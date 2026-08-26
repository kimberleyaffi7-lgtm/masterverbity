# Deployment Fixes Included in v2

This fresh package incorporates the deployment problems encountered during the previous deployment cycle.

## Fixed

1. Removed invalid `pptx2json@^1.1.1` dependency.
2. Removed the malformed TypeScript regex that stopped `tsc`.
3. Corrected ioredis construction/import usage.
4. Normalized Express route parameters with `String(...)` where required.
5. Added a local TypeScript declaration for the legacy `pdf-parse` API.
6. Corrected the `tar` import and filter parameter typing.
7. Removed reliance on a system `unzip` executable that is not present in Alpine images.
8. Added safe ZIP/TAR path traversal and expansion limits.
9. Added PowerPoint `.pptx` text extraction without `pptx2json`.
10. Upgraded BullMQ and ioredis to current compatible major versions to remove the old cron-parser warning path.
11. Added Aiven Valkey `valkeys://` → `rediss://` normalization.
12. Added Aiven PostgreSQL TLS configuration.
13. Added automatic database schema initialization at application startup.
14. Added PostgreSQL/Valkey health checks.
15. Added a JSON API error handler so the frontend receives useful errors instead of a generic `Request failed` message.
16. Made first-admin registration race-safe with a PostgreSQL advisory transaction lock.
17. Removed Render/Railway-specific deployment configuration from the fresh package.
18. Added Aiven-specific setup and deployment walkthrough.
19. Added S3-compatible object-storage instructions and CORS example.
20. Kept API provider keys encrypted server-side with AES-256-GCM.

## Known architectural requirement

The application host is intentionally provider-neutral. Run the web service and the file-processing worker from the same Docker image on any Docker-compatible host. Aiven supplies PostgreSQL and Valkey; S3-compatible object storage supplies persistent uploaded files.
