# Local Development

You can run the application locally while still using your Aiven services.

## 1. Install

Requirements:

- Node.js 22+
- npm 10+
- Aiven PostgreSQL
- Aiven Valkey
- S3-compatible bucket

From `backend/`:

```bash
npm install
```

## 2. Configure

Copy `.env.example` to `.env` at the project root and fill in the Aiven/S3 values.

For local HTTP use:

```text
PUBLIC_ORIGIN=http://localhost:8080
COOKIE_SECURE=false
COOKIE_SAME_SITE=lax
```

## 3. Run the web server

```bash
cd backend
npm run dev
```

Open:

```text
http://localhost:8080
```

## 4. Run the worker

In another terminal:

```bash
cd backend
npm run worker
```

## 5. Schema

No manual schema command is required. The web server and worker both run the idempotent database initialization on startup.

## 6. Production-like Docker test

```bash
docker build -t internal-ai-chat:2.0 .
```

Then run the web and worker containers with the same production environment variables.
