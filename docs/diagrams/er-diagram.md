# Entity-Relationship Diagram

See [05-Database-Design.md](../05-Database-Design.md) for full schema reference, including the migration-history gap noted for this schema.

```mermaid
erDiagram
    USER ||--o{ TASK : owns
    USER {
        int id PK
        string name
        string email UK
        string password
        datetime createdAt
        datetime updatedAt
        datetime emailVerified
    }
    TASK {
        int id PK
        string title
        string priority
        boolean completed
        datetime dueDate
        datetime createdAt
        datetime updatedAt
        int userId FK
        string description
        string category
    }
    VERIFICATION_TOKEN {
        int id PK
        string email
        string token UK
        datetime expiresAt
        datetime createdAt
    }
    PASSWORD_RESET_TOKEN {
        int id PK
        string email
        string token UK
        datetime expiresAt
        datetime createdAt
    }
    RATE_LIMIT {
        int id PK
        string key UK
        int count
        datetime resetAt
        datetime createdAt
        datetime updatedAt
    }
```

**Note:** `VERIFICATION_TOKEN`, `PASSWORD_RESET_TOKEN`, and `RATE_LIMIT` are deliberately not foreign-keyed to `USER` — they're keyed by `email`/`key` strings instead, since rate limiting in particular needs to key on things that aren't always a user ID (e.g. an IP address for unauthenticated endpoints). See [05-Database-Design.md § 5](../05-Database-Design.md#5-relationships--design-rationale).
