"""AI Live Engagement — generate contextual livestream comments per role."""

import json
import logging
import random

from openai import AsyncOpenAI

from app.config import get_settings

logger = logging.getLogger(__name__)

# Order patterns — no AI call needed, just pick randomly
ORDER_PATTERNS = [
    "+1", "nak", "order", "want", "beli", "+1 pls",
    "nak satu", "order please", "want this!", "beli satu",
    "interested!", "pm", "nak beli", "i want this",
    "+1 please", "how to order?", "nak order",
]

ROLE_DESCRIPTIONS = {
    "ask_question": (
        "Ask a genuine product question. Reference something the streamer might have shown or mentioned. "
        "Examples: price, shipping, sizes, availability, color options, material."
    ),
    "place_order": (
        "Post an order comment. Keep it very short (1-5 words)."
    ),
    "repeat_question": (
        "Rephrase a question from recent comments in your own words. "
        "Pick a real question and reword it slightly to show multiple people have the same interest. "
        "Do NOT copy the exact wording — paraphrase naturally."
    ),
    "good_vibe": (
        "Post a positive, enthusiastic comment about the product or streamer. "
        "Compliment quality, price, or the stream itself. Sound genuinely excited."
    ),
    "react_comment": (
        "React naturally to a specific recent comment. Agree with it, add to it, "
        "or build on what they said. Reference their comment naturally without quoting it exactly."
    ),
    "share_experience": (
        "Share a brief personal experience or testimony about the product or brand. "
        "Sound like a returning customer who has bought before."
    ),
}


def _parse_json_response(content: str, fallback):
    """Strip markdown fences and parse JSON, returning fallback on failure."""
    content = content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[1] if "\n" in content else content[3:]
    if content.endswith("```"):
        content = content[:-3]
    try:
        return json.loads(content.strip())
    except (json.JSONDecodeError, ValueError):
        return fallback


class AILiveEngageService:
    def __init__(self):
        settings = get_settings()
        if not settings.openai_api_key:
            raise ValueError("OpenAI API key not configured")
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def generate_comment(
        self,
        role: str,
        recent_comments: list[dict],
        business_context: str = "",
        training_comments: str | None = None,
        ai_instructions: str = "",
        reference_comment: str | None = None,
    ) -> str:
        """Generate a single livestream comment for the given role.

        For `place_order` role, returns a random template (no AI call).
        For all others, calls GPT-4o with role-specific prompts.
        """
        if role == "place_order":
            return self._generate_order_comment(recent_comments)

        return await self._generate_ai_comment(
            role, recent_comments, business_context, training_comments, ai_instructions,
            reference_comment,
        )

    def _generate_order_comment(self, recent_comments: list[dict]) -> str:
        """Generate a place-order comment — prefer patterns from current livestream."""
        # Extract short order-like comments from the current livestream
        order_keywords = {"+1", "nak", "order", "want", "beli", "pm", "interested"}
        live_order_comments = []
        for c in recent_comments[-20:]:
            msg = c.get("message", "").strip()
            if not msg or len(msg) > 30:
                continue
            msg_lower = msg.lower()
            if any(kw in msg_lower for kw in order_keywords):
                live_order_comments.append(msg)

        # Prefer current livestream order patterns, fall back to static templates
        if live_order_comments:
            return random.choice(live_order_comments)
        return random.choice(ORDER_PATTERNS)

    async def _generate_ai_comment(
        self,
        role: str,
        recent_comments: list[dict],
        business_context: str,
        training_comments: str | None,
        ai_instructions: str,
        reference_comment: str | None = None,
    ) -> str:
        """Call GPT-4o to generate a single comment."""
        role_desc = ROLE_DESCRIPTIONS.get(role, "Post a natural comment.")

        # Build training sample
        training_sample = ""
        if training_comments:
            lines = [l.strip() for l in training_comments.strip().split("\n") if l.strip()]
            if lines:
                sample = random.sample(lines, min(20, len(lines)))
                training_sample = "\n".join(f"- {l}" for l in sample)

        # Build recent comments context
        recent_text = ""
        if recent_comments:
            last_15 = recent_comments[-15:]
            recent_text = "\n".join(
                f"- {c.get('from_name', 'Someone')}: {c.get('message', '')}"
                for c in last_15
            )

        system_prompt = (
            "You generate a single Facebook livestream comment as a real viewer.\n"
            f"Your role: {role_desc}\n\n"
        )
        if business_context:
            system_prompt += f"Product/Business context:\n{business_context}\n\n"
        if ai_instructions:
            system_prompt += f"Additional instructions:\n{ai_instructions}\n\n"

        # ── CURRENT LIVESTREAM (primary content reference) ──
        if recent_text:
            system_prompt += (
                "=== CURRENT LIVESTREAM COMMENTS (this is what is happening RIGHT NOW) ===\n"
                f"{recent_text}\n\n"
                "IMPORTANT: These are the REAL comments from the live audience right now. "
                "Your comment MUST be relevant to what people are currently talking about. "
                "Follow the current topics, trends, and energy in these comments. "
                "If viewers are saying '+1' or ordering, follow that flow. "
                "If they are asking about a specific product or topic, engage with THAT topic.\n\n"
            )

        if reference_comment and role in ("react_comment", "repeat_question"):
            system_prompt += (
                f"=== TARGET COMMENT (respond to / rephrase THIS specific comment) ===\n"
                f"{reference_comment}\n\n"
            )

        # ── TRAINING COMMENTS (style guide only) ──
        if training_sample:
            system_prompt += (
                "=== STYLE GUIDE (tone and writing pattern ONLY — do NOT copy content) ===\n"
                f"{training_sample}\n\n"
                "These are past comment examples for STYLE REFERENCE ONLY. "
                "Match the tone, language, and writing pattern (casual, short, emoji usage, etc.) "
                "but do NOT use their content or topics. Your comment content must come from "
                "the CURRENT livestream comments above.\n\n"
            )

        system_prompt += (
            "Rules:\n"
            "- Your comment MUST relate to what the current livestream audience is discussing\n"
            "- Match the language of current live comments (auto-detect Malay/English/etc.)\n"
            "- Use the style/tone from style guide examples if provided, but NOT their content\n"
            "- 1-2 sentences max, casual livestream chat tone\n"
            "- No hashtags, minimal emojis (0-1 max)\n"
            "- Sound like a real viewer, not a bot or marketer\n"
            "- Vary sentence structure and length\n"
            "- Do NOT repeat any current comment verbatim\n\n"
            'Return JSON: {"comment": "your comment text"}'
        )

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Generate one {role} comment for the livestream."},
                ],
                temperature=0.7,
                max_tokens=300,
                response_format={"type": "json_object"},
            )
            parsed = _parse_json_response(response.choices[0].message.content or "{}", {})
            comment = parsed.get("comment", "")
            if comment:
                return comment
        except Exception as exc:
            logger.warning(f"[LiveEngage] AI generation failed for role={role}: {exc}")

        # Fallback: generic comment if AI fails
        fallbacks = {
            "ask_question": "How much is this?",
            "good_vibe": "This looks great!",
            "react_comment": "I agree!",
            "repeat_question": "Yes I also want to know the price",
            "share_experience": "I bought this before, very good quality!",
        }
        return fallbacks.get(role, "Nice!")
