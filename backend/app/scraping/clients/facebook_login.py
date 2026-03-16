"""HTTP-based Facebook login via mbasic.facebook.com.

Uses curl_cffi for realistic browser TLS fingerprinting to avoid
Facebook's bot detection (JA3/JA4 fingerprint checks).
"""

import logging
import random
import re
from html.parser import HTMLParser

from curl_cffi.requests import AsyncSession

logger = logging.getLogger(__name__)

MBASIC_BASE = "https://mbasic.facebook.com"

# Browser impersonation targets for realistic TLS fingerprints
IMPERSONATE_TARGETS = [
    "chrome120",
    "chrome119",
    "chrome116",
]

# Realistic mobile UAs for mbasic
MOBILE_USER_AGENTS = [
    "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.43 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.71 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 12; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.6045.66 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; Redmi Note 12 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36",
]


def random_user_agent() -> str:
    return random.choice(MOBILE_USER_AGENTS)


def build_proxy_url(proxy: dict) -> str | None:
    """Convert proxy dict {host, port, username, password} to proxy URL."""
    if not proxy or not proxy.get("host"):
        return None
    host = proxy["host"]
    port = proxy.get("port", "")
    username = proxy.get("username", "")
    password = proxy.get("password", "")
    if username and password:
        return f"http://{username}:{password}@{host}:{port}"
    return f"http://{host}:{port}"


class FormFieldParser(HTMLParser):
    """Parse HTML to extract hidden form fields and the first POST form action URL."""

    def __init__(self):
        super().__init__()
        self.fields: dict[str, str] = {}
        self.form_action: str | None = None
        self._in_form = False

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        if tag == "form" and attrs_dict.get("method", "").lower() == "post":
            if self.form_action is None:  # take the first POST form
                self.form_action = attrs_dict.get("action", "")
            self._in_form = True
        if tag == "input" and self._in_form:
            input_type = attrs_dict.get("type", "").lower()
            name = attrs_dict.get("name", "")
            value = attrs_dict.get("value", "")
            if input_type == "hidden" and name:
                self.fields[name] = value

    def handle_endtag(self, tag):
        if tag == "form":
            self._in_form = False


async def fb_mbasic_login(
    email: str,
    password: str,
    totp_secret: str | None = None,
    proxy: dict | None = None,
    user_agent: str | None = None,
) -> dict:
    """
    Perform HTTP-based login against mbasic.facebook.com.

    Returns:
        {
            "success": bool,
            "cookie_string": str | None,   # "c_user=...; xs=..."
            "fb_user_id": str | None,
            "user_agent": str,
            "error": str | None,
        }
    """
    ua = user_agent or random_user_agent()
    proxy_url = build_proxy_url(proxy)
    impersonate = random.choice(IMPERSONATE_TARGETS)

    logger.info(
        "fb_mbasic_login: email=%s proxy=%s impersonate=%s",
        email, bool(proxy), impersonate,
    )

    try:
        async with AsyncSession(
            impersonate=impersonate,
            proxy=proxy_url,
            timeout=30,
            headers={"User-Agent": ua},
        ) as session:
            return await _do_login(session, email, password, totp_secret, ua, bool(proxy_url))
    except Exception as exc:
        err_str = str(exc).lower()
        if "proxy" in err_str:
            return _fail(ua, f"Proxy error: {exc}")
        if "timeout" in err_str or "timed out" in err_str:
            return _fail(ua, f"Timeout: {exc}")
        if "connect" in err_str:
            return _fail(ua, f"Connection error: {exc}")
        return _fail(ua, f"Unexpected error: {exc}")


