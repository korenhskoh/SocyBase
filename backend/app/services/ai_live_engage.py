"""AI Live Engagement — generate contextual livestream comments per role."""

import json
import logging
import random
from difflib import SequenceMatcher

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
        "Ask a genuine product question about something specific. "
        "Examples: price, shipping, sizes, availability, color options, material. "
        "Keep it casual and short — like a real person typing fast in chat."
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
        "Post a brief positive comment about the product or stream. "
        "Keep it grounded and casual — like a normal viewer, NOT an overly excited fan. "
        "Avoid superlatives like 'amazing', 'incredible', 'the best ever'. "
        "Simple and believable, e.g. 'looks nice', 'good price eh', 'quality looks ok'."
    ),
    "react_comment": (
        "React naturally to a specific recent comment. Agree with it, add to it, "
        "or build on what they said. Keep it short and conversational."
    ),
    "share_experience": (
        "Share a very brief personal note about the product or brand. "
        "Keep it casual and believable — avoid sounding like a testimonial ad. "
        "e.g. 'bought last month still good' or 'my friend recommended this'."
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
        posted_history: list[str] | None = None,
        detected_codes: list[str] | None = None,
    ) -> str:
        """Generate a single livestream comment for the given role.

        For `place_order` role, returns a random template (no AI call).
        For all others, calls GPT-4o with role-specific prompts.

        Args:
            posted_history: List of our recently posted comments (last ~15) so
                AI can avoid repeating similar content.
        """
        if role == "place_order":
            return self._generate_order_comment(recent_comments, posted_history, detected_codes)

        return await self._generate_ai_comment(
            role, recent_comments, business_context, training_comments, ai_instructions,
            reference_comment, posted_history,
        )

    def _generate_order_comment(
        self,
        recent_comments: list[dict],
        posted_history: list[str] | None = None,
        detected_codes: list[str] | None = None,
    ) -> str:
        """Generate a place-order comment.

        Priority: detected product codes > real viewer patterns > static templates.
        Filters out recently posted content to avoid repetition.
        """
        # ── Priority 1: Use detected product codes ~80% of the time ──
        if detected_codes and random.random() < 0.8:
            code = random.choice(detected_codes)
            roll = random.random()
            if roll < 0.3:
                qty = random.choices([1, 2, 3], weights=[6, 3, 1], k=1)[0]
                return f"{code} +{qty}"
            elif roll < 0.5:
                phrase = random.choice(["nak", "want", "order", "beli", "pm"])
                return f"{code} {phrase}"
            return code

        # ── Priority 2: Copy real viewer order patterns from scraped comments ──
        order_signals = {
            "+1", "nak", "order", "want", "beli", "pm", "interested",
            "mau", "cod", "buy", "book", "reserved", "mine", "me",
            "saya", "aku", "confirm", "done", "paid", "bayar",
        }

        live_patterns: list[str] = []
        for c in recent_comments[-30:]:
            msg = c.get("message", "").strip()
            if not msg:
                continue
            msg_lower = msg.lower()
            if len(msg) <= 40 and any(kw in msg_lower for kw in order_signals):
                live_patterns.append(msg)
            elif len(msg) <= 15:
                live_patterns.append(msg)

        # Deduplicate while preserving order
        seen = set()
        unique_patterns: list[str] = []
        for p in live_patterns:
            key = p.lower().strip()
            if key not in seen:
                seen.add(key)
                unique_patterns.append(p)

        candidates = unique_patterns if unique_patterns else list(ORDER_PATTERNS)

        # Filter out recently posted to avoid repetition
        if posted_history:
            recent_posted = set(p.lower().strip() for p in posted_history[-10:])
            filtered = [c for c in candidates if c.lower().strip() not in recent_posted]
            if filtered:
                candidates = filtered

        return random.choice(candidates)

    async def _generate_ai_comment(
        self,
        role: str,
        recent_comments: list[dict],
        business_context: str,
        training_comments: str | None,
        ai_instructions: str,
        reference_comment: str | None = None,
        posted_history: list[str] | None = None,
    ) -> str:
        """Call GPT-4o to generate a single comment.

        Includes posted_history so the AI knows what we already said and avoids
        repeating similar content, structure, or phrasing.
        """
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

        # Build our posted history context
        history_text = ""
        if posted_history:
            last_entries = posted_history[-15:]
            history_text = "\n".join(f"- {c}" for c in last_entries)

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
                "Your comment MUST be relevant to what people are currently talking about. "
                "Follow the current topics and energy in these comments.\n\n"
            )

        if reference_comment and role in ("react_comment", "repeat_question"):
            system_prompt += (
                f"=== TARGET COMMENT (respond to / rephrase THIS specific comment) ===\n"
                f"{reference_comment}\n\n"
            )

        # ── OUR POSTED HISTORY (anti-repetition context) ──
        if history_text:
            system_prompt += (
                "=== COMMENTS WE ALREADY POSTED (DO NOT repeat or resemble these) ===\n"
                f"{history_text}\n\n"
                "CRITICAL: You must write something COMPLETELY DIFFERENT from the above. "
                "Do not reuse the same words, sentence structure, or topic angle. "
                "If we already asked about price, ask about something else. "
                "If we already complimented the product, say something about the stream or seller instead. "
                "Each comment must feel like it comes from a DIFFERENT person with a different personality.\n\n"
            )

        # ── TRAINING COMMENTS (teach AI how to reply) ──
        if training_sample:
            system_prompt += (
                "=== EXAMPLE COMMENTS (learn HOW to reply from these) ===\n"
                f"{training_sample}\n\n"
                "These are real past comments that show the RIGHT way to reply. "
                "Study them carefully and learn:\n"
                "- The LANGUAGE to use (Malay, English, mixed, slang)\n"
                "- The TONE (casual, formal, playful, direct)\n"
                "- The LENGTH and STRUCTURE (short phrases vs full sentences)\n"
                "- The STYLE of engagement (how they ask questions, react, express interest)\n"
                "- Any common phrases, abbreviations, or patterns\n\n"
                "Your comment should feel like it was written by the same type of person. "
                "Do NOT copy these examples word-for-word, but deeply match their style "
                "and adapt it to the CURRENT livestream topics above.\n\n"
            )

        system_prompt += (
            "Rules:\n"
            "- Match the language of current live comments (auto-detect Malay/English/etc.)\n"
            "- 1-2 sentences max, casual livestream chat tone\n"
            "- No hashtags, no more than 1 emoji\n"
            "- Sound like a NORMAL viewer — not overly enthusiastic or salesy\n"
            "- Do NOT use exclamation marks excessively (max 1 per comment)\n"
            "- Avoid superlatives (amazing, incredible, best ever, absolutely love)\n"
            "- Keep it grounded and believable — imperfect grammar is OK\n"
            "- Vary sentence structure and length from previous comments\n"
            "- Do NOT repeat any current comment or our posted comments\n\n"
            'Return JSON: {"comment": "your comment text"}'
        )

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Generate one {role} comment for the livestream."},
                ],
                temperature=0.85,
                max_tokens=300,
                response_format={"type": "json_object"},
            )
            parsed = _parse_json_response(response.choices[0].message.content or "{}", {})
            comment = parsed.get("comment", "")
            if comment and not self._is_too_similar(comment, posted_history):
                return comment
            # If too similar, try once more with higher temperature
            if comment:
                logger.info(f"[LiveEngage] Comment too similar to history, regenerating")
                response2 = await self.client.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": (
                            f"Generate one {role} comment for the livestream. "
                            "Make it very different from anything posted before — "
                            "use a completely different angle, tone, and wording."
                        )},
                    ],
                    temperature=1.0,
                    max_tokens=300,
                    response_format={"type": "json_object"},
                )
                parsed2 = _parse_json_response(response2.choices[0].message.content or "{}", {})
                comment2 = parsed2.get("comment", "")
                if comment2:
                    return comment2
                return comment  # Use original if retry also fails
        except Exception as exc:
            logger.warning(f"[LiveEngage] AI generation failed for role={role}: {exc}")

        # Fallback: generic comment if AI fails
        fallbacks = {
            "ask_question": "How much is this?",
            "good_vibe": "Looks nice",
            "react_comment": "Same here",
            "repeat_question": "Ya I also want to know",
            "share_experience": "Bought before, quite good",
        }
        return fallbacks.get(role, "Nice")

    @staticmethod
    def _is_too_similar(comment: str, posted_history: list[str] | None, threshold: float = 0.55) -> bool:
        """Check if comment is too similar to any recently posted comment."""
        if not posted_history:
            return False
        comment_lower = comment.lower().strip()
        for prev in posted_history[-15:]:
            ratio = SequenceMatcher(None, comment_lower, prev.lower().strip()).ratio()
            if ratio >= threshold:
                return True
        return False
