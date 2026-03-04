# Architecture Document Template

Use this template when creating `architecture.md` for a tracer bullet project.

---

```markdown
# Architecture: <Project Name>

**Created:** YYYY-MM-DD
**Status:** Draft | Review | Approved

---

## System Overview

One paragraph describing what the system does and its core value proposition.
Focus on: what problem it solves, who uses it, what makes it valuable.

---

## Technology Stack

| Layer      | Technology         | Rationale                           |
|------------|--------------------|------------------------------------|
| Frontend   | React + TypeScript | Team expertise, component ecosystem |
| API        | Node.js + Express  | Same language as frontend           |
| Database   | PostgreSQL         | ACID compliance, JSON support       |
| Cache      | Redis              | Session storage, rate limiting      |
| Queue      | -                  | Not needed for v1                   |

---

## Layer Architecture

### Layer: Frontend
- **Responsibility:** User interface, state management, API communication
- **Boundaries:** Only communicates with API Gateway
- **Key Patterns:** Component composition, hooks for state, React Query for data
- **Entry Points:** `src/app/page.tsx`, `src/components/`
- **Testing:** Vitest + React Testing Library

### Layer: API Gateway
- **Responsibility:** Authentication, routing, request validation, rate limiting
- **Boundaries:** Receives frontend requests, delegates to services
- **Key Patterns:** Middleware chain, JWT validation, Zod schemas
- **Entry Points:** `src/api/index.ts`, `src/api/routes/`
- **Testing:** Supertest integration tests

### Layer: Services
- **Responsibility:** Business logic, orchestration, domain rules
- **Boundaries:** Called by API, calls repositories, emits events
- **Key Patterns:** Use-case pattern, dependency injection, pure functions
- **Entry Points:** `src/services/*.service.ts`
- **Testing:** Unit tests with mocked repositories

### Layer: Data
- **Responsibility:** Persistence, queries, migrations, data integrity
- **Boundaries:** Only accessed by services (never directly by API)
- **Key Patterns:** Repository pattern, Prisma ORM, migrations
- **Entry Points:** `src/db/schema.prisma`, `src/repositories/`
- **Testing:** Integration tests with test database

---

## Module Boundaries

### Module: Auth
- **Owns:** User identity, sessions, permissions, password hashing
- **Exposes:**
  - `AuthService.register(email, password): User`
  - `AuthService.login(email, password): { token, user }`
  - `AuthService.verify(token): User | null`
- **Consumes:** Database (users table)
- **Events Emitted:** `user.created`, `user.logged_in`

### Module: Core
- **Owns:** Primary domain entities (e.g., projects, items, orders)
- **Exposes:**
  - `CoreService.create(data): Entity`
  - `CoreService.get(id): Entity`
  - `CoreService.list(filters): Entity[]`
- **Consumes:** Database, Auth (for ownership validation)
- **Events Emitted:** `entity.created`, `entity.updated`

### Module: [Additional modules as needed]

---

## Integration Contracts

### External API: [Service Name]
```
Base URL: https://api.example.com/v1
Auth: Bearer token in Authorization header
Rate Limit: 100 req/min

Endpoints Used:
- GET /resource/{id} → { id, name, data }
- POST /resource → { id }
```

### Internal API: POST /api/auth/register
```typescript
// Request
interface RegisterRequest {
  email: string;      // Valid email format
  password: string;   // Min 8 chars, 1 uppercase, 1 number
}

// Response 201
interface RegisterResponse {
  user: { id: string; email: string; createdAt: string };
  token: string;
}

// Response 400
{ error: "Validation failed", details: [...] }

// Response 409
{ error: "Email already registered" }
```

### Internal API: POST /api/auth/login
```typescript
// Request
interface LoginRequest {
  email: string;
  password: string;
}

// Response 200
interface LoginResponse {
  user: { id: string; email: string };
  token: string;  // JWT, expires in 24h
}

// Response 401
{ error: "Invalid credentials" }
```

### Event: user.created
```typescript
interface UserCreatedEvent {
  type: "user.created";
  timestamp: string;  // ISO 8601
  payload: {
    userId: string;
    email: string;
    createdAt: string;
  };
}
```

---

## Data Models

### Entity: User
```typescript
interface User {
  id: string;           // UUID v4
  email: string;        // Unique, lowercase
  passwordHash: string; // bcrypt hash
  role: "user" | "admin";
  createdAt: Date;
  updatedAt: Date;
}

// Database indexes:
// - UNIQUE(email)
// - INDEX(createdAt)
```

### Entity: [Primary Domain Entity]
```typescript
interface Entity {
  id: string;
  ownerId: string;      // FK to User
  name: string;
  status: "draft" | "active" | "archived";
  data: JsonValue;      // Flexible JSON field
  createdAt: Date;
  updatedAt: Date;
}

// Database indexes:
// - INDEX(ownerId)
// - INDEX(status)
// - INDEX(createdAt)
```

---

## Technical Risks

| Risk | Probability | Impact | Mitigation | Slice to Validate |
|------|-------------|--------|------------|-------------------|
| DB connection pooling under load | Medium | High | Use PgBouncer, connection limits | slice-1 |
| JWT token invalidation on logout | Low | Medium | Implement token blacklist in Redis | slice-3 |
| Third-party API rate limits | High | Medium | Circuit breaker, request queuing | slice-4 |
| File upload size limits | Medium | Low | Chunked uploads, size validation | slice-5 |

---

## Non-Goals (v1)

Explicitly out of scope for this version:

- **OAuth/Social Login** - Deferred to v2, email/password sufficient for launch
- **Real-time Features** - No WebSocket, polling acceptable for now
- **Mobile Apps** - Web-only, responsive design for mobile browsers
- **Multi-tenancy** - Single tenant, no workspace isolation needed yet
- **Internationalization** - English only for v1

---

## Infrastructure Decisions

### Deployment
- **Platform:** [Vercel / Railway / AWS / etc.]
- **Environments:** development, staging, production
- **CI/CD:** GitHub Actions

### Observability
- **Logging:** Structured JSON logs to stdout
- **Metrics:** [Prometheus / CloudWatch / etc.]
- **Tracing:** [OpenTelemetry / none for v1]

### Security
- **Authentication:** JWT in httpOnly cookie
- **Authorization:** Role-based (user, admin)
- **Secrets:** Environment variables, no .env in repo
- **CORS:** Whitelist frontend origin only

---

## Open Questions

| Question | Owner | Status | Decision |
|----------|-------|--------|----------|
| Redis vs in-memory for sessions? | @backend | Open | - |
| Which email provider for transactional? | @infra | Open | - |
| Do we need audit logging for v1? | @product | Open | - |

---

## Revision History

| Date | Author | Changes |
|------|--------|---------|
| YYYY-MM-DD | @author | Initial architecture |
```
