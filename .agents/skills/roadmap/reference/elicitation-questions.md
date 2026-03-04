# Feature Elicitation Questions

Systematic question bank to ensure complete feature coverage.

---

## Layer 1: User Journeys

For each persona, walk through their complete journey:

### Onboarding Journey
- How does a new user discover this product?
- What's the signup/registration process?
- What's the first thing they do after signing up?
- What makes them feel successful in the first session?

### Core Usage Journey
- What's the main thing users do daily/weekly?
- What triggers them to open the product?
- What's the complete flow for their primary task?
- What do they do when they're done?

### Return Journey
- Why do users come back?
- What brings them back (notification, habit, need)?
- What do they check first when returning?

---

## Layer 2: User Goals

For each persona, ask:

### Primary Goals
- "What are the top 3 things [persona] needs to accomplish?"
- "What would make [persona] say 'this product is essential'?"
- "What task takes them the most time today?"

### Secondary Goals
- "What else might [persona] want to do occasionally?"
- "What would be nice to have but not critical?"

### Frustration Points
- "What's the most annoying part of their current workflow?"
- "What do they wish they could do but can't?"

---

## Layer 3: Feature Categories

Ensure coverage across all categories:

### Authentication & Identity
- [ ] Registration (email/password)
- [ ] Login / Logout
- [ ] Password reset
- [ ] Email verification
- [ ] Social login (OAuth)
- [ ] Multi-factor authentication
- [ ] Session management

### User Management
- [ ] User profile
- [ ] Profile editing
- [ ] Avatar/photo upload
- [ ] Account settings
- [ ] Account deletion
- [ ] Preferences

### Core Domain (Product-Specific)
- [ ] Create [primary entity]
- [ ] Read/View [primary entity]
- [ ] Update/Edit [primary entity]
- [ ] Delete [primary entity]
- [ ] List [primary entities]
- [ ] Search [primary entities]
- [ ] Filter [primary entities]
- [ ] Sort [primary entities]

### Collaboration & Sharing
- [ ] Share with others
- [ ] Team/organization support
- [ ] Invite users
- [ ] Role-based permissions
- [ ] Comments/discussion
- [ ] Real-time collaboration

### Notifications & Communication
- [ ] Email notifications
- [ ] In-app notifications
- [ ] Push notifications (mobile)
- [ ] Notification preferences
- [ ] Digest emails

### Data & Analytics
- [ ] Dashboard/overview
- [ ] Reports
- [ ] Charts/visualizations
- [ ] Export data (CSV, PDF)
- [ ] Import data
- [ ] Activity history

### Administration
- [ ] Admin dashboard
- [ ] User management (admin)
- [ ] System settings
- [ ] Audit logs
- [ ] Usage analytics
- [ ] Billing/subscription

### Integrations
- [ ] REST API
- [ ] Webhooks
- [ ] Third-party integrations
- [ ] Zapier/automation
- [ ] Import from other tools
- [ ] Export to other tools

### Security & Compliance
- [ ] Data encryption
- [ ] Access control
- [ ] Audit logging
- [ ] GDPR compliance
- [ ] Data backup
- [ ] Rate limiting

---

## Layer 4: Non-Functional → Features

Some non-functional requirements imply features:

| Requirement    | Implied Feature                |
|----------------|--------------------------------|
| Performance    | Caching, pagination, lazy load |
| Scalability    | Queue processing, async jobs   |
| Reliability    | Backup/restore, health checks  |
| Accessibility  | Keyboard nav, screen reader    |
| Mobile         | Responsive design, mobile app  |
| Offline        | Offline mode, sync             |

---

## Layer 5: Edge Cases & Error States

- What happens when something goes wrong?
- What if the user makes a mistake?
- What if data is invalid?
- What if external service is down?
- What if user loses connection?

---

## Questioning Technique

### One Question at a Time
Ask one question, wait for answer, then follow up.

### Breadth First
Cover all categories before going deep on any one.

### "What Else?"
After each answer, ask "What else?" to ensure completeness.

### "Why?"
For each feature, ask "Why is this important?" to validate need.

### Multiple Choice When Possible
"Do you need (a) just email login, (b) social login too, or (c) SSO?"

---

## Feature Extraction Pattern

For each identified need:

1. **Name it**: Short, descriptive feature name
2. **Describe it**: One sentence of what it does
3. **Size it**: S/M/L/XL based on scope
4. **Prioritize it**: MVP / v1.1 / v2 / Backlog
5. **Depend it**: What must exist first?
