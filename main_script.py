import csv
import time
import requests
import os
from gpt4_api import process_with_gpt4

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
        if resp.status_code == 200:
            return resp.json()  # The JSON as Python dict
        else:
            print(f"[WARN] user_id={user_id} => HTTP {resp.status_code}")
            return None
    except Exception as e:
        print(f"[ERROR] user_id={user_id} => {e}")
        return None

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

                print(f"[INFO] Processing user_id={user_id} ...")

                # 1) Call RapidAPI
                data_json = fetch_profile_about(user_id)

                # 2) Process with GPT-4
                about_data = process_with_gpt4(data_json)

                # 3) Fill from input CSV
                about_data["Name"] = user_name if user_name else "NA"
                about_data["First Name"] = fn if fn else "NA"
                about_data["Last Name"] = ln if ln else "NA"
                # Override ID from CSV if you want
                about_data["ID"] = user_id  

                # 4) Write row
                writer.writerow(about_data)
                print(f"[INFO] Wrote row for user_id={user_id}")

    print("[INFO] Done.")


if __name__ == "__main__":
    main()
