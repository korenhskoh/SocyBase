#!/usr/bin/env python3
"""
SocyBase Local Login Worker
============================
Runs Facebook bulk login on YOUR machine using a real Chromium browser.
Results are sent back to SocyBase server automatically.

Requirements:
    pip install playwright httpx pyotp
    playwright install chromium

Usage:
    python fb_login_worker.py --url https://your-socybase.up.railway.app --token YOUR_JWT --batch BATCH_ID

Options:
    --headless        Run browser without visible window (default: show browser)
    --2fa-wait SEC    Seconds to wait for 2FA/security check (default: 60)
"""

import argparse
import asyncio
import logging
import random
import re
import sys
import time

try:
    import httpx
except ImportError:
    print("ERROR: httpx not installed. Run: pip install httpx")
    sys.exit(1)

try:
    from playwright.async_api import async_playwright
except ImportError:
    print("ERROR: playwright not installed. Run: pip install playwright && playwright install chromium")
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("fb-worker")

# ── Desktop User Agents ──────────────────────────────────────────────
DESKTOP_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) ApplyWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
]

MAX_LOGIN_ATTEMPTS = 3

# ── Follow-up button keywords ────────────────────────────────────────
PREFERRED_BUTTONS = ["always confirm", "always trust"]
FALLBACK_BUTTONS = ["trust", "confirm", "continue", "this was me", "save", "ok", "skip", "not now", "lanjutkan", "next"]

# 2FA code input selectors
TWO_FA_SELECTORS = [
    'input[name="approvals_code"]', 'input[name="code"]',
    'input[type="tel"]', 'input[type="number"]',
    'input[autocomplete="one-time-code"]', 'input[inputmode="numeric"]',
]


# ── API Client ────────────────────────────────────────────────────────

class SocyBaseAPI:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.client = httpx.Client(
            base_url=f"{self.base_url}/api/v1",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30.0,
        )

    def get_worker_data(self, batch_id: str) -> dict:
        r = self.client.get(f"/fb-action/login-batch/{batch_id}/worker-data")
        r.raise_for_status()
        return r.json()

    def worker_start(self, batch_id: str):
        r = self.client.post(f"/fb-action/login-batch/{batch_id}/worker-start")
        r.raise_for_status()

    def post_result(self, batch_id: str, result: dict):
        """Post result with retry (up to 3 attempts with backoff)."""
        for attempt in range(3):
            try:
                r = self.client.post(f"/fb-action/login-batch/{batch_id}/worker-result", json=result)
                r.raise_for_status()
                return
            except Exception as e:
                logger.warning("API POST attempt %d/3 failed: %s", attempt + 1, e)
                if attempt < 2:
                    time.sleep(2 ** attempt + random.random())
                else:
                    raise

    def worker_complete(self, batch_id: str):
        r = self.client.post(f"/fb-action/login-batch/{batch_id}/worker-complete")
        r.raise_for_status()


# ── Facebook Login Logic ──────────────────────────────────────────────

def _build_playwright_proxy(proxy: dict) -> dict | None:
    if not proxy or not proxy.get("host"):
        return None
    config = {"server": f"http://{proxy['host']}:{proxy.get('port', '')}"}
    if proxy.get("username"):
        config["username"] = proxy["username"]
    if proxy.get("password"):
        config["password"] = proxy["password"]
    return config


def _select_proxy(row: dict, proxy_pool: list, index: int) -> dict | None:
    host = row.get("proxy_host", "")
    if host:
        return {
            "host": host,
            "port": row.get("proxy_port", ""),
            "username": row.get("proxy_username", ""),
            "password": row.get("proxy_password", ""),
        }
    if proxy_pool:
        return proxy_pool[index % len(proxy_pool)]
    return None


def _is_home_url(url: str) -> bool:
    stripped = url.rstrip("/")
    return stripped in (
        "https://mbasic.facebook.com",
        "https://m.facebook.com",
        "https://www.facebook.com",
        "https://facebook.com",
    ) or stripped.endswith("facebook.com/home.php") or "facebook.com/?sk=" in url


