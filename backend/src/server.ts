import express, { type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import auth from "./routes/auth.js";
import chats from "./routes/chats.js";
import files from "./routes/files.js";
import providers from "./routes/providers.js";
import admin from "./routes/admin.js";
import { config } from "./config.js";
import { checkDatabase } from "./db.js";
import { checkRedis } from "./redis.js";
import { initializeDatabase } from "./db-init.js";
import { ZodError } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, "../../frontend");
const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: false
  })
);
app.use(cors({ origin: config.publicOrigin, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.get("/api/health", async (_req, res) => {
  try {
    await checkDatabase();
    await checkRedis();
    res.json({ ok: true, database: "ok", redis: "ok" });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : "Dependency check failed"
    });
  }
});

app.use("/api/auth", auth);
app.use("/api/conversations", chats);
app.use("/api/uploads", files);
app.use("/api/providers", providers);
app.use("/api/admin", admin);

app.use(express.static(frontendDir, { extensions: ["html"] }));
app.get("/{*splat}", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API route not found" });
  }
  res.sendFile(path.join(frontendDir, "index.html"));
});

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error(error);
  if (res.headersSent) return;
  const status = error instanceof ZodError ? 400 : Number(error?.statusCode ?? error?.status ?? 500);
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: error instanceof ZodError ? "Invalid request" : error instanceof Error ? error.message : "Internal server error",
    details: error instanceof ZodError ? error.issues.map((issue) => ({ path: issue.path, message: issue.message })) : undefined
  });
};
app.use(errorHandler);

async function start() {
  await initializeDatabase();
  await checkDatabase();
  await checkRedis();
  app.listen(config.port, () => {
    console.log(`Internal AI Chat listening on port ${config.port}`);
  });
}

start().catch((error) => {
  console.error("Startup failed:", error);
  process.exit(1);
});
