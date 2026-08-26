import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireUser } from "../auth.js";
import { getProvider } from "../providers/registry.js";
import { retrieveRelevant } from "../services/retrieval.js";

const router = Router();

router.use(requireUser);

type FlushableResponse = {
  flush?: () => void;
};

function writeSSE(
  res: FlushableResponse & {
    writableEnded: boolean;
    destroyed?: boolean;
    write: (chunk: string) => boolean;
  },
  data: Record<string, unknown>
): boolean {
  if (res.writableEnded || res.destroyed) {
    return false;
  }

  try {
    res.write(
      `data: ${JSON.stringify(data)}\n\n`
    );

    const flush = res.flush;
    if (typeof flush === "function") {
      flush.call(res);
    }

    return true;
  } catch {
    return false;
  }
}

router.get("/", async (req, res) => {
  const r = await db.query(
    `
      SELECT id, title, created_at, updated_at
      FROM conversations
      WHERE user_id=$1
      ORDER BY updated_at DESC
    `,
    [req.user!.id]
  );

  res.json({
    conversations: r.rows,
  });
});

router.post("/", async (req, res) => {
  const r = await db.query(
    `
      INSERT INTO conversations(user_id,title)
      VALUES($1,'New chat')
      RETURNING *
    `,
    [req.user!.id]
  );

  res.json({
    conversation: r.rows[0],
  });
});

router.get("/:id", async (req, res) => {
  const c = await db.query(
    `
      SELECT *
      FROM conversations
      WHERE id=$1 AND user_id=$2
    `,
    [req.params.id, req.user!.id]
  );

  if (!c.rows[0]) {
    return res.status(404).json({
      error: "Conversation not found",
    });
  }

  const m = await db.query(
    `
      SELECT
        id,
        role,
        content,
        metadata,
        created_at
      FROM messages
      WHERE conversation_id=$1
      ORDER BY created_at
    `,
    [req.params.id]
  );

  const f = await db.query(
    `
      SELECT
        id,
        original_name,
        size_bytes,
        status
      FROM files
      WHERE conversation_id=$1
      ORDER BY created_at DESC
    `,
    [req.params.id]
  );

  res.json({
    conversation: c.rows[0],
    messages: m.rows,
    files: f.rows,
  });
});

router.delete("/:id", async (req, res) => {
  await db.query(
    `
      DELETE FROM conversations
      WHERE id=$1 AND user_id=$2
    `,
    [req.params.id, req.user!.id]
  );

  res.json({
    ok: true,
  });
});

