import re
import httpx
from app.scraping.clients.base import AbstractSocialClient
from app.config import get_settings

settings = get_settings()


def _resolve_page_id(page_segment: str, full_url: str) -> str:
    """If page segment is 'profile.php', extract numeric ID from ?id= param."""
    if page_segment and page_segment.startswith("profile.php"):
        id_match = re.search(r"[?&]id=(\d+)", full_url)
        if id_match:
            return id_match.group(1)
    return page_segment


class FacebookGraphClient(AbstractSocialClient):
    """Client for the akng.io.vn Facebook Graph API proxy."""

    def __init__(self):
        self.base_url = settings.akng_base_url
        self.access_token = settings.akng_access_token
        self.api_version = settings.akng_api_version
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=15.0))

    async def close(self):
        await self.client.aclose()

    def parse_post_url(self, url: str) -> dict:
        """
        Parse Facebook post URL to extract post_id and determine type.

        Supported URL formats:
        - https://facebook.com/{page}/posts/{id}
        - https://facebook.com/{page}/posts/pfbid...
        - https://www.facebook.com/permalink.php?story_fbid={id}&id={page_id}
        - https://facebook.com/groups/{group_id}/posts/{post_id}
        - https://facebook.com/photo.php?fbid={id}
        - https://www.facebook.com/{page}/videos/{id}
        - https://www.facebook.com/reel/{id}
        - https://www.facebook.com/watch/?v={id}
        - Direct post ID (pfbid...)
        """
        result = {"post_id": url, "is_group": False, "group_id": None, "page_id": None, "original_url": url}

        # Direct post ID (not a URL)
        if not url.startswith("http"):
            # Handle compound IDs from feed: "pageId_postId" or "pageId_postId_commentId"
            # Extract the actual post ID (second part for 2-part, middle for 3-part)
            parts = url.split("_")
            if len(parts) == 2 and all(p.isdigit() for p in parts):
                result["post_id"] = parts[1]  # pageId_postId → postId
                result["page_id"] = parts[0]
            elif len(parts) == 3 and all(p.isdigit() for p in parts):
                result["post_id"] = parts[1]  # pageId_postId_commentId → postId
                result["page_id"] = parts[0]
            return result

        # Group post
        group_match = re.search(r"groups/(\d+)/(?:posts|permalink)/(\d+)", url)
        if group_match:
            result["group_id"] = group_match.group(1)
            result["page_id"] = group_match.group(1)
            result["post_id"] = group_match.group(2)
            result["is_group"] = True
            return result

        # Page/profile post - /posts/{id} or /posts/pfbid...
        post_match = re.search(r"/posts/(pfbid\w+|\w+)", url)
        if post_match:
            result["post_id"] = post_match.group(1)
            # Extract page name from URL: facebook.com/{page}/posts/...
            page_match = re.search(r"facebook\.com/([^/]+)/posts/", url)
            if page_match:
                result["page_id"] = _resolve_page_id(page_match.group(1), url)
            return result

        # Video post - /{page}/videos/{id}
        video_match = re.search(r"/videos/(\d+)", url)
        if video_match:
            result["post_id"] = video_match.group(1)
            # Extract page name from URL: facebook.com/{page}/videos/...
            page_match = re.search(r"facebook\.com/([^/]+)/videos/", url)
            if page_match:
                result["page_id"] = _resolve_page_id(page_match.group(1), url)
            return result

        # Reel post - /reel/{id} or /reels/{id}
        reel_match = re.search(r"/reels?/(\d+)", url)
        if reel_match:
            result["post_id"] = reel_match.group(1)
            return result

        # permalink.php?story_fbid=...
        story_match = re.search(r"story_fbid=(\d+)", url)
        if story_match:
            result["post_id"] = story_match.group(1)
            # Extract page ID from &id= parameter
            id_match = re.search(r"[?&]id=(\d+)", url)
            if id_match:
                result["page_id"] = id_match.group(1)
            return result

        # pfbid format in URL
        pfbid_match = re.search(r"(pfbid\w+)", url)
        if pfbid_match:
            result["post_id"] = pfbid_match.group(1)
            return result

        # photo.php?fbid=...
        photo_match = re.search(r"fbid=(\d+)", url)
        if photo_match:
            result["post_id"] = photo_match.group(1)
            return result

        # watch/?v=...
        watch_match = re.search(r"[?&]v=(\d+)", url)
        if watch_match:
            result["post_id"] = watch_match.group(1)
            return result

        # reel/{id}
        reel_match = re.search(r"/reel/(\d+)", url)
        if reel_match:
            result["post_id"] = reel_match.group(1)
            return result

        return result

    async def get_post_comments(
        self,
        post_id: str,
        is_group: bool = False,
        after: str | None = None,
        limit: int = 25,
    ) -> dict:
        """
        Fetch comments for a post with pagination.

        Groups use the direct /comments endpoint.
        Pages/profiles use nested field expansion on the post object.
        """
        comment_fields = "message,created_time,from,like_count,can_remove,message_tags"
        reply_fields = "comments.limit(25)"

        if is_group:
            url = f"{self.base_url}/{post_id}/comments"
            params = {
                "access_token": self.access_token,
                "fields": f"{comment_fields},{reply_fields}",
                "limit": limit,
            }
            if after:
                params["after"] = after
        else:
            url = f"{self.base_url}/{post_id}"
            params = {
                "access_token": self.access_token,
                "fields": f"comments.limit({limit}){{{comment_fields},{reply_fields}}}",
            }
            if after:
                params["fields"] = f"comments.limit({limit}).after({after}){{{comment_fields},{reply_fields}}}"

        response = await self.client.get(url, params=params)
        response.raise_for_status()
        return response.json()

    async def get_user_profile(self, user_id: str) -> dict:
        """
        Fetch user profile details.
        GET /graph/v1.0/{user_id} (no fields param — returns all available fields)
        """
        url = f"{self.base_url}/v1.0/{user_id}"
        params = {
            "access_token": self.access_token,
        }

        response = await self.client.get(url, params=params)
        response.raise_for_status()
        return response.json()

    async def get_object_details(self, object_id: str, fields: str | None = None, token_type: str | None = None) -> dict:
        """
        Get details about any Facebook object (page, post, video, etc.)
        GET /graph/{version}/{object_id}
        """
        url = f"{self.base_url}/{self.api_version}/{object_id}"
        params = {"access_token": self.access_token}
        if token_type:
            params["token_type"] = token_type
        if fields:
            params["fields"] = fields
        else:
            params["fields"] = "id,name,about,description,location,phone,website,picture.type(large),cover"

        response = await self.client.get(url, params=params)
        response.raise_for_status()
        return response.json()

    def parse_page_input(self, input_value: str) -> dict:
        """
        Parse page/group/profile input to extract ID.

        Supported formats:
        - Numeric ID: 123456789
        - Group URL: https://facebook.com/groups/123456789
        - Page URL: https://facebook.com/pagename
        - Username: @pagename or pagename
        """
        result = {"page_id": input_value.strip(), "is_group": False}

        value = input_value.strip()

        # Direct numeric ID
        if value.isdigit():
            return result

        # Group URL
        group_match = re.search(r"groups/([^/?]+)", value)
        if group_match:
            result["page_id"] = group_match.group(1)
            result["is_group"] = True
            return result

        # Reel/video URL: /reel/{id}, /reels/{id}, /videos/{id}
        # These are content IDs, not page IDs — extract the numeric ID
        reel_match = re.search(r"/reels?/(\d+)", value)
        if reel_match:
            result["page_id"] = reel_match.group(1)
            return result
        video_match = re.search(r"/videos/(\d+)", value)
        if video_match:
            result["page_id"] = video_match.group(1)
            return result

        # Page/profile URL — skip known non-page path segments
        if value.startswith("http"):
            # Try /{page}/posts/, /{page}/videos/, /{page}/reels/ first (page is before content type)
            page_content_match = re.search(r"facebook\.com/([^/]+)/(?:posts|videos|reels?)/", value)
            if page_content_match:
                page_segment = page_content_match.group(1)
                if page_segment not in ("www", "m", "web", "l"):
                    result["page_id"] = _resolve_page_id(page_segment, value)
                    return result

            username_match = re.search(r"facebook\.com/([^/?]+)", value)
            if username_match:
                captured = username_match.group(1)
                # Skip known content-type path segments
                if captured in ("reel", "reels", "watch", "stories", "story", "photo", "video", "videos", "events", "marketplace"):
                    # Try to get a numeric ID from the URL path
                    id_match = re.search(r"/(?:reel|reels|watch|video|videos|stories|story)/(\d+)", value)
                    if id_match:
                        result["page_id"] = id_match.group(1)
                        return result
                else:
                    result["page_id"] = captured
                    return result

        # Plain username
        result["page_id"] = value.lstrip("@")
        return result

    async def get_page_feed(
        self,
        page_id: str,
        token_type: str = "EAAAAU",
        limit: int = 10,
        after: str | None = None,
        order: str = "chronological",
        pagination_params: dict | None = None,
    ) -> dict:
        """
        Get posts from a page/profile/group feed.
        GET /graph/{version}/{page_id}/feed

        AKNG wraps the response: {"success": true, "data": {"data": [...], "paging": {...}}}

        For pagination, pass ``pagination_params`` (extracted from the paging
        ``next`` URL) which includes ``until`` + ``__paging_token`` — both are
        required for Facebook's time-based feed pagination to advance.
        """
        url = f"{self.base_url}/{self.api_version}/{page_id}/feed"
        params = {
            "access_token": self.access_token,
            "token_type": token_type,
            "fields": "message,updated_time,created_time,from,comments.summary(total_count),reactions.summary(total_count),shares,attachments",
            "limit": limit,
            "order": order,
        }
        if pagination_params:
            params.update(pagination_params)
        elif after:
            params["after"] = after

        response = await self.client.get(url, params=params)
        response.raise_for_status()
        return response.json()

    async def search_pages(self, query: str, limit: int = 10) -> dict:
        """
        Search for Facebook pages.
        GET /graph/v19.0/pages/search
        """
        url = f"{self.base_url}/{self.api_version}/pages/search"
        params = {
            "access_token": self.access_token,
            "q": query,
            "fields": "is_eligible_for_branded_content,is_unclaimed,link,location,name,verification_status",
            "limit": limit,
        }
        response = await self.client.get(url, params=params)
        response.raise_for_status()
        return response.json()
