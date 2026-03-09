"""Playwright-based Facebook scraper — fallback when AKNG API returns permission errors.

Uses headless Chromium with injected user cookies on mbasic.facebook.com (the
basic HTML version of Facebook).  mbasic renders server-side HTML with simple,
stable DOM structures — no React, no GraphQL, no obfuscated class names.

Comment structure on mbasic:
  <div>
    <a href="/profile.php?id=123">John Doe</a>
    <div>Comment text here</div>
  </div>

Feed post structure on mbasic:
  <div class="story_body_container">
    <header><a href="/PageName">Page Name</a></header>
    <div><p>Post message text</p></div>
    <footer>... reactions, comments count ...</footer>
  </div>
"""

import asyncio
import json
import logging
import random
import re
logger = logging.getLogger(__name__)

# Max concurrent Playwright browsers (soft limit via asyncio semaphore)
_browser_semaphore = asyncio.Semaphore(3)

MBASIC_BASE = "https://mbasic.facebook.com"


def _convert_cookies_for_playwright(raw_cookies: list[dict]) -> list[dict]:
    """Normalise cookie dicts (from EditThisCookie / DevTools export) to Playwright format."""
    converted = []
    for c in raw_cookies:
        name = c.get("name") or c.get("Name") or ""
        value = c.get("value") or c.get("Value") or ""
        if not name:
            continue
        pw_cookie = {
            "name": name,
            "value": str(value),
            "domain": c.get("domain", c.get("Domain", ".facebook.com")),
            "path": c.get("path", c.get("Path", "/")),
        }
        # Playwright needs sameSite as title case
        same_site = c.get("sameSite", c.get("SameSite", "None"))
        if same_site:
            ss = str(same_site).capitalize()
            if ss not in ("Strict", "Lax", "None"):
                ss = "None"
            pw_cookie["sameSite"] = ss
        pw_cookie["httpOnly"] = bool(c.get("httpOnly", c.get("HttpOnly", False)))
        pw_cookie["secure"] = bool(c.get("secure", c.get("Secure", True)))
        converted.append(pw_cookie)
    return converted


def _extract_user_id_from_href(href: str) -> str:
    """Extract numeric user ID from an mbasic profile link.

    Possible formats:
      /profile.php?id=123456
      /user.name?fref=...
      /123456?fref=...
    """
    if not href:
        return ""
    # profile.php?id=NUM
    m = re.search(r"profile\.php\?id=(\d+)", href)
    if m:
        return m.group(1)
    # /NUM? (direct numeric ID in path)
    m = re.match(r"^/(\d+)", href)
    if m:
        return m.group(1)
    # /username?... — return username as ID (will be resolved later during enrichment)
    m = re.match(r"^/([^/?]+)", href)
    if m:
        return m.group(1)
    return ""


def _convert_post_url_to_mbasic(url: str) -> str:
    """Convert any facebook.com URL to mbasic.facebook.com."""
    return re.sub(
        r"https?://(www\.|m\.|web\.)?facebook\.com",
        MBASIC_BASE,
        url,
    )


