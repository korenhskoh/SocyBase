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
    ) -> str:
        """Generate a single livestream comment for the given role.

        For `place_order` role, returns a random template (no AI call).
        For all others, calls GPT-4o with role-specific prompts.
        """
        if role == "place_order":
            return self._generate_order_comment(business_context)

        return await self._generate_ai_comment(
            role, recent_comments, business_context, training_comments, ai_instructions
        )

    def _generate_order_comment(self, business_context: str) -> str:
        """Generate a place-order comment from templates — no AI call."""
        # Try to extract a product keyword from context
        product_keyword = ""
        if business_context:
            words = business_context.split()
            # Pick a short noun-like word from context (simple heuristic)
            candidates = [w.strip(".,!?") for w in words if 3 <= len(w.strip(".,!?")) <= 15]
            if candidates:
                product_keyword = random.choice(candidates[:10])

        pattern = random.choice(ORDER_PATTERNS)
        if "{product_keyword}" in pattern and product_keyword:
            return pattern.replace("{product_keyword}", product_keyword)
        elif "{product_keyword}" in pattern:
            # Fallback to simple pattern without product keyword
            return random.choice([p for p in ORDER_PATTERNS if "{product_keyword}" not in p])
        return pattern

    async def _generate_ai_comment(
        self,
        role: str,
        recent_comments: list[dict],
        business_context: str,
        training_comments: str | None,
        ai_instructions: str,
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
        if training_sample:
            system_prompt += f"Style examples from past comments (match this tone and language):\n{training_sample}\n\n"
        if recent_text:
            system_prompt += f"Recent live comments (current conversation happening now):\n{recent_text}\n\n"

        system_prompt += (
            "Rules:\n"
            "- Match the language of recent comments (auto-detect Malay/English/etc.)\n"
            "- 1-2 sentences max, casual livestream chat tone\n"
            "- No hashtags, minimal emojis (0-1 max)\n"
            "- Sound like a real viewer, not a bot or marketer\n"
            "- Vary sentence structure and length\n"
            "- Do NOT repeat any recent comment verbatim\n\n"
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
