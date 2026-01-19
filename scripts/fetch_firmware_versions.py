import requests
import json
import urllib.parse
import os
import argparse
import sys
from packaging.version import parse as parse_version

# Constants
REPO_OWNER = "joebritt"
REPO_NAME = "luma1"
CONTENTS_PATH = "TeensyCode"

def parse_arguments():
    description = "Fetch firmware versions and commit messages for Luma1 from GitHub."
    epilog = """
ENVIRONMENT VARIABLES:
  GITHUB_TOKEN  GitHub Personal Access Token (classic or fine-grained).
                Required to bypass unauthenticated rate limits (60 requests/hour).
                Without a token, you may receive 403 errors.

HOW TO GET A TOKEN:
  1. Go to GitHub Settings -> Developer settings -> Personal access tokens -> Tokens (classic).
  2. Generate a new token (no scopes needed for public repos).
  3. Copy the token.

USAGE EXAMPLES:
  # Run with token (recommended)
  export GITHUB_TOKEN="ghp_..."
  python3 scripts/fetch_firmware_versions.py

  # Run without token (likely to hit rate limits)
  python3 scripts/fetch_firmware_versions.py
"""
    parser = argparse.ArgumentParser(
        description=description,
        epilog=epilog,
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    return parser.parse_args()

def fetch_firmware_versions():
    # Setup headers with optional token
    token = os.environ.get("GITHUB_TOKEN")
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    # 1. Fetch directory listing
    url = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/contents/{CONTENTS_PATH}"
    response = requests.get(url, headers=headers)
    
    if response.status_code != 200:
        print(f"Error fetching directory contents: {response.status_code}")
        if 'X-RateLimit-Remaining' in response.headers:
             print(f"Rate Limit Remaining: {response.headers['X-RateLimit-Remaining']}")
        return
    
    items = response.json()
    
    # 2. Filter for directories starting with "Prebuilt "
    firmware_releases = []
    
    for item in items:
        if item['type'] == 'dir' and item['name'].startswith('Prebuilt '):
            version_str = item['name'].replace('Prebuilt ', '').strip()
            
            # Construct release object
            release = {
                "name": item['name'],
                "version": version_str,
                "url": item['url'],
                "html_url": item['html_url'],
                "commit_message": None # To be fetched
            }
            firmware_releases.append(release)
            
    # 3. Sort by version (descending)
    # Using packaging.version for robust version comparison if possible, otherwise string sort
    try:
        firmware_releases.sort(key=lambda x: parse_version(x['version']), reverse=True)
    except:
         # Fallback to string comparison if version parsing fails for some reason
        firmware_releases.sort(key=lambda x: x['version'], reverse=True)


    # 4. Fetch commit info for each release
    for release in firmware_releases:
        print(f"Fetching commit info for {release['name']}...", file=sys.stderr)
        path = f"{CONTENTS_PATH}/{release['name']}"
        encoded_path = urllib.parse.quote(path)
        commits_url = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/commits?path={encoded_path}&per_page=1"
        
        response = requests.get(commits_url, headers=headers)
        if response.status_code == 200:
            commits = response.json()
            if commits:
                release['commit_message'] = commits[0]['commit']['message']
        else:
            print(f"Error fetching commits for {release['name']}: {response.status_code}", file=sys.stderr)
            if 'X-RateLimit-Remaining' in response.headers:
                print(f"Rate Limit Remaining: {response.headers['X-RateLimit-Remaining']}", file=sys.stderr)

    # 5. Output as JSON
    print(json.dumps(firmware_releases, indent=2))

if __name__ == "__main__":
    args = parse_arguments()
    fetch_firmware_versions()
