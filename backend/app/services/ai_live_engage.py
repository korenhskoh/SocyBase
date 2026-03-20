"""AI Live Engagement — generate contextual livestream comments per role."""

import asyncio
import json
import logging
import random
import re
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
        quantity_variation: bool = True,
        languages: str = "",
    ) -> str:
        """Generate a single livestream comment for the given role.

        For `place_order` role, returns a random template (no AI call).
        For all others, calls GPT-4o with role-specific prompts.
        """
        if role == "place_order":
            return self._generate_order_comment(
                recent_comments, posted_history, detected_codes, quantity_variation,
                training_comments,
            )

        return await self._generate_ai_comment(
            role, recent_comments, business_context, training_comments, ai_instructions,
            reference_comment, posted_history, languages,
        )

    # Regex patterns for extracting codes/numbers from any text
    # Regex: code/number patterns with optional quantity — captures the WHOLE order string
    _ORDER_PATTERN_RE = re.compile(
        r'(?:^|\s)'
        r'('
        r'[a-zA-Z]{1,3}\d{1,5}'   # code like L6, m763, AB12
        r'|'
        r'\d{1,5}\s*[号號]?'       # number like 8, 8号
        r')'
        r'(\s*[+＋]\s*\d{1,3})?'   # optional quantity: +1, +2, ＋3
        r'',
        re.MULTILINE,
    )
    _CODE_RE = re.compile(r'[a-zA-Z]{1,3}\d{1,5}|\d{1,5}\s*[号號]')

    def _extract_order_patterns_from_comments(self, comments: list[dict]) -> list[str]:
        """Extract real order patterns (code + qty) exactly as viewers write them."""
        patterns: list[str] = []
        for c in comments[-30:]:
            msg = c.get("message", "").strip()
            if not msg or len(msg) > 30:
                continue
            # Check if this short message looks like an order
            matches = self._ORDER_PATTERN_RE.findall(msg)
            if matches:
                # Use the original message as-is (preserves viewer's exact format)
                patterns.append(msg.strip())
        return patterns

    def _extract_codes(self, text: str) -> list[str]:
        """Extract just the code/number part from text."""
        return self._CODE_RE.findall(text)

    def _generate_order_comment(
        self,
        recent_comments: list[dict],
        posted_history: list[str] | None = None,
        detected_codes: list[str] | None = None,
        quantity_variation: bool = True,
        training_comments: str | None = None,
    ) -> str:
        """Generate a place-order comment.

        Priority 1: Copy real viewer order patterns exactly (L6 +1, m763 nak)
        Priority 2: Use detected codes with variations
        Priority 3: Extract codes from training comments
        Priority 4: Static templates
        """
        recent_posted = {p.lower().strip() for p in (posted_history or [])[-15:]}

        # ── Priority 1: Copy REAL order patterns from live comments ──
        # This captures the exact format viewers use (L6 +1, 8号, m763 要)
        real_patterns = self._extract_order_patterns_from_comments(recent_comments)
        if real_patterns:
            # Deduplicate
            seen: set[str] = set()
            unique = []
            for p in real_patterns:
                if p.lower() not in seen and p.lower() not in recent_posted:
                    seen.add(p.lower())
                    unique.append(p)
            if unique:
                # 70% chance: use real pattern as-is
                if random.random() < 0.7:
                    return random.choice(unique)
                # 30% chance: pick a code from patterns and add variation
                codes_from_patterns = []
                for p in unique:
                    codes_from_patterns.extend(self._extract_codes(p))
                if codes_from_patterns:
                    code = random.choice(codes_from_patterns)
                    if quantity_variation:
                        qty = random.choices([1, 2, 3], weights=[6, 3, 1], k=1)[0]
                        return f"{code} +{qty}"
                    return code

        # ── Priority 2: Use detected codes + live comment codes ONLY ──
        # Training/past comments are for style reference only — never use their codes
        all_codes: list[str] = list(detected_codes or [])

        # Extract codes from LIVE comments only (not training)
        for c in recent_comments[-30:]:
            msg = c.get("message", "").strip()
            if msg:
                all_codes.extend(self._extract_codes(msg))

        # Deduplicate
        seen_upper: set[str] = set()
        unique_codes: list[str] = []
        for code in all_codes:
            if code.upper() not in seen_upper:
                seen_upper.add(code.upper())
                unique_codes.append(code)

        if unique_codes:
            # Filter out recently posted codes
            available = [c for c in unique_codes if c.lower() not in recent_posted]
            code = random.choice(available) if available else random.choice(unique_codes)

            # Generate variation — weighted to match common livestream patterns
            roll = random.random()
            if quantity_variation and roll < 0.35:
                qty = random.choices([1, 2, 3], weights=[6, 3, 1], k=1)[0]
                return f"{code} +{qty}"
            elif roll < 0.50:
                # Use order phrases seen in live chat, or defaults
                phrases = ["nak", "要", "+1", "order", "买"]
                return f"{code} {random.choice(phrases)}"
            return code

        # ── Priority 3: Short order-like patterns from live chat ──
        order_signals = {
            "+1", "nak", "order", "want", "beli", "pm",
            "要", "买", "拿", "下单", "收", "订",
        }
        live_patterns: list[str] = []
        for c in recent_comments[-30:]:
            msg = c.get("message", "").strip()
            if not msg:
                continue
            if len(msg) <= 15 or (len(msg) <= 40 and any(kw in msg.lower() for kw in order_signals)):
                live_patterns.append(msg)

        if live_patterns:
            unique_live = list({p.lower(): p for p in live_patterns}.values())
            filtered = [p for p in unique_live if p.lower() not in recent_posted]
            if filtered:
                return random.choice(filtered)
            if unique_live:
                return random.choice(unique_live)

        # ── Priority 4: Static templates ──
        templates = [p for p in ORDER_PATTERNS if p.lower() not in recent_posted]
        return random.choice(templates) if templates else random.choice(ORDER_PATTERNS)

    async def _generate_ai_comment(
        self,
        role: str,
        recent_comments: list[dict],
        business_context: str,
        training_comments: str | None,
        ai_instructions: str,
        reference_comment: str | None = None,
        posted_history: list[str] | None = None,
        languages: str = "",
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

        # Language instruction
        lang_str = ""
        if languages:
            lang_list = [l.strip().capitalize() for l in languages.split(",") if l.strip()]
            if lang_list:
                lang_str = ", ".join(lang_list)
                system_prompt += (
                    f"=== LANGUAGE REQUIREMENT ===\n"
                    f"You MUST write your comment in one of these languages: {lang_str}.\n"
                    f"Pick the most natural one for the current conversation context.\n\n"
                )

        system_prompt += (
            "Rules:\n"
            "- " + (
                f"Write in {lang_str}" if lang_str else
                "Match the language of current live comments (auto-detect Malay/English/etc.)"
            ) + "\n"
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
            response = await asyncio.wait_for(
                self.client.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": f"Generate one {role} comment for the livestream."},
                    ],
                    temperature=0.85,
                    max_tokens=300,
                    response_format={"type": "json_object"},
                ),
                timeout=30,  # 30s max for AI generation
            )
            parsed = _parse_json_response(response.choices[0].message.content or "{}", {})
            comment = parsed.get("comment", "")
            if comment and not self._is_too_similar(comment, posted_history):
                return comment
            # If too similar, try once more with higher temperature
            if comment:
                logger.info(f"[LiveEngage] Comment too similar to history, regenerating")
                response2 = await asyncio.wait_for(
                    self.client.chat.completions.create(
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
                    ),
                    timeout=30,
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
