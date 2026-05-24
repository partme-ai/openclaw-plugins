#!/usr/bin/env node
/**
 * Static server for test-web UI (default :8090).
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.TEST_WEB_PORT ?? 8090);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

createServer(async (req, res) => {
  const path = req.url?.split("?")[0] ?? "/";
  const file = path === "/" ? "/index.html" : path;
  try {
    const data = await readFile(join(root, file));
    const ext = file.slice(file.lastIndexOf("."));
    res.writeHead(200, { "Content-Type": mime[ext] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`[test-web] http://127.0.0.1:${port}/`);
});
