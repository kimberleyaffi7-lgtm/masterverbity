import crypto from "node:crypto";
import { Router } from "express";
import path from "node:path";
import { z } from "zod";
import { db } from "../db.js";
import { requireUser } from "../auth.js";
import { config } from "../config.js";
import {
  startMultipart,
  partUrl,
  completeMultipart,
  abortMultipart,
  deleteObject
} from "../services/storage.js";
import { Queue } from "bullmq";
import { redis } from "../redis.js";

const router = Router();
router.use(requireUser);

const fileQueue = new Queue("file-processing", {
  connection: redis
});

router.post("/start", async (req, res) => {
  const p = z
    .object({
      fileName: z.string().min(1).max(500),
      fileSize: z.number().int().positive(),
      contentType: z.string().max(200).optional(),
      conversationId: z.string().uuid().optional()
    })
    .parse(req.body);

  if (p.fileSize > config.maxFileSize) {
    return res.status(413).json({
      error: `Maximum file size is ${config.maxFileSize / 1024 / 1024} MB`
    });
  }

  const safe = path
    .basename(p.fileName)
    .replace(/[^\w.\- ]+/g, "_")
    .slice(0, 200);

  const key = `users/${req.user!.id}/${crypto.randomUUID()}-${safe}`;

  const uploadId = await startMultipart(key, p.contentType);

  const r = await db.query(
    "INSERT INTO files(user_id,conversation_id,original_name,storage_key,mime_type,extension,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,original_name,size_bytes,status",
    [
      req.user!.id,
      p.conversationId || null,
      p.fileName,
      key,
      p.contentType || null,
      path.extname(p.fileName).slice(1).toLowerCase(),
      p.fileSize
    ]
  );

  res.json({
    fileId: r.rows[0].id,
    uploadId,
    storageKey: key,
    partSize: config.uploadPartSize,
    parts: Math.ceil(p.fileSize / config.uploadPartSize)
  });
});

router.post("/:fileId/part-url", async (req, res) => {
  const p = z
    .object({
      uploadId: z.string(),
      partNumber: z.number().int().min(1).max(10000)
    })
    .parse(req.body);

  const r = await db.query(
    "SELECT storage_key FROM files WHERE id=$1 AND user_id=$2",
    [req.params.fileId, req.user!.id]
  );

  if (!r.rows[0]) {
    return res.status(404).json({ error: "File not found" });
  }

  res.json({
    url: await partUrl(
      r.rows[0].storage_key,
      p.uploadId,
      p.partNumber
    )
  });
});

router.post("/:fileId/complete", async (req, res) => {
  const p = z
    .object({
      uploadId: z.string(),
      parts: z
        .array(
          z.object({
            PartNumber: z.number().int().min(1),
            ETag: z.string().min(1)
          })
        )
        .min(1)
    })
    .parse(req.body);

  const r = await db.query(
    "SELECT * FROM files WHERE id=$1 AND user_id=$2",
    [req.params.fileId, req.user!.id]
  );

  if (!r.rows[0]) {
    return res.status(404).json({ error: "File not found" });
  }

  try {
    await completeMultipart(
      r.rows[0].storage_key,
      p.uploadId,
      p.parts
    );

    await db.query(
      "UPDATE files SET status='uploaded' WHERE id=$1",
      [req.params.fileId]
    );

    await fileQueue.add(
      "process",
      { fileId: req.params.fileId },
      {
        removeOnComplete: 100,
        removeOnFail: 100
      }
    );

    res.json({ ok: true });
  } catch (e) {
    await abortMultipart(
      r.rows[0].storage_key,
      p.uploadId
    ).catch(() => {});

    await db.query(
      "UPDATE files SET status='failed',processing_error=$1 WHERE id=$2",
      [
        e instanceof Error ? e.message : "Upload failed",
        req.params.fileId
      ]
    );

    res.status(400).json({
      error: "Upload completion failed"
    });
  }
});

router.get("/:fileId/status", async (req, res) => {
  const r = await db.query(
    "SELECT id,original_name,size_bytes,status,processing_error FROM files WHERE id=$1 AND user_id=$2",
    [req.params.fileId, req.user!.id]
  );

  if (!r.rows[0]) {
    return res.status(404).json({
      error: "File not found"
    });
  }

  res.json({
    file: r.rows[0]
  });
});

router.delete("/:fileId", async (req, res) => {
  const r = await db.query(
    "SELECT storage_key FROM files WHERE id=$1 AND user_id=$2",
    [req.params.fileId, req.user!.id]
  );

  if (!r.rows[0]) {
    return res.status(404).json({
      error: "File not found"
    });
  }

  await deleteObject(r.rows[0].storage_key).catch(() => {});

  await db.query(
    "DELETE FROM files WHERE id=$1",
    [req.params.fileId]
  );

  res.json({ ok: true });
});

export default router;
