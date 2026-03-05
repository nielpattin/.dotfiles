# Layer Catalog

Standard layer definitions for common architectures.

---

## Web Application Layers

### Frontend Layer
```json
{
  "id": "frontend",
  "name": "Frontend",
  "responsibility": "User interface, state management, API communication",
  "boundaries": ["Only communicates with API Gateway"],
  "technologies": ["React", "Vue", "Svelte", "Next.js", "SvelteKit"],
  "patterns": [
    "Component composition",
    "Hooks for state",
    "React Query / TanStack Query for server state",
    "Zustand / Jotai for client state"
  ],
  "entryPoints": ["src/app/", "src/pages/", "src/components/"],
  "testing": "Vitest + Testing Library"
}
```

### API Gateway Layer
```json
{
  "id": "api",
  "name": "API Gateway",
  "responsibility": "Authentication, routing, validation, rate limiting",
  "boundaries": ["Receives frontend requests", "Delegates to services"],
  "technologies": ["Express", "Fastify", "Hono", "tRPC"],
  "patterns": [
    "Middleware chain",
    "JWT validation",
    "Zod request schemas",
    "Error handling middleware"
  ],
  "entryPoints": ["src/api/", "src/routes/", "src/server/"],
  "testing": "Supertest integration tests"
}
```

### Service Layer
```json
{
  "id": "service",
  "name": "Services",
  "responsibility": "Business logic, orchestration, domain rules",
  "boundaries": ["Called by API", "Calls repositories", "Emits events"],
  "technologies": ["TypeScript", "Node.js"],
  "patterns": [
    "Use-case pattern",
    "Dependency injection",
    "Pure functions where possible",
    "Domain-driven design concepts"
  ],
  "entryPoints": ["src/services/", "src/domain/", "src/use-cases/"],
  "testing": "Unit tests with mocked dependencies"
}
```

### Repository Layer
```json
{
  "id": "repository",
  "name": "Repositories",
  "responsibility": "Data access abstraction, query building",
  "boundaries": ["Called by services", "Calls database"],
  "technologies": ["Prisma", "Drizzle", "TypeORM", "Kysely"],
  "patterns": [
    "Repository pattern",
    "Query builders",
    "Transaction management"
  ],
  "entryPoints": ["src/repositories/", "src/db/"],
  "testing": "Integration tests with test database"
}
```

### Database Layer
```json
{
  "id": "database",
  "name": "Database",
  "responsibility": "Data persistence, integrity, migrations",
  "boundaries": ["Only accessed via repositories"],
  "technologies": ["PostgreSQL", "MySQL", "SQLite", "MongoDB"],
  "patterns": [
    "Schema migrations",
    "Indexes for performance",
    "Constraints for integrity"
  ],
  "entryPoints": ["prisma/schema.prisma", "src/db/migrations/"],
  "testing": "Migration tests, seed data tests"
}
```

---

## API-Only Layers

### API Handler Layer
```json
{
  "id": "handler",
  "name": "Handlers",
  "responsibility": "HTTP request/response handling, validation",
  "boundaries": ["Entry point for requests", "Calls services"],
  "patterns": [
    "Request validation (Zod)",
    "Response formatting",
    "Error mapping to HTTP codes"
  ],
  "entryPoints": ["src/handlers/", "src/routes/"]
}
```

### Domain Layer
```json
{
  "id": "domain",
  "name": "Domain",
  "responsibility": "Core business logic, entities, rules",
  "boundaries": ["Pure business logic", "No I/O dependencies"],
  "patterns": [
    "Entities with behavior",
    "Value objects",
    "Domain events",
    "Aggregate roots"
  ],
  "entryPoints": ["src/domain/"]
}
```

---

## CLI Tool Layers

### CLI Layer
```json
{
  "id": "cli",
  "name": "CLI",
  "responsibility": "Argument parsing, user interaction, output formatting",
  "boundaries": ["Entry point", "Calls core logic"],
  "technologies": ["Commander", "Yargs", "Clack", "Inquirer"],
  "patterns": [
    "Command pattern",
    "Subcommands",
    "Interactive prompts",
    "Progress indicators"
  ],
  "entryPoints": ["src/cli/", "src/commands/"]
}
```

