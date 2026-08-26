# Deployment Walkthrough — Aiven Edition

## Architecture

Use any Docker-compatible application host. Aiven provides the database and Redis-compatible queue:

```text
                 Docker Host
              ┌───────────────┐
              │ Web/API       │
              │ Worker        │
              └───────┬───────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
 Aiven PostgreSQL           Aiven Valkey
 + pgvector                 Redis-compatible
          │
          └──────────┐
                     ▼
              S3-compatible
               file storage
```

## Step 1 — Build the image

From the project root:

```bash
docker build -t internal-ai-chat:2.0 .
```

## Step 2 — Configure environment variables

Copy:

```text
.env.example
```

to your secret/environment manager. Never commit real credentials.

Required variables:

```text
PUBLIC_ORIGIN
DATABASE_URL
REDIS_URL
S3_ENDPOINT
S3_REGION
S3_BUCKET
S3_ACCESS_KEY
S3_SECRET_KEY
JWT_SECRET
ENCRYPTION_KEY
```

Recommended values:

```text
DATABASE_SSL=true
DATABASE_SSL_REJECT_UNAUTHORIZED=false
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
MAX_FILE_SIZE_MB=350
UPLOAD_PART_SIZE_MB=16
```

## Step 3 — Generate secrets

### JWT_SECRET

Use a long random secret. Example with OpenSSL:

```bash
openssl rand -base64 48
```

### ENCRYPTION_KEY

This MUST be exactly 64 hexadecimal characters:

```bash
openssl rand -hex 32
```

Do not change this key after provider API keys have been stored unless you intentionally perform key rotation.

## Step 4 — Start the web container

The web container runs:

```bash
node dist/server.js
```

Expose port `8080` unless your hosting provider injects another `PORT` value.

## Step 5 — Start the worker

Create a second service/container from the same image and run:

```bash
node dist/workers/file-processing.js
```

Both services use the same Aiven PostgreSQL, Aiven Valkey, and S3 environment variables.

## Step 6 — Health check

Open:

```text
https://YOUR-APP-DOMAIN/api/health
```

You need:

```json
{"ok":true,"database":"ok","redis":"ok"}
```

Do not proceed to registration until this endpoint is healthy.

## Step 7 — Create the first admin account

Open the application URL.

Click:

```text
Create account
```

Enter your own name, email, and password.

The first registered account automatically becomes:

```text
role = admin
```

There is no predefined admin password.

## Step 8 — Add an AI provider

After login:

```text
Admin → Provider administration
```

Add one of:

- OpenAI-compatible
- Anthropic
- Google Gemini

The API key is encrypted with AES-256-GCM before it is stored in PostgreSQL.

## Step 9 — Optional RAG embeddings

For file-based RAG, add an embedding-capable OpenAI-compatible provider and set its provider ID as:

```text
EMBEDDING_PROVIDER_ID
```

The default embedding model is:

```text
text-embedding-3-small
```

The database uses `vector(1536)` and cosine similarity.

## Step 10 — File storage

Files are NOT stored on the application container filesystem.

Configure an S3-compatible bucket. Cloudflare R2 is recommended for this project.

Configure bucket CORS to allow your `PUBLIC_ORIGIN` for `PUT`, `GET`, `HEAD`, and `OPTIONS`, and expose the `ETag` header.

See `s3-cors.example.json`.

## Troubleshooting

### `ENCRYPTION_KEY must be exactly 64 hex characters`

Generate it with:

```bash
openssl rand -hex 32
```

### `Request failed` during registration

Open `/api/health` first. If the database is not healthy, fix `DATABASE_URL`/SSL first.

The application automatically initializes `database/schema.sql` before accepting traffic.

### Redis/Valkey connection error

If your Aiven URI starts with:

```text
valkeys://
```

keep it exactly that way. The application normalizes it internally for ioredis.

### Build error about `pptx2json`

This project intentionally does NOT use `pptx2json`. PowerPoint `.pptx` text extraction is handled directly from slide XML using the existing ZIP parser.

### `unzip: not found`

This project no longer calls the system `unzip` command. ZIP extraction uses the Node package `unzipper`, so Alpine containers do not need an OS-level unzip binary.
