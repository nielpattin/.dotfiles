# Slice Patterns by Project Type

Common tracer bullet slice patterns for different project architectures.

---

## Web Application (Full-Stack)

**Stack:** React + Node.js + PostgreSQL

### Slice 1: Infrastructure Hello World
```json
{
  "id": "slice-1",
  "name": "Infrastructure Hello World",
  "priority": 1,
  "risk": "high",
  "category": "infrastructure",
  "touchesLayers": ["frontend", "api", "database"],
  "tasks": [
    "Initialize React app with TypeScript",
    "Initialize Express server with TypeScript",
    "Setup PostgreSQL with Prisma",
    "Create health check endpoint GET /api/health",
    "Create minimal React component that calls health endpoint",
    "Verify full round-trip works"
  ],
  "verification": [
    "npm run dev starts both frontend and backend",
    "GET /api/health returns { status: 'ok', db: 'connected' }",
    "Frontend displays 'Connected' after API call",
    "Database connection pool works"
  ],
  "estimatedLines": "200-300"
}
```

### Slice 2: User Registration
```json
{
  "id": "slice-2",
  "name": "User Registration",
  "priority": 2,
  "risk": "medium",
  "category": "auth",
  "touchesLayers": ["frontend", "api", "service", "database"],
  "dependsOn": ["slice-1"],
  "tasks": [
    "Create User model in Prisma schema",
    "Create AuthService with register method",
    "Implement password hashing with bcrypt",
    "Create POST /api/auth/register endpoint",
    "Add Zod validation for request body",
    "Create registration form component",
    "Handle success and error states in UI"
  ],
  "verification": [
    "POST /api/auth/register creates user in DB",
    "Password is hashed (not stored plain)",
    "Duplicate email returns 409 Conflict",
    "Invalid input returns 400 with validation errors",
    "Frontend form shows success message",
    "Frontend form shows validation errors"
  ],
  "estimatedLines": "400-500"
}
```

### Slice 3: User Login + Protected Routes
```json
{
  "id": "slice-3",
  "name": "User Login + Protected Routes",
  "priority": 3,
  "risk": "high",
  "category": "auth",
  "touchesLayers": ["frontend", "api", "service", "database"],
  "dependsOn": ["slice-2"],
  "tasks": [
    "Create AuthService.login method",
    "Implement JWT token generation",
    "Create POST /api/auth/login endpoint",
    "Create auth middleware for protected routes",
    "Create login form component",
    "Store token in httpOnly cookie",
    "Create protected dashboard route",
    "Implement logout functionality"
  ],
  "verification": [
    "POST /api/auth/login returns JWT for valid credentials",
    "Invalid credentials return 401",
    "Protected GET /api/me requires valid token",
    "Protected route rejects expired/invalid tokens",
    "Frontend redirects to login when unauthenticated",
    "Frontend shows dashboard when authenticated"
  ],
  "estimatedLines": "500-600"
}
```

### Slice 4: Core Entity CRUD
```json
{
  "id": "slice-4",
  "name": "Core Entity CRUD",
  "priority": 4,
  "risk": "medium",
  "category": "core",
  "touchesLayers": ["frontend", "api", "service", "database"],
  "dependsOn": ["slice-3"],
  "tasks": [
    "Create Entity model with owner relationship",
    "Create EntityService with CRUD methods",
    "Create REST endpoints: GET/POST/PUT/DELETE /api/entities",
    "Add ownership validation (users can only access own entities)",
    "Create entity list component",
    "Create entity form (create/edit)",
    "Implement optimistic updates in UI"
  ],
  "verification": [
    "POST /api/entities creates entity owned by current user",
    "GET /api/entities returns only user's entities",
    "Cannot access/modify other user's entities (403)",
    "PUT updates entity correctly",
    "DELETE removes entity",
    "UI list updates after CRUD operations"
  ],
  "estimatedLines": "600-800"
}
```

---

## API-Only Backend

**Stack:** Node.js + PostgreSQL (no frontend)

### Slice 1: Infrastructure + Health
```json
{
  "id": "slice-1",
  "name": "Infrastructure + Health",
  "priority": 1,
  "risk": "high",
  "category": "infrastructure",
  "touchesLayers": ["api", "database"],
  "tasks": [
    "Initialize Express with TypeScript",
    "Setup Prisma with PostgreSQL",
    "Create structured logging (pino)",
    "Create GET /health endpoint with DB check",
    "Setup error handling middleware",
    "Create request validation middleware (Zod)"
  ],
  "verification": [
    "Server starts without errors",
    "GET /health returns { status: 'ok', db: 'connected' }",
    "Invalid requests return proper error format",
    "Logs are structured JSON"
  ],
  "estimatedLines": "200-300"
}
```

