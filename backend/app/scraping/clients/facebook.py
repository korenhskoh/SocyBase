import re
import httpx
from app.scraping.clients.base import AbstractSocialClient
from app.config import get_settings

settings = get_settings()


class FacebookGraphClient(AbstractSocialClient):
    """Client for the akng.io.vn Facebook Graph API proxy."""

    def __init__(self):
        self.base_url = settings.akng_base_url
        self.access_token = settings.akng_access_token
        self.api_version = settings.akng_api_version
        self.client = httpx.AsyncClient(timeout=30.0)

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
                result["page_id"] = page_match.group(1)
            return result

        # Video post - /{page}/videos/{id}
        video_match = re.search(r"/videos/(\d+)", url)
        if video_match:
            result["post_id"] = video_match.group(1)
            # Extract page name from URL: facebook.com/{page}/videos/...
            page_match = re.search(r"facebook\.com/([^/]+)/videos/", url)
            if page_match:
                result["page_id"] = page_match.group(1)
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
        comment_fields = "created_time,from,message,can_remove,like_count,message_tags,user_like"
        reply_fields = f"comments{{{comment_fields}}}"

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
        GET /graph/{version}/{user_id}?fields=...
        """
        url = f"{self.base_url}/{self.api_version}/{user_id}"
        fields = (
            "id,name,first_name,last_name,about,birthday,gender,"
            "hometown,location,education,work,website,languages,"
            "link,relationship_status,username,phone,"
            "picture.type(large)"
        )
        params = {
            "access_token": self.access_token,
            "fields": fields,
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
            params["fields"] = "id,name,about,category,description,location,phone,website,picture.type(large),cover"

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

        # Page/profile URL
        if value.startswith("http"):
            username_match = re.search(r"facebook\.com/([^/?]+)", value)
            if username_match:
                result["page_id"] = username_match.group(1)
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
    ) -> dict:
        """
        Get posts from a page/profile/group feed.
        GET /graph/{version}/{page_id}/feed

        AKNG wraps the response: {"success": true, "data": {"data": [...], "paging": {...}}}
        """
        url = f"{self.base_url}/{self.api_version}/{page_id}/feed"
        params = {
            "access_token": self.access_token,
            "token_type": token_type,
            "fields": "message,updated_time,created_time,from,comments.summary(total_count),reactions.summary(total_count),shares,attachments",
            "limit": limit,
            "order": order,
        }
        if after:
            params["__paging_token"] = after

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
