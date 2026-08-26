import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

const ssl =
  config.databaseSsl
    ? {
        // Aiven uses a managed TLS certificate. Setting this false is
        // required when the public CA chain is not available in the
        // container. Set DATABASE_SSL_REJECT_UNAUTHORIZED=true only when
        // you explicitly provide a trusted CA bundle.
        rejectUnauthorized: config.databaseSslRejectUnauthorized
      }
    : undefined;

export const db = new Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  ssl,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000
});

db.on("error", (error) => {
  console.error("PostgreSQL pool error:", error.message);
});

export async function checkDatabase() {
  await db.query("SELECT 1");
  return true;
}