def _is_security_check_text(text: str) -> dict:
    """Check page text for security check indicators (Arkose)."""
    lower = text.lower()
    has_heading = "running security checks" in lower or "please wait while we verify" in lower
    has_footer = "combat harmful conduct" in lower or "arkose" in lower or "matchkey" in lower
    return {"has_heading": has_heading, "has_footer": has_footer, "is_security_check": has_heading or has_footer}


def _is_2fa_text(text: str) -> bool:
    indicators = [
        "approvals_code", "two-factor", "enter the code",
        "security code", "authentication code", "verify your identity",
        "masukkan kode",
    ]
    lower = text.lower()
    return any(ind in lower for ind in indicators)


def _is_trust_text(text: str) -> bool:
    indicators = [
        "always trust", "trust this browser", "save browser",
        "this was me", "remember browser", "trust this device",
    ]
    lower = text.lower()
    return any(ind in lower for ind in indicators)


def _is_follow_up_url(url: str) -> bool:
    return any(seg in url for seg in ["/checkpoint", "/two_step", "/two_factor", "/auth", "/remember_browser"])


async def _has_c_user(context) -> bool:
    cookies = await context.cookies()
    return any(c["name"] == "c_user" for c in cookies)


async def _extract_cookies(context, ua: str) -> dict:
    cookies = await context.cookies()
    cookie_parts = []
    fb_user_id = None
    has_xs = False
    for c in cookies:
        cookie_parts.append(f"{c['name']}={c['value']}")
        if c["name"] == "c_user":
            fb_user_id = c["value"]
        if c["name"] == "xs":
            has_xs = True
    # Both c_user and xs are required for a valid session
    if not fb_user_id or not has_xs:
        return {"success": False, "cookie_string": None, "fb_user_id": None, "user_agent": ua,
                "error": "Login appeared successful but c_user/xs cookie not found"}
    return {"success": True, "cookie_string": "; ".join(cookie_parts),
            "fb_user_id": fb_user_id, "user_agent": ua, "error": None}


def _fail(ua: str, error: str) -> dict:
    return {"success": False, "cookie_string": None, "fb_user_id": None, "user_agent": ua, "error": error}


# ── Follow-up screens (Trust this device / Always confirm) ───────────

async def _handle_follow_up_screens(page, context, ua: str) -> dict:
    """Click through trust/save/review screens until we reach home or cookies."""
    for i in range(5):
        url = page.url
        logger.info("Follow-up screen %d: %s", i + 1, url[:80])

        if _is_home_url(url):
            await page.wait_for_timeout(3000)
            result = await _extract_cookies(context, ua)
            if result["success"]:
                return result
            break

        if not _is_follow_up_url(url):
            result = await _extract_cookies(context, ua)
            if result["success"]:
                return result
            break

        # Click follow-up button FIRST — prefer "always confirm" over "trust this device"
        buttons = page.locator('div[role="button"], button[type="submit"], button, input[type="submit"], a[role="button"]')
        btn_count = await buttons.count()

        clicked = False
        # Pass 1: prefer "always confirm" / "always trust"
        for j in range(btn_count):
            btn = buttons.nth(j)
            try:
                text = (await btn.inner_text()).strip().lower()
            except Exception:
                continue
            if any(kw in text for kw in PREFERRED_BUTTONS):
                logger.info("Clicking preferred button: '%s'", text)
                try:
                    await btn.click()
                    clicked = True
                except Exception:
                    pass
                break

        # Pass 2: fallback to other action buttons
        if not clicked:
            for j in range(btn_count):
                btn = buttons.nth(j)
                try:
                    text = (await btn.inner_text()).strip().lower()
                except Exception:
                    continue
                if any(kw in text for kw in FALLBACK_BUTTONS):
                    logger.info("Clicking follow-up button: '%s'", text)
                    try:
                        await btn.click()
                        clicked = True
                    except Exception:
                        pass
                    break

        if clicked:
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=15000)
            except Exception:
                pass
            # Wait 7s for cookies to settle after button click
            await page.wait_for_timeout(7000)
        else:
            # No button found — try submitting any form
            submit = page.locator('input[type="submit"]')
            if await submit.count() > 0:
                try:
                    await submit.first.click()
                    await page.wait_for_load_state("domcontentloaded", timeout=15000)
                    await page.wait_for_timeout(3000)
                except Exception:
                    break
            else:
                break

    # Final cookie check
    result = await _extract_cookies(context, ua)
    if result["success"]:
        return result
    return _fail(ua, f"Follow-up screens not resolved (url={page.url[:80]})")


