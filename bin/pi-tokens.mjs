#!/usr/bin/env node
// pi-tokens CLI：启动本地 dashboard
import { startServer } from "../src/server.mjs";

function parseArgs(argv) {
  const args = { port: 0, open: true, sessionDir: undefined };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port" || a === "-p") {
      args.port = Number(argv[++i]);
    } else if (a === "--no-open") {
      args.open = false;
    } else if (a === "--session-dir") {
      args.sessionDir = argv[++i];
    } else if (a === "--help" || a === "-h") {
      args.help = true;
    } else if (a === "--version" || a === "-v") {
      args.version = true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`pi-tokens — visualize your pi coding agent token usage

Usage:
  pi-tokens [options]

Options:
  -p, --port <n>         server port (default: random)
  --no-open              don't open browser
  --session-dir <path>   pi sessions dir (default: ~/.pi/agent/sessions)
  -h, --help             show this help
  -v, --version          show version`);
    return;
  }
  if (args.version) {
    const pkg = await import("../package.json", { with: { type: "json" } }).catch(() => null);
    console.log(pkg?.default?.version || "unknown");
    return;
  }

  const { port } = await startServer({ port: args.port, sessionDir: args.sessionDir });
  const url = `http://127.0.0.1:${port}`;
  console.log(`\n🥧  pi-tokens running at ${url}`);
  console.log("   Press Ctrl+C to stop.\n");

  if (args.open) {
    try {
      const { default: open } = await import("open");
      await open(url);
    } catch {
      // open 是可选的，失败就提示用户手动打开
      console.log("   (couldn't auto-open browser — please open the URL manually)");
    }
  }
}

main().catch((err) => {
  console.error("pi-tokens failed:", err);
  process.exit(1);
});
