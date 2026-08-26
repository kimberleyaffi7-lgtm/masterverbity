import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { db } from "./db.js";
import { config } from "./config.js";

export type AuthUser = { id: string; email: string; name: string; role: "admin" | "member" };

declare global {
  namespace Express { interface Request { user?: AuthUser } }
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}
export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}
export function setSession(res: Response, user: AuthUser) {
  const token = jwt.sign(user, config.jwtSecret, { expiresIn: "7d" });
  res.cookie("session", token, {
    httpOnly: true, secure: config.cookieSecure,
    sameSite: config.cookieSameSite, maxAge: 7 * 86400000, path: "/"
  });
}
export function clearSession(res: Response) {
  res.clearCookie("session", { path: "/" });
}
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.session;
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const user = jwt.verify(token, config.jwtSecret) as AuthUser;
    const result = await db.query("SELECT id,email,name,role FROM users WHERE id=$1", [user.id]);
    if (!result.rows[0]) return res.status(401).json({ error: "Session expired" });
    req.user = result.rows[0];
    next();
  } catch {
    return res.status(401).json({ error: "Invalid session" });
  }
}
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
}
