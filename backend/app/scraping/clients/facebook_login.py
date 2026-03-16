"""Browser-based Facebook login via Playwright + Chromium.

Launches real headless Chromium instances with per-login proxy support.
This bypasses all bot detection since it's an actual browser with real
JS execution, TLS fingerprint, and cookie handling.
"""

import logging
import random

from playwright.async_api import async_playwright

logger = logging.getLogger(__name__)

# Realistic mobile UAs
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
    """Convert proxy dict to URL string (kept for backward compat)."""
    if not proxy or not proxy.get("host"):
        return None
    host = proxy["host"]
    port = proxy.get("port", "")
    username = proxy.get("username", "")
    password = proxy.get("password", "")
    if username and password:
        return f"http://{username}:{password}@{host}:{port}"
    return f"http://{host}:{port}"


def _build_playwright_proxy(proxy: dict) -> dict | None:
    """Convert proxy dict to Playwright proxy config."""
    if not proxy or not proxy.get("host"):
        return None
    config = {
        "server": f"http://{proxy['host']}:{proxy.get('port', '')}",
    }
    if proxy.get("username"):
        config["username"] = proxy["username"]
    if proxy.get("password"):
        config["password"] = proxy["password"]
    return config


async def fb_mbasic_login(
    email: str,
    password: str,
    totp_secret: str | None = None,
    proxy: dict | None = None,
    user_agent: str | None = None,
) -> dict:
    """
    Perform browser-based login against mbasic.facebook.com.

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
    proxy_config = _build_playwright_proxy(proxy)

    logger.info(
        "fb_mbasic_login: email=%s proxy=%s method=playwright",
        email, bool(proxy),
    )

    try:
        async with async_playwright() as p:
            # Launch Chromium with proxy (if any)
            launch_args = {
                "headless": True,
                "args": ["--no-sandbox", "--disable-dev-shm-usage"],
            }
            if proxy_config:
                launch_args["proxy"] = proxy_config

            browser = await p.chromium.launch(**launch_args)
            context = await browser.new_context(
                user_agent=ua,
                viewport={"width": 375, "height": 812},
                locale="en-US",
            )

            try:
                page = await context.new_page()
                return await _do_login(page, context, email, password, totp_secret, ua, bool(proxy))
            finally:
                await context.close()
                await browser.close()
    except Exception as exc:
        err_str = str(exc).lower()
        if "proxy" in err_str:
            return _fail(ua, f"Proxy error: {exc}")
        if "timeout" in err_str or "timed out" in err_str:
            return _fail(ua, f"Timeout: {exc}")
        return _fail(ua, f"Browser error: {exc}")


async def _do_login(page, context, email: str, password: str, totp_secret: str | None, ua: str, has_proxy: bool) -> dict:
    """Internal login flow using real browser."""

    # ── Step 1: Navigate to login page ──────────────────────────────
    resp = await page.goto(
        "https://mbasic.facebook.com/login/",
        wait_until="domcontentloaded",
        timeout=30000,
    )

    if resp and resp.status == 400:
        proxy_info = f"proxy={'yes' if has_proxy else 'NO'}"
        return _fail(ua, f"Login page blocked (HTTP 400) — {proxy_info}")

    # ── Step 1b: Handle cookie consent / interstitials ─────────────
    # mbasic may show a cookie consent page first
    accept_btn = page.locator('button[name="accept_only_essential"], button[title="Accept All"], input[value="Accept All"], input[value="OK"], button:has-text("Accept")')
    if await accept_btn.count() > 0:
        logger.info("Cookie consent detected, clicking accept")
        try:
            async with page.expect_navigation(wait_until="domcontentloaded", timeout=10000):
                await accept_btn.first.click()
        except Exception:
            pass  # might not navigate

    # ── Step 2: Fill and submit credentials ─────────────────────────
    # Wait for email field (may take a moment after consent)
    email_field = page.locator('input[name="email"]')
    if await email_field.count() == 0:
        # Log page content for debugging
        title = await page.title()
        url_now = page.url
        snippet = (await page.content())[:500]
        logger.warning("No email field found: title=%s url=%s body=%s", title, url_now, snippet)
        return _fail(ua, f"Login form not found (title={title}, url={url_now})")

    await email_field.fill(email)
    await page.locator('input[name="pass"]').fill(password)

    # Find submit button — mbasic uses various names/types
    submit_btn = page.locator('input[name="login"]')
    if await submit_btn.count() == 0:
        submit_btn = page.locator('input[type="submit"], button[type="submit"]').first

    # Click login and wait for navigation
    async with page.expect_navigation(wait_until="domcontentloaded", timeout=30000):
        await submit_btn.click()

    # ── Step 3: Determine outcome ───────────────────────────────────
    url = page.url
    logger.info("Login result: url=%s", url)

    # Check if we landed on home page (success)
    if _is_home_url(url):
        return await _extract_cookies(context, ua)

    # Check cookies (might have succeeded without landing on home)
    if await _has_c_user(context):
        return await _extract_cookies(context, ua)

    # Check for 2FA checkpoint
    if "/checkpoint" in url:
        return await _handle_checkpoint(page, context, totp_secret, ua)

    # Detect checkpoint from page content
    body = await page.content()
    if _body_has_checkpoint(body):
        logger.info("Detected checkpoint/2FA from page content (url=%s)", url)
        return await _handle_checkpoint(page, context, totp_secret, ua)

    # Still on login page = invalid credentials
    if "/login" in url:
        error_text = ""
        error_el = page.locator('#login_error')
        if await error_el.count() > 0:
            error_text = (await error_el.inner_text()).strip()[:120]
        msg = "Invalid credentials"
        if error_text:
            msg += f" ({error_text})"
        return _fail(ua, msg)

    return _fail(ua, f"Unexpected state: url={url}")


async def _handle_checkpoint(page, context, totp_secret: str | None, ua: str) -> dict:
    """Handle 2FA checkpoint and follow-up screens."""
    if not totp_secret:
        return _fail(ua, "2FA required but no TOTP secret provided")

    import pyotp
    code = pyotp.TOTP(totp_secret).now()

    # Fill 2FA code
    code_input = page.locator('input[name="approvals_code"]')
    if await code_input.count() > 0:
        await code_input.fill(code)

        # Submit the code
        submit = page.locator('input[type="submit"], button[type="submit"]')
        if await submit.count() > 0:
            try:
                async with page.expect_navigation(wait_until="domcontentloaded", timeout=30000):
                    await submit.first.click()
            except Exception:
                pass  # navigation might not happen

    # Handle up to 3 follow-up screens ("This was me", "Don't save", etc.)
    for _ in range(3):
        if await _has_c_user(context):
            return await _extract_cookies(context, ua)

        if _is_home_url(page.url):
            return await _extract_cookies(context, ua)

        if "/checkpoint" not in page.url:
            break

        # Try clicking the next submit button
        submit = page.locator('input[type="submit"], button[type="submit"]')
        if await submit.count() > 0:
            try:
                async with page.expect_navigation(wait_until="domcontentloaded", timeout=15000):
                    await submit.first.click()
            except Exception:
                break
        else:
            break

    # Final check
    if await _has_c_user(context):
        return await _extract_cookies(context, ua)

    return _fail(ua, "2FA submitted but login still failed (account may need review)")


# ── Helpers ──────────────────────────────────────────────────────────

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


async def _has_c_user(context) -> bool:
    """Check if c_user cookie exists in the browser context."""
    cookies = await context.cookies()
    return any(c["name"] == "c_user" for c in cookies)


async def _extract_cookies(context, ua: str) -> dict:
    """Extract cookies from browser context."""
    cookies = await context.cookies()
    cookie_parts = []
    fb_user_id = None
    for c in cookies:
        cookie_parts.append(f"{c['name']}={c['value']}")
        if c["name"] == "c_user":
            fb_user_id = c["value"]

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
