#!/usr/bin/env node

/**
 * pi-release-notes — 分析 pi agent 最新版本更新内容
 *
 * 用法:
 *   node scripts/release-notes.mjs          # 显示最新版本更新
 *   node scripts/release-notes.mjs --all    # 显示最近 3 个版本
 *   node scripts/release-notes.mjs 0.79.7   # 显示指定版本
 *
 * 数据源: pi agent 全局安装路径下的 CHANGELOG.md
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

// ─── 定位 pi agent 的 CHANGELOG ──────────────────────────────────

function findChangelog() {
  // 优先级: 环境变量 > bun global > npm global > pnpm global
  if (process.env.PI_CHANGELOG && existsSync(process.env.PI_CHANGELOG)) {
    return process.env.PI_CHANGELOG;
  }

  const candidates = [
    join(homedir(), ".bun/install/global/node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md"),
    join(homedir(), ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md"),
    join(homedir(), ".local/share/pnpm/global/5/node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md"),
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  // 兜底: 用 npm root -g 查找
  try {
    const root = execSync("npm root -g", { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    const p = join(root, "@earendil-works/pi-coding-agent/CHANGELOG.md");
    if (existsSync(p)) return p;
  } catch { /* ignore */ }

  // bun pm ls 查找
  try {
    const globalDir = execSync("bun pm ls -g", { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    // 从输出中提取路径
  } catch { /* ignore */ }

  return null;
}

// ─── 解析 CHANGELOG ─────────────────────────────────────────────

/**
 * 解析 CHANGELOG.md，返回版本数组
 * 每个版本: { version, date, sections: { title, items[] } }
 */
function parseChangelog(text) {
  const versions = [];
  const lines = text.split("\n");
  let currentVersion = null;
  let currentSection = null;

  for (const line of lines) {
    // ## [0.79.8] - 2026-06-19
    const versionMatch = line.match(/^##\s+\[([^\]]+)\]\s*-\s*(.+)$/);
    if (versionMatch) {
      if (currentVersion) versions.push(currentVersion);
      currentVersion = { version: versionMatch[1], date: versionMatch[2].trim(), sections: [] };
      currentSection = null;
      continue;
    }

    if (!currentVersion) continue;

    // ### New Features / ### Added / ### Changed / ### Fixed
    const sectionMatch = line.match(/^###\s+(.+)$/);
    if (sectionMatch) {
      currentSection = { title: sectionMatch[1].trim(), items: [] };
      currentVersion.sections.push(currentSection);
      continue;
    }

    if (currentSection && line.startsWith("- ")) {
      currentSection.items.push(line.slice(2).trim());
      continue;
    }
  }

  if (currentVersion) versions.push(currentVersion);
  return versions;
}

// ─── 格式化输出 ─────────────────────────────────────────────────

const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const MAGENTA = "\x1b[35m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function colorBySection(title, text) {
  const t = title.toLowerCase();
  if (t.includes("feature")) return GREEN + text + RESET;
  if (t.includes("added")) return CYAN + text + RESET;
  if (t.includes("changed")) return YELLOW + text + RESET;
  if (t.includes("fixed")) return RED + text + RESET;
  if (t.includes("deprecated") || t.includes("removed")) return DIM + text + RESET;
  return text;
}

function formatVersion(ver) {
  let out = "";
  out += `${BOLD}${MAGENTA}╔══════════════════════════════════════════════════════╗${RESET}\n`;
  out += `${BOLD}${MAGENTA}║${RESET}  ${BOLD}pi agent v${ver.version}${RESET}  ${DIM}(${ver.date})${RESET}\n`;
  out += `${BOLD}${MAGENTA}╚══════════════════════════════════════════════════════╝${RESET}\n`;

  const stats = ver.sections.map(s => `${s.title}: ${s.items.length}`).join("  ");
  out += `${DIM}📊 ${stats}${RESET}\n\n`;

  for (const section of ver.sections) {
    out += `${BOLD}${colorBySection(section.title, "▸ " + section.title)}${RESET}\n`;
    for (const item of section.items) {
      // 清理 GitHub issue/PR 引用，保留描述
      const cleaned = item.replace(/\s*\(\[#\d+\].*?\)\s*$/, "");
      out += `  ${DIM}•${RESET} ${cleaned}\n`;
    }
    out += "\n";
  }

  return out;
}

function formatCompact(ver) {
  let out = "";
  out += `${BOLD}pi agent v${ver.version}${RESET} ${DIM}(${ver.date})${RESET}\n\n`;

  for (const section of ver.sections) {
    out += `  ${colorBySection(section.title, section.title)} (${section.items.length})\n`;
    for (const item of section.items.slice(0, 5)) {
      const cleaned = item.replace(/\s*\(\[#\d+\].*?\)\s*$/, "");
      out += `    ${cleaned.slice(0, 100)}${cleaned.length > 100 ? "…" : ""}\n`;
    }
    if (section.items.length > 5) {
      out += `    ${DIM}… 还有 ${section.items.length - 5} 项${RESET}\n`;
    }
    out += "\n";
  }
  return out;
}

// ─── 获取当前 pi 版本 ──────────────────────────────────────────

function getPiVersion() {
  try {
    return execSync("pi --version", { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

// ─── 主流程 ─────────────────────────────────────────────────────

const args = process.argv.slice(2);
const changelogPath = findChangelog();

if (!changelogPath) {
  console.error(`${RED}❌ 找不到 pi agent 的 CHANGELOG.md${RESET}`);
  console.error("   请设置环境变量 PI_CHANGELOG 指定路径");
  process.exit(1);
}

const text = readFileSync(changelogPath, "utf8");
const versions = parseChangelog(text);

if (versions.length === 0) {
  console.error(`${RED}❌ 无法解析 CHANGELOG${RESET}`);
  process.exit(1);
}

const currentPiVersion = getPiVersion();

// 头部
console.log(`${BOLD}${CYAN}╭──────────────────────────────────────────────╮${RESET}`);
console.log(`${BOLD}${CYAN}│${RESET}  ${BOLD}pi agent Release Notes${RESET}  ${DIM}当前: v${currentPiVersion}${RESET}`);
console.log(`${BOLD}${CYAN}│${RESET}  ${DIM}数据源: ${changelogPath}${RESET}`);
console.log(`${BOLD}${CYAN}╰──────────────────────────────────────────────╯${RESET}\n`);

if (args.includes("--all") || args.includes("-a")) {
  // 显示最近 3 个版本
  for (const ver of versions.slice(0, 3)) {
    console.log(formatCompact(ver));
    console.log(`${DIM}───${RESET}\n`);
  }
} else if (args[0] && /^\d/.test(args[0])) {
  // 显示指定版本
  const target = versions.find(v => v.version === args[0]);
  if (target) {
    console.log(formatVersion(target));
  } else {
    console.error(`${YELLOW}⚠ 未找到版本 ${args[0]}${RESET}`);
    console.log(`${DIM}可用的版本: ${versions.map(v => v.version).slice(0, 10).join(", ")}${RESET}`);
  }
} else {
  // 默认: 显示最新版本
  console.log(formatVersion(versions[0]));
  console.log(`${DIM}💡 提示: 使用 --all 查看最近 3 个版本，或指定版本号查看特定版本${RESET}\n`);
}
