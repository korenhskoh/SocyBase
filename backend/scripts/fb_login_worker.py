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
    --headless    Run browser without visible window (default: show browser)
"""

import argparse
import asyncio
import json
import logging
import random
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
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
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
        r = self.client.post(f"/fb-action/login-batch/{batch_id}/worker-result", json=result)
        r.raise_for_status()

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


def _body_has_checkpoint(body: str) -> bool:
    indicators = [
        "approvals_code", "checkpoint", "two-factor", "login_approvals",
        "Enter the code", "enter the login code", "verify your identity",
        "submit[Submit Code]", "pengesahan", "code generator",
        "security code", "authentication code", "/checkpoint/",
    ]
    body_lower = body.lower()
    return any(ind.lower() in body_lower for ind in indicators)


async def _has_c_user(context) -> bool:
    cookies = await context.cookies()
    return any(c["name"] == "c_user" for c in cookies)


async def _extract_cookies(context, ua: str) -> dict:
    cookies = await context.cookies()
    cookie_parts = []
    fb_user_id = None
    for c in cookies:
        cookie_parts.append(f"{c['name']}={c['value']}")
        if c["name"] == "c_user":
            fb_user_id = c["value"]
    if not fb_user_id:
        return {"success": False, "cookie_string": None, "fb_user_id": None, "user_agent": ua,
                "error": "Login appeared successful but c_user cookie not found"}
    return {"success": True, "cookie_string": "; ".join(cookie_parts),
            "fb_user_id": fb_user_id, "user_agent": ua, "error": None}


def _fail(ua: str, error: str) -> dict:
    return {"success": False, "cookie_string": None, "fb_user_id": None, "user_agent": ua, "error": error}


async def _handle_checkpoint(page, context, totp_secret: str | None, ua: str) -> dict:
    if not totp_secret:
        return _fail(ua, "2FA required but no TOTP secret provided")

    try:
        import pyotp
    except ImportError:
        return _fail(ua, "2FA required but pyotp not installed (pip install pyotp)")

    code = pyotp.TOTP(totp_secret).now()
    code_input = page.locator('input[name="approvals_code"], input[name="code"], input[type="tel"]')
    if await code_input.count() > 0:
        await code_input.first.fill(code)
        submit = page.get_by_role("button", name="Continue").or_(
            page.get_by_role("button", name="Submit")
        ).or_(page.locator('input[type="submit"], button[type="submit"]'))
        if await submit.count() > 0:
            try:
                async with page.expect_navigation(wait_until="domcontentloaded", timeout=30000):
                    await submit.first.click()
            except Exception:
                pass

    for _ in range(3):
        if await _has_c_user(context):
            return await _extract_cookies(context, ua)
        if _is_home_url(page.url):
            return await _extract_cookies(context, ua)
        if "/checkpoint" not in page.url:
            break
        submit = page.get_by_role("button", name="Continue").or_(
            page.get_by_role("button", name="This was me")
        ).or_(page.locator('input[type="submit"], button[type="submit"]'))
        if await submit.count() > 0:
            try:
                async with page.expect_navigation(wait_until="domcontentloaded", timeout=15000):
                    await submit.first.click()
            except Exception:
                break
        else:
            break

    if await _has_c_user(context):
        return await _extract_cookies(context, ua)
    return _fail(ua, "2FA submitted but login still failed (account may need review)")


async def _do_login(page, context, email: str, password: str, totp_secret: str | None, ua: str, has_proxy: bool) -> dict:
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
    await page.locator('input[name="pass"]').fill(password)

    login_btn = page.get_by_role("button", name="Log in").first
    if await login_btn.count() == 0:
        login_btn = page.locator('#login_form input[type="submit"], input[type="submit"], input[name="login"]').first

    async with page.expect_navigation(wait_until="domcontentloaded", timeout=30000):
        await login_btn.click()

    url = page.url
    if _is_home_url(url):
        return await _extract_cookies(context, ua)
    if await _has_c_user(context):
        return await _extract_cookies(context, ua)
    if "/checkpoint" in url:
        return await _handle_checkpoint(page, context, totp_secret, ua)

    body = await page.content()
    if _body_has_checkpoint(body):
        return await _handle_checkpoint(page, context, totp_secret, ua)

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
) -> dict:
    ua = random.choice(DESKTOP_USER_AGENTS)
    proxy_config = _build_playwright_proxy(proxy)

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


# ── Main Worker Logic ─────────────────────────────────────────────────

async def run_worker(api: SocyBaseAPI, batch_id: str, headless: bool):
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
                    logger.info("[%d/%d] Logging in: %s (proxy=%s)",
                                index + 1, len(accounts), email, bool(proxy))

                    result = await login_single_account(
                        p, email, row.get("password", ""),
                        row.get("2fa_secret") or None,
                        proxy, headless,
                    )

                    if result["success"]:
                        success_count += 1
                        logger.info("[%d/%d] SUCCESS: %s (uid=%s)",
                                    index + 1, len(accounts), email, result["fb_user_id"])
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
                logger.info("[%d/%d] Logging in: %s (proxy=%s)",
                            i + 1, len(accounts), email, bool(proxy))

                result = await login_single_account(
                    p, email, row.get("password", ""),
                    row.get("2fa_secret") or None,
                    proxy, headless,
                )

                if result["success"]:
                    success_count += 1
                    logger.info("[%d/%d] SUCCESS: %s (uid=%s)",
                                i + 1, len(accounts), email, result["fb_user_id"])
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

    args = parser.parse_args()

    api = SocyBaseAPI(args.url, args.token)
    asyncio.run(run_worker(api, args.batch, args.headless))


if __name__ == "__main__":
    main()
