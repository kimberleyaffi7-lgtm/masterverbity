import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(here, "../../database/schema.sql");

export async function initializeDatabase() {
  const schema = await fs.readFile(schemaPath, "utf8");
  await db.query(schema);
  await db.query("SELECT 1 FROM users LIMIT 1");
  console.log("Database schema verified/initialized");
}