### Core Layer
```json
{
  "id": "core",
  "name": "Core",
  "responsibility": "Business logic independent of CLI",
  "boundaries": ["Called by CLI", "No CLI-specific code"],
  "patterns": [
    "Pure functions",
    "Configuration objects",
    "Result types for errors"
  ],
  "entryPoints": ["src/core/", "src/lib/"]
}
```

### Filesystem Layer
```json
{
  "id": "filesystem",
  "name": "Filesystem",
  "responsibility": "File reading, writing, watching",
  "boundaries": ["Called by core", "Abstracts fs operations"],
  "patterns": [
    "Virtual filesystem for testing",
    "Atomic writes",
    "Glob patterns"
  ],
  "entryPoints": ["src/fs/", "src/io/"]
}
```

---

## Serverless Layers

### Function Layer
```json
{
  "id": "function",
  "name": "Functions",
  "responsibility": "Request handling, event processing",
  "boundaries": ["Entry point for invocations", "Calls services"],
  "technologies": ["AWS Lambda", "Cloudflare Workers", "Vercel Functions"],
  "patterns": [
    "Handler pattern",
    "Cold start optimization",
    "Context reuse"
  ],
  "entryPoints": ["src/functions/", "src/handlers/"]
}
```

### Event Layer
```json
{
  "id": "events",
  "name": "Events",
  "responsibility": "Event processing, async operations",
  "boundaries": ["Triggered by queues/events", "Calls services"],
  "technologies": ["SQS", "EventBridge", "Cloudflare Queues"],
  "patterns": [
    "Event handlers",
    "Idempotency",
    "Dead letter queues"
  ],
  "entryPoints": ["src/events/", "src/workers/"]
}
```

---

## Cross-Cutting Concerns

### Logging
```json
{
  "id": "logging",
  "name": "Logging",
  "responsibility": "Structured logging, request tracing",
  "technologies": ["Pino", "Winston"],
  "patterns": ["Structured JSON", "Request correlation IDs", "Log levels"]
}
```

### Caching
```json
{
  "id": "cache",
  "name": "Cache",
  "responsibility": "Performance optimization, session storage",
  "technologies": ["Redis", "Memcached", "In-memory"],
  "patterns": ["Cache-aside", "Write-through", "TTL expiration"]
}
```

### Queue
```json
{
  "id": "queue",
  "name": "Queue",
  "responsibility": "Async processing, background jobs",
  "technologies": ["BullMQ", "SQS", "RabbitMQ"],
  "patterns": ["Job scheduling", "Retry with backoff", "Priority queues"]
}
```

---

## Layer Communication Patterns

### Synchronous
```
Frontend → API → Service → Repository → Database
         ←     ←         ←            ←
```

### Async with Events
```
API → Service → Event Emitter
                     │
                     ▼
              Event Handler → External Service
```

### Request/Response with Cache
```
Frontend → API → Cache Check
                    │
                    ├─ HIT → Return cached
                    │
                    └─ MISS → Service → Database
                                   │
                                   └─► Update Cache
```

---

## Layer Boundary Rules

1. **Frontend → API only**: Frontend never calls services/database directly
2. **API → Service only**: API handlers don't contain business logic
3. **Service → Repository only**: Services don't write raw SQL
4. **No upward dependencies**: Database layer never imports from service layer
5. **Cross-cutting via middleware**: Logging, auth, etc. applied at API layer
6. **Events for async**: Services emit events, handlers subscribe

---

## Choosing Layers

| Project Size | Recommended Layers |
|--------------|-------------------|
| Small (< 1000 LOC) | API + Database |
| Medium (1000-5000 LOC) | API + Service + Database |
| Large (5000+ LOC) | Full stack with all layers |
| Enterprise | Add Domain layer, Event layer |

| Project Type | Primary Layers |
|--------------|---------------|
| Web App | Frontend, API, Service, Database |
| API Only | Handler, Service, Repository, Database |
| CLI Tool | CLI, Core, Filesystem |
| Serverless | Function, Service, Database |
| Microservice | API, Domain, Repository, Events |
