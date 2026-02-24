from abc import ABC, abstractmethod


class AbstractSocialClient(ABC):
    """Base class for all social media platform API clients."""

    @abstractmethod
    async def get_post_comments(self, post_id: str, **kwargs) -> dict:
        """Fetch comments for a post. Returns paginated response."""
        pass

    @abstractmethod
    async def get_user_profile(self, user_id: str) -> dict:
        """Fetch detailed profile for a user."""
        pass

    @abstractmethod
    async def parse_post_url(self, url: str) -> dict:
        """Parse a post URL to extract post ID and metadata."""
        pass