class PlaywrightFacebookClient:
    """Headless Chromium scraper using mbasic.facebook.com with injected cookies."""

    def __init__(self, cookies: list[dict]):
        self._raw_cookies = cookies
        self._browser = None
        self._context = None
        self._pw = None

    async def start(self):
        """Launch headless browser and inject cookies."""
        from playwright.async_api import async_playwright

        self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.launch(headless=True)
        self._context = await self._browser.new_context(
            viewport={"width": 420, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Linux; Android 13; Pixel 7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Mobile Safari/537.36"
            ),
            locale="en-US",
        )
        pw_cookies = _convert_cookies_for_playwright(self._raw_cookies)
        await self._context.add_cookies(pw_cookies)

    async def close(self):
        """Cleanup browser resources."""
        if self._context:
            await self._context.close()
        if self._browser:
            await self._browser.close()
        if self._pw:
            await self._pw.stop()

    def _is_login_redirect(self, url: str) -> bool:
        """Detect if Facebook redirected to login page (cookies expired)."""
        return "/login" in url or "checkpoint" in url

    # ── Comment scraping ────────────────────────────────────────────

    async def get_post_comments(self, post_url: str, limit: int = 100) -> dict | None:
        """
        Fetch comments from mbasic.facebook.com post page.

        mbasic renders comments as server-side HTML with simple structure:
        - Each comment has an <a> tag linking to the commenter's profile
        - Comment text is in a sibling <div>
        - "See more" pagination is a simple <a> link

        Returns data in mapper-compatible format:
        { "data": [ { "from": {"id", "name"}, "id", "message", "created_time" } ] }
        """
        page = await self._context.new_page()
        comments = []
        seen_ids = set()

        try:
            mbasic_url = _convert_post_url_to_mbasic(post_url)
            logger.info("Playwright: navigating to %s", mbasic_url)

            await page.goto(mbasic_url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(random.uniform(1.0, 2.0))

            if self._is_login_redirect(page.url):
                logger.warning("Playwright: cookies expired — redirected to login")
                return None

            # Debug: log page title and a snippet of the HTML to diagnose selector issues
            title = await page.title()
            html_content = await page.content()
            logger.info("Playwright: page title = %s, URL = %s, HTML length = %d",
                        title, page.url, len(html_content))
            # Log first 2000 chars of body for debugging selectors
            logger.info("Playwright: HTML snippet: %s", html_content[:2000])

            # Extract comments from current page + follow "See more" links
            pages_loaded = 0
            max_pages = max(limit // 10, 3)

            while pages_loaded < max_pages and len(comments) < limit:
                new_comments = await self._parse_mbasic_comments(page)
                for c in new_comments:
                    cid = c.get("id", "")
                    if cid not in seen_ids:
                        seen_ids.add(cid)
                        comments.append(c)

                if len(comments) >= limit:
                    break

                # Look for "See more comments" / pagination link
                next_link = None
                for link in await page.query_selector_all("a"):
                    text = (await link.inner_text()).strip().lower()
                    if any(kw in text for kw in ["more comment", "previous comment",
                                                  "view more", "see more",
                                                  "komen lagi", "lihat lagi"]):
                        href = await link.get_attribute("href")
                        if href:
                            next_link = link
                            break

                if not next_link:
                    break

                await next_link.click()
                await asyncio.sleep(random.uniform(1.5, 2.5))
                pages_loaded += 1

                if self._is_login_redirect(page.url):
                    logger.warning("Playwright: cookies expired during pagination")
                    break

            comments = comments[:limit]
            logger.info("Playwright: extracted %d comments", len(comments))

            return {
                "data": comments,
                "paging": {},
            }

        except Exception as e:
            logger.error("Playwright comment scraping failed: %s", e)
            return None
        finally:
            await page.close()

    async def _parse_mbasic_comments(self, page) -> list[dict]:
        """Parse comments from the current mbasic page HTML."""
        comments = []

        # mbasic comment containers: <div> elements that contain profile links
        # followed by comment text. The structure varies but the key pattern is:
        # an <a> with href to a profile, then text content nearby.
        # Strategy: find all <a> tags that link to profiles inside comment sections
        # mbasic uses <div id="ufi_X"> for comment sections
        comment_divs = await page.query_selector_all('[id^="ufi"] > div > div')
        logger.info("Playwright: selector '[id^=ufi] > div > div' matched %d elements", len(comment_divs))
        if not comment_divs:
            comment_divs = await page.query_selector_all('div[data-sigil="comment"]')
            logger.info("Playwright: selector 'div[data-sigil=comment]' matched %d elements", len(comment_divs))
        if not comment_divs:
            comment_divs = await page.query_selector_all('div.dw > div')
            logger.info("Playwright: selector 'div.dw > div' matched %d elements", len(comment_divs))
        if not comment_divs:
            comment_divs = await page.query_selector_all('#root div > div > div')
            logger.info("Playwright: selector '#root div > div > div' matched %d elements", len(comment_divs))

        for div in comment_divs:
            try:
                # Find profile link in this comment
                profile_link = await div.query_selector('a[href*="profile.php"], a[href*="fref="]')
                if not profile_link:
                    # Try any link that looks like a profile (starts with /)
                    links = await div.query_selector_all("a")
                    for link in links:
                        href = await link.get_attribute("href") or ""
                        text = (await link.inner_text()).strip()
                        # Profile links have a name and point to /username or /profile.php
                        if text and len(text) > 1 and ("profile.php" in href or
                                (href.startswith("/") and "?" in href and not href.startswith("/story"))):
                            profile_link = link
                            break

                if not profile_link:
                    continue

                name = (await profile_link.inner_text()).strip()
                href = await profile_link.get_attribute("href") or ""
                user_id = _extract_user_id_from_href(href)

                if not name or len(name) < 2:
                    continue

                # Get comment text — the text content of the div, minus the name
                full_text = (await div.inner_text()).strip()
                # Remove the commenter name from the beginning
                message = full_text
                if message.startswith(name):
                    message = message[len(name):].strip()
                # Remove trailing metadata (like "· Reply · 2h")
                message = re.split(r"\n\s*(?:Like|Reply|Comment|Suka|Balas|·)", message)[0].strip()

                if not message:
                    continue

                comment_id = f"pw_{user_id}_{hash(message) & 0xFFFFFF:06x}"

                comments.append({
                    "from": {"id": str(user_id), "name": name},
                    "id": comment_id,
                    "message": message,
                    "created_time": "",
                })
            except Exception:
                continue

        return comments

    # ── Feed / post discovery ───────────────────────────────────────

    async def get_page_feed(self, page_url: str, limit: int = 10) -> dict | None:
        """
        Fetch posts from mbasic.facebook.com page feed.

        mbasic renders each post as a <div> with:
        - Post message in a <p> or text node
        - Author name in a header <a> tag
        - Engagement counts in footer text
        - "See more posts" pagination link

        Returns AKNG-compatible format:
        { "data": [ { "id", "message", "created_time", "from": {...}, ... } ] }
        """
        page = await self._context.new_page()
        posts = []
        seen_ids = set()

        try:
            # Navigate to page feed on mbasic
            mbasic_url = _convert_post_url_to_mbasic(page_url)
            if not mbasic_url.endswith("/") and "?" not in mbasic_url:
                mbasic_url += "/"
            logger.info("Playwright: navigating to feed %s", mbasic_url)

            await page.goto(mbasic_url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(random.uniform(1.0, 2.0))

            if self._is_login_redirect(page.url):
                logger.warning("Playwright: cookies expired — redirected to login")
                return None

            pages_loaded = 0
            max_pages = max(limit // 3, 2)

            while pages_loaded < max_pages and len(posts) < limit:
                new_posts = await self._parse_mbasic_feed(page)
                for p in new_posts:
                    pid = p.get("id", "")
                    if pid and pid not in seen_ids:
                        seen_ids.add(pid)
                        posts.append(p)

                if len(posts) >= limit:
                    break

                # Look for "See more posts" / "Show more" pagination
                next_link = None
                for link in await page.query_selector_all("a"):
                    text = (await link.inner_text()).strip().lower()
                    if any(kw in text for kw in ["see more post", "show more",
                                                  "more stories", "older post",
                                                  "lagi cerita", "lihat lagi"]):
                        href = await link.get_attribute("href")
                        if href:
                            next_link = link
                            break

                if not next_link:
                    break

                await next_link.click()
                await asyncio.sleep(random.uniform(1.5, 2.5))
                pages_loaded += 1

                if self._is_login_redirect(page.url):
                    break

            posts = posts[:limit]
            logger.info("Playwright: extracted %d feed posts", len(posts))

            if not posts:
                return None

            return {
                "data": posts,
                "paging": {},
            }

        except Exception as e:
            logger.error("Playwright feed scraping failed: %s", e)
            return None
        finally:
            await page.close()

    async def _parse_mbasic_feed(self, page) -> list[dict]:
        """Parse feed posts from the current mbasic page."""
        posts = []

        # mbasic wraps each post in an <article> or a div with specific structure
        # Try multiple selectors for post containers
        post_elements = await page.query_selector_all("article")
        if not post_elements:
            post_elements = await page.query_selector_all('[data-ft]')
        if not post_elements:
            post_elements = await page.query_selector_all('div.story_body_container')
        if not post_elements:
            # Broader: divs inside the timeline section
            post_elements = await page.query_selector_all('#structured_composer_async_container ~ div > div > div')

        for el in post_elements:
            try:
                # Extract post ID from any link containing /story.php or /permalink
                post_id = ""
                post_url = ""
                all_links = await el.query_selector_all("a")
                for link in all_links:
                    href = await link.get_attribute("href") or ""
                    # story_fbid pattern
                    m = re.search(r"story_fbid=(\d+)", href)
                    if m:
                        post_id = m.group(1)
                        post_url = f"https://www.facebook.com/permalink.php?{href.split('?', 1)[-1]}" if "?" in href else ""
                        break
                    # /posts/ID pattern
                    m = re.search(r"/posts/(\w+)", href)
                    if m:
                        post_id = m.group(1)
                        post_url = f"https://www.facebook.com{href}"
                        break
                    # pfbid pattern
                    m = re.search(r"(pfbid\w+)", href)
                    if m:
                        post_id = m.group(1)
                        post_url = f"https://www.facebook.com{href}"
                        break

                if not post_id:
                    # Generate an ID from content hash
                    text = (await el.inner_text()).strip()
                    if not text or len(text) < 10:
                        continue
                    post_id = f"pw_{hash(text) & 0xFFFFFFFF:08x}"

                # Extract author from first profile link
                from_name = ""
                from_id = ""
                header_link = await el.query_selector("header a, h3 a, strong a, a[href*='profile.php'], a[href*='fref=']")
                if header_link:
                    from_name = (await header_link.inner_text()).strip()
                    href = await header_link.get_attribute("href") or ""
                    from_id = _extract_user_id_from_href(href)

                # Extract message text
                message = ""
                # Try <p> tags first (main post text)
                p_tags = await el.query_selector_all("p")
                if p_tags:
                    parts = []
                    for p in p_tags:
                        t = (await p.inner_text()).strip()
                        if t:
                            parts.append(t)
                    message = "\n".join(parts)
                else:
                    # Fallback: get all text minus header/footer
                    message = (await el.inner_text()).strip()
                    # Remove author name from beginning
                    if from_name and message.startswith(from_name):
                        message = message[len(from_name):].strip()

                # Extract engagement from footer text (e.g. "5 Comments · 12 Shares")
                footer_text = ""
                footer = await el.query_selector("footer, abbr")
                if footer:
                    footer_text = (await footer.inner_text()).strip()
                full_text = (await el.inner_text()).strip()

                comment_count = 0
                reaction_count = 0
                share_count = 0

                # Parse engagement numbers from text
                for text_source in [footer_text, full_text]:
                    if not text_source:
                        continue
                    cm = re.search(r"(\d+)\s*(?:comment|komen)", text_source, re.I)
                    if cm:
                        comment_count = int(cm.group(1))
                    rm = re.search(r"(\d+)\s*(?:reaction|like|suka)", text_source, re.I)
                    if rm:
                        reaction_count = int(rm.group(1))
                    sm = re.search(r"(\d+)\s*(?:share|kongsi)", text_source, re.I)
                    if sm:
                        share_count = int(sm.group(1))

                if not message and not from_name:
                    continue

                posts.append({
                    "id": str(post_id),
                    "message": message[:2000],  # Truncate very long posts
                    "created_time": "",
                    "updated_time": "",
                    "from": {"name": from_name, "id": str(from_id)},
                    "comments": {"summary": {"total_count": comment_count}},
                    "reactions": {"summary": {"total_count": reaction_count}},
                    "shares": {"count": share_count},
                    "attachments": {"data": []},
                    "post_url": post_url,
                })
            except Exception:
                continue

        return posts


async def try_playwright_comments(
    cookies_encrypted: str,
    post_url: str,
    limit: int = 100,
) -> dict | None:
    """
    High-level helper for the comment pipeline.

    Decrypts cookies, launches a Playwright browser (with concurrency limit),
    scrapes comments from mbasic.facebook.com, and returns mapper-compatible
    data or None.
    """
    from app.services.meta_api import MetaAPIService

    meta = MetaAPIService()
    try:
        cookies = json.loads(meta.decrypt_token(cookies_encrypted))
    except Exception as e:
        logger.error("Failed to decrypt FB cookies: %s", e)
        return None

    async with _browser_semaphore:
        client = PlaywrightFacebookClient(cookies)
        try:
            await client.start()
            return await client.get_post_comments(post_url, limit=limit)
        except Exception as e:
            logger.error("Playwright comment scraping error: %s", e)
            return None
        finally:
            await client.close()


async def try_playwright_feed(
    cookies_encrypted: str,
    page_url: str,
    limit: int = 10,
) -> dict | None:
    """
    High-level helper for the post discovery pipeline.

    Returns AKNG-compatible feed response or None.
    """
    from app.services.meta_api import MetaAPIService

    meta = MetaAPIService()
    try:
        cookies = json.loads(meta.decrypt_token(cookies_encrypted))
    except Exception as e:
        logger.error("Failed to decrypt FB cookies: %s", e)
        return None

    async with _browser_semaphore:
        client = PlaywrightFacebookClient(cookies)
        try:
            await client.start()
            return await client.get_page_feed(page_url, limit=limit)
        except Exception as e:
            logger.error("Playwright feed scraping error: %s", e)
            return None
        finally:
            await client.close()
