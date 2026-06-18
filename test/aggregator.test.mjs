// 基础测试：聚合逻辑
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadAllRecords, buildStats } from "../src/aggregator.mjs";

async function setupFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokamak-test-"));
  const projDir = path.join(root, "--my-project--");
  await fs.mkdir(projDir, { recursive: true });

  const lines = [
    JSON.stringify({
      type: "session",
      version: 3,
      id: "s1",
      timestamp: "2026-06-10T01:00:00.000Z",
    }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-06-10T01:01:00.000Z",
      message: {
        role: "assistant",
        provider: "deepseek",
        model: "deepseek-v4-pro",
        usage: {
          input: 100,
          output: 200,
          cacheRead: 1000,
          cacheWrite: 0,
          cost: { total: 0.05 },
        },
      },
    }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-06-11T02:00:00.000Z",
      message: {
        role: "assistant",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        usage: {
          input: 50,
          output: 80,
          cacheRead: 200,
          cacheWrite: 0,
          cost: { total: 0.01 },
        },
      },
    }),
    // user message without usage — should be ignored
    JSON.stringify({
      type: "message",
      timestamp: "2026-06-11T02:00:30.000Z",
      message: { role: "user", content: [] },
    }),
  ];
  await fs.writeFile(path.join(projDir, "s1.jsonl"), lines.join("\n"));
  return root;
}

test("loadAllRecords extracts only assistant messages with usage", async () => {
  const root = await setupFixture();
  const records = await loadAllRecords(root);
  assert.equal(records.length, 2);
  assert.equal(records[0].provider, "deepseek");
  assert.equal(records[0].input, 100);
  assert.equal(records[0].date, "2026-06-10");
  assert.equal(records[1].date, "2026-06-11");
});

test("buildStats aggregates by day, project, model, provider", async () => {
  const root = await setupFixture();
  const stats = await (async () => {
    const records = await loadAllRecords(root);
    return buildStats(records);
  })();

  assert.equal(stats.summary.messages, 2);
  assert.equal(stats.summary.sessions, 1);
  assert.equal(stats.summary.input, 150);
  assert.equal(stats.summary.output, 280);
  assert.equal(stats.summary.cacheRead, 1200);
  assert.equal(Number(stats.summary.cost.toFixed(4)), 0.06);
  assert.equal(stats.summary.firstDate, "2026-06-10");
  assert.equal(stats.summary.lastDate, "2026-06-11");

  assert.equal(Object.keys(stats.byDay).length, 2);
  assert.equal(stats.byDay["2026-06-10"].input, 100);
  assert.equal(stats.byDay["2026-06-11"].input, 50);

  assert.equal(stats.byProject.length, 1);
  assert.equal(stats.byProject[0].name, "my-project");
  assert.equal(stats.byProject[0].messages, 2);

  assert.equal(stats.byModel.length, 2);
  // Sorted by cost desc — pro (0.05) before flash (0.01)
  assert.equal(stats.byModel[0].model, "deepseek-v4-pro");
  assert.equal(stats.byModel[1].model, "deepseek-v4-flash");

  assert.equal(stats.byProvider.length, 1);
  assert.equal(stats.byProvider[0].name, "deepseek");
});

test("loadAllRecords handles missing sessions dir gracefully", async () => {
  const records = await loadAllRecords("/nonexistent/path/that/does/not/exist");
  assert.deepEqual(records, []);
});

test("buildStats handles empty input", () => {
  const stats = buildStats([]);
  assert.equal(stats.summary.messages, 0);
  assert.equal(stats.summary.sessions, 0);
  assert.deepEqual(stats.byDay, {});
  assert.deepEqual(stats.byProject, []);
});
