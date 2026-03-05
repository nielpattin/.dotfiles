# Project Type Templates

Pre-built feature lists for common project types. Use these as starting points to accelerate roadmap creation.

---

## How to Use Templates

During roadmap creation:

1. Ask user: "What type of project is this?"
2. If matches a template, offer: "I have a template for [type]. Use it as a starting point?"
3. If yes, load the template features
4. Review and customize with user
5. Add project-specific features

---

## Template: SaaS Web Application

**Typical stack:** React + Node.js + PostgreSQL

### MVP Features

| ID  | Feature             | Description                              | Size | Dependencies |
|-----|---------------------|------------------------------------------|------|--------------|
| F1  | User Registration   | Email/password signup with verification  | M    | -            |
| F2  | User Login          | Authentication with JWT/session          | M    | F1           |
| F3  | Password Reset      | Forgot password email flow               | S    | F1           |
| F4  | User Dashboard      | Main landing page after login            | M    | F2           |
| F5  | Core Entity CRUD    | Create/read/update/delete main objects   | L    | F2           |
| F6  | Basic Settings      | User preferences and account settings    | S    | F2           |

### v1.1 Features

| ID  | Feature              | Description                          | Size | Dependencies |
|-----|----------------------|--------------------------------------|------|--------------|
| F7  | Email Notifications  | Transactional emails for key events  | M    | F1           |
| F8  | Search               | Full-text search across entities     | M    | F5           |
| F9  | Filtering & Sorting  | List views with filters              | M    | F5           |
| F10 | User Profile         | Editable profile with avatar         | S    | F2           |
| F11 | Activity Log         | User action history                  | M    | F5           |

### v2 Features

| ID  | Feature           | Description                          | Size | Dependencies |
|-----|-------------------|--------------------------------------|------|--------------|
| F12 | Team/Org Support  | Multi-user organizations             | L    | F2           |
| F13 | Role Permissions  | RBAC for team features               | L    | F12          |
| F14 | Billing/Payments  | Stripe integration, subscriptions    | L    | F2           |
| F15 | Admin Dashboard   | Internal admin tools                 | L    | F12          |
| F16 | API Access        | REST/GraphQL API for integrations    | L    | F5           |
| F17 | Webhooks          | Event notifications to external URLs | M    | F16          |

### Backlog

| ID  | Feature          | Description                    | Size | Dependencies |
|-----|------------------|--------------------------------|------|--------------|
| F18 | Social Login     | Google/GitHub OAuth            | M    | F2           |
| F19 | 2FA              | Two-factor authentication      | M    | F2           |
| F20 | Mobile App       | Native iOS/Android             | XL   | F16          |
| F21 | Real-time        | WebSocket live updates         | L    | F5           |
| F22 | Audit Log        | Compliance audit trail         | M    | F11          |

---

## Template: REST API / Backend Service

**Typical stack:** Node.js/Python + PostgreSQL + Redis

### MVP Features

| ID  | Feature             | Description                          | Size | Dependencies |
|-----|---------------------|--------------------------------------|------|--------------|
| F1  | Health Check        | GET /health endpoint                 | S    | -            |
| F2  | API Authentication  | API key or JWT auth middleware       | M    | F1           |
| F3  | Core Resources      | CRUD endpoints for main entities     | L    | F2           |
| F4  | Input Validation    | Request validation with schemas      | M    | F3           |
| F5  | Error Handling      | Consistent error response format     | S    | F1           |
| F6  | Logging             | Structured request/error logging     | S    | F1           |

### v1.1 Features

| ID  | Feature           | Description                          | Size | Dependencies |
|-----|-------------------|--------------------------------------|------|--------------|
| F7  | Rate Limiting     | Per-client request throttling        | M    | F2           |
| F8  | Pagination        | Cursor/offset pagination on lists    | M    | F3           |
| F9  | Filtering         | Query params for filtering lists     | M    | F3           |
| F10 | Caching           | Redis caching for reads              | M    | F3           |
| F11 | OpenAPI Docs      | Swagger/OpenAPI documentation        | M    | F3           |

### v2 Features

| ID  | Feature           | Description                          | Size | Dependencies |
|-----|-------------------|--------------------------------------|------|--------------|
| F12 | Webhooks          | Event delivery to external URLs      | L    | F3           |
| F13 | Bulk Operations   | Batch create/update/delete           | M    | F3           |
| F14 | Versioning        | API version management               | M    | F3           |
| F15 | Admin Endpoints   | Internal management APIs             | M    | F2           |
| F16 | Metrics           | Prometheus metrics endpoint          | M    | F1           |

---

## Template: CLI Tool

**Typical stack:** Node.js or Rust

### MVP Features

