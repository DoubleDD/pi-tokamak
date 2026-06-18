/**
 * pi-tokamak Extension
 *
 * 注册 tokamak / tokamak_stats 工具，让 pi agent 直接调用，
 * 无需通过 skill → bash 的间接链路。
 */
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";

const PORT_FILE = "/tmp/tokamak.port";

/** 从持久化端口文件获取端口 */
function readPort(): number | null {
  try {
    const raw = fs.readFileSync(PORT_FILE, "utf8").trim();
    const p = parseInt(raw, 10);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

/** 保存端口到文件 */
function writePort(port: number): void {
  fs.writeFileSync(PORT_FILE, String(port));
}

/** HTTP 健康检查 */
function isAlive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/stats`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

/** 启动 tokamak 服务，返回端口 */
async function startServer(): Promise<number> {
  const TOKAMAK_BIN = "/Volumes/code/com.github/pi-token-stats/bin/tokamak.mjs";
  const TOKAMAK_NPM = "tokamak";

  // 优先用源码路径，fallback 到全局 npm 安装
  let bin = TOKAMAK_BIN;
  if (!fs.existsSync(bin)) {
    try {
      bin = execSync("which tokamak", { encoding: "utf8" }).trim();
    } catch {
      throw new Error("tokamak not found — install with: npm install -g pi-tokamak");
    }
  }

  return new Promise((resolve, reject) => {
    const child = spawn("node", [bin, "--port", "0", "--no-open"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("tokamak startup timed out"));
    }, 10000);

    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const m = output.match(/127\.0\.0\.1:(\d+)/);
      if (m) {
        const port = parseInt(m[1], 10);
        clearTimeout(timeout);
        // 写入端口文件，下次复用
        writePort(port);
        // 不杀子进程——让它持续运行，pi 会话结束后它自己会随终端关闭
        child.unref();
        resolve(port);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/** 获取或启动服务 */
async function ensureServer(): Promise<number> {
  // 1. 检查持久化的端口是否还活着
  const savedPort = readPort();
  if (savedPort && (await isAlive(savedPort))) {
    return savedPort;
  }
  // 2. 启动新服务
  return startServer();
}

/** 获取 /api/stats 数据 */
function fetchStats(port: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/api/stats`, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

/** 格式化摘要文本 */
function formatSummary(stats: any): string {
  const s = stats.summary;
  return [
    "🔥 pi-tokamak token 消耗",
    "━━━━━━━━━━━━━━━━━━━━━━",
    `总费用:    $${s.cost.toFixed(4)}`,
    `总 token:  ${(s.totalTokens / 1e6).toFixed(2)}M`,
    `input:     ${(s.input / 1e6).toFixed(2)}M`,
    `output:    ${(s.output / 1e6).toFixed(2)}M`,
    `会话数:    ${s.sessions}`,
    `消息数:    ${s.messages}`,
    `日期范围:  ${s.firstDate} → ${s.lastDate}`,
    "━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

export default function tokamakExtension(pi: ExtensionAPI): void {

  // Tool: tokamak — 启动 dashboard 并返回摘要
  pi.registerTool({
    name: "tokamak",
    label: "Tokamak Token Dashboard",
    description:
      "启动或复用 tokamak token 消耗 dashboard，返回一个 URL 和当前 token 统计摘要。" +
      "Use when asked to \"查看 token 用量\", \"token dashboard\", \"我花了多少 token\".",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate) {
      try {
        const port = await ensureServer();
        const stats = await fetchStats(port);
        const url = `http://127.0.0.1:${port}`;
        const summary = formatSummary(stats);

        return {
          content: [
            {
              type: "text",
              text: [
                `Dashboard: ${url}`,
                "",
                summary,
              ].join("\n"),
            },
          ],
          details: { port, url, stats },
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `tokamak 启动失败: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  });

  // Tool: tokamak_stats — 仅返回统计，不打开 dashboard
  pi.registerTool({
    name: "tokamak_stats",
    label: "Tokamak Token Stats",
    description:
      "返回 pi coding agent 的 token 消耗摘要（费用、token 数、会话数等），" +
      "不打开浏览器 dashboard。Use for quick stats queries.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate) {
      try {
        const port = await ensureServer();
        const stats = await fetchStats(port);
        return {
          content: [{ type: "text", text: formatSummary(stats) }],
          details: { stats },
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `tokamak 查询失败: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  });

  // Slash command: /tokamak — 手动打开 dashboard
  pi.registerCommand("tokamak", {
    description: "打开 tokamak token 消耗 dashboard",
    handler: async (_args, ctx) => {
      try {
        const port = await ensureServer();
        const url = `http://127.0.0.1:${port}`;
        execSync(`open "${url}"`);
        ctx.ui.notify(`tokamak dashboard: ${url}`, "info");
      } catch (err) {
        ctx.ui.notify(
          `tokamak 启动失败: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    },
  });

  // Slash command: /tokamak-stop — 关停 tokamak 服务
  pi.registerCommand("tokamak-stop", {
    description: "关停 tokamak 服务并释放端口",
    handler: async (_args, ctx) => {
      try {
        const port = readPort();
        if (port) {
          try { execSync(`lsof -ti:${port} | xargs kill`, { stdio: "ignore" }); } catch {}
          fs.unlinkSync(PORT_FILE);
          ctx.ui.notify(`tokamak 已关停 (port ${port})`, "info");
        } else {
          try { execSync("pkill -f tokamak.mjs", { stdio: "ignore" }); } catch {}
          ctx.ui.notify("tokamak 已关停", "info");
        }
      } catch (err) {
        ctx.ui.notify(
          `关停失败: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    },
  });
  // Slash command: /tokamak-stats — 在 pi 内快速查询统计
  pi.registerCommand("tokamak-stats", {
    description: "快速查看 token 消耗摘要（不打开浏览器）",
    handler: async (_args, ctx) => {
      try {
        const port = await ensureServer();
        const stats = await fetchStats(port);
        ctx.ui.notify(formatSummary(stats), "info");
      } catch (err) {
        ctx.ui.notify(
          `查询失败: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    },
  });

  // Tool: tokamak_stop — Agent 可调用的关停工具
  // Tool: tokamak_stop — Agent 可调用的关停工具
  pi.registerTool({
    name: "tokamak_stop",
    label: "Stop Tokamak Server",
    description: "关停 tokamak 服务并释放占用的端口",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate) {
      try {
        const port = readPort();
        if (port) {
          try { execSync(`lsof -ti:${port} | xargs kill`, { stdio: "ignore" }); } catch {}
          fs.unlinkSync(PORT_FILE);
          const alive = await isAlive(port);
          return { content: [{ type: "text", text: alive ? `kill 发送成功，但进程仍在运行 (port ${port})` : `tokamak 已关停 (was port ${port})` }] };
        }
        try { execSync("pkill -f tokamak.mjs", { stdio: "ignore" }); } catch {}
        return { content: [{ type: "text", text: "tokamak 已关停" }] };
      } catch (err) {
        return { content: [{ type: "text", text: `关停失败: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  });
}
