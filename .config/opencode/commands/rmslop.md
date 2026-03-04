---
description: Remove AI code slop
---

Target file(s): $ARGUMENTS

If a specific file path is provided (non-empty), remove AI slop from ONLY those files.
If no path is provided, review the diff against main and remove AI slop introduced in this branch.

Remove:
- Unnecessary comments a human wouldn't add
- Extra defensive checks or try/catch blocks that are out of place
- `any` casts used to bypass types
- Style that is inconsistent with the file
- Unnecessary emoji usage

Report at the end with a short summary of what changed.