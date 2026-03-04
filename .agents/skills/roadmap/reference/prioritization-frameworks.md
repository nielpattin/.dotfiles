# Prioritization Frameworks

Techniques for deciding what to build first.

---

## MoSCoW Method

Categorize features by necessity:

| Category    | Meaning                     | Typical %   |
|-------------|-----------------------------|-------------|
| **Must**    | Product fails without this  | 60%         |
| **Should**  | Important but not critical  | 20%         |
| **Could**   | Nice to have                | 15%         |
| **Won't**   | Not this version            | 5%          |

### Mapping to Roadmap Versions

| MoSCoW  | Roadmap Version |
|---------|-----------------|
| Must    | MVP             |
| Should  | v1.1            |
| Could   | v2              |
| Won't   | Backlog         |

---

## RICE Scoring

Score features numerically:

| Factor     | Definition                           | Scale     |
|------------|--------------------------------------|-----------|
| **Reach**  | How many users affected per quarter? | Number    |
| **Impact** | How much does it move the needle?    | 0.25-3    |
| **Confidence** | How sure are we about estimates? | 50%-100%  |
| **Effort** | Person-weeks to build                | Number    |

**Formula:** `RICE = (Reach × Impact × Confidence) / Effort`

### Impact Scale

| Score | Meaning           |
|-------|-------------------|
| 3     | Massive impact    |
| 2     | High impact       |
| 1     | Medium impact     |
| 0.5   | Low impact        |
| 0.25  | Minimal impact    |

---

## Value vs Effort Matrix

Quick visual prioritization:

```
                    High Value
                        │
         ┌──────────────┼──────────────┐
         │              │              │
         │   QUICK      │    BIG       │
         │   WINS       │    BETS      │
         │   (Do Now)   │   (Plan)     │
         │              │              │
Low ─────┼──────────────┼──────────────┼───── High
Effort   │              │              │      Effort
         │   FILL       │    MONEY     │
         │   INS        │    PIT       │
         │   (Maybe)    │   (Avoid)    │
         │              │              │
         └──────────────┼──────────────┘
                        │
                    Low Value
```

### Mapping to Priority

| Quadrant   | Action        | Roadmap Version |
|------------|---------------|-----------------|
| Quick Wins | Do first      | MVP             |
| Big Bets   | Plan carefully| v1.1 or v2      |
| Fill Ins   | If time       | Backlog         |
| Money Pit  | Avoid         | Cut             |

---

## Kano Model

Categorize by user satisfaction:

| Category      | Description                          | Priority |
|---------------|--------------------------------------|----------|
| **Basic**     | Expected, dissatisfied if missing    | MVP      |
| **Performance** | More is better, linear satisfaction | v1.1     |
| **Delighter** | Unexpected, creates excitement       | v2       |

### Examples

| Category    | Example Features                    |
|-------------|-------------------------------------|
| Basic       | Login, CRUD, error messages         |
| Performance | Speed, search, filtering            |
| Delighter   | AI suggestions, beautiful animations|

---

## Dependency-Based Ordering

Some features MUST come before others:

```
1. Build foundations first
   └── Auth before any protected features
   └── Core CRUD before advanced features
   └── API before integrations

2. Risk-first within each level
   └── Uncertain/risky features earlier
   └── Well-understood features can wait

3. Value-first within same risk level
   └── Higher impact features first
```

---

## Size Estimation

Quick sizing without detailed estimation:

| Size | Description                      | Relative Effort |
|------|----------------------------------|-----------------|
| S    | One component, simple logic      | 1x              |
| M    | Multiple components, some logic  | 2-3x            |
| L    | Full feature, complex logic      | 5-8x            |
| XL   | Major feature, consider splitting| 10x+            |

### T-Shirt to Time Mapping (Rough)

| Size | Solo Developer | Small Team |
|------|----------------|------------|
| S    | 1-2 days       | 1 day      |
| M    | 3-5 days       | 2-3 days   |
| L    | 1-2 weeks      | 1 week     |
| XL   | 2-4 weeks      | 1-2 weeks  |

---

## MVP Checklist

Minimum for launch:

- [ ] Core value proposition works
- [ ] Users can sign up and log in
- [ ] Primary user journey is complete
- [ ] Critical errors are handled
- [ ] Data is not lost
- [ ] Basic security in place

### MVP Anti-Patterns

- Including "nice to have" features
- Perfectionism on non-core features
- Building for scale before validation
- Adding features "just in case"

---

## Quick Prioritization Process

1. **List all features** (don't prioritize yet)
2. **Mark dependencies** (what requires what)
3. **Score each** (MoSCoW or Value/Effort)
4. **Group by version** (MVP → v1.1 → v2 → Backlog)
5. **Order within version** (dependencies + priority)
6. **Validate with stakeholders** (are priorities right?)