# ── 2FA handling ─────────────────────────────────────────────────────

async def _handle_2fa(page, context, totp_secret: str | None, ua: str, two_fa_wait: int) -> dict:
    """Handle 2FA code entry and submission."""
    if not totp_secret:
        return _fail(ua, "2FA required but no TOTP secret provided")

    try:
        import pyotp
    except ImportError:
        return _fail(ua, "2FA required but pyotp not installed (pip install pyotp)")

    logger.info("Entering 2FA flow (wait=%ds)", two_fa_wait)
    await page.wait_for_timeout(2000)

    # Step 0: If security check heading still present, wait for it to clear
    body_text = await page.inner_text("body")
    sec = _is_security_check_text(body_text)
    if sec["has_heading"]:
        logger.info("Security check heading still present in 2FA — waiting for it to clear...")
        for wait_i in range(20):
            await page.wait_for_timeout(3000)
            body_text = await page.inner_text("body")
            sec = _is_security_check_text(body_text)
            if not sec["has_heading"]:
                logger.info("Security check heading cleared in 2FA")
                await page.wait_for_timeout(2000)
                break

    # Step 1: Handle "Choose a way to confirm" dialog
    for nav_attempt in range(3):
        body_text = await page.inner_text("body")
        body_lower = body_text.lower()
        is_selection = "choose a way" in body_lower or "confirmation method" in body_lower or "pilih cara" in body_lower

        if not is_selection:
            break

        logger.info("2FA method selection page detected — choosing authenticator app")
        # Click "Authentication app" option
        options = page.locator('div[role="radio"], input[type="radio"], div[role="listitem"], div[role="option"], label')
        opt_count = await options.count()
        for j in range(opt_count):
            opt = options.nth(j)
            try:
                text = (await opt.inner_text()).strip().lower()
            except Exception:
                continue
            if "authentication app" in text or "authenticator" in text or "aplikasi autentikasi" in text or "code generator" in text:
                await opt.click()
                break

        # Click Continue
        cont_btns = page.locator('div[role="button"], button, input[type="submit"]')
        cont_count = await cont_btns.count()
        for j in range(cont_count):
            btn = cont_btns.nth(j)
            try:
                text = (await btn.inner_text()).strip().lower()
            except Exception:
                continue
            if text in ("continue", "lanjutkan", "next"):
                try:
                    async with page.expect_navigation(wait_until="domcontentloaded", timeout=15000):
                        await btn.click()
                except Exception:
                    pass
                await page.wait_for_timeout(2000)
                break

    # Step 2: Wait for code input and fill TOTP
    max_attempts = max(5, two_fa_wait // 3)
    code_filled = False
    for attempt in range(max_attempts):
        if attempt > 0:
            logger.info("2FA code input scan %d/%d — waiting 3s...", attempt + 1, max_attempts)
            await page.wait_for_timeout(3000)

        # Early exit: redirected to login page
        if "/login" in page.url and "/two_step" not in page.url and "/checkpoint" not in page.url:
            return _fail(ua, "Login rejected (redirected to login during 2FA)")

        # Early exit: cookies appeared
        if await _has_c_user(context):
            return await _extract_cookies(context, ua)

        # Check for code input
        code_input = None
        for sel in TWO_FA_SELECTORS:
            loc = page.locator(sel)
            if await loc.count() > 0:
                code_input = loc.first
                break

        # Fallback: any visible text/tel/number input not email/password
        if not code_input:
            all_inputs = page.locator('input[type="text"], input[type="tel"], input[type="number"], input:not([type])')
            inp_count = await all_inputs.count()
            for j in range(inp_count):
                inp = all_inputs.nth(j)
                if await inp.is_visible():
                    name = await inp.get_attribute("name") or ""
                    if "email" not in name and "pass" not in name:
                        code_input = inp
                        break

        if code_input:
            # Generate TOTP code fresh
            code = pyotp.TOTP(totp_secret).now()
            logger.info("Generated TOTP code: %s (attempt %d)", code, attempt + 1)
            await code_input.fill(code)
            code_filled = True
            break
        else:
            logger.info("2FA scan #%d: no input found", attempt + 1)
            # Maybe there's still a method selection — click auth app + continue
            try:
                auth_opt = page.locator('div[role="radio"], div[role="listitem"], label')
                ac = await auth_opt.count()
                for j in range(ac):
                    opt = auth_opt.nth(j)
                    text = (await opt.inner_text()).strip().lower()
                    if "authentication app" in text or "authenticator" in text:
                        await opt.click()
                        break
                cont = page.locator('div[role="button"], button')
                cc = await cont.count()
                for j in range(cc):
                    btn = cont.nth(j)
                    text = (await btn.inner_text()).strip().lower()
                    if text in ("continue", "lanjutkan"):
                        await btn.click()
                        break
            except Exception:
                pass

    if not code_filled:
        return _fail(ua, f"2FA input not found after {max_attempts} attempts ({two_fa_wait}s)")

    # Step 3: Click submit button
    await page.wait_for_timeout(500)
    submit_keywords = ["continue", "submit", "verify", "confirm", "lanjutkan", "kirim", "send", "next"]
    submit_btns = page.locator('div[role="button"], button[type="submit"], button, input[type="submit"]')
    sub_count = await submit_btns.count()
    for j in range(sub_count):
        btn = submit_btns.nth(j)
        try:
            text = (await btn.inner_text()).strip().lower()
        except Exception:
            text = ""
        if any(kw in text for kw in submit_keywords):
            try:
                async with page.expect_navigation(wait_until="domcontentloaded", timeout=30000):
                    await btn.click()
            except Exception:
                pass
            break

    # Step 4: Wait and check post-2FA state
    url = page.url
    logger.info("Post-2FA URL: %s", url[:80])

    # Always handle follow-up screens first (click "Always confirm" etc.)
    if _is_follow_up_url(url):
        logger.info("Follow-up page detected after 2FA — handling before extracting cookies")
        follow_result = await _handle_follow_up_screens(page, context, ua)
        if follow_result["success"]:
            return follow_result

    # Check cookies
    if await _has_c_user(context):
        return await _extract_cookies(context, ua)

    # Last resort: try follow-up screens one more time
    return await _handle_follow_up_screens(page, context, ua)


# ── Security check (Arkose) handling ─────────────────────────────────

async def _handle_security_check(page, context, email: str, password: str, totp_secret: str | None, ua: str, two_fa_wait: int) -> dict:
    """Wait through Arkose security check, then handle 2FA/trust/re-login."""
    timeout_ms = two_fa_wait * 1000
    start = time.time()
    elapsed = lambda: (time.time() - start) * 1000

    logger.info("Security check detected. Waiting up to %ds for 2FA input...", two_fa_wait)

    while elapsed() < timeout_ms:
        await page.wait_for_timeout(3000)

        # Check 1: cookies appeared → success
        if await _has_c_user(context):
            logger.info("Got cookies during security check wait")
            return await _extract_cookies(context, ua)

        # Check 2: page state
        body_text = await page.inner_text("body")
        sec = _is_security_check_text(body_text)
        has_2fa_input = False
        for sel in TWO_FA_SELECTORS:
            if await page.locator(sel).count() > 0:
                has_2fa_input = True
                break
        has_2fa_text = _is_2fa_text(body_text)
        is_trust = _is_trust_text(body_text)

        secs = int(elapsed() / 1000)
        logger.info("Scan (%ds): heading=%s, footer=%s, 2faInput=%s, 2faText=%s",
                     secs, sec["has_heading"], sec["has_footer"], has_2fa_input, has_2fa_text)

        # Check 3: 2FA input found → handle it
        if has_2fa_input or has_2fa_text:
            logger.info("2FA input found at %ds — proceeding to TOTP", secs)
            return await _handle_2fa(page, context, totp_secret, ua, two_fa_wait)

        # Check 4: trust page
        if is_trust:
            return await _handle_follow_up_screens(page, context, ua)

        # Check 5: still on security check page → keep waiting
        if sec["has_heading"] or sec["has_footer"]:
            continue

        # Check 6: both gone → check URL
        url = page.url
        if _is_home_url(url):
            result = await _extract_cookies(context, ua)
            if result["success"]:
                return result
            return _fail(ua, "Home page reached after security check but no c_user cookie")

        if "/login" in url and "/two_step" not in url and "/checkpoint" not in url:
            # Security check failed → redirected back to login
            # Re-fill credentials on the SAME page
            logger.info("Security check redirected to login at %ds — re-filling credentials...", secs)
            await page.wait_for_timeout(1500)

            email_field = page.locator('input[name="email"]')
            if await email_field.count() == 0:
                return _fail(ua, "Login form not found on re-login after security check")

            await email_field.fill(email)
            await page.wait_for_timeout(200)
            await page.locator('input[name="pass"]').fill(password)
            await page.wait_for_timeout(300)

            # Click login button
            login_btn = page.locator(
                'button[data-testid="royal_login_button"], button[name="login"], button#loginbutton'
            )
            if await login_btn.count() == 0:
                login_btn = page.get_by_role("button", name="Log in").first
            if await login_btn.count() == 0:
                login_btn = page.locator('input[type="submit"], button[type="submit"]').first

            try:
                async with page.expect_navigation(wait_until="domcontentloaded", timeout=30000):
                    await login_btn.click()
            except Exception:
                pass
            logger.info("Re-login submitted — post-nav URL: %s", page.url[:80])
            # Continue scan loop — should land on 2FA next
            continue

        logger.info("No indicators at %ds, URL=%s — continuing scan...", secs, url[:80])

    return _fail(ua, f"2FA input not found after security check (waited {two_fa_wait}s)")


# ── EAAB Token Extraction ────────────────────────────────────────────

async def _extract_eaab_token(page) -> str | None:
    """Extract EAAB access token from Facebook business page (best-effort)."""
    try:
        await page.goto("https://business.facebook.com/content_management", wait_until="domcontentloaded", timeout=20000)
        await page.wait_for_timeout(3000)  # Wait for JS to render

        content = await page.content()
        # Try multiple patterns for EAAB token
        patterns = [
            r'"accessToken":"(EAAB[^"]+)"',
            r'"access_token":"(EAAB[^"]+)"',
            r'accessToken\s*[:=]\s*"(EAAB[^"]+)"',
            r'(EAAB[a-zA-Z0-9]+)',
        ]
        for pattern in patterns:
            match = re.search(pattern, content)
            if match:
                token = match.group(1)
                if token.startswith("EAAB"):
                    logger.info("EAAB token extracted: %s...", token[:20])
                    return token
        logger.info("No EAAB token found on business page")
        return None
    except Exception as e:
        logger.warning("EAAB extraction failed: %s", e)
        return None


# ── Main login flow ──────────────────────────────────────────────────

async def _do_login(page, context, email: str, password: str, totp_secret: str | None, ua: str, has_proxy: bool, two_fa_wait: int) -> dict:
    resp = await page.goto("https://www.facebook.com/login/", wait_until="domcontentloaded", timeout=30000)
    if resp and resp.status == 400:
        return _fail(ua, f"Login page blocked (HTTP 400) -- proxy={'yes' if has_proxy else 'NO'}")

    # Cookie consent
    consent = page.locator('[data-cookiebanner="accept_button"], button:has-text("Allow all cookies"), button:has-text("Accept All"), button:has-text("Accept")')
    if await consent.count() > 0:
        try:
            await consent.first.click()
            await page.wait_for_timeout(1000)
        except Exception:
            pass

    # Fill credentials
    email_field = page.locator('input[name="email"]')
    if await email_field.count() == 0:
        title = await page.title()
        return _fail(ua, f"Login form not found (title={title}, url={page.url})")

    await email_field.fill(email)
    await page.wait_for_timeout(200)
    await page.locator('input[name="pass"]').fill(password)
    await page.wait_for_timeout(300)

    login_btn = page.get_by_role("button", name="Log in").first
    if await login_btn.count() == 0:
        login_btn = page.locator('#login_form input[type="submit"], input[type="submit"], input[name="login"]').first

    try:
        async with page.expect_navigation(wait_until="domcontentloaded", timeout=30000):
            await login_btn.click()
    except Exception:
        pass

    url = page.url

    # Success: redirected to home
    if _is_home_url(url):
        return await _extract_cookies(context, ua)
    if await _has_c_user(context):
        return await _extract_cookies(context, ua)

    # Check page body for various states
    body_text = await page.inner_text("body")

    # Security check (Arkose) — unified scan loop
    sec = _is_security_check_text(body_text)
    if sec["is_security_check"]:
        return await _handle_security_check(page, context, email, password, totp_secret, ua, two_fa_wait)

    # Checkpoint/2FA URL
    if "/checkpoint" in url or "/two_step" in url or "/two_factor" in url:
        # Check if it's a trust page vs 2FA
        if _is_trust_text(body_text) and not _is_2fa_text(body_text):
            return await _handle_follow_up_screens(page, context, ua)
        return await _handle_2fa(page, context, totp_secret, ua, two_fa_wait)

    # Body has 2FA indicators
    if _is_2fa_text(body_text):
        return await _handle_2fa(page, context, totp_secret, ua, two_fa_wait)

    # Trust page at non-checkpoint URL
    if _is_trust_text(body_text):
        return await _handle_follow_up_screens(page, context, ua)

    # Still on login page = invalid credentials
    if "/login" in url:
        error_text = ""
        for sel in ['#login_error', '[data-testid="login_error"]', '.login_error_box', '._9ay7']:
            error_el = page.locator(sel)
            if await error_el.count() > 0:
                error_text = (await error_el.first.inner_text()).strip()[:120]
                break
        msg = "Invalid credentials"
        if error_text:
            msg += f" ({error_text})"
        return _fail(ua, msg)

    return _fail(ua, f"Unexpected state: url={url}")


async def login_single_account(
    playwright_instance,
    email: str,
    password: str,
    totp_secret: str | None = None,
    proxy: dict | None = None,
    headless: bool = False,
    two_fa_wait: int = 60,
) -> dict:
    """Login to a single Facebook account with retry logic.

    Returns dict with: success, cookie_string, fb_user_id, user_agent, error, access_token
    """
    ua = random.choice(DESKTOP_USER_AGENTS)
    proxy_config = _build_playwright_proxy(proxy)

    for attempt in range(1, MAX_LOGIN_ATTEMPTS + 1):
        try:
            launch_args = {
                "headless": headless,
                "args": ["--no-sandbox", "--disable-dev-shm-usage"],
            }
            if proxy_config:
                launch_args["proxy"] = proxy_config

            browser = await playwright_instance.chromium.launch(**launch_args)
            context = await browser.new_context(
                user_agent=ua,
                viewport={"width": 1280, "height": 800},
                locale="en-US",
            )
            try:
                page = await context.new_page()
                result = await _do_login(page, context, email, password, totp_secret, ua, bool(proxy), two_fa_wait)

                if result["success"]:
                    # Wait 15s for Facebook to finish setting all cookies
                    logger.info("Login successful — waiting 15s for cookies to settle...")
                    await page.wait_for_timeout(15000)

                    # Re-extract the full cookie jar
                    settled = await _extract_cookies(context, ua)
                    if settled["success"]:
                        result["cookie_string"] = settled["cookie_string"]
                        result["fb_user_id"] = settled["fb_user_id"]

                    # Extract EAAB token (best-effort)
                    result["access_token"] = await _extract_eaab_token(page)
                    return result

                # Check if retryable
                err = (result.get("error") or "").lower()
                is_retryable = any(kw in err for kw in ["rejected", "security check", "redirected to login", "incorrect"])
                is_non_retryable = any(kw in err for kw in ["2fa required", "totp", "form not found", "button not found"])

                if is_non_retryable or not is_retryable or attempt >= MAX_LOGIN_ATTEMPTS:
                    logger.info("Attempt %d/%d FAILED (no retry): %s — %s",
                                attempt, MAX_LOGIN_ATTEMPTS, email, result["error"])
                    result["access_token"] = None
                    return result

                logger.info("Attempt %d/%d failed: %s — retrying in 5s...",
                            attempt, MAX_LOGIN_ATTEMPTS, result["error"])
            finally:
                await context.close()
                await browser.close()

            # Wait before retry
            await asyncio.sleep(5)

        except Exception as exc:
            err_str = str(exc).lower()
            logger.error("Attempt %d/%d error: %s", attempt, MAX_LOGIN_ATTEMPTS, exc)
            if attempt >= MAX_LOGIN_ATTEMPTS:
                if "proxy" in err_str:
                    return _fail(ua, f"Proxy error: {exc}")
                if "timeout" in err_str or "timed out" in err_str:
                    return _fail(ua, f"Timeout: {exc}")
                return _fail(ua, f"Browser error: {exc}")
            await asyncio.sleep(5)

    return _fail(ua, "All login attempts exhausted")


# ── Main Worker Logic ─────────────────────────────────────────────────

async def run_worker(api: SocyBaseAPI, batch_id: str, headless: bool, two_fa_wait: int):
    print("\n" + "=" * 60)
    print("  SocyBase Local Login Worker")
    print("=" * 60)

    # 1. Fetch batch data
    logger.info("Fetching batch data from server...")
    try:
        data = api.get_worker_data(batch_id)
    except httpx.HTTPStatusError as e:
        logger.error("Failed to fetch batch data: %s", e.response.text)
        return
    except Exception as e:
        logger.error("Failed to connect to server: %s", e)
        return

    accounts = data["accounts"]
    execution_mode = data["execution_mode"]
    delay_seconds = data["delay_seconds"]
    max_parallel = data["max_parallel"]
    proxy_pool = data["proxy_pool"]

    print(f"\n  Accounts:       {len(accounts)}")
    print(f"  Mode:           {execution_mode}")
    if execution_mode == "sequential":
        print(f"  Delay:          {delay_seconds}s between logins")
    else:
        print(f"  Max parallel:   {max_parallel}")
    print(f"  Headless:       {headless}")
    print(f"  Proxies:        {len(proxy_pool)} in pool")
    print(f"  2FA wait:       {two_fa_wait}s")
    print()

    # 2. Mark batch as running
    logger.info("Marking batch as running...")
    try:
        api.worker_start(batch_id)
    except Exception as e:
        logger.error("Failed to start batch: %s", e)
        return

    # 3. Run logins
    success_count = 0
    fail_count = 0
    start_time = time.time()

    async with async_playwright() as p:
        if execution_mode == "concurrent":
            # Concurrent mode with semaphore
            semaphore = asyncio.Semaphore(max_parallel)

            async def process_account(index: int, row: dict):
                nonlocal success_count, fail_count
                async with semaphore:
                    email = row.get("email", "")
                    proxy = _select_proxy(row, proxy_pool, index)
                    proxy_label = f"{proxy['host']}:{proxy.get('port', '')}" if proxy else "direct"
                    logger.info("[%d/%d] Logging in: %s (proxy=%s)",
                                index + 1, len(accounts), email, proxy_label)

                    result = await login_single_account(
                        p, email, row.get("password", ""),
                        row.get("2fa_secret") or None,
                        proxy, headless, two_fa_wait,
                    )

                    if result["success"]:
                        success_count += 1
                        logger.info("[%d/%d] SUCCESS: %s (uid=%s, token=%s)",
                                    index + 1, len(accounts), email,
                                    result["fb_user_id"],
                                    "yes" if result.get("access_token") else "no")
                    else:
                        fail_count += 1
                        logger.warning("[%d/%d] FAILED: %s -- %s",
                                       index + 1, len(accounts), email, result["error"])

                    # Report to server
                    try:
                        api.post_result(batch_id, {
                            "email": email,
                            "success": result["success"],
                            "cookie_string": result.get("cookie_string"),
                            "fb_user_id": result.get("fb_user_id"),
                            "user_agent": result.get("user_agent"),
                            "error": result.get("error"),
                            "proxy_used": proxy,
                            "access_token": result.get("access_token"),
                        })
                    except Exception as e:
                        logger.error("Failed to report result for %s: %s", email, e)

            await asyncio.gather(
                *(process_account(i, row) for i, row in enumerate(accounts)),
                return_exceptions=True,
            )
        else:
            # Sequential mode
            for i, row in enumerate(accounts):
                email = row.get("email", "")
                proxy = _select_proxy(row, proxy_pool, i)
                proxy_label = f"{proxy['host']}:{proxy.get('port', '')}" if proxy else "direct"
                logger.info("[%d/%d] Logging in: %s (proxy=%s)",
                            i + 1, len(accounts), email, proxy_label)

                result = await login_single_account(
                    p, email, row.get("password", ""),
                    row.get("2fa_secret") or None,
                    proxy, headless, two_fa_wait,
                )

                if result["success"]:
                    success_count += 1
                    logger.info("[%d/%d] SUCCESS: %s (uid=%s, token=%s)",
                                i + 1, len(accounts), email,
                                result["fb_user_id"],
                                "yes" if result.get("access_token") else "no")
                else:
                    fail_count += 1
                    logger.warning("[%d/%d] FAILED: %s -- %s",
                                   i + 1, len(accounts), email, result["error"])

                # Report to server
                try:
                    api.post_result(batch_id, {
                        "email": email,
                        "success": result["success"],
                        "cookie_string": result.get("cookie_string"),
                        "fb_user_id": result.get("fb_user_id"),
                        "user_agent": result.get("user_agent"),
                        "error": result.get("error"),
                        "proxy_used": proxy,
                        "access_token": result.get("access_token"),
                    })
                except Exception as e:
                    logger.error("Failed to report result for %s: %s", email, e)

                # Delay between logins
                if i < len(accounts) - 1:
                    logger.info("Waiting %ds before next login...", delay_seconds)
                    await asyncio.sleep(delay_seconds)

    # 4. Mark batch complete
    elapsed = time.time() - start_time
    logger.info("Marking batch as complete...")
    try:
        api.worker_complete(batch_id)
    except Exception as e:
        logger.error("Failed to mark batch complete: %s", e)

    print("\n" + "=" * 60)
    print(f"  DONE in {elapsed:.1f}s")
    print(f"  Success: {success_count}")
    print(f"  Failed:  {fail_count}")
    print(f"  Total:   {len(accounts)}")
    print("=" * 60 + "\n")


def main():
    parser = argparse.ArgumentParser(
        description="SocyBase Local Login Worker - runs Facebook login on your machine",
    )
    parser.add_argument("--url", required=True, help="SocyBase server URL (e.g. https://your-app.up.railway.app)")
    parser.add_argument("--token", required=True, help="Your JWT auth token (copy from SocyBase dashboard)")
    parser.add_argument("--batch", required=True, help="Login batch ID")
    parser.add_argument("--headless", action="store_true", default=False,
                        help="Run browser in headless mode (no visible window)")
    parser.add_argument("--2fa-wait", type=int, default=60, dest="two_fa_wait",
                        help="Seconds to wait for 2FA/security check (default: 60)")

    args = parser.parse_args()

    api = SocyBaseAPI(args.url, args.token)
    asyncio.run(run_worker(api, args.batch, args.headless, args.two_fa_wait))


if __name__ == "__main__":
    main()
