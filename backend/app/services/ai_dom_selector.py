"""AI DOM Selector Verifier — analyzes Facebook DOM snapshots to identify
and verify CSS selectors for warm-up actions."""

import json
import logging

from openai import AsyncOpenAI

from app.config import get_settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a DOM analysis expert specializing in Facebook's UI structure.
Given a DOM snapshot of Facebook's news feed, identify and verify the correct CSS selectors
for automated warm-up actions (scrolling, liking, reacting, viewing profiles, watching videos,
stories, marketplace, notifications, search, commenting, sharing).

Analyze the structural metadata (tags, attributes, aria-labels, roles) and return stable,
reliable selectors. Prefer aria-labels and role attributes over CSS classes (classes change
frequently with Facebook deploys).

Return JSON with this exact structure:
{
  "selectors": {
    "feed_article": {
      "selector": "CSS selector for feed post containers",
      "confidence": 0.0-1.0,
      "reasoning": "Brief explanation"
    },
    "like_button": {
      "selector": "CSS selector for the Like button",
      "state_check": "attribute name to check liked state (e.g. aria-pressed)",
      "state_value_liked": "value when post is already liked (e.g. true)",
      "confidence": 0.0-1.0,
      "reasoning": "Brief explanation"
    },
    "profile_link": {
      "selector": "CSS selector for profile links in feed",
      "href_include": ["patterns the href must contain"],
      "href_exclude": ["patterns to exclude from href"],
      "confidence": 0.0-1.0,
      "reasoning": "Brief explanation"
    },
    "reaction_trigger": {
      "selector": "CSS selector for button to hover to trigger reaction popup (usually same as like button)",
      "hover_duration_ms": 1500,
      "confidence": 0.0-1.0,
      "reasoning": "Brief explanation"
    },
    "reaction_popup": {
      "selector": "CSS selector for individual reaction buttons inside the popup",
      "reaction_labels": ["Love", "Haha", "Wow", "Sad", "Angry"],
      "confidence": 0.0-1.0,
      "reasoning": "Brief explanation"
    },
    "video_post": {
      "selector": "CSS selector to find video elements within articles",
      "play_button": "CSS selector for video play button",
      "confidence": 0.0-1.0,
      "reasoning": "Brief explanation"
    },
    "story_tray": {
      "selector": "CSS selector for story items in the stories carousel/tray",
      "confidence": 0.0-1.0,
      "reasoning": "Brief explanation"
    },
    "notification_icon": {
      "selector": "CSS selector for the notification bell/icon button",
      "panel_selector": "CSS selector for the notifications panel/dialog",
      "confidence": 0.0-1.0,
      "reasoning": "Brief explanation"
    },
    "search_input": {
      "selector": "CSS selector for the search input field",
      "confidence": 0.0-1.0,
      "reasoning": "Brief explanation"
    },
    "comment_input": {
      "selector": "CSS selector for comment input fields (contenteditable elements)",
      "confidence": 0.0-1.0,
      "reasoning": "Brief explanation"
    },
    "share_button": {
      "selector": "CSS selector for the Share button on posts",
      "confidence": 0.0-1.0,
      "reasoning": "Brief explanation"
    }
  },
  "overall_confidence": 0.0-1.0,
  "warnings": ["list of potential issues or uncertainties"],
  "facebook_version": "detected FB UI version or variant if identifiable"
}

Rules:
- Prefer aria-labels and role attributes over classes
- For like buttons: MUST verify aria-pressed or similar state check exists
- For profile links: MUST provide href include/exclude patterns to filter non-profiles
- For reaction popup: identify the container that appears on hover and individual reaction buttons
- For video posts: look for <video> tags, data-video-id attributes, or video-related aria-labels
- For story tray: identify the horizontal carousel at the top of the feed
- For notification icon: look for bell icon or notification-related aria-labels in top navigation
- For search input: look for the main search bar in the top header
- For comment input: look for contenteditable elements with comment-related aria-labels
- Confidence < 0.7 means the selector is risky and may break
- If elements are missing from the snapshot, set confidence to 0 and explain in warnings"""


def _parse_json(content: str, fallback):
    """Strip markdown fences and parse JSON."""
    content = content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[1] if "\n" in content else content[3:]
    if content.endswith("```"):
        content = content[:-3]
    try:
        return json.loads(content.strip())
    except (json.JSONDecodeError, ValueError):
        return fallback


class DOMSelectorVerifier:
    def __init__(self):
        settings = get_settings()
        if not settings.openai_api_key:
            raise ValueError("OpenAI API key not configured")
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def verify_selectors(self, dom_snapshot: dict) -> dict:
        """Analyze DOM snapshot and return verified CSS selectors."""
        user_prompt = (
            "Analyze this Facebook DOM snapshot and identify the correct CSS selectors "
            "for each warm-up action:\n\n"
            f"{json.dumps(dom_snapshot, indent=2)}\n\n"
            "Focus on:\n"
            "1. Feed articles — what role/attribute identifies post containers?\n"
            "2. Like buttons — what aria-label? How to detect liked vs unliked state?\n"
            "3. Profile links — what href patterns indicate a user profile link?\n"
            "4. Reaction popup — what container appears on like button hover? What are the individual reaction buttons?\n"
            "5. Video posts — how to detect articles containing videos?\n"
            "6. Story tray — what identifies the stories carousel at the top of the feed?\n"
            "7. Notification icon — what identifies the notification bell button?\n"
            "8. Search input — what identifies the main search bar?\n"
            "9. Comment input — what identifies comment input fields?\n"
            "10. Share button — what identifies the share action button on posts?\n\n"
            "Return ONLY valid JSON."
        )

        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=3000,
        )

        fallback = {
            "selectors": {},
            "overall_confidence": 0.0,
            "warnings": ["AI response parsing failed — using fallback selectors"],
            "facebook_version": "unknown",
        }
        result = _parse_json(response.choices[0].message.content, fallback)
        logger.info(
            "[DOMSelector] Verified selectors — confidence %.2f",
            result.get("overall_confidence", 0.0),
        )
        return result