### Slice 2: API Authentication
```json
{
  "id": "slice-2",
  "name": "API Key Authentication",
  "priority": 2,
  "risk": "high",
  "category": "auth",
  "touchesLayers": ["api", "service", "database"],
  "dependsOn": ["slice-1"],
  "tasks": [
    "Create ApiKey model in Prisma",
    "Create API key generation utility",
    "Create auth middleware that validates X-API-Key header",
    "Create POST /api/keys endpoint (admin only)",
    "Create key rotation mechanism",
    "Add rate limiting per API key"
  ],
  "verification": [
    "Requests without API key return 401",
    "Invalid API key returns 401",
    "Valid API key allows request through",
    "Rate limit triggers after threshold",
    "Key rotation invalidates old key"
  ],
  "estimatedLines": "300-400"
}
```

---

## CLI Tool

**Stack:** Node.js + TypeScript

### Slice 1: CLI Infrastructure
```json
{
  "id": "slice-1",
  "name": "CLI Infrastructure",
  "priority": 1,
  "risk": "medium",
  "category": "infrastructure",
  "touchesLayers": ["cli", "core"],
  "tasks": [
    "Setup commander.js for arg parsing",
    "Create project root detection",
    "Setup configuration file loading (.toolrc)",
    "Create help command and version flag",
    "Setup colored output with chalk",
    "Create error handling and exit codes"
  ],
  "verification": [
    "tool --help shows usage",
    "tool --version shows version",
    "Runs from any subdirectory (finds project root)",
    "Loads config from .toolrc if present",
    "Errors exit with non-zero code"
  ],
  "estimatedLines": "200-300"
}
```

### Slice 2: Core Command
```json
{
  "id": "slice-2",
  "name": "Core Command",
  "priority": 2,
  "risk": "medium",
  "category": "core",
  "touchesLayers": ["cli", "core", "filesystem"],
  "dependsOn": ["slice-1"],
  "tasks": [
    "Create main command (e.g., 'tool generate')",
    "Implement interactive prompts with inquirer",
    "Create file generation logic",
    "Add dry-run mode (--dry-run)",
    "Implement template loading",
    "Add confirmation before destructive operations"
  ],
  "verification": [
    "tool generate prompts for required input",
    "Generated files match templates",
    "--dry-run shows what would be created",
    "Existing files prompt for overwrite confirmation"
  ],
  "estimatedLines": "300-400"
}
```

---

## Monorepo (Turborepo/Nx)

**Stack:** Turborepo + Multiple Packages

### Slice 1: Monorepo Infrastructure
```json
{
  "id": "slice-1",
  "name": "Monorepo Infrastructure",
  "priority": 1,
  "risk": "high",
  "category": "infrastructure",
  "touchesLayers": ["build", "packages"],
  "tasks": [
    "Initialize Turborepo with pnpm workspaces",
    "Create apps/ and packages/ structure",
    "Setup shared TypeScript config",
    "Setup shared ESLint config",
    "Create first shared package (e.g., @repo/utils)",
    "Create first app that imports shared package",
    "Setup turbo.json with build pipeline"
  ],
  "verification": [
    "pnpm install works without errors",
    "turbo build builds all packages in correct order",
    "Shared package is importable from app",
    "TypeScript types flow through correctly",
    "Incremental builds work (no-op on unchanged)"
  ],
  "estimatedLines": "200-300"
}
```

---

## Serverless (AWS Lambda / Cloudflare Workers)

**Stack:** Serverless + DynamoDB/D1

### Slice 1: Serverless Infrastructure
```json
{
  "id": "slice-1",
  "name": "Serverless Infrastructure",
  "priority": 1,
  "risk": "high",
  "category": "infrastructure",
  "touchesLayers": ["function", "database", "deployment"],
  "tasks": [
    "Setup serverless framework or SAM",
    "Create hello world function",
    "Setup DynamoDB/D1 table",
    "Create function that reads/writes to DB",
    "Setup local development environment",
    "Create deployment scripts for dev/prod"
  ],
  "verification": [
    "Local invoke returns expected response",
    "Function connects to local DynamoDB",
    "Deploy to dev environment succeeds",
    "Deployed function responds correctly",
    "Cold start time is acceptable (<500ms)"
  ],
  "estimatedLines": "200-300"
}
```

---

## Slice Sizing Guidelines

| Slice Size | Lines Estimate | Typical Content |
|------------|----------------|-----------------|
| Small | 150-250 | Infrastructure, config, single endpoint |
| Medium | 250-400 | Auth flow, simple CRUD, integration |
| Large | 400-600 | Complex feature, multiple components |
| Max | 600-800 | Should probably be split |

## Slice Dependencies

```
slice-1 (infrastructure)
    │
    ▼
slice-2 (auth/first-feature)
    │
    ├──► slice-3 (depends on auth)
    │
    └──► slice-4 (depends on auth)
              │
              ▼
         slice-5 (depends on slice-4)
```

Rules:
- Infrastructure slice has no dependencies
- Auth usually depends only on infrastructure
- Core features depend on auth
- Integrations can often run in parallel after auth
