---
description: Clone GitHub repo to ~/repo/public/{org}/{repo}
---

Clone this GitHub repository to the correct folder structure.

URL: $ARGUMENTS

<system-reminder>
# Clone Command Instructions

1. Parse the GitHub URL to extract:
   - Organization/username (e.g., "docling-project")
   - Repository name without .git suffix (e.g., "docling")

2. Target path: ~/repo/public/{org}/{repo}/
   
   Example:
   - Input: https://github.com/docling-project/docling.git
   - Output: ~/repo/public/docling-project/docling/

3. Steps to execute:

   a. Extract org and repo from URL (strip .git suffix if present)
   
   b. Check if folder already exists:
      - If EXISTS: Tell the user it already exists, then run `git pull` in that folder
      - If NOT EXISTS: Create parent dir and clone
   
   ```bash
   # If folder exists:
   git -C ~/repo/public/{org}/{repo} pull
   
   # If folder does not exist:
   mkdir -p ~/repo/public/{org}
   git clone {url} ~/repo/public/{org}/{repo}
   ```

4. After cloning or pulling, confirm success by showing the path.
</system-reminder>
