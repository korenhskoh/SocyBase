from datetime import datetime, timezone
from app.scraping.mappers.base import AbstractProfileMapper, STANDARD_FIELDNAMES


class FacebookProfileMapper(AbstractProfileMapper):
    """
    Maps akng.io.vn Facebook Graph API response to the standard 18-field format.

    The Graph API returns flat fields unlike the RapidAPI nested structure
    that was used in rapid_profile_scrape.py. Education and Work come as arrays.
    """

    def map_to_standard(self, api_response: dict) -> dict:
        result = self.empty_result()
        result["Updated Time"] = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

        if not api_response:
            return result

        # Direct fields
        result["ID"] = str(api_response.get("id", "NA"))
        result["Name"] = api_response.get("name", "NA")
        result["First Name"] = api_response.get("first_name", "NA")
        result["Last Name"] = api_response.get("last_name", "NA")
        result["Gender"] = api_response.get("gender", "NA")
        result["Birthday"] = api_response.get("birthday", "NA")
        result["About"] = api_response.get("about", "NA")
        result["Relationship"] = api_response.get("relationship_status", "NA")
        result["Username"] = api_response.get("username", "NA")
        result["Website"] = api_response.get("website", "NA")

        # Education: array of { school: { name }, type, year: { name } }
        education = api_response.get("education", [])
        if education and isinstance(education, list):
            edu_names = []
            for e in education:
                school = e.get("school", {})
                if isinstance(school, dict) and school.get("name"):
                    edu_names.append(school["name"])
            if edu_names:
                result["Education"] = "; ".join(edu_names)

        # Work: array of { employer: { name }, position: { name }, ... }
        work = api_response.get("work", [])
        if work and isinstance(work, list):
            latest = work[0]
            employer = latest.get("employer", {})
            if isinstance(employer, dict):
                result["Work"] = employer.get("name", "NA")
            position = latest.get("position", {})
            if isinstance(position, dict):
                result["Position"] = position.get("name", "NA")

        # Location: { id, name }
        location = api_response.get("location", {})
        if isinstance(location, dict):
            result["Location"] = location.get("name", "NA")
        elif isinstance(location, str):
            result["Location"] = location

        # Hometown: { id, name }
        hometown = api_response.get("hometown", {})
        if isinstance(hometown, dict):
            result["Hometown"] = hometown.get("name", "NA")
        elif isinstance(hometown, str):
            result["Hometown"] = hometown

        # Languages: array of { id, name }
        languages = api_response.get("languages", [])
        if languages and isinstance(languages, list):
            lang_names = [lang.get("name", "") for lang in languages if lang.get("name")]
            if lang_names:
                result["Languages"] = ", ".join(lang_names)

        # UsernameLink
        if result["ID"] != "NA":
            result["UsernameLink"] = f"https://facebook.com/{result['ID']}"

        return result

    def extract_comments_data(self, api_response: dict, is_group: bool = False) -> dict:
        """
        Extract comments and pagination info from API response.

        Handles AKNG wrapper: {success, data: {comments: {data: [...]}}}

        Returns:
            {
                "comments": [{ "user_id", "user_name", "comment_id", "message", "created_time" }],
                "next_cursor": str | None,
                "has_next": bool,
            }
        """
        comments_list = []
        next_cursor = None
        has_next = False

        # Unwrap AKNG response wrapper if present
        inner = api_response
        if "success" in api_response and isinstance(api_response.get("data"), dict):
            inner = api_response["data"]

        if is_group:
            # Group comments: response is { data: [...], paging: { cursors: { after }, next } }
            data = inner.get("data", [])
            paging = inner.get("paging", {})
        else:
            # Page/profile comments: response is { comments: { data: [...], paging: {...} } }
            comments_obj = inner.get("comments", {})
            data = comments_obj.get("data", [])
            paging = comments_obj.get("paging", {})

        for comment in data:
            from_data = comment.get("from", {})
            comments_list.append({
                "user_id": from_data.get("id", ""),
                "user_name": from_data.get("name", ""),
                "comment_id": comment.get("id", ""),
                "message": comment.get("message", ""),
                "created_time": comment.get("created_time", ""),
            })

            # Also extract reply commenters
            replies = comment.get("comments", {}).get("data", [])
            for reply in replies:
                reply_from = reply.get("from", {})
                if reply_from.get("id"):
                    comments_list.append({
                        "user_id": reply_from.get("id", ""),
                        "user_name": reply_from.get("name", ""),
                        "comment_id": reply.get("id", ""),
                        "message": reply.get("message", ""),
                        "created_time": reply.get("created_time", ""),
                    })

        # Pagination
        cursors = paging.get("cursors", {})
        if cursors.get("after"):
            next_cursor = cursors["after"]
        if paging.get("next"):
            has_next = True

        return {
            "comments": comments_list,
            "next_cursor": next_cursor,
            "has_next": has_next,
        }
