import { Worker } from "bullmq";
import { db } from "../db.js";
import { redis } from "../redis.js";
import { initializeDatabase } from "../db-init.js";
import { parseStoredFile } from "../services/file-parser.js";
import { getProvider } from "../providers/registry.js";

async function startWorker() {
  await initializeDatabase();

  const worker = new Worker(
    "file-processing",
    async (job) => {
      const file = (
        await db.query("SELECT * FROM files WHERE id=$1", [job.data.fileId])
      ).rows[0];

      if (!file) return;

      try {
        await db.query(
          "UPDATE files SET status='processing',processing_error=NULL WHERE id=$1",
          [file.id]
        );

        const chunks = await parseStoredFile(file.storage_key, file.original_name);
        if (!chunks.length) throw new Error("No supported text content was extracted");

        const providerId = process.env.EMBEDDING_PROVIDER_ID;
        let embeddings: number[][] | null = null;

        if (providerId) {
          const provider = await getProvider(providerId);
          if (provider.createEmbeddings) {
            embeddings = await provider.createEmbeddings(chunks.map((x) => x.content));
          }
        }

        const c = await db.connect();
        try {
          await c.query("BEGIN");
          await c.query("DELETE FROM file_chunks WHERE file_id=$1", [file.id]);

          for (let i = 0; i < chunks.length; i++) {
            const x = chunks[i];
            const vector = embeddings?.[i];
            if (vector?.length === 1536) {
              await c.query(
                "INSERT INTO file_chunks(file_id,path,chunk_index,content,token_count,embedding) VALUES($1,$2,$3,$4,$5,$6)",
                [file.id, x.path, x.chunkIndex, x.content, x.tokenCount, `[${vector.join(",")}]`]
              );
            } else {
              await c.query(
                "INSERT INTO file_chunks(file_id,path,chunk_index,content,token_count) VALUES($1,$2,$3,$4,$5)",
                [file.id, x.path, x.chunkIndex, x.content, x.tokenCount]
              );
            }
          }

          await c.query("UPDATE files SET status='ready' WHERE id=$1", [file.id]);
          await c.query("COMMIT");
        } catch (error) {
          await c.query("ROLLBACK");
          throw error;
        } finally {
          c.release();
        }
      } catch (error) {
        await db.query(
          "UPDATE files SET status='failed',processing_error=$1 WHERE id=$2",
          [error instanceof Error ? error.message : "Processing failed", file.id]
        );
        throw error;
      }
    },
    { connection: redis, concurrency: 2 }
  );

  worker.on("completed", (job) => console.log("Processed", job.id));
  worker.on("failed", (job, error) => console.error("File processing failed", job?.id, error));
  console.log("File-processing worker started");
}

startWorker().catch((error) => {
  console.error("Worker startup failed:", error);
  process.exit(1);
});