async def _do_login(
    session: AsyncSession, email: str, password: str,
    totp_secret: str | None, ua: str, has_proxy: bool = False,
) -> dict:
    """Internal login flow."""

    # ── Step 1: GET login page ───────────────────────────────────────
    resp = await session.get(f"{MBASIC_BASE}/login/", allow_redirects=False)
    if resp.status_code not in (200, 301, 302):
        return _fail(ua, f"Login page returned {resp.status_code}")

    # Follow redirect if needed
    if resp.status_code in (301, 302):
        loc = resp.headers.get("location", "")
        if loc:
            resp = await session.get(_abs_url(loc), allow_redirects=False)

    parser = FormFieldParser()
    parser.feed(resp.text)

    form_action = parser.form_action or "/login/device-based/regular/login/"
    form_action = _abs_url(form_action)

    # ── Step 2: POST login form ──────────────────────────────────────
    post_data = {**parser.fields, "email": email, "pass": password, "login": "Log In"}
    resp = await session.post(
        form_action,
        data=post_data,
        headers={"Referer": f"{MBASIC_BASE}/login/", "Origin": MBASIC_BASE},
        allow_redirects=False,
    )

    logger.info(
        "Login POST result: status=%s url=%s",
        resp.status_code,
        resp.url,
    )

    # 400 = Facebook blocked the request (datacenter IP / bot detection)
    if resp.status_code == 400:
        proxy_info = f"proxy={'yes' if has_proxy else 'NO'}"
        return _fail(ua, f"Login blocked by Facebook (HTTP 400) — {proxy_info}")

    # ── Step 3: Determine outcome ────────────────────────────────────
    # Follow redirect chain (up to 5 hops)
    redirect_urls = []
    for _ in range(5):
        if resp.status_code not in (301, 302, 303, 307):
            break
        loc = resp.headers.get("location", "")
        if not loc:
            break
        next_url = _abs_url(loc)
        redirect_urls.append(next_url)
        logger.info("Login redirect hop: %s", next_url)

        # Check if we landed on home = success
        if _is_home_url(next_url):
            resp = await session.get(next_url, allow_redirects=False)
            return _extract_cookies(session, ua)

        # Check if it's a checkpoint (2FA)
        if "/checkpoint" in next_url:
            resp = await session.get(next_url, allow_redirects=False)
            return await _handle_checkpoint(session, resp, totp_secret, ua)

        resp = await session.get(next_url, allow_redirects=False)

    # Check cookies after redirect chain
    if _has_c_user(session):
        return _extract_cookies(session, ua)

    url_str = str(resp.url)
    body = resp.text

    logger.info(
        "Login post-redirect: url=%s status=%s body_len=%d redirects=%s",
        url_str, resp.status_code, len(body), redirect_urls,
    )

    # Check for checkpoint FIRST — URL may contain both /login and /checkpoint
    if "/checkpoint" in url_str:
        return await _handle_checkpoint(session, resp, totp_secret, ua)

    # Detect checkpoint/2FA from response body
    if _body_has_checkpoint(body):
        logger.info("Detected checkpoint/2FA from response body (url=%s)", url_str)
        return await _handle_checkpoint(session, resp, totp_secret, ua)

    # Extract diagnostic snippet for debugging
    diag = _extract_error_snippet(body)

    # Still on login page = invalid credentials
    if "/login" in url_str:
        msg = "Invalid credentials"
        if diag:
            msg += f" ({diag})"
        return _fail(ua, msg)

    return _fail(ua, f"Unexpected state: url={url_str}, status={resp.status_code}")


