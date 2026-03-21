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
ORDER_PATTERNS_BY_LANG = {
    "malay": [
        "+1", "nak", "beli", "nak satu", "nak beli", "pm",
        "interested", "order", "nak order", "beli satu",
        "berapa harga?", "nak satu ni", "cantik nak",
    ],
    "english": [
        "+1", "want", "order", "want this!", "order please",
        "+1 please", "interested!", "pm", "i want this",
        "how to order?", "how much?", "take one",
    ],
    "chinese": [
        "+1", "要", "想要", "下单", "买", "我要",
        "拿一个", "怎么买", "多少钱", "要一个",
        "来一个", "买买买", "想买", "订一个",
        "有货吗", "还有吗", "要这个", "pm",
    ],
}
# Combined fallback (English + Chinese, default)
ORDER_PATTERNS = (
    ORDER_PATTERNS_BY_LANG["english"]
    + ORDER_PATTERNS_BY_LANG["chinese"]
)

ROLE_DESCRIPTIONS = {
    "ask_question": (
        "Ask a genuine product question about something visible or being discussed RIGHT NOW. "
        "Base your question on what the host is showing or what other viewers are asking about. "
        "Topics: price, size, color, material, shipping, availability, how to use, comparison. "
        "Keep it SHORT (3-10 words) — like a real person typing fast on their phone in chat. "
        "Use casual tone, abbreviations OK, slight typos OK. "
        "Examples: '这个多少钱', 'ada size lain tak?', 'how much this one', '几号的？', 'can ship to penang?'"
    ),
    "place_order": (
        "Post an order comment. Keep it very short (1-5 words)."
    ),
    "repeat_question": (
        "You MUST pick ONE specific question from the recent comments and rephrase it in your own words. "
        "This shows the host that MULTIPLE people want to know the same thing. "
        "Change the wording but keep the same meaning. Do NOT ask a new question. "
        "Example: if someone asked '多少钱？' → you write '价格怎么算的' or 'berapa ni?'. "
        "Match the language that most viewers are using."
    ),
    "good_vibe": (
        "Post a VERY brief reaction (2-6 words). You are a casual viewer, not a salesperson. "
        "Comment on what you SEE in the stream — the product, the host's energy, or the chat vibe. "
        "Must feel spontaneous and real, like you typed it in 2 seconds without thinking. "
        "GOOD: '不错', '好看', 'cantik', 'nice colour', '这个可以', 'quality ok la' "
        "BAD: '这个产品真的太棒了非常值得购买' (too long, too salesy, not believable)"
    ),
    "react_comment": (
        "React to a SPECIFIC recent viewer comment. You MUST reference what they said. "
        "Agree, disagree gently, add your perspective, or ask a follow-up. "
        "Keep it conversational — like two viewers chatting in the live stream. "
        "Example: viewer says '这个颜色好看' → you: '对啊这个绿蛮正的' or 'betul cantik warna dia'. "
        "Do NOT be generic — your reply must clearly relate to what the specific viewer said."
    ),
    "share_experience": (
        "Share a BRIEF personal touch about owning/using this type of product. "
        "Must be 1 sentence, casual, and sound like a normal person sharing — not an ad. "
        "Mention a specific detail (who you gave it to, how long you've had it, what happened). "
        "GOOD: '上次买了个送妈妈，她戴了都不肯脱', 'beli bulan lepas masih ok lagi' "
        "BAD: '我强烈推荐这个产品，质量非常好！' (sounds like a paid review)"
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
        ai_context_count: int = 15,
    ) -> str:
        """Generate a single livestream comment for the given role.

        For `place_order` role, returns a random template (no AI call).
        For all others, calls GPT-4o with role-specific prompts.
        """
        if role == "place_order":
            return self._generate_order_comment(
                recent_comments, posted_history, detected_codes, quantity_variation,
                training_comments, languages,
            )

        return await self._generate_ai_comment(
            role, recent_comments, business_context, training_comments, ai_instructions,
            reference_comment, posted_history, languages, detected_codes, ai_context_count,
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
        languages: str = "",
    ) -> str:
        """Generate a place-order comment.

        Priority 1: Copy real viewer order patterns exactly (L6 +1, m763 nak)
        Priority 2: Use detected codes with variations
        Priority 3: Extract codes from training comments
        Priority 4: Language-specific static templates
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

            if quantity_variation:
                # Quantity variation ON → always add +N to code
                qty = random.choices([1, 2, 3], weights=[6, 3, 1], k=1)[0]
                roll = random.random()
                if roll < 0.5:
                    return f"{code}+{qty}"      # B1+1
                elif roll < 0.8:
                    return f"{code} +{qty}"     # B1 +1
                else:
                    # Occasionally add order phrase too
                    phrase_map = {
                        "english": ["want", "order"],
                        "chinese": ["要", "买"],
                    }
                    phrases = []
                    if languages:
                        for lang in [l.strip().lower() for l in languages.split(",") if l.strip()]:
                            phrases.extend(phrase_map.get(lang, []))
                    if not phrases:
                        phrases = ["要", "want"]
                    return f"{code}+{qty} {random.choice(phrases)}"  # B1+1 要
            else:
                # Quantity variation OFF → just code, maybe with phrase
                roll = random.random()
                if roll < 0.6:
                    return code                 # B1
                else:
                    phrase_map = {
                        "english": ["want", "order", "pm"],
                        "chinese": ["要", "买", "下单"],
                    }
                    phrases = []
                    if languages:
                        for lang in [l.strip().lower() for l in languages.split(",") if l.strip()]:
                            phrases.extend(phrase_map.get(lang, []))
                    if not phrases:
                        phrases = ["要", "want"]
                    return f"{code} {random.choice(phrases)}"  # B1 要

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

        # ── Priority 4: Language-specific static templates ──
        # Build template pool based on selected languages
        lang_pool: list[str] = []
        if languages:
            lang_list = [l.strip().lower() for l in languages.split(",") if l.strip()]
            for lang in lang_list:
                if lang in ORDER_PATTERNS_BY_LANG:
                    lang_pool.extend(ORDER_PATTERNS_BY_LANG[lang])
        if not lang_pool:
            lang_pool = list(ORDER_PATTERNS)  # fallback: all languages
        templates = [p for p in lang_pool if p.lower() not in recent_posted]
        return random.choice(templates) if templates else random.choice(lang_pool)

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
        detected_codes: list[str] | None = None,
        ai_context_count: int = 15,
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
            last_15 = recent_comments[-ai_context_count:]
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

        # ── DETECTED PRODUCT CODES (from real live comments) ──
        if detected_codes:
            codes_str = ", ".join(detected_codes[:20])
            system_prompt += (
                f"=== ACTIVE PRODUCT CODES (detected from viewer comments) ===\n"
                f"{codes_str}\n\n"
                "These are real product codes viewers are ordering right now. "
                "When asking questions, you can reference these codes specifically "
                "(e.g. 'how much is code 480?' or '480号还有吗？'). "
                "When reacting to comments, acknowledge orders with these codes. "
                "This makes your comment relevant to the current ordering activity.\n\n"
            )

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
                "- The TONE (casual, formal, playful, direct)\n"
                "- The LENGTH and STRUCTURE (short phrases vs full sentences)\n"
                "- The STYLE of engagement (how they ask questions, react, express interest)\n"
                "- Any common phrases, abbreviations, or patterns\n\n"
                "Your comment should feel like it was written by the same type of person. "
                "Do NOT copy these examples word-for-word, but deeply match their style "
                "and adapt it to the CURRENT livestream topics above.\n\n"
            )

        # Language instruction — auto-detect from comments if not specified
        lang_str = ""
        if languages:
            lang_list = [l.strip().capitalize() for l in languages.split(",") if l.strip()]
            if lang_list:
                lang_str = ", ".join(lang_list)
                system_prompt += (
                    f"=== LANGUAGE REQUIREMENT (MANDATORY) ===\n"
                    f"You MUST write your comment ONLY in: {lang_str}.\n"
                    f"Do NOT use any other language. Even if comments are in other languages, "
                    f"you MUST respond in {lang_str} ONLY. This is non-negotiable.\n\n"
                )
        elif recent_comments:
            # Auto-detect dominant language from recent comments (default: English)
            all_msgs = " ".join(c.get("message", "") for c in recent_comments[-10:])
            has_chinese = bool(re.search(r'[\u4e00-\u9fff]', all_msgs))
            detected_langs = []
            if has_chinese:
                detected_langs.append("Chinese")
            if not detected_langs:
                detected_langs.append("English")
            lang_str = ", ".join(detected_langs)
            system_prompt += (
                f"=== LANGUAGE (auto-detected from live chat) ===\n"
                f"The viewers are mostly using: {lang_str}. Write in this language.\n\n"
            )

        system_prompt += (
            "=== STRICT RULES ===\n"
            "- " + (
                f"STRICTLY write in {lang_str} ONLY — do NOT use any other language" if lang_str else
                "Auto-detect and match the language most viewers are using (Chinese/Malay/English/mixed)"
            ) + "\n"
            "- MAX 1-2 short sentences. Most livestream comments are 3-15 words\n"
            "- Casual chat tone — you're typing on a phone while watching\n"
            "- NO hashtags. Max 1 emoji (optional). No @ mentions\n"
            "- Sound like a REAL viewer — imperfect grammar, abbreviations, slang are GOOD\n"
            "- Do NOT use exclamation marks excessively (max 1)\n"
            "- NEVER use superlatives: amazing, incredible, best ever, absolutely, definitely\n"
            "- NEVER sound like an advertisement or sponsored comment\n"
            "- Keep it grounded — like someone casually watching, not deeply invested\n"
            "- Mixed language is natural and OK (e.g. 'wah 这个 not bad la', '好看 cantik')\n"
            "- Vary your comment length — some short (2-4 words), some medium (5-12 words)\n"
            "- Each comment must feel like a DIFFERENT person typed it\n"
            "- NEVER repeat anything from current comments or our posted history\n"
            "- Reference what is CURRENTLY being shown/discussed — not generic product comments\n\n"
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

        # Fallback: language-aware generic comment if AI fails
        fallbacks_by_lang = {
            "chinese": {
                "ask_question": ["多少钱", "有其他颜色吗", "可以包邮吗", "还有货吗"],
                "good_vibe": ["不错", "好看", "可以", "质量不错"],
                "react_comment": ["对啊", "是的", "确实", "我也觉得"],
                "repeat_question": ["也想知道", "对呀多少钱", "怎么买"],
                "share_experience": ["之前买过不错", "朋友推荐的", "用了很久了"],
            },
            "english": {
                "ask_question": ["how much?", "any other colors?", "can ship?", "still available?"],
                "good_vibe": ["looks nice", "not bad", "good quality", "nice one"],
                "react_comment": ["same here", "agree", "true", "yeah"],
                "repeat_question": ["want to know too", "how much is it?", "same question"],
                "share_experience": ["bought before quite good", "friend recommended", "have one already"],
            },
        }
        # Pick language from setting or auto-detect (default: English)
        lang_key = "english"
        if languages:
            first_lang = languages.split(",")[0].strip().lower()
            if first_lang in fallbacks_by_lang:
                lang_key = first_lang
        elif recent_comments:
            all_msgs = " ".join(c.get("message", "") for c in recent_comments[-5:])
            if re.search(r'[\u4e00-\u9fff]', all_msgs):
                lang_key = "chinese"
        pool = fallbacks_by_lang.get(lang_key, fallbacks_by_lang["english"])
        options = pool.get(role, pool.get("good_vibe", ["nice"]))
        return random.choice(options)

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
