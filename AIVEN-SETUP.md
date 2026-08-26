# Aiven Setup — PostgreSQL + Valkey

This project is designed around Aiven PostgreSQL and Aiven Valkey. No Render or Railway database is required.

## 1. Create Aiven PostgreSQL

Create an Aiven for PostgreSQL service and a database for this application.

From the Aiven PostgreSQL connection information, copy the PostgreSQL service URI into:

```text
DATABASE_URL
```

Use SSL. The included configuration defaults to SSL and can be made stricter later by setting `DATABASE_SSL_REJECT_UNAUTHORIZED=true` with the correct Aiven CA certificate.

## 2. Enable pgvector

The application schema runs:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

Aiven supports pgvector as a PostgreSQL extension. If your service/user does not permit automatic extension creation, open the Aiven SQL console and run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

The application then creates the tables and HNSW vector index automatically at startup.

## 3. Create Aiven Valkey

Create an Aiven for Valkey service.

Copy its Service URI into:

```text
REDIS_URL
```

Aiven currently uses the `valkeys://` URI scheme for TLS. This application automatically converts `valkeys://` to the `rediss://` scheme expected by ioredis.

Do not disable TLS for production.

## 4. Verify both services

After deploying the application, open:

```text
/api/health
```

A healthy response is:

```json
{"ok":true,"database":"ok","redis":"ok"}
```

## 5. Database initialization

You do NOT manually paste the schema into a SQL editor for normal deployment.

At startup the application reads:

```text
database/schema.sql
```

and executes it safely with `CREATE ... IF NOT EXISTS` statements.

This specifically prevents the earlier registration failure caused by deploying the application before the `users` table existed.
