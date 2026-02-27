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

        # Unwrap AKNG response wrapper: {success, message, data: {actual fields}}
        data = api_response
        if "success" in api_response and isinstance(api_response.get("data"), dict):
            data = api_response["data"]

        # Direct scalar fields
        result["ID"] = str(data.get("id", "NA"))
        result["Name"] = data.get("name", "NA")
        result["First Name"] = data.get("first_name", "NA")
        result["Last Name"] = data.get("last_name", "NA")
        raw_gender = data.get("gender", "NA")
        if raw_gender and raw_gender != "NA":
            low = raw_gender.strip().lower()
            result["Gender"] = "m" if low in ("male", "m") else "f" if low in ("female", "f") else raw_gender
        else:
            result["Gender"] = "NA"
        result["About"] = data.get("about", "NA")
        result["Username"] = data.get("username", "NA")
        result["Birthday"] = data.get("birthday", "NA")
        result["Relationship"] = data.get("relationship_status", "NA")
        result["Phone"] = data.get("phone", "NA")
        result["Website"] = data.get("website", "NA")

        # Updated Time: prefer API value, fall back to current time
        updated_time = data.get("updated_time")
        if updated_time:
            result["Updated Time"] = updated_time

        # Languages: array of { id, name }
        languages = data.get("languages", [])
        if languages and isinstance(languages, list):
            lang_names = [l.get("name", "") for l in languages if isinstance(l, dict) and l.get("name")]
            if lang_names:
                result["Languages"] = "; ".join(lang_names)

        # Education: array of { school: { name }, type, id }
        education = data.get("education", [])
        if education and isinstance(education, list):
            edu_names = []
            for e in education:
                school = e.get("school", {})
                if isinstance(school, dict) and school.get("name"):
                    edu_names.append(school["name"])
            if edu_names:
                result["Education"] = "; ".join(edu_names)

        # Work: array of { employer: { name }, position: { name }, location: { name } }
        work = data.get("work", [])
        if work and isinstance(work, list):
            work_entries = []
            latest_position = None
            for w in work:
                employer = w.get("employer", {})
                position = w.get("position", {})
                emp_name = employer.get("name", "") if isinstance(employer, dict) else ""
                pos_name = position.get("name", "") if isinstance(position, dict) else ""
                if emp_name and pos_name:
                    work_entries.append(f"{pos_name} at {emp_name}")
                elif emp_name:
                    work_entries.append(emp_name)
                elif pos_name:
                    work_entries.append(pos_name)
                # First work entry's position is the latest
                if latest_position is None and pos_name:
                    latest_position = pos_name
            if work_entries:
                result["Work"] = "; ".join(work_entries)
            if latest_position:
                result["Position"] = latest_position

        # Location: { id, name }
        location = data.get("location", {})
        if isinstance(location, dict):
            if location.get("name"):
                result["Location"] = location["name"]
        elif isinstance(location, str):
            result["Location"] = location

        # Hometown: { id, name }
        hometown = data.get("hometown", {})
        if isinstance(hometown, dict) and hometown.get("name"):
            result["Hometown"] = hometown["name"]
        elif isinstance(hometown, str) and hometown:
            result["Hometown"] = hometown

        # Cross-fill: hometown ↔ location (if one is missing, use the other)
        if result["Hometown"] == "NA" and result["Location"] != "NA":
            result["Hometown"] = result["Location"]
        elif result["Location"] == "NA" and result["Hometown"] != "NA":
            result["Location"] = result["Hometown"]

        # UsernameLink: prefer the 'link' field from API
        link = data.get("link")
        if link:
            result["UsernameLink"] = link
        elif result["ID"] != "NA":
            result["UsernameLink"] = f"https://facebook.com/{result['ID']}"

        # Picture URL: { data: { url } }
        picture = data.get("picture", {})
        if isinstance(picture, dict):
            pic_data = picture.get("data", {})
            if isinstance(pic_data, dict) and pic_data.get("url"):
                result["Picture URL"] = pic_data["url"]
            elif picture.get("url"):
                result["Picture URL"] = picture["url"]

        return result

    def map_object_to_author(self, api_response: dict) -> dict:
        """
        Map an AKNG get_object_details response to page/author fields.

        Returns dict with: platform_object_id, name, about, category, description,
        location, phone, website, picture_url, cover_url
        """
        result = {
            "platform_object_id": "",
            "name": None,
            "about": None,
            "category": None,
            "description": None,
            "location": None,
            "phone": None,
            "website": None,
            "picture_url": None,
            "cover_url": None,
        }

        if not api_response:
            return result

        # Unwrap AKNG response wrapper
        data = api_response
        if "success" in api_response and isinstance(api_response.get("data"), dict):
            data = api_response["data"]

        result["platform_object_id"] = str(data.get("id", ""))
        result["name"] = data.get("name")
        result["about"] = data.get("about")
        result["category"] = data.get("category")
        result["description"] = data.get("description")
        result["phone"] = data.get("phone")
        result["website"] = data.get("website")

        # Location: can be { city, country, street } or string
        location = data.get("location")
        if isinstance(location, dict):
            parts = []
            if location.get("street"):
                parts.append(location["street"])
            if location.get("city"):
                parts.append(location["city"])
            if location.get("country"):
                parts.append(location["country"])
            result["location"] = ", ".join(parts) if parts else None
        elif isinstance(location, str):
            result["location"] = location

        # Picture: { data: { url } } or { url }
        picture = data.get("picture", {})
        if isinstance(picture, dict):
            pic_data = picture.get("data", {})
            if isinstance(pic_data, dict) and pic_data.get("url"):
                result["picture_url"] = pic_data["url"]
            elif picture.get("url"):
                result["picture_url"] = picture["url"]

        # Cover: { source, cover_id } or { source }
        cover = data.get("cover", {})
        if isinstance(cover, dict) and cover.get("source"):
            result["cover_url"] = cover["source"]

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
        top_level_count = 0
        reply_count = 0

        # Unwrap AKNG response wrapper if present
        inner = api_response
        if "success" in api_response and isinstance(api_response.get("data"), dict):
            inner = api_response["data"]

        # Direct /comments endpoint: { data: [...], paging: {...} }
        # Also handle nested format: { comments: { data: [...], paging: {...} } }
        if "data" in inner and isinstance(inner.get("data"), list):
            data = inner["data"]
            paging = inner.get("paging", {})
        elif "comments" in inner:
            comments_obj = inner["comments"]
            data = comments_obj.get("data", [])
            paging = comments_obj.get("paging", {})
        else:
            data = []
            paging = {}

        for comment in data:
            from_data = comment.get("from", {})
            if from_data.get("id"):
                comments_list.append({
                    "user_id": from_data.get("id", ""),
                    "user_name": from_data.get("name", ""),
                    "comment_id": comment.get("id", ""),
                    "message": comment.get("message", ""),
                    "created_time": comment.get("created_time", ""),
                })
                top_level_count += 1

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
                    reply_count += 1

        # Pagination
        cursors = paging.get("cursors", {})
        if cursors.get("after"):
            next_cursor = cursors["after"]
        if paging.get("next"):
            has_next = True

        return {
            "comments": comments_list,
            "top_level_count": top_level_count,
            "reply_count": reply_count,
            "next_cursor": next_cursor,
            "has_next": has_next,
        }
