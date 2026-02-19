import os
import cloudscraper
from bs4 import BeautifulSoup
import time
import random

# Configuration
COLLECTION_URL = "https://www.svgrepo.com/collection/dazzle-line-icons/"
OUTPUT_FOLDER = "dazzle_icons"
FILE_PREFIX = "dazzle-"

def download_dazzle_icons():
    # 1. Create Output Folder
    if not os.path.exists(OUTPUT_FOLDER):
        os.makedirs(OUTPUT_FOLDER)
        print(f"Created folder: {OUTPUT_FOLDER}")

    # 2. Initialize CloudScraper (mimics a real Chrome browser)
    #    This is critical to bypass the 429 Bot Detection.
    scraper = cloudscraper.create_scraper(
        browser={
            'browser': 'chrome',
            'platform': 'windows',
            'desktop': True
        }
    )

    page = 1
    total_downloaded = 0
    seen_urls = set()

    print(f"Starting download with CloudScraper...")
    print(f"Target: {COLLECTION_URL}")
    print(f"Prefix: '{FILE_PREFIX}'")

    while True:
        # SVGRepo pagination: base url for page 1, ?page=X for others
        target_url = f"{COLLECTION_URL}?page={page}"
        print(f"\n--- Processing Page {page} ---")

        try:
            # Use scraper.get() instead of requests.get()
            response = scraper.get(target_url)

            # Check status
            if response.status_code == 404:
                print("✅ Reached end of collection (Page Not Found).")
                break
            if response.status_code == 429:
                print("❌ IP Blocked (429). Even CloudScraper was detected.")
                print("   Solution: Wait 1 hour or change IP.")
                break
            if response.status_code != 200:
                print(f"❌ Error: Status code {response.status_code}")
                break

            soup = BeautifulSoup(response.text, "html.parser")
            
            # Find all icon images
            images = soup.find_all("img", {"itemprop": "contentUrl"})

            if not images:
                print("⚠️ No icons found on this page. Stopping.")
                break

            print(f"   Found {len(images)} icons on page {page}.")
            count_on_page = 0

            for img in images:
                src_url = img.get("src")
                if not src_url or src_url in seen_urls:
                    continue
                
                seen_urls.add(src_url)
                count_on_page += 1

                # Logic: Change /show/ to /download/
                # From: https://www.svgrepo.com/show/123/icon.svg
                # To:   https://www.svgrepo.com/download/123/icon.svg
                download_url = src_url.replace("/show/", "/download/")
                
                # File Naming
                original_name = src_url.split("/")[-1]
                if not original_name.endswith(".svg"):
                    original_name += ".svg"
                
                final_filename = f"{FILE_PREFIX}{original_name}"
                save_path = os.path.join(OUTPUT_FOLDER, final_filename)

                # Skip if exists
                if os.path.exists(save_path):
                    continue

                # Download the individual file
                try:
                    # Random delay (0.5s - 1.5s) to look human
                    time.sleep(random.uniform(0.5, 1.5))
                    
                    file_resp = scraper.get(download_url)
                    
                    if file_resp.status_code == 200:
                        with open(save_path, "wb") as f:
                            f.write(file_resp.content)
                        print(f"   ✓ Downloaded: {final_filename}")
                        total_downloaded += 1
                    else:
                        print(f"   ❌ Failed: {final_filename} ({file_resp.status_code})")

                except Exception as e:
                    print(f"   ❌ Error downloading file: {e}")

            if count_on_page == 0:
                print("⚠️ No new icons on this page.")
                break

            page += 1
            # Sleep 2-4 seconds between pages (Critical to prevent bans)
            time.sleep(random.uniform(2.0, 4.0))

        except Exception as e:
            print(f"❌ Critical Error: {e}")
            break

    print(f"\n🎉 Done! Downloaded {total_downloaded} icons.")

if __name__ == "__main__":
    download_dazzle_icons()