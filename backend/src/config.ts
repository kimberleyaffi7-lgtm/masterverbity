import "dotenv/config";

function required(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function normalizeRedisUrl(raw: string) {
  return raw
    .replace(/^valkeys:\/\//i, "rediss://")
    .replace(/^valkey:\/\//i, "redis://");
}

const cookieSameSite = (process.env.COOKIE_SAME_SITE ?? "lax") as
  | "lax"
  | "strict"
  | "none";

const cookieSecure = process.env.COOKIE_SECURE === "true";

if (cookieSameSite === "none" && !cookieSecure) {
  throw new Error("COOKIE_SAME_SITE=none requires COOKIE_SECURE=true");
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  publicOrigin: required("PUBLIC_ORIGIN", "http://localhost:8080"),
  databaseUrl: required("DATABASE_URL"),
  databaseSsl: process.env.DATABASE_SSL !== "false",
  databaseSslRejectUnauthorized:
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true",
  redisUrl: normalizeRedisUrl(required("REDIS_URL")),
  s3Endpoint: required("S3_ENDPOINT"),
  s3Region: required("S3_REGION", "auto"),
  s3Bucket: required("S3_BUCKET"),
  s3AccessKey: required("S3_ACCESS_KEY"),
  s3SecretKey: required("S3_SECRET_KEY"),
  jwtSecret: required("JWT_SECRET"),
  encryptionKey: required("ENCRYPTION_KEY"),
  maxFileSize:
    Number(process.env.MAX_FILE_SIZE_MB ?? 350) * 1024 * 1024,
  cookieSecure,
  cookieSameSite,
  uploadPartSize:
    Number(process.env.UPLOAD_PART_SIZE_MB ?? 16) * 1024 * 1024,
  dbPoolMax: Number(process.env.DB_POOL_MAX ?? 20)
};

if (
  !Number.isInteger(config.port) ||
  config.port < 1 ||
  config.port > 65535
) {
  throw new Error("PORT must be a valid TCP port");
}

if (
  !Number.isInteger(config.maxFileSize) ||
  config.maxFileSize <= 0
) {
  throw new Error("MAX_FILE_SIZE_MB must be greater than zero");
}

if (
  !Number.isInteger(config.uploadPartSize) ||
  config.uploadPartSize < 5 * 1024 * 1024
) {
  throw new Error("UPLOAD_PART_SIZE_MB must be at least 5 MB");
}