async def _handle_checkpoint(
    session: AsyncSession, resp, totp_secret: str | None, ua: str,
) -> dict:
    """Handle 2FA checkpoint and follow-up screens."""
    if not totp_secret:
        return _fail(ua, "2FA required but no TOTP secret provided")

    import pyotp
    totp = pyotp.TOTP(totp_secret)
    code = totp.now()

    # Parse checkpoint form
    cp_parser = FormFieldParser()
    cp_parser.feed(resp.text)

    cp_action = cp_parser.form_action or "/checkpoint/"
    cp_action = _abs_url(cp_action)

    cp_data = {**cp_parser.fields, "approvals_code": code, "submit[Submit Code]": "Submit Code"}
    resp = await session.post(cp_action, data=cp_data, allow_redirects=False)

    # Handle up to 3 follow-up checkpoint rounds ("This was me", "Don't save", etc.)
    for _ in range(3):
        # Follow redirect if needed
        if resp.status_code in (301, 302, 303):
            loc = resp.headers.get("location", "")
            if not loc:
                break
            next_url = _abs_url(loc)
            if _is_home_url(next_url):
                await session.get(next_url, allow_redirects=False)
                return _extract_cookies(session, ua)
            resp = await session.get(next_url, allow_redirects=False)

        # Check if we have cookies now
        if _has_c_user(session):
            return _extract_cookies(session, ua)

        # If still on checkpoint, parse and submit the next form
        if "/checkpoint" in str(resp.url):
            cp2 = FormFieldParser()
            cp2.feed(resp.text)
            if cp2.form_action:
                act = _abs_url(cp2.form_action)
                data2 = {**cp2.fields}
                data2["submit[This was me]"] = "This was me"
                data2["name_action_selected"] = "dont_save"
                resp = await session.post(act, data=data2, allow_redirects=False)
            else:
                break
        else:
            break

    # Final check
    if _has_c_user(session):
        return _extract_cookies(session, ua)

    return _fail(ua, "2FA submitted but login still failed (account may need review)")


# ── Helpers ──────────────────────────────────────────────────────────

def _abs_url(url: str) -> str:
    """Ensure URL is absolute."""
    if url.startswith("http"):
        return url
    return MBASIC_BASE + (url if url.startswith("/") else "/" + url)


def _extract_error_snippet(body: str) -> str:
    """Extract error/status text from Facebook response for diagnostics."""
    patterns = [
        r'id="login_error"[^>]*>(.*?)</div>',
        r'class="[^"]*error[^"]*"[^>]*>(.*?)</div>',
        r'<title>(.*?)</title>',
    ]
    for pat in patterns:
        m = re.search(pat, body, re.DOTALL | re.IGNORECASE)
        if m:
            text = re.sub(r'<[^>]+>', '', m.group(1)).strip()
            if text:
                return text[:120]
    return ""


def _body_has_checkpoint(body: str) -> bool:
    """Detect 2FA / checkpoint page from response body content."""
    indicators = [
        "approvals_code",
        "checkpoint",
        "two-factor",
        "login_approvals",
        "Enter the code",
        "enter the login code",
        "verify your identity",
        "submit[Submit Code]",
        "pengesahan",
        "code generator",
        "security code",
        "authentication code",
        "/checkpoint/",
    ]
    body_lower = body.lower()
    return any(ind.lower() in body_lower for ind in indicators)


def _is_home_url(url: str) -> bool:
    """Check if URL is the Facebook home page."""
    stripped = url.rstrip("/")
    return stripped in (
        "https://mbasic.facebook.com",
        "https://m.facebook.com",
        "https://www.facebook.com",
        "https://facebook.com",
    ) or stripped.endswith("facebook.com/home.php")


def _has_c_user(session: AsyncSession) -> bool:
    """Check if c_user cookie exists in the session."""
    return session.cookies.get("c_user") is not None


def _extract_cookies(session: AsyncSession, ua: str) -> dict:
    """Extract cookies from session into a raw string."""
    cookie_parts = []
    fb_user_id = None
    for name, value in session.cookies.items():
        cookie_parts.append(f"{name}={value}")
        if name == "c_user":
            fb_user_id = value

    cookie_string = "; ".join(cookie_parts)

    if not fb_user_id:
        return _fail(ua, "Login appeared successful but c_user cookie not found")

    return {
        "success": True,
        "cookie_string": cookie_string,
        "fb_user_id": fb_user_id,
        "user_agent": ua,
        "error": None,
    }


def _fail(ua: str, error: str) -> dict:
    """Return a failure result dict."""
    return {
        "success": False,
        "cookie_string": None,
        "fb_user_id": None,
        "user_agent": ua,
        "error": error,
    }
