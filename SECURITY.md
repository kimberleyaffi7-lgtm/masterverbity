# Security

## Secrets

Never commit:

- Aiven PostgreSQL passwords
- Aiven Valkey passwords
- S3/R2 access keys
- AI provider API keys
- JWT_SECRET
- ENCRYPTION_KEY

## Provider API keys

Provider keys are encrypted with AES-256-GCM using `ENCRYPTION_KEY` before storage.

The browser never receives the plaintext provider API key.

## Encryption key

`ENCRYPTION_KEY` must be exactly 32 bytes represented as 64 hexadecimal characters.

Generate it with:

```bash
openssl rand -hex 32
```

Keep a secure backup. Losing this key makes previously encrypted provider credentials undecryptable.

## Authentication

- Passwords are hashed with bcrypt.
- Sessions use signed JWTs in HTTP-only cookies.
- The first account is admin.
- Later accounts are members.
- First-account creation is serialized with a PostgreSQL advisory transaction lock.

## Database

Aiven PostgreSQL should use TLS.

For the simplest setup, the project accepts Aiven's `sslmode=require` connection URI and also enables PostgreSQL TLS at the client level.

For stricter certificate verification, provide the appropriate Aiven CA and set `DATABASE_SSL_REJECT_UNAUTHORIZED=true`.

## Valkey

Aiven Valkey uses TLS by default. Keep the `valkeys://` Service URI and do not disable TLS for production.

## Files

Uploaded files are stored in S3-compatible object storage, not the application container filesystem.

Uploads use multipart presigned URLs. Configure bucket CORS to your exact application origin and expose `ETag`.

## Archive safety

ZIP/TAR extraction has:

- path traversal protection
- file count limits
- expanded-size limits
- symlink avoidance

ZIP extraction is performed by a Node library rather than an OS command, so deployment does not depend on an `unzip` binary.
