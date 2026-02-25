"""Algorithmic bot/fake account detection for Facebook commenters."""

from collections import Counter
from datetime import datetime


class BotDetector:
    """Detect bot/fake accounts based on comment patterns."""

    @staticmethod
    def analyze_fan(comments: list[dict]) -> dict:
        """
        Analyze a fan's comments for bot indicators.

        Each comment dict should have: post_id, comment_text, comment_time (datetime|None).

        Returns dict with bot_score (0-1), is_bot, indicators, details.
        """
        if not comments:
            return {
                "bot_score": 0.0,
                "is_bot": False,
                "indicators": {},
                "details": {},
            }

        indicators: dict[str, bool] = {}
        details: dict[str, float] = {}

        # 1. Excessive comments on same post (>5)
        post_counts = Counter(c.get("post_id") for c in comments if c.get("post_id"))
        max_same_post = max(post_counts.values(), default=0)
        indicators["excessive_same_post"] = max_same_post > 5
        details["max_comments_same_post"] = float(max_same_post)

        # 2. Very short comments (avg <10 chars)
        texts = [c.get("comment_text") or "" for c in comments]
        lengths = [len(t) for t in texts]
        avg_length = sum(lengths) / max(len(lengths), 1)
        indicators["short_comments"] = avg_length < 10
        details["avg_comment_length"] = round(avg_length, 1)

        # 3. Duplicate/near-duplicate texts (>50%)
        normalised = [t.lower().strip() for t in texts if t.strip()]
        text_counts = Counter(normalised)
        dup_count = sum(cnt for cnt in text_counts.values() if cnt > 1)
        dup_pct = dup_count / max(len(normalised), 1)
        indicators["duplicate_comments"] = dup_pct > 0.5
        details["duplicate_percentage"] = round(dup_pct * 100, 1)

        # 4. Fast posting intervals (<5 sec between comments, >30% of intervals)
        timed = sorted(
            [c for c in comments if isinstance(c.get("comment_time"), datetime)],
            key=lambda x: x["comment_time"],
        )
        fast_intervals = 0
        total_intervals = max(len(timed) - 1, 1)
        for i in range(1, len(timed)):
            delta = (timed[i]["comment_time"] - timed[i - 1]["comment_time"]).total_seconds()
            if abs(delta) < 5:
                fast_intervals += 1
        fast_pct = fast_intervals / total_intervals if len(timed) > 1 else 0.0
        indicators["fast_posting"] = fast_pct > 0.3
        details["fast_posting_percentage"] = round(fast_pct * 100, 1)

        # Calculate weighted bot score
        weights = {
            "excessive_same_post": 0.30,
            "short_comments": 0.20,
            "duplicate_comments": 0.30,
            "fast_posting": 0.20,
        }
        bot_score = sum(weights[k] for k, v in indicators.items() if v and k in weights)

        return {
            "bot_score": round(bot_score, 2),
            "is_bot": bot_score >= 0.5,
            "indicators": indicators,
            "details": details,
        }
