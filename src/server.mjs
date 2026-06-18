// 极简 HTTP server：一个 /api/stats 接口 + 静态文件
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getStats } from "./aggregator.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function serveStatic(req, res) {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/index.html";
  // 避免路径穿越
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const fpath = path.join(PUBLIC_DIR, safe);
  if (!fpath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("forbidden");
  }
  try {
    const data = await fs.readFile(fpath);
    const ext = path.extname(fpath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

export function createServer({ sessionDir } = {}) {
  return http.createServer(async (req, res) => {
    try {
      if (req.url === "/api/stats" || req.url.startsWith("/api/stats?")) {
        const stats = await getStats(sessionDir);
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(stats));
        return;
      }
      await serveStatic(req, res);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`server error: ${err.message}`);
    }
  });
}

export function startServer({ port = 0, sessionDir } = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer({ sessionDir });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}
