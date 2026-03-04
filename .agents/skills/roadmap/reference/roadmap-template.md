# Roadmap Template

Use this template when creating `roadmap.md` for a project.

---

```markdown
# Product Roadmap: <Project Name>

**Created:** YYYY-MM-DD
**Updated:** YYYY-MM-DD
**Status:** Draft | Reviewed | Approved

---

## Vision

One paragraph describing what this product does, who it's for,
and what success looks like when it's complete.

---

## User Personas

### Persona: <Name> (e.g., End User)
- **Who:** Description of this user type
- **Goals:** What they want to accomplish
- **Pain Points:** Current frustrations this product solves

### Persona: <Name> (e.g., Admin)
- **Who:** Description of this user type
- **Goals:** What they want to accomplish
- **Pain Points:** Current frustrations this product solves

---

## Feature Roadmap

### MVP (Launch Requirements)

| ID  | Feature             | Description                                  | Size | Dependencies | Status  |
|-----|---------------------|----------------------------------------------|------|--------------|---------|
| F1  | User Registration   | Users can create accounts with email/password | M    | -            | planned |
| F2  | User Login          | Users can authenticate and receive session   | M    | F1           | planned |
| F3  | Core Entity CRUD    | Users can create, read, update, delete items | L    | F2           | planned |
| F4  | Basic Dashboard     | Users see overview of their data             | M    | F3           | planned |

### v1.1 (Post-Launch Priority)

| ID  | Feature              | Description                              | Size | Dependencies | Status  |
|-----|----------------------|------------------------------------------|------|--------------|---------|
| F5  | Email Notifications  | System sends emails for key events       | M    | F1           | planned |
| F6  | User Profile         | Users can update their profile info      | S    | F2           | planned |
| F7  | Search               | Users can search their entities          | M    | F3           | planned |

### v2 (Future)

| ID  | Feature           | Description                              | Size | Dependencies | Status  |
|-----|-------------------|------------------------------------------|------|--------------|---------|
| F8  | Team Support      | Multiple users in one organization       | L    | F2           | planned |
| F9  | Role Permissions  | Fine-grained access control              | L    | F8           | planned |
| F10 | API Access        | External API for integrations            | L    | F3           | planned |
| F11 | Webhooks          | Push notifications to external systems   | M    | F10          | planned |

### Backlog (Someday/Maybe)

| ID  | Feature           | Description                        | Size | Dependencies | Status  |
|-----|-------------------|------------------------------------|------|--------------|---------|
| F12 | Social Login      | Login with Google/GitHub           | M    | F2           | planned |
| F13 | Mobile App        | Native iOS/Android apps            | XL   | F10          | planned |
| F14 | Real-time Collab  | Live collaboration features        | XL   | F8           | planned |

---

## Dependency Graph

```
F1 (Registration)
 │
 └──► F2 (Login)
       │
       ├──► F3 (Core CRUD)
       │     │
       │     ├──► F4 (Dashboard)
       │     ├──► F7 (Search)
       │     └──► F10 (API)
       │           │
       │           ├──► F11 (Webhooks)
       │           └──► F13 (Mobile)
       │
       ├──► F5 (Email)
       ├──► F6 (Profile)
       ├──► F8 (Teams)
       │     │
       │     ├──► F9 (Permissions)
       │     └──► F14 (Real-time)
       │
       └──► F12 (Social Login)
```

---

## Suggested PRD Order

Based on dependencies and priorities:

1. **F1: User Registration** - Foundation for all auth
2. **F2: User Login** - Completes auth flow
3. **F3: Core Entity CRUD** - Main product value
4. **F4: Basic Dashboard** - User home base
5. **F5: Email Notifications** - Essential communication
6. **F6: User Profile** - Quick win
7. **F7: Search** - Usability improvement
8. *(Continue based on priorities...)*

---

## Size Reference

| Size | Typical Scope                    | Estimated PRD Tasks |
|------|----------------------------------|---------------------|
| S    | Single component, < 200 lines   | 2-3 tasks           |
| M    | Multiple components, 200-500 lines | 4-6 tasks        |
| L    | Full feature, 500-1000 lines    | 7-10 tasks          |
| XL   | Major feature, 1000+ lines      | 10+ tasks, consider splitting |

---

## Status Legend

| Status        | Meaning                    | Updated By                     |
|---------------|----------------------------|--------------------------------|
| `planned`     | In roadmap, not started    | /roadmap (default)             |
| `prd`         | PRD created                | /prd (auto-updates)            |
| `in-progress` | Currently being built      | /complete-next-task (auto)     |
| `done`        | Implemented and verified   | /complete-next-task (auto)     |
| `cut`         | Removed from scope         | Manual edit                    |

---

## Open Questions

| Question                              | Impact          | Status |
|---------------------------------------|-----------------|--------|
| Question about scope or decision      | Affects which F | Open   |

---

## Revision History

| Date       | Changes              |
|------------|----------------------|
| YYYY-MM-DD | Initial roadmap      |
| YYYY-MM-DD | Added F15, F16       |
```
