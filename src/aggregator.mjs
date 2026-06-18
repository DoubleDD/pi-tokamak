// JSONL 扫描 + token 用量聚合
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULT_SESSION_DIR = path.join(os.homedir(), ".pi", "agent", "sessions");

/**
 * 把 session 目录名（如 "--Volumes-code-com.github-foo--"）反编码成可读的项目名。
 * pi 用 `--` 包裹路径，并把 `/` 替换成 `-`。
 */
function decodeProjectName(dirName) {
  let s = dirName;
  if (s.startsWith("--")) s = s.slice(2);
  if (s.endsWith("--")) s = s.slice(0, -2);
  // 注意：路径中的 `-` 也会被保留，所以无法 100% 还原
  // 这里只做轻量美化：把开头的 Volumes-code-com.X-Y- 缩短
  const short = s
    .replace(/^Volumes-code-com\.codeup\.aliyun-/, "")
    .replace(/^Volumes-code-com\.github-/, "gh:")
    .replace(/^Volumes-code-com\.gitee-/, "gitee:")
    .replace(/^Users-/, "~/");
  return short || dirName;
}

/**
 * 扫描所有 session JSONL，提取每条 message 的 usage。
 * 返回扁平的 records 数组，由调用者聚合成不同维度。
 */
export async function loadAllRecords(sessionDir = DEFAULT_SESSION_DIR) {
  const records = [];
  let projectDirs = [];
  try {
    projectDirs = await fs.readdir(sessionDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return records;
    throw err;
  }

  for (const ent of projectDirs) {
    if (!ent.isDirectory()) continue;
    const projDir = path.join(sessionDir, ent.name);
    const project = decodeProjectName(ent.name);
    let files = [];
    try {
      files = await fs.readdir(projDir);
    } catch {
      continue;
    }
    for (const fname of files) {
      if (!fname.endsWith(".jsonl")) continue;
      const fpath = path.join(projDir, fname);
      const sessionId = fname.replace(/\.jsonl$/, "");
      let raw;
      try {
        raw = await fs.readFile(fpath, "utf8");
      } catch {
        continue;
      }
      for (const line of raw.split("\n")) {
        if (!line) continue;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (entry.type !== "message") continue;
        const usage = entry.message?.usage;
        if (!usage) continue;
        const ts = entry.timestamp || entry.message?.timestamp;
        const date = ts ? new Date(ts).toISOString().slice(0, 10) : null;
        if (!date) continue;
        records.push({
          project,
          sessionId,
          date,
          timestamp: ts,
          provider: entry.message?.provider || "unknown",
          model: entry.message?.model || "unknown",
          input: usage.input || 0,
          output: usage.output || 0,
          cacheRead: usage.cacheRead || 0,
          cacheWrite: usage.cacheWrite || 0,
          cost: usage.cost?.total || 0,
        });
      }
    }
  }
  return records;
}

const emptyAgg = () => ({
  messages: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
});

function addInto(agg, r) {
  agg.messages += 1;
  agg.input += r.input;
  agg.output += r.output;
  agg.cacheRead += r.cacheRead;
  agg.cacheWrite += r.cacheWrite;
  agg.cost += r.cost;
}

/** 把 records 聚合成各维度的 stats。 */
export function buildStats(records) {
  const summary = emptyAgg();
  summary.sessions = new Set();
  summary.firstDate = null;
  summary.lastDate = null;

  const byDay = new Map();
  const byProject = new Map();
  const byModel = new Map();
  const byProvider = new Map();

  for (const r of records) {
    addInto(summary, r);
    summary.sessions.add(`${r.project}::${r.sessionId}`);
    if (!summary.firstDate || r.date < summary.firstDate) summary.firstDate = r.date;
    if (!summary.lastDate || r.date > summary.lastDate) summary.lastDate = r.date;

    if (!byDay.has(r.date)) byDay.set(r.date, emptyAgg());
    addInto(byDay.get(r.date), r);

    if (!byProject.has(r.project)) byProject.set(r.project, emptyAgg());
    addInto(byProject.get(r.project), r);

    const modelKey = `${r.provider}/${r.model}`;
    if (!byModel.has(modelKey)) byModel.set(modelKey, { provider: r.provider, model: r.model, ...emptyAgg() });
    addInto(byModel.get(modelKey), r);

    if (!byProvider.has(r.provider)) byProvider.set(r.provider, emptyAgg());
    addInto(byProvider.get(r.provider), r);
  }

  const sessionsCount = summary.sessions.size;
  delete summary.sessions;

  const sortByCost = (a, b) => b.cost - a.cost;

  return {
    summary: {
      sessions: sessionsCount,
      ...summary,
      totalTokens:
        summary.input + summary.output + summary.cacheRead + summary.cacheWrite,
    },
    byDay: Object.fromEntries([...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))),
    byProject: [...byProject.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort(sortByCost),
    byModel: [...byModel.values()].sort(sortByCost),
    byProvider: [...byProvider.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort(sortByCost),
  };
}

export async function getStats(sessionDir) {
  const records = await loadAllRecords(sessionDir);
  return buildStats(records);
}
