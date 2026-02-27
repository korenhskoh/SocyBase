"""OpenAI GPT-4o integration for fan comment analysis and business insights."""

import json
import logging
from typing import Any

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)


class OpenAIService:
    def __init__(self, api_key: str):
        self.client = AsyncOpenAI(api_key=api_key)

    async def analyze_fan_comments(
        self,
        comments: list[str],
        fan_name: str,
        business_context: str = "",
    ) -> dict[str, Any]:
        """Analyze a fan's comments for buying intent, interests, and sentiment."""
        comments_text = "\n".join(f"- {c}" for c in comments[:50])  # cap at 50

        system_prompt = (
            "You are a social media audience analyst. Analyze the following Facebook "
            "comments from a single user and return a JSON object with these fields:\n"
            '  "buying_intent_score": float 0.0-1.0 (how likely they are to buy),\n'
            '  "interests": list of up to 5 interest keywords,\n'
            '  "sentiment": "positive" | "neutral" | "negative",\n'
            '  "persona_type": one of "enthusiast", "buyer", "casual", "critic", "supporter",\n'
            '  "summary": 1-2 sentence analysis of this user,\n'
            '  "key_phrases": list of up to 5 notable phrases from their comments.\n'
            "Return ONLY valid JSON, no markdown."
        )

        user_prompt = f"Fan name: {fan_name}\n"
        if business_context:
            user_prompt += f"Business context: {business_context}\n"
        user_prompt += f"\nComments ({len(comments)} total, showing up to 50):\n{comments_text}"

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.3,
                max_tokens=500,
            )
            result = json.loads(response.choices[0].message.content)
            result["token_cost"] = response.usage.total_tokens if response.usage else 0
            return result
        except Exception as e:
            logger.error("OpenAI fan analysis failed: %s", e)
            return {
                "buying_intent_score": 0.0,
                "interests": [],
                "sentiment": "neutral",
                "persona_type": "casual",
                "summary": f"Analysis failed: {str(e)}",
                "key_phrases": [],
                "token_cost": 0,
            }

    async def suggest_competitor_pages(
        self,
        business_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Suggest competitor Facebook pages based on business profile."""
        system_prompt = (
            "You are a social media marketing strategist. Based on the business profile "
            "provided, suggest Facebook pages that this business should monitor and scrape "
            "for audience insights. Pay special attention to the country/region — suggest "
            "pages that are relevant to the local market and language when a country is specified.\n\n"
            "CRITICAL: Only suggest REAL, well-known brands and businesses that you are confident "
            "actually have Facebook pages. Do NOT guess or fabricate Facebook URLs. "
            "For the facebook_url field, ONLY provide a URL if you are highly confident the exact "
            "page slug/username is correct (e.g. major brands like https://www.facebook.com/Nike). "
            "If you are NOT sure about the exact Facebook page URL, set facebook_url to null and "
            "instead provide a facebook_search_url in the format: "
            "https://www.facebook.com/search/pages?q=PAGE+NAME so the user can find the real page.\n\n"
            "Return a JSON object with:\n"
            '  "business_fit_analysis": 2-3 sentence analysis of the business positioning,\n'
            '  "suggested_pages": list of 5-10 objects with:\n'
            '    "name": the real business/brand name,\n'
            '    "facebook_url": ONLY if you are confident this exact URL exists, otherwise null,\n'
            '    "facebook_search_url": Facebook search URL to find the page (always provide this),\n'
            '    "reason": why this competitor is relevant (1 sentence),\n'
            '  "audience_insights": list of 3-5 audience insight strings,\n'
            '  "targeting_recommendations": list of 3-5 targeting recommendations.\n'
            "Return ONLY valid JSON, no markdown."
        )

        biz_text = (
            f"Business: {business_data.get('business_name', 'Unknown')}\n"
            f"Type: {business_data.get('business_type', 'N/A')}\n"
            f"Industry: {business_data.get('industry', 'N/A')}\n"
            f"Country: {business_data.get('country', 'N/A')}\n"
            f"Facebook Page: {business_data.get('facebook_page_url', 'N/A')}\n"
            f"Products/Services: {', '.join(business_data.get('product_service_links', []))}\n"
            f"Target Audience: {business_data.get('target_audience_description', 'N/A')}\n"
        )

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": biz_text},
                ],
                response_format={"type": "json_object"},
                temperature=0.3,
                max_tokens=1500,
            )
            result = json.loads(response.choices[0].message.content)
            result["token_cost"] = response.usage.total_tokens if response.usage else 0
            return result
        except Exception as e:
            logger.error("OpenAI competitor suggestion failed: %s", e)
            return {
                "business_fit_analysis": f"Analysis failed: {str(e)}",
                "suggested_pages": [],
                "audience_insights": [],
                "targeting_recommendations": [],
                "token_cost": 0,
            }
