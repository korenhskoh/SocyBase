import csv
import time
import requests
import os

####################################################
# CONFIG: Paths
####################################################
INPUT_CSV = r"C:\Users\acer\Documents\facebook scraper\Profile scrape\Test_rapid_input.csv"
OUTPUT_CSV = r"C:\Users\acer\Documents\facebook scraper\Profile scrape\rapid_scraped_folder"
OUTPUT_FILE = "rapid_output.csv"
OUTPUT_PATH = os.path.join(OUTPUT_CSV, OUTPUT_FILE)

####################################################
# CONFIG: RapidAPI
####################################################
RAPIDAPI_KEY = "71682063a1mshdd323b33b958867p153f17jsn2b3ec1c1238c"  # put your real key here
RAPIDAPI_HOST = "facebook-realtimeapi.p.rapidapi.com"

BASE_URL = "https://facebook-realtimeapi.p.rapidapi.com/facebook/profiles"

####################################################
# Desired columns in the final CSV
####################################################
FIELDNAMES = [
    "ID", "Name", "First Name", "Last Name",
    "Gender", "Birthday", "Relationship", "Education", "Work",
    "Position", "Hometown", "Location", "Website", "Languages",
    "UsernameLink", "Username", "About", "Updated Time"
]

#############################################
# FETCH FUNCTION
#############################################
def fetch_profile_about(user_id):
    """
    Calls the RapidAPI endpoint for the given user_id
    Returns parsed JSON or None on error
    """
    url = f"{BASE_URL}/{user_id}/about"
    headers = {
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": RAPIDAPI_HOST
    }   
    try:
        resp = requests.get(url, headers=headers, timeout=15)
        time.sleep(1)  # Add a 1-second delay between API calls if needed
        if resp.status_code == 200:
            return resp.json()  # The JSON as Python dict
        else:
            print(f"[WARN] user_id={user_id} => HTTP {resp.status_code}")
            return None
    except Exception as e:
        print(f"[ERROR] user_id={user_id} => {e}")
        return None

#############################################
# PARSE FUNCTION (MODIFIED)
#############################################
def parse_about_json(data_json):
    """
    Convert the returned JSON into the final dictionary with FIELDNAMES.
    Missing fields => 'NA'.
    """
    # Initialize all fields to "NA"
    result = {k: "NA" for k in FIELDNAMES}
    result["Updated Time"] = time.strftime("%Y-%m-%d %H:%M:%S")

    if not data_json:
        return result

    user_obj = data_json.get("data", {}).get("user", {})
    # ID
    result["ID"] = str(user_obj.get("id", "NA"))

    # Build a link
    if result["ID"] != "NA":
        result["UsernameLink"] = f"https://facebook.com/{result['ID']}"

    # Profile sections
    sections = user_obj.get("profile_field_sections", {}).get("edges", [])
    for section in sections:
        node = section.get("node", {})
        stype = node.get("field_section_type", "")
        fields = node.get("profile_fields", {}).get("edges", [])

        # Gender and Birthday
        if stype == "basic_info":
            for field in fields:
                field_type = field.get("fieldInfo", {}).get("field_type", "")
                if field_type == "gender":
                    result["Gender"] = field.get("fieldInfo", {}).get("title", {}).get("text", "NA")
                elif field_type == "birthday":
                    # Extracting and logging birthday
                    birthday_text = field.get("fieldInfo", {}).get("title", {}).get("text", "NA")
                    print(f"[DEBUG] Extracted Birthday: {birthday_text}")
                    result["Birthday"] = birthday_text

        # Relationship
        if stype == "relationship":
            for field in fields:
                result["Relationship"] = field.get("fieldInfo", {}).get("title", {}).get("text", "NA")

        # Education
        if stype == "education":
            for field in fields:
                education_text = field.get("fieldInfo", {}).get("title", {}).get("text", "NA")
                # Remove "Went to" prefix if present
                result["Education"] = education_text.replace("Went to ", "").strip()
        # Work
        if stype == "work":
            for field in fields:
                work_text = field.get("fieldInfo", {}).get("title", {}).get("text", "NA")
                # Remove "Works at" prefix if present
                result["Work"] = work_text.replace("Works at ", "").strip()
                
        # Places lived (Hometown and Location)
        if stype == "places_lived":
            for field in fields:
                field_info = field.get("fieldInfo", {})
                if field_info.get("field_type") == "current_city":
                    result["Location"] = field_info.get("title", {}).get("text", "NA")
                elif field_info.get("field_type") == "hometown":
                    result["Hometown"] = field_info.get("title", {}).get("text", "NA")

    return result


#############################################
# MAIN WORKFLOW
#############################################
def main():
    print(f"[INFO] Reading from: {INPUT_CSV}")
    print(f"[INFO] Writing to:   {OUTPUT_PATH}")

    with open(OUTPUT_PATH, "w", newline="", encoding="utf-8-sig") as out_f:
        writer = csv.DictWriter(out_f, fieldnames=FIELDNAMES)
        writer.writeheader()

        with open(INPUT_CSV, "r", encoding="utf-8-sig") as in_f:
            reader = csv.DictReader(in_f)  # If it's comma-delimited
            for row in reader:
                row = {k.replace("\ufeff", ""): v for k, v in row.items()}  # Remove BOM from keys
                print(row)  # Debug: Print the entire row

                user_id = row.get("user_id", "").strip()  # Adjust based on actual column name
                print(f"User ID: {user_id}")  # Debug: Print user_id
                if not user_id:
                    print("[WARN] Missing user_id, skipping row.")
                    continue
                user_name = row.get("from/name", "").strip()
                fn = row.get("fn", "").strip()
                ln = row.get("ln", "").strip()

                if not user_id:
                    print("[WARN] Missing user_id, skipping row.")
                    continue

                print(f"[INFO] Processing user_id={user_id} ...")

                # 1) call RapidAPI
                data_json = fetch_profile_about(user_id)
                # 2) parse
                about_data = parse_about_json(data_json)

                # 3) fill from input CSV
                about_data["Name"] = user_name if user_name else "NA"
                about_data["First Name"] = fn if fn else "NA"
                about_data["Last Name"] = ln if ln else "NA"
                # override ID from CSV if you want
                about_data["ID"] = user_id  

                # 4) write row
                writer.writerow(about_data)
                print(f"[INFO] Wrote row for user_id={user_id}")

    print("[INFO] Done.")


if __name__ == "__main__":
    main()