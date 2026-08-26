import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { encrypt } from "../services/encryption.js";
import { getProvider } from "../providers/registry.js";
import { requireUser, requireAdmin } from "../auth.js";

const router = Router();

router.use(requireUser);

router.get("/", async (req, res) => {
  const r = await db.query(`
    SELECT
      p.id,
      p.name,
      p.provider_type,
      p.base_url,
      p.enabled,
      COALESCE(
        json_agg(
          json_build_object(
            'id', m.id,
            'model_id', m.model_id,
            'display_name', m.display_name,
            'enabled', m.enabled
          )
          ORDER BY m.display_name
        ) FILTER (WHERE m.id IS NOT NULL),
        '[]'
      ) models
    FROM ai_providers p
    LEFT JOIN ai_models m
      ON m.provider_id = p.id
    GROUP BY p.id
    ORDER BY p.name
  `);

  res.json({
    providers: r.rows
  });
});

router.post(
  "/admin/providers",
  requireAdmin,
  async (req, res) => {
    const p = z
      .object({
        name: z.string().min(1).max(100),
        providerType: z.enum([
          "openai-compatible",
          "anthropic",
          "gemini"
        ]),
        baseUrl: z.string().url().optional(),
        apiKey: z.string().min(1),
        models: z
          .array(
            z.object({
              modelId: z.string().min(1),
              displayName: z.string().min(1)
            })
          )
          .default([])
      })
      .parse(req.body);

    const c = await db.connect();

    try {
      await c.query("BEGIN");

      const r = await c.query(
        "INSERT INTO ai_providers(name,provider_type,base_url,encrypted_api_key,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,name,provider_type,base_url,enabled",
        [
          p.name,
          p.providerType,
          p.baseUrl || null,
          encrypt(p.apiKey),
          req.user!.id
        ]
      );

      for (const m of p.models) {
        await c.query(
          "INSERT INTO ai_models(provider_id,model_id,display_name) VALUES($1,$2,$3)",
          [
            r.rows[0].id,
            m.modelId,
            m.displayName
          ]
        );
      }

      await c.query("COMMIT");

      res.json({
        provider: r.rows[0]
      });
    } catch (e) {
      await c.query("ROLLBACK");

      res.status(400).json({
        error:
          e instanceof Error
            ? e.message
            : "Could not create provider"
      });
    } finally {
      c.release();
    }
  }
);

router.post(
  "/admin/providers/:id/test",
  requireAdmin,
  async (req, res) => {
    try {
      const providerId = String(req.params.id);

      res.json(
        await (
          await getProvider(providerId)
        ).testConnection()
      );
    } catch (e) {
      res.status(400).json({
        success: false,
        message:
          e instanceof Error
            ? e.message
            : "Test failed"
      });
    }
  }
);

router.post(
  "/admin/providers/:id/models",
  requireAdmin,
  async (req, res) => {
    const p = z
      .object({
        modelId: z.string().min(1),
        displayName: z.string().min(1)
      })
      .parse(req.body);

    const providerId = String(req.params.id);

    await db.query(
      "INSERT INTO ai_models(provider_id,model_id,display_name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [
        providerId,
        p.modelId,
        p.displayName
      ]
    );

    res.json({
      ok: true
    });
  }
);

router.delete(
  "/admin/providers/:id",
  requireAdmin,
  async (req, res) => {
    const providerId = String(req.params.id);

    await db.query(
      "DELETE FROM ai_providers WHERE id=$1",
      [providerId]
    );

    res.json({
      ok: true
    });
  }
);

export default router;
