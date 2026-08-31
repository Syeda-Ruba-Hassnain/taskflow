# Deployment Diagram

Reflects the deployment model described in [10-Deployment.md](../10-Deployment.md) — a single Next.js application process talking to one PostgreSQL database and two external SaaS APIs. There is no separate backend service, load balancer configuration, or container orchestration defined in the repository itself; this diagram shows the logical topology any Node.js-capable host would need to provide.

```mermaid
graph TB
    subgraph Client_Devices["Client Devices"]
        Browser["Web Browser<br/>(desktop / mobile)"]
    end

    subgraph Hosting["Node.js Host (e.g. Vercel or equivalent)"]
        NextApp["TaskFlow — Next.js 16 Application<br/>(pages + API routes + AI pipeline,<br/>single deployable process)"]
    end

    subgraph Data["Data Tier"]
        Postgres[("PostgreSQL Database<br/>User, Task, VerificationToken,<br/>PasswordResetToken, RateLimit")]
    end

    subgraph External_Services["External Services"]
        Groq["Groq API<br/>(llama-3.3-70b-versatile)"]
        Resend["Resend<br/>(transactional email)"]
    end

    subgraph Monitoring["Operational"]
        Monitor["Uptime Monitor /<br/>Load Balancer"]
    end

    Browser -->|HTTPS| NextApp
    NextApp -->|Prisma Client<br/>SQL over TCP| Postgres
    NextApp -->|HTTPS, OpenAI-compatible| Groq
    NextApp -->|HTTPS| Resend
    Monitor -->|GET /api/health<br/>unauthenticated| NextApp
```

**Known gap affecting this diagram's accuracy for a *first* production deployment:** the arrow from `NextApp` to `Postgres` assumes a schema already exists in the database. As documented in [05-Database-Design.md § 7](../05-Database-Design.md#7-migration-strategy), no committed migration exists to create that schema — this must be resolved (see [10-Deployment.md § 4](../10-Deployment.md#4-database-setup)) before this deployment topology is viable against a genuinely fresh database.
