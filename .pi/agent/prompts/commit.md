---
description: Run worker subagent to commit the staged changes
---

Call `task` tool with exactly:
```json
{   
    "agent": "worker", 
    "task": "$@",
    "summary": "Commit the damn things",
    "skills": ["writing-git-commits"]
}
```