| ID  | Feature            | Description                          | Size | Dependencies |
|-----|--------------------|--------------------------------------|------|--------------|
| F1  | Project Detection  | Find project root automatically      | S    | -            |
| F2  | Config Loading     | Load .rc or config file              | S    | F1           |
| F3  | Help Command       | --help with usage info               | S    | -            |
| F4  | Version Command    | --version flag                       | S    | -            |
| F5  | Main Command       | Primary functionality                | L    | F1, F2       |
| F6  | Error Handling     | User-friendly error messages         | S    | F5           |

### v1.1 Features

| ID  | Feature            | Description                          | Size | Dependencies |
|-----|--------------------|--------------------------------------|------|--------------|
| F7  | Interactive Mode   | Prompts for missing inputs           | M    | F5           |
| F8  | Dry Run            | --dry-run to preview changes         | S    | F5           |
| F9  | Verbose Output     | --verbose for debugging              | S    | F5           |
| F10 | Config Init        | Generate default config file         | S    | F2           |
| F11 | Color Output       | Colored terminal output              | S    | F5           |

### v2 Features

| ID  | Feature            | Description                          | Size | Dependencies |
|-----|--------------------|--------------------------------------|------|--------------|
| F12 | Watch Mode         | --watch for continuous operation     | M    | F5           |
| F13 | Plugin System      | Extensible with plugins              | L    | F5           |
| F14 | Shell Completions  | Bash/zsh/fish completions            | M    | F3           |
| F15 | Update Checker     | Notify of new versions               | S    | F4           |

---

## Template: E-Commerce Platform

**Typical stack:** Next.js + Node.js + PostgreSQL + Stripe

### MVP Features

| ID  | Feature            | Description                          | Size | Dependencies |
|-----|--------------------|--------------------------------------|------|--------------|
| F1  | Product Catalog    | Browse products with categories      | L    | -            |
| F2  | Product Detail     | Individual product pages             | M    | F1           |
| F3  | Shopping Cart      | Add/remove items, persist cart       | L    | F1           |
| F4  | User Registration  | Account creation                     | M    | -            |
| F5  | User Login         | Authentication                       | M    | F4           |
| F6  | Checkout Flow      | Address, shipping, payment           | L    | F3, F5       |
| F7  | Payment Processing | Stripe integration                   | L    | F6           |
| F8  | Order Confirmation | Success page + email                 | M    | F7           |

### v1.1 Features

| ID  | Feature            | Description                          | Size | Dependencies |
|-----|--------------------|--------------------------------------|------|--------------|
| F9  | Order History      | View past orders                     | M    | F8           |
| F10 | Search             | Product search                       | M    | F1           |
| F11 | Wishlist           | Save products for later              | M    | F5           |
| F12 | Product Reviews    | Ratings and reviews                  | M    | F2, F5       |
| F13 | Inventory Tracking | Stock management                     | M    | F1           |

### v2 Features

| ID  | Feature            | Description                          | Size | Dependencies |
|-----|--------------------|--------------------------------------|------|--------------|
| F14 | Admin Dashboard    | Product/order management             | L    | F1, F8       |
| F15 | Discount Codes     | Coupon system                        | M    | F6           |
| F16 | Shipping Rates     | Dynamic shipping calculation         | M    | F6           |
| F17 | Multi-currency     | International pricing                | L    | F7           |
| F18 | Analytics          | Sales and traffic reports            | L    | F8           |

---

## Template: Mobile App (React Native)

### MVP Features

| ID  | Feature            | Description                          | Size | Dependencies |
|-----|--------------------|--------------------------------------|------|--------------|
| F1  | Onboarding         | First-launch walkthrough             | M    | -            |
| F2  | Registration       | Email/password signup                | M    | -            |
| F3  | Login              | Authentication                       | M    | F2           |
| F4  | Home Screen        | Main app landing                     | M    | F3           |
| F5  | Core Feature       | Primary app functionality            | L    | F3           |
| F6  | Profile Screen     | User info display                    | S    | F3           |
| F7  | Settings           | App preferences                      | S    | F3           |

### v1.1 Features

| ID  | Feature            | Description                          | Size | Dependencies |
|-----|--------------------|--------------------------------------|------|--------------|
| F8  | Push Notifications | Firebase Cloud Messaging             | M    | F3           |
| F9  | Offline Mode       | Local caching and sync               | L    | F5           |
| F10 | Pull to Refresh    | Data refresh gesture                 | S    | F5           |
| F11 | Deep Linking       | URL scheme handling                  | M    | F4           |
| F12 | Analytics          | Event tracking                       | M    | F4           |

---

## Using Templates

When creating a roadmap:

```
Agent: What type of project is this?
  1. SaaS Web Application
  2. REST API / Backend Service
  3. CLI Tool
  4. E-Commerce Platform
  5. Mobile App
  6. Other (custom)

User: 1

Agent: I'll start with the SaaS template. Let's review and customize:

[Shows MVP features]

Which of these apply to your project?
- [ ] F1: User Registration
- [ ] F2: User Login
...
```
