"""AI DOM Selector Verifier — analyzes Facebook DOM snapshots to identify
and verify CSS selectors for warm-up actions."""

import json
import logging

from openai import AsyncOpenAI

from app.config import get_settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a DOM analysis expert specializing in Facebook's UI structure.
Given a DOM snapshot of Facebook's news feed, identify and verify the correct CSS selectors
for automated warm-up actions (scrolling, liking posts, viewing profiles).

Analyze the structural metadata (tags, attributes, aria-labels, roles) and return stable,
reliable selectors. Prefer aria-labels and role attributes over CSS classes (classes change
frequently with Facebook deploys).

Return JSON with this exact structure:
{
  "selectors": {
    "feed_article": {
      "selector": "CSS selector string for feed post containers",
      "confidence": 0.0-1.0,
      "reasoning": "Brief explanation"
    },
    "like_button": {
      "selector": "CSS selector string for the Like button",
      "state_check": "attribute name to check liked state (e.g. aria-pressed)",
      "state_value_liked": "value when post is already liked (e.g. true)",
      "confidence": 0.0-1.0,
      "reasoning": "Brief explanation"
    },
    "profile_link": {
      "selector": "CSS selector string for profile links in feed",
      "href_include": ["patterns the href must contain"],
      "href_exclude": ["patterns to exclude from href"],
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
            "3. Profile links — what href patterns indicate a user profile link?\n\n"
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
            max_tokens=1500,
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
