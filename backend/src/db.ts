import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const db = new Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.DB_POOL_MAX ?? 20),
  ssl: config.databaseSsl
    ? { rejectUnauthorized: config.databaseSslRejectUnauthorized }
    : undefined,
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
