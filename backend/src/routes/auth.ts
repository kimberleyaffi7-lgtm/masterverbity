import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { hashPassword, verifyPassword, setSession, clearSession, requireUser } from "../auth.js";

const router = Router();
const credentials = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(100).optional()
});

router.post("/register", async (req, res) => {
  const p = credentials.parse(req.body);
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    // Serialize first-account creation so two simultaneous signups cannot both become admin.
    await client.query("SELECT pg_advisory_xact_lock($1)", [20260826]);
    const count = Number((await client.query("SELECT count(*)::int AS n FROM users")).rows[0].n);
    const role = count === 0 ? "admin" : "member";
    const hash = await hashPassword(p.password);
    const r = await client.query(
      "INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,email,name,role",
      [p.email.toLowerCase(), p.name || p.email.split("@")[0], hash, role]
    );
    await client.query("COMMIT");
    setSession(res, r.rows[0]);
    res.status(201).json({ user: r.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if ((error as { code?: string })?.code === "23505") {
      return res.status(409).json({ error: "Email already registered" });
    }
    throw error;
  } finally {
    client.release();
  }
});

router.post("/login", async (req, res) => {
  const p = credentials.pick({ email: true, password: true }).parse(req.body);
  const r = await db.query(
    "SELECT id,email,name,role,password_hash FROM users WHERE email=$1",
    [p.email.toLowerCase()]
  );
  if (!r.rows[0] || !(await verifyPassword(p.password, r.rows[0].password_hash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const { password_hash: _passwordHash, ...user } = r.rows[0];
  setSession(res, user);
  res.json({ user });
});

router.post("/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get("/me", requireUser, (req, res) => {
  res.json({ user: req.user });
});

export default router;
