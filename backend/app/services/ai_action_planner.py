"""AI Action Planner — generate contextual bulk Facebook actions from scraped posts."""

import json
import logging
import random

from openai import AsyncOpenAI

from app.config import get_settings

logger = logging.getLogger(__name__)

# Actions the planner can generate (excludes utility-only actions)
PLANNABLE_ACTIONS = {
    "comment_to_post",
    "page_comment_to_post",
    "reply_to_comment",
    "add_friend",
    "join_group",
    "post_to_my_feed",
    "post_to_group",
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


class AIActionPlanner:
    def __init__(self):
        settings = get_settings()
        if not settings.openai_api_key:
            raise ValueError("OpenAI API key not configured")
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def extract_search_keywords(self, user_prompt: str) -> list[str]:
        """Extract 3-5 Facebook page search keywords from user's description."""
        system = (
            "You help find relevant Facebook pages. Given a user's description of what they want, "
            "extract 3-5 short search keywords/phrases optimized for Facebook page search.\n\n"
            "Rules:\n"
            "- Each keyword should be 1-4 words\n"
            "- Include variations: English + local language (Malay/etc.) if relevant\n"
            "- Focus on business/page names, product categories, location terms\n"
            "- Think about how real businesses name their Facebook pages\n\n"
            'Return JSON: {"keywords": ["keyword1", "keyword2", ...]}'
        )
        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.3,
                max_tokens=200,
            )
            parsed = _parse_json_response(response.choices[0].message.content or "{}", {})
            keywords = parsed.get("keywords", [])
            return keywords if keywords else [user_prompt]
        except Exception as exc:
            logger.warning(f"[AIPlanner] Keyword extraction failed: {exc}")
            return [user_prompt]

    async def generate_actions(
        self,
        posts: list[dict],
        comments_by_post: dict[str, list[dict]],
        action_types: list[str],
        business_context: str = "",
        actions_per_post: int = 3,
        page_id: str | None = None,
        group_id: str | None = None,
    ) -> list[dict]:
        """Generate bulk actions from selected posts using a two-stage AI pipeline.

        Returns a flat list of action dicts, each with at minimum:
            action_name, and the relevant param fields (post_id, content, uid, etc.)
        """
        all_actions: list[dict] = []

        # Stage 1: Analyze posts
        analysis = await self._analyze_posts(posts)

        # Stage 2: Generate per action type
        for action_type in action_types:
            if action_type not in PLANNABLE_ACTIONS:
                continue

            if action_type == "comment_to_post":
                actions = await self._gen_comments(
                    posts, analysis, business_context, actions_per_post
                )
                all_actions.extend(actions)

            elif action_type == "page_comment_to_post" and page_id:
                actions = await self._gen_page_comments(
                    posts, analysis, business_context, actions_per_post, page_id
                )
                all_actions.extend(actions)

            elif action_type == "reply_to_comment":
                actions = await self._gen_replies(
                    posts, comments_by_post, analysis, business_context
                )
                all_actions.extend(actions)

            elif action_type == "add_friend":
                actions = self._gen_add_friend(comments_by_post)
                all_actions.extend(actions)

            elif action_type == "join_group":
                actions = self._gen_join_group(posts)
                all_actions.extend(actions)

            elif action_type == "post_to_my_feed":
                actions = await self._gen_original_posts(
                    posts, analysis, business_context, actions_per_post
                )
                all_actions.extend(actions)

            elif action_type == "post_to_group" and group_id:
                actions = await self._gen_group_posts(
                    posts, analysis, business_context, actions_per_post, group_id
                )
                all_actions.extend(actions)

        return all_actions

    # ── Stage 1: Analyze ─────────────────────────────────────────────

    async def _analyze_posts(self, posts: list[dict]) -> dict:
        """Analyze posts for themes, tone, and engagement patterns."""
        post_summaries = []
        for i, p in enumerate(posts[:20]):
            msg = (p.get("message") or "")[:300]
            post_summaries.append(
                f"[{i}] \"{msg}\" "
                f"(reactions:{p.get('reaction_count', 0)}, "
                f"comments:{p.get('comment_count', 0)}, "
                f"shares:{p.get('share_count', 0)}, "
                f"type:{p.get('attachment_type', 'text')})"
            )

        system_prompt = (
            "You are a social media analyst. Analyze these Facebook posts from competitor pages.\n"
            "Return JSON with:\n"
            '  "themes": list of top 5 recurring topics/themes,\n'
            '  "tone": overall tone (casual, professional, enthusiastic, etc.),\n'
            '  "audience_profile": one-sentence description of who these posts target,\n'
            '  "top_indices": list of up to 5 post indices with best engagement\n'
            "Return ONLY valid JSON."
        )

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": "\n".join(post_summaries)},
                ],
                response_format={"type": "json_object"},
                temperature=0.3,
                max_tokens=600,
            )
            return _parse_json_response(
                response.choices[0].message.content,
                {"themes": [], "tone": "neutral", "audience_profile": "", "top_indices": []},
            )
        except Exception as e:
            logger.error("AI analysis failed: %s", e)
            return {"themes": [], "tone": "neutral", "audience_profile": "", "top_indices": []}

    # ── Stage 2: Generators ──────────────────────────────────────────

    async def _gen_comments(
        self, posts: list[dict], analysis: dict, context: str, per_post: int
    ) -> list[dict]:
        """Generate varied comments for posts."""
        post_data = []
        for p in posts:
            post_data.append({
                "post_id": p["post_id"],
                "message": (p.get("message") or "")[:400],
                "from_name": p.get("from_name", ""),
                "type": p.get("attachment_type", "text"),
            })

        system_prompt = (
            "You are a social media engagement specialist. Generate natural, varied comments "
            "for Facebook posts. Each comment must use a DIFFERENT style from:\n"
            "- question: Ask a genuine question about the content\n"
            "- compliment: Express genuine appreciation\n"
            "- personal_story: Share a brief related experience\n"
            "- agreement: Agree and add an insight\n"
            "- opinion: Share a thoughtful opinion\n\n"
            "Rules:\n"
            "- NEVER use hashtags\n"
            "- Keep comments 1-3 sentences\n"
            "- Sound human and authentic, not like a bot\n"
            "- Reference specific details from the post content\n"
            "- Vary sentence length and structure\n"
            "- Match the language of the post (if post is in Malay, comment in Malay)\n"
            "- If the post has no text (image/video only), comment on the visual content\n\n"
            f"Generate exactly {per_post} comments per post, each with a different style.\n"
            'Return JSON: {{"comments": [{{"post_id": "...", "content": "...", "style": "..."}}]}}'
        )

        user_prompt = ""
        if context:
            user_prompt += f"Business context: {context}\n\n"
        user_prompt += f"Post analysis: themes={analysis.get('themes', [])}, tone={analysis.get('tone', 'neutral')}\n\n"
        user_prompt += f"Posts:\n{json.dumps(post_data, ensure_ascii=False)}"

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.7,
                max_tokens=3000,
            )
            data = _parse_json_response(
                response.choices[0].message.content, {"comments": []}
            )
            return [
                {
                    "action_name": "comment_to_post",
                    "post_id": c["post_id"],
                    "content": c["content"],
                    "style": c.get("style", ""),
                }
                for c in data.get("comments", [])
                if c.get("post_id") and c.get("content")
            ]
        except Exception as e:
            logger.error("AI comment generation failed: %s", e)
            return []

    async def _gen_page_comments(
        self, posts: list[dict], analysis: dict, context: str, per_post: int, page_id: str
    ) -> list[dict]:
        """Generate professional brand-voice comments as a page."""
        post_data = [
            {
                "post_id": p["post_id"],
                "message": (p.get("message") or "")[:400],
                "from_name": p.get("from_name", ""),
            }
            for p in posts
        ]

        system_prompt = (
            "You are a professional social media manager commenting as a business page. "
            "Generate brand-appropriate comments that add value to the conversation.\n\n"
            "Rules:\n"
            "- Professional but warm tone\n"
            "- Add value: share expertise, offer helpful tips, or show genuine interest\n"
            "- NEVER be salesy or promotional\n"
            "- 1-2 sentences max\n"
            "- Match the language of the post\n"
            f"- Generate {per_post} comments per post\n"
            'Return JSON: {{"comments": [{{"post_id": "...", "content": "..."}}]}}'
        )

        user_prompt = ""
        if context:
            user_prompt += f"Brand context: {context}\n\n"
        user_prompt += f"Posts:\n{json.dumps(post_data, ensure_ascii=False)}"

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.7,
                max_tokens=2000,
            )
            data = _parse_json_response(
                response.choices[0].message.content, {"comments": []}
            )
            return [
                {
                    "action_name": "page_comment_to_post",
                    "page_id": page_id,
                    "post_id": c["post_id"],
                    "content": c["content"],
                }
                for c in data.get("comments", [])
                if c.get("post_id") and c.get("content")
            ]
        except Exception as e:
            logger.error("AI page comment generation failed: %s", e)
            return []

    async def _gen_replies(
        self, posts: list[dict], comments_by_post: dict, analysis: dict, context: str
    ) -> list[dict]:
        """Generate replies to top comments."""
        comment_data = []
        for post_id, comments in comments_by_post.items():
            # Pick top comments by text length (most substantive)
            sorted_comments = sorted(
                comments, key=lambda c: len(c.get("comment_text", "")), reverse=True
            )
            for c in sorted_comments[:3]:
                if c.get("comment_text") and c.get("comment_id"):
                    comment_data.append({
                        "post_id": post_id,
                        "comment_id": c["comment_id"],
                        "commenter_name": c.get("commenter_name", ""),
                        "comment_text": c["comment_text"][:300],
                    })

        if not comment_data:
            return []

        system_prompt = (
            "You are a friendly social media user. Generate natural replies to Facebook comments.\n\n"
            "Rules:\n"
            "- Be conversational and add value\n"
            "- 1-2 sentences\n"
            "- Address the commenter naturally\n"
            "- Match the language\n"
            "- NEVER use hashtags\n"
            'Return JSON: {{"replies": [{{"post_id": "...", "comment_id": "...", "content": "..."}}]}}'
        )

        user_prompt = ""
        if context:
            user_prompt += f"Context: {context}\n\n"
        user_prompt += f"Comments to reply to:\n{json.dumps(comment_data, ensure_ascii=False)}"

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.7,
                max_tokens=2000,
            )
            data = _parse_json_response(
                response.choices[0].message.content, {"replies": []}
            )
            return [
                {
                    "action_name": "reply_to_comment",
                    "parent_post_id": r["post_id"],
                    "comment_id": r["comment_id"],
                    "content": r["content"],
                }
                for r in data.get("replies", [])
                if r.get("post_id") and r.get("comment_id") and r.get("content")
            ]
        except Exception as e:
            logger.error("AI reply generation failed: %s", e)
            return []

    def _gen_add_friend(self, comments_by_post: dict) -> list[dict]:
        """Extract unique commenter UIDs for friend requests. No AI needed."""
        seen_uids: set[str] = set()
        actions = []
        for comments in comments_by_post.values():
            for c in comments:
                uid = c.get("commenter_user_id", "")
                if uid and uid not in seen_uids:
                    seen_uids.add(uid)
                    actions.append({"action_name": "add_friend", "uid": uid})
        return actions

    def _gen_join_group(self, posts: list[dict]) -> list[dict]:
        """Extract group IDs from post raw_data. No AI needed."""
        seen_groups: set[str] = set()
        actions = []
        for p in posts:
            raw = p.get("raw_data") or {}
            if isinstance(raw, str):
                try:
                    raw = json.loads(raw)
                except (json.JSONDecodeError, ValueError):
                    raw = {}

            # Look for group references in various possible locations
            target = raw.get("target") or {}
            if isinstance(target, dict):
                group_id = target.get("id", "")
                if group_id and "group" in str(target.get("type", "")).lower():
                    if group_id not in seen_groups:
                        seen_groups.add(group_id)
                        actions.append({"action_name": "join_group", "group_id": group_id})

            # Also check shared_from
            shared = raw.get("shared_from") or raw.get("via") or {}
            if isinstance(shared, dict):
                gid = shared.get("id", "")
                if gid and gid not in seen_groups:
                    seen_groups.add(gid)
                    actions.append({"action_name": "join_group", "group_id": gid})

        return actions

    async def _gen_original_posts(
        self, posts: list[dict], analysis: dict, context: str, count: int
    ) -> list[dict]:
        """Generate original posts inspired by top-performing competitor content."""
        # Use top posts by engagement
        top_posts = sorted(
            posts,
            key=lambda p: (p.get("reaction_count", 0) + p.get("share_count", 0) * 3),
            reverse=True,
        )[:5]

        inspiration = [
            {"message": (p.get("message") or "")[:400], "engagement": p.get("reaction_count", 0)}
            for p in top_posts
            if p.get("message")
        ]

        if not inspiration:
            return []

        system_prompt = (
            "You are a creative social media content writer. Create original posts "
            "inspired by high-performing competitor content. NEVER copy text directly.\n\n"
            "Rules:\n"
            "- Capture the VALUE PROPOSITION, not the words\n"
            "- Use the business context to tailor the message\n"
            "- Include a call to action when appropriate\n"
            "- Keep posts 2-4 sentences\n"
            "- Vary formats: story-driven, direct, question-based\n"
            "- Match the language of the inspiration posts\n"
            f"- Generate {min(count, 5)} original posts\n"
            'Return JSON: {{"posts": [{{"content": "..."}}]}}'
        )

        user_prompt = f"Business: {context or 'General business'}\n\n"
        user_prompt += f"Themes: {analysis.get('themes', [])}\n"
        user_prompt += f"Audience: {analysis.get('audience_profile', '')}\n\n"
        user_prompt += f"Inspiration posts:\n{json.dumps(inspiration, ensure_ascii=False)}"

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.8,
                max_tokens=1500,
            )
            data = _parse_json_response(
                response.choices[0].message.content, {"posts": []}
            )
            return [
                {"action_name": "post_to_my_feed", "content": p["content"]}
                for p in data.get("posts", [])
                if p.get("content")
            ]
        except Exception as e:
            logger.error("AI original post generation failed: %s", e)
            return []

    async def _gen_group_posts(
        self, posts: list[dict], analysis: dict, context: str, count: int, group_id: str
    ) -> list[dict]:
        """Generate posts for a specific group, inspired by top content."""
        feed_actions = await self._gen_original_posts(posts, analysis, context, count)
        return [
            {**a, "action_name": "post_to_group", "group_id": group_id}
            for a in feed_actions
        ]

    # ── CSV Export ───────────────────────────────────────────────────

    def build_csv_rows(
        self,
        actions: list[dict],
        login_results: list | None = None,
        meta_service=None,
    ) -> list[dict]:
        """Convert actions to CSV_COLUMNS-compatible rows.

        If login_results are provided, shuffle and round-robin assign accounts.
        """
        from app.api.v1.fb_action import CSV_COLUMNS

        rows = []
        shuffled = list(actions)
        random.shuffle(shuffled)

        for i, action in enumerate(shuffled):
            row = {col: "" for col in CSV_COLUMNS}
            row["action_name"] = action.get("action_name", "")
            row["repeat_count"] = "1"

            # Map action params to CSV columns
            for key in [
                "content", "post_id", "comment_id", "parent_post_id",
                "page_id", "group_id", "uid", "input",
                "images", "image", "video_url", "preset_id",
                "first", "last", "middle", "bio",
            ]:
                if action.get(key):
                    row[key] = str(action[key])

            # Assign account if login results available
            if login_results:
                account = login_results[i % len(login_results)]
                try:
                    if meta_service and account.cookie_encrypted:
                        row["cookie"] = meta_service.decrypt_token(account.cookie_encrypted)
                except Exception:
                    row["cookie"] = ""
                row["user_agent"] = account.user_agent or ""
                if account.proxy_used and isinstance(account.proxy_used, dict):
                    row["proxy_host"] = account.proxy_used.get("host", "")
                    row["proxy_port"] = str(account.proxy_used.get("port", ""))
                    row["proxy_username"] = account.proxy_used.get("username", "")
                    row["proxy_password"] = account.proxy_used.get("password", "")

            rows.append(row)

        return rows
