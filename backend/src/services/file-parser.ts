import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { downloadObject } from "./storage.js";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import * as tar from "tar";
import unzipper from "unzipper";

const textExt = new Set([
  "txt", "md", "markdown", "csv", "json", "xml", "yaml", "yml",
  "js", "jsx", "ts", "tsx", "py", "java", "go", "rs", "php",
  "html", "css", "sql", "sh", "env", "toml", "ini", "conf", "log"
]);
const ignored = /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|vendor)(\/|$)/i;
const MAX_EXTRACTED = 1024 * 1024 * 1024;
const MAX_FILES = 20000;

function safeName(name: string) {
  return path.basename(name).replace(/[^\w.\- ]+/g, "_").slice(0, 200);
}

function safeArchivePath(name: string) {
  const normalized = name.replaceAll("\\", "/");
  if (path.isAbsolute(normalized)) return false;
  const parts = normalized.split("/");
  return !parts.some((part) => part === ".." || part === "");
}

async function collectFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!ignored.test(p)) await walk(p);
      } else if (e.isFile() && !ignored.test(p)) {
        out.push(p);
      }
      if (out.length > MAX_FILES) throw new Error("Archive contains too many files");
    }
  };
  await walk(dir);
  return out;
}

function chunks(text: string, size = 6000, overlap = 500) {
  const result: string[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + size);
    result.push(text.slice(i, end));
    if (end === text.length) break;
    i = Math.max(0, end - overlap);
  }
  return result;
}


function decodeXml(text: string) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function extractPptx(target: string, originalName: string) {
  const directory = await unzipper.Open.file(target);
  const slides = directory.files
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.path))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  if (!slides.length) throw new Error("No PowerPoint slide content found");
  return slides.map(async (entry, index) => {
    const xml = (await entry.buffer()).toString("utf8");
    const text = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi)]
      .map((match) => decodeXml(match[1]))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return { path: `${originalName}::slide-${index + 1}`, content: text };
  });
}

async function extractZip(target: string, extract: string) {
  await fs.mkdir(extract, { recursive: true });
  const directory = await unzipper.Open.file(target);
  let total = 0;
  let files = 0;

  for (const entry of directory.files) {
    if (files++ > MAX_FILES) throw new Error("Archive contains too many files");
    if (!safeArchivePath(entry.path)) throw new Error("Archive contains an unsafe path");
    if (entry.type === "Directory") continue;

    const output = path.resolve(extract, entry.path);
    const root = path.resolve(extract) + path.sep;
    if (!output.startsWith(root)) throw new Error("Archive contains an unsafe path");

    const declaredSize = Number(entry.vars?.uncompressedSize ?? 0);
    if (declaredSize > MAX_EXTRACTED || total + declaredSize > MAX_EXTRACTED) {
      throw new Error("Archive expands beyond safety limit");
    }
    const data = await entry.buffer();
    total += data.byteLength;
    if (total > MAX_EXTRACTED) throw new Error("Archive expands beyond safety limit");

    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, data);
  }
}

export async function parseStoredFile(storageKey: string, originalName: string) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "internal-ai-"));
  const target = path.join(tmp, safeName(originalName));

  try {
    const obj = await downloadObject(storageKey);
    if (!obj.Body) throw new Error("Stored object has no body");
    await pipeline(obj.Body as any, createWriteStream(target));

    const ext = path.extname(originalName).toLowerCase().slice(1);
    const outputs: { path: string; content: string }[] = [];

    if (textExt.has(ext)) {
      outputs.push({ path: originalName, content: await fs.readFile(target, "utf8") });
    } else if (ext === "pdf") {
      outputs.push({ path: originalName, content: (await pdfParse(await fs.readFile(target))).text });
    } else if (ext === "docx") {
      outputs.push({ path: originalName, content: (await mammoth.extractRawText({ path: target })).value });
    } else if (ext === "xlsx" || ext === "xls") {
      const wb = XLSX.read(await fs.readFile(target), { type: "buffer" });
      for (const sheet of wb.SheetNames) {
        outputs.push({
          path: `${originalName}::${sheet}`,
          content: XLSX.utils.sheet_to_csv(wb.Sheets[sheet])
        });
      }
    } else if (ext === "pptx") {
      outputs.push(...(await Promise.all(await extractPptx(target, originalName))));
    } else if (ext === "zip") {
      const extract = path.join(tmp, "extract");
      await extractZip(target, extract);
      for (const f of await collectFiles(extract)) {
        if (textExt.has(path.extname(f).slice(1).toLowerCase())) {
          outputs.push({ path: path.relative(extract, f), content: await fs.readFile(f, "utf8") });
        }
      }
    } else if (ext === "tar" || ext === "gz" || ext === "tgz") {
      const extract = path.join(tmp, "extract");
      await fs.mkdir(extract, { recursive: true });
      await tar.x({
        file: target,
        cwd: extract,
        filter: (p: string) => safeArchivePath(p)
      });
      for (const f of await collectFiles(extract)) {
        if (textExt.has(path.extname(f).slice(1).toLowerCase())) {
          outputs.push({ path: path.relative(extract, f), content: await fs.readFile(f, "utf8") });
        }
      }
    } else {
      throw new Error(`Unsupported file type: .${ext || "unknown"}`);
    }

    return outputs.flatMap((x) =>
      chunks(x.content).map((content, i) => ({
        path: x.path,
        chunkIndex: i,
        content,
        tokenCount: Math.ceil(content.length / 4)
      }))
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

export async function sha256Stored(storageKey: string) {
  const obj = await downloadObject(storageKey);
  if (!obj.Body) throw new Error("No body");
  const hash = crypto.createHash("sha256");
  for await (const chunk of obj.Body as any) hash.update(chunk);
  return hash.digest("hex");
}
