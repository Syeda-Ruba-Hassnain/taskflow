# System Architecture Diagram

See [03-System-Architecture.md](../03-System-Architecture.md) for full explanation.

```mermaid
graph TD
    UI["Presentation Layer<br/>app/**, components/**"]
    API["API Layer<br/>app/api/**"]
    SVC["Business Logic Layer<br/>lib/services/**"]
    AI["AI Pipeline<br/>lib/ai/**"]
    REPO["Repository Layer<br/>lib/repositories/**"]
    ERR["Error Types<br/>lib/errors/**"]
    DB[("PostgreSQL")]
    PRISMA["Prisma Client<br/>lib/prisma.ts"]

    UI -->|fetch| API
    API --> SVC
    API --> AI
    AI --> SVC
    SVC --> REPO
    AI -.->|shared validators| SVC
    REPO --> PRISMA
    PRISMA --> DB
    API -.->|catches| ERR
    SVC -.->|throws| ERR
```

**Key point:** the AI Pipeline calls into the same Business Logic Layer (`TaskService`) that the API Layer calls directly — it is a second entry point into shared logic, not a parallel implementation. See [03-System-Architecture.md § 3](../03-System-Architecture.md#3-why-this-architecture-was-chosen).