router.post("/:id/messages", async (req, res) => {
  const body = z
    .object({
      content: z.string().min(1).max(100000),
      providerId: z.string().uuid(),
      modelId: z.string().uuid(),
    })
    .parse(req.body);

  const c = await db.query(
    `
      SELECT *
      FROM conversations
      WHERE id=$1 AND user_id=$2
    `,
    [req.params.id, req.user!.id]
  );

  if (!c.rows[0]) {
    return res.status(404).json({
      error: "Conversation not found",
    });
  }

  const model = await db.query(
    `
      SELECT model_id
      FROM ai_models
      WHERE id=$1
        AND provider_id=$2
        AND enabled=true
    `,
    [body.modelId, body.providerId]
  );

  if (!model.rows[0]) {
    return res.status(400).json({
      error: "Model not found or disabled",
    });
  }

  await db.query(
    `
      INSERT INTO messages(
        conversation_id,
        role,
        content
      )
      VALUES($1,'user',$2)
    `,
    [req.params.id, body.content]
  );

  const history = await db.query(
    `
      SELECT role, content
      FROM messages
      WHERE conversation_id=$1
      ORDER BY created_at DESC
      LIMIT 30
    `,
    [req.params.id]
  );

  const fileRows = await db.query(
    `
      SELECT id
      FROM files
      WHERE conversation_id=$1
        AND user_id=$2
        AND status='ready'
    `,
    [req.params.id, req.user!.id]
  );

  const context = await retrieveRelevant(
    fileRows.rows.map((x) => x.id),
    body.content
  );

  const system = `
You are the internal team AI assistant.

Be accurate, useful and concise.

When file context is supplied, cite it using:
[filename:path#chunk]

Never invent citations.

FILE CONTEXT:

${context
  .map(
    (x) =>
      `[${x.original_name}:${x.path}#${x.chunk_index}]
${x.content}`
  )
  .join("\n\n")}
`;

  const messages = [
    {
      role: "system" as const,
      content: system,
    },
    ...history.rows.reverse().map((x) => ({
      role: x.role as
        | "user"
        | "assistant"
        | "system",
      content: x.content,
    })),
  ];

  let provider;

  try {
    provider = await getProvider(body.providerId);
  } catch (error) {
    return res.status(400).json({
      error:
        error instanceof Error
          ? error.message
          : "Unable to load AI provider",
    });
  }

  res.status(200);

  res.setHeader(
    "Content-Type",
    "text/event-stream; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "no-cache, no-transform"
  );

  res.setHeader(
    "Connection",
    "keep-alive"
  );

  res.setHeader(
    "X-Accel-Buffering",
    "no"
  );

  res.setHeader(
    "X-Content-Type-Options",
    "nosniff"
  );

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  if (res.socket) {
    res.socket.setNoDelay(true);
    res.socket.setKeepAlive(true);
  }

  const abortController = new AbortController();

  let clientDisconnected = false;
  let completed = false;

  const abortUpstream = () => {
    if (completed) {
      return;
    }

    clientDisconnected = true;

    if (!abortController.signal.aborted) {
      abortController.abort(
        new DOMException(
          "Client disconnected",
          "AbortError"
        )
      );
    }
  };

  req.on("aborted", abortUpstream);

  res.on("close", () => {
    if (!completed) {
      abortUpstream();
    }
  });

  writeSSE(res, {
    status: "connecting",
    message: "Connecting to AI provider…",
  });

  const heartbeat = setInterval(() => {
    if (
      completed ||
      clientDisconnected ||
      res.writableEnded
    ) {
      return;
    }

    try {
      res.write(": heartbeat\n\n");

      const flush =
        (res as unknown as FlushableResponse).flush;

      if (typeof flush === "function") {
        flush.call(res);
      }
    } catch {
      abortUpstream();
    }
  }, 10000);

  let full = "";

  try {
    writeSSE(res, {
      status: "generating",
      message:
        "AI is generating a response…",
    });

    for await (const token of provider.streamChat({
      model: model.rows[0].model_id,
      messages,
      temperature: 0.3,
      signal: abortController.signal,
    })) {
      if (
        clientDisconnected ||
        abortController.signal.aborted
      ) {
        break;
      }

      full += token;

      if (
        !writeSSE(res, {
          token,
        })
      ) {
        abortUpstream();
        break;
      }
    }

    if (
      clientDisconnected ||
      abortController.signal.aborted
    ) {
      return;
    }

    if (full.trim()) {
      await db.query(
        `
          INSERT INTO messages(
            conversation_id,
            role,
            content
          )
          VALUES($1,'assistant',$2)
        `,
        [req.params.id, full]
      );
    }

    await db.query(
      `
        UPDATE conversations
        SET
          updated_at=now(),
          provider_id=$1,
          model_id=$2,
          title=
            CASE
              WHEN title='New chat'
              THEN LEFT($3,80)
              ELSE title
            END
        WHERE id=$4
      `,
      [
        body.providerId,
        body.modelId,
        body.content,
        req.params.id,
      ]
    );

    completed = true;

    writeSSE(res, {
      done: true,
    });

    res.end();
  } catch (error) {
    if (
      clientDisconnected ||
      abortController.signal.aborted
    ) {
      return;
    }

    const message =
      error instanceof Error
        ? error.message
        : "AI generation failed.";

    writeSSE(res, {
      error: message,
    });

    completed = true;

    res.end();
  } finally {
    clearInterval(heartbeat);

    req.off(
      "aborted",
      abortUpstream
    );
  }
});

export default router;
