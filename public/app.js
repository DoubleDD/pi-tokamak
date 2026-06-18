// pi-tokens dashboard frontend
const SVG_NS = "http://www.w3.org/2000/svg";

const fmtInt = (n) => Number(n || 0).toLocaleString("en-US");
const fmtCost = (n) => "$" + (Number(n) || 0).toFixed(4);
const fmtCompact = (n) => {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
};

// 选 metric 的 getter
const METRIC_GETTERS = {
  totalTokens: (d) => d.input + d.output + d.cacheRead + d.cacheWrite,
  cost: (d) => d.cost,
  input: (d) => d.input,
  output: (d) => d.output,
  messages: (d) => d.messages,
};

const METRIC_LABELS = {
  totalTokens: "tokens",
  cost: "cost",
  input: "input tokens",
  output: "output tokens",
  messages: "messages",
};

let STATS = null;
let CURRENT_METRIC = "totalTokens";

async function loadStats() {
  const res = await fetch("/api/stats");
  if (!res.ok) throw new Error("failed to load stats");
  STATS = await res.json();
  render();
}

function render() {
  renderSummary();
  renderHeatmap();
  renderUsageTable();
  renderDailyTable();
  renderTable("t-project", STATS.byProject, [
    { key: "name", label: "project" },
    { key: "messages", label: "msgs", num: true, fmt: fmtInt },
    { key: "input", label: "input", num: true, fmt: fmtInt },
    { key: "output", label: "output", num: true, fmt: fmtInt },
    { key: "cacheRead", label: "cache read", num: true, fmt: fmtInt },
    { key: "cost", label: "cost", num: true, fmt: fmtCost },
  ]);

  const meta = document.getElementById("meta");
  const s = STATS.summary;
  meta.textContent = `${s.firstDate || "—"} → ${s.lastDate || "—"} · last refreshed ${new Date().toLocaleTimeString()}`;
}

function renderSummary() {
  const s = STATS.summary;
  document.getElementById("m-total-cost").textContent = fmtCost(s.cost);
  document.getElementById("m-total-tokens").textContent = fmtCompact(s.totalTokens);
  document.getElementById("m-input").textContent = fmtCompact(s.input);
  document.getElementById("m-output").textContent = fmtCompact(s.output);
  document.getElementById("m-sessions").textContent = fmtInt(s.sessions);
  document.getElementById("m-messages").textContent = fmtInt(s.messages);
}

function renderTable(tableId, rows, cols) {
  const t = document.getElementById(tableId);
  t.innerHTML = "";
  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  for (const c of cols) {
    const th = document.createElement("th");
    th.textContent = c.label;
    if (c.num) th.classList.add("num");
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  t.appendChild(thead);

  const tb = document.createElement("tbody");
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = cols.length;
    td.textContent = "(no data)";
    td.style.color = "var(--fg-dim)";
    td.style.textAlign = "center";
    tr.appendChild(td);
    tb.appendChild(tr);
  } else {
    for (const row of rows) {
      const tr = document.createElement("tr");
      for (const c of cols) {
        const td = document.createElement("td");
        const val = row[c.key];
        td.textContent = c.fmt ? c.fmt(val) : (val ?? "");
        if (c.num) td.classList.add("num");
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    }
  }
  t.appendChild(tb);
}

// 按 provider 分组、包含小计 / 总计的聚合表
function renderUsageTable() {
  const table = document.getElementById("t-usage");
  table.innerHTML = "";

  // STATS.byModel 已按 cost 降序；按 provider 分组保留顺序
  const groups = new Map();
  for (const row of STATS.byModel) {
    if (!groups.has(row.provider)) groups.set(row.provider, []);
    groups.get(row.provider).push(row);
  }
  // provider 顺序按 byProvider 的 cost 降序（STATS.byProvider 已排过）
  const providerOrder = STATS.byProvider.map((p) => p.name);
  const providerSubtotal = new Map(STATS.byProvider.map((p) => [p.name, p]));

  // 表头
  const headers = [
    { label: "provider" },
    { label: "model" },
    { label: "msgs", num: true },
    { label: "input", num: true },
    { label: "output", num: true },
    { label: "cache read", num: true },
    { label: "cost", num: true },
  ];
  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  for (const h of headers) {
    const th = document.createElement("th");
    th.textContent = h.label;
    if (h.num) th.classList.add("num");
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);

  const tb = document.createElement("tbody");
  const td = (text, opts = {}) => {
    const el = document.createElement("td");
    el.textContent = text;
    if (opts.num) el.classList.add("num");
    if (opts.cls) el.classList.add(opts.cls);
    if (opts.rowSpan) el.rowSpan = opts.rowSpan;
    if (opts.colSpan) el.colSpan = opts.colSpan;
    return el;
  };

  for (const provider of providerOrder) {
    const models = groups.get(provider) || [];
    if (!models.length) continue;
    const sub = providerSubtotal.get(provider);

    models.forEach((m, i) => {
      const tr = document.createElement("tr");
      if (i === 0) {
        tr.appendChild(td(provider, { rowSpan: models.length + 1, cls: "group-cell" }));
      }
      tr.appendChild(td(m.model));
      tr.appendChild(td(fmtInt(m.messages), { num: true }));
      tr.appendChild(td(fmtInt(m.input), { num: true }));
      tr.appendChild(td(fmtInt(m.output), { num: true }));
      tr.appendChild(td(fmtInt(m.cacheRead), { num: true }));
      tr.appendChild(td(fmtCost(m.cost), { num: true }));
      tb.appendChild(tr);
    });

    // 小计行（provider 列被上面 rowspan 占据）
    const trSub = document.createElement("tr");
    trSub.classList.add("subtotal");
    trSub.appendChild(td("subtotal", { cls: "subtotal-label" }));
    trSub.appendChild(td(fmtInt(sub.messages), { num: true }));
    trSub.appendChild(td(fmtInt(sub.input), { num: true }));
    trSub.appendChild(td(fmtInt(sub.output), { num: true }));
    trSub.appendChild(td(fmtInt(sub.cacheRead), { num: true }));
    trSub.appendChild(td(fmtCost(sub.cost), { num: true }));
    tb.appendChild(trSub);
  }

  // 总计行
  const s = STATS.summary;
  const trTotal = document.createElement("tr");
  trTotal.classList.add("grand-total");
  trTotal.appendChild(td("Total", { colSpan: 2 }));
  trTotal.appendChild(td(fmtInt(s.messages), { num: true }));
  trTotal.appendChild(td(fmtInt(s.input), { num: true }));
  trTotal.appendChild(td(fmtInt(s.output), { num: true }));
  trTotal.appendChild(td(fmtInt(s.cacheRead), { num: true }));
  trTotal.appendChild(td(fmtCost(s.cost), { num: true }));
  tb.appendChild(trTotal);

  table.appendChild(tb);
}

// 按月分组、含月小计 / 总计的每日表
function renderDailyTable() {
  const table = document.getElementById("t-daily");
  table.innerHTML = "";

  // 按 YYYY-MM 分组，同时累加月小计
  const groups = new Map();           // "2026-06" -> [{date, ...agg}]
  const monthSubtotals = new Map();   // "2026-06" -> {messages, input, ...}
  const emptyAgg = () => ({ messages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
  for (const [date, agg] of Object.entries(STATS.byDay)) {
    const month = date.slice(0, 7);
    if (!groups.has(month)) {
      groups.set(month, []);
      monthSubtotals.set(month, emptyAgg());
    }
    groups.get(month).push({ date, ...agg });
    const sub = monthSubtotals.get(month);
    sub.messages += agg.messages;
    sub.input += agg.input;
    sub.output += agg.output;
    sub.cacheRead += agg.cacheRead;
    sub.cacheWrite += agg.cacheWrite;
    sub.cost += agg.cost;
  }
  // 月份降序（最新月在上）；每月内日期也降序
  // 月份升序（最早月在上，最新月在下）；每月内日期也升序
  const monthsAsc = [...groups.keys()].sort();

  const headers = [
    { label: "month" },
    { label: "date" },
    { label: "msgs", num: true },
    { label: "input", num: true },
    { label: "output", num: true },
    { label: "cache read", num: true },
    { label: "cost", num: true },
  ];
  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  for (const h of headers) {
    const th = document.createElement("th");
    th.textContent = h.label;
    if (h.num) th.classList.add("num");
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);

  const tb = document.createElement("tbody");
  const td = (text, opts = {}) => {
    const el = document.createElement("td");
    el.textContent = text;
    if (opts.num) el.classList.add("num");
    if (opts.cls) el.classList.add(opts.cls);
    if (opts.rowSpan) el.rowSpan = opts.rowSpan;
    if (opts.colSpan) el.colSpan = opts.colSpan;
    return el;
  };

  for (const month of monthsAsc) {
    const days = (groups.get(month) || []).sort((a, b) => a.date.localeCompare(b.date));
    if (!days.length) continue;
    const sub = monthSubtotals.get(month);

    days.forEach((d, i) => {
      const tr = document.createElement("tr");
      if (i === 0) {
        tr.appendChild(td(month, { rowSpan: days.length + 1, cls: "group-cell" }));
      }
      tr.appendChild(td(d.date));
      tr.appendChild(td(fmtInt(d.messages), { num: true }));
      tr.appendChild(td(fmtInt(d.input), { num: true }));
      tr.appendChild(td(fmtInt(d.output), { num: true }));
      tr.appendChild(td(fmtInt(d.cacheRead), { num: true }));
      tr.appendChild(td(fmtCost(d.cost), { num: true }));
      tb.appendChild(tr);
    });

    // 月小计行
    const trSub = document.createElement("tr");
    trSub.classList.add("subtotal");
    trSub.appendChild(td("subtotal", { cls: "subtotal-label" }));
    trSub.appendChild(td(fmtInt(sub.messages), { num: true }));
    trSub.appendChild(td(fmtInt(sub.input), { num: true }));
    trSub.appendChild(td(fmtInt(sub.output), { num: true }));
    trSub.appendChild(td(fmtInt(sub.cacheRead), { num: true }));
    trSub.appendChild(td(fmtCost(sub.cost), { num: true }));
    tb.appendChild(trSub);
  }

  // 总计行
  const s = STATS.summary;
  const trTotal = document.createElement("tr");
  trTotal.classList.add("grand-total");
  trTotal.appendChild(td("Total", { colSpan: 2 }));
  trTotal.appendChild(td(fmtInt(s.messages), { num: true }));
  trTotal.appendChild(td(fmtInt(s.input), { num: true }));
  trTotal.appendChild(td(fmtInt(s.output), { num: true }));
  trTotal.appendChild(td(fmtInt(s.cacheRead), { num: true }));
  trTotal.appendChild(td(fmtCost(s.cost), { num: true }));
  tb.appendChild(trTotal);

  table.appendChild(tb);
}

// ============== Heatmap (GitHub style) ==============
// 布局常量：格子尺寸会根据容器宽度动态计算（避免横向滚动撑破布局）
const GAP = 4;
const TOP_PAD = 26;     // 月份标签留位
const LEFT_PAD = 36;    // 周几标签留位
const CELL_MIN = 10;
const CELL_MAX = 20;    // 最大到 20px，接近“1.5倍”诉求

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(d, n) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/**
 * GitHub style: 列=周，行=星期（Sun..Sat）。
 * 决定起止：从 firstDate 所在周的周日到今天所在周的周六。
 */
function renderHeatmap() {
  const wrap = document.getElementById("heatmap");
  wrap.innerHTML = "";

  const days = STATS.byDay || {};
  const summary = STATS.summary;
  if (!summary.firstDate) {
    wrap.textContent = "no data yet";
    return;
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayIso = isoDate(today);

  // 始终绘制完整 12 个月，无数据的日子使用空色格子
  let start = addDays(today, -365);
  // 对齐到周日（GitHub 对齐方式）
  const startDow = start.getUTCDay(); // 0=Sun
  start = addDays(start, -startDow);

  const totalDays = Math.floor((today - start) / 86400000) + 1;
  const numWeeks = Math.ceil((totalDays + start.getUTCDay()) / 7);

  // 根据容器宽度反推格子尺寸，保证不会横向滚动
  const wrapStyle = getComputedStyle(wrap);
  const padX =
    parseFloat(wrapStyle.paddingLeft || "0") +
    parseFloat(wrapStyle.paddingRight || "0");
  const contentWidth = (wrap.clientWidth || 1100) - padX;
  const availForCells = contentWidth - LEFT_PAD - 8;
  const idealStep = Math.floor(availForCells / numWeeks);
  const STEP = Math.max(CELL_MIN + GAP, Math.min(CELL_MAX + GAP, idealStep));
  const CELL = STEP - GAP;

  // 计算 metric 的最大值，用于颜色分级
  const getter = METRIC_GETTERS[CURRENT_METRIC];
  const valuesByDate = {};
  let maxVal = 0;
  for (const [date, agg] of Object.entries(days)) {
    if (date < isoDate(start)) continue;
    const v = getter(agg);
    valuesByDate[date] = v;
    if (v > maxVal) maxVal = v;
  }

  // 分级：0 / (0, 25%] / (25%, 50%] / (50%, 75%] / (75%, 100%]
  const colorFor = (v) => {
    if (!v) return "var(--heat-0)";
    const r = v / maxVal;
    if (r <= 0.25) return "var(--heat-1)";
    if (r <= 0.5) return "var(--heat-2)";
    if (r <= 0.75) return "var(--heat-3)";
    return "var(--heat-4)";
  };

  const width = LEFT_PAD + numWeeks * STEP + 8;
  const height = TOP_PAD + 7 * STEP + 4;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  // 不设固定 width/height，让 CSS 控制实际尺寸，避免撑破布局
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", height);
  svg.style.maxWidth = width + "px";

  // Day labels (Mon, Wed, Fri)
  const dayNames = ["", "Mon", "", "Wed", "", "Fri", ""];
  for (let i = 0; i < 7; i++) {
    if (!dayNames[i]) continue;
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", 0);
    t.setAttribute("y", TOP_PAD + i * STEP + CELL - 2);
    t.setAttribute("class", "day-label");
    t.textContent = dayNames[i];
    svg.appendChild(t);
  }

  // 渲染格子 + 月份标签
  let lastMonth = -1;
  for (let week = 0; week < numWeeks; week++) {
    for (let day = 0; day < 7; day++) {
      const d = addDays(start, week * 7 + day);
      const iso = isoDate(d);
      const isFuture = d > today;
      const v = isFuture ? 0 : (valuesByDate[iso] || 0);
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", LEFT_PAD + week * STEP);
      rect.setAttribute("y", TOP_PAD + day * STEP);
      rect.setAttribute("width", CELL);
      rect.setAttribute("height", CELL);
      rect.setAttribute("rx", 2);
      rect.setAttribute("ry", 2);
      rect.setAttribute("fill", colorFor(v));
      const isToday = iso === todayIso;
      const cls = "cell" + (isFuture ? " future" : "") + (isToday ? " today" : "");
      rect.setAttribute("class", cls);
      rect.dataset.date = iso;
      rect.dataset.value = String(v);
      if (!isFuture) attachTooltip(rect, iso, days[iso]);
      svg.appendChild(rect);

      // 月份标签：每个月第一周的第一天（不画未来月份）
      if (day === 0 && !isFuture) {
        const m = d.getUTCMonth();
        if (m !== lastMonth) {
          const t = document.createElementNS(SVG_NS, "text");
          t.setAttribute("x", LEFT_PAD + week * STEP);
          t.setAttribute("y", TOP_PAD - 6);
          t.setAttribute("class", "month-label");
          // 跨年时加年份，避免循环错觉
          const monthStr = d.toLocaleString("en-US", { month: "short" });
          const yearStr = String(d.getUTCFullYear()).slice(2);
          t.textContent = m === 0 || lastMonth === -1 ? `${monthStr} '${yearStr}` : monthStr;
          svg.appendChild(t);
          lastMonth = m;
        }
      }
    }
  }

  wrap.appendChild(svg);
  renderLegend(maxVal, todayIso);
}

function renderLegend(maxVal, todayIso) {
  const el = document.getElementById("legend");
  const label = METRIC_LABELS[CURRENT_METRIC];
  const fmt = CURRENT_METRIC === "cost" ? fmtCost : fmtCompact;
  el.innerHTML = "";
  const lessSpan = document.createElement("span");
  lessSpan.textContent = "less";
  el.appendChild(lessSpan);
  for (const v of ["var(--heat-0)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"]) {
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = v;
    el.appendChild(sw);
  }
  const moreSpan = document.createElement("span");
  moreSpan.textContent = `more · max ${fmt(maxVal)} ${label}/day`;
  el.appendChild(moreSpan);
  // today 标识
  const todayMarker = document.createElement("span");
  todayMarker.style.marginLeft = "16px";
  todayMarker.innerHTML = `→ today: <strong style="color:var(--accent)">${todayIso}</strong> (rightmost column)`;
  el.appendChild(todayMarker);
}

function attachTooltip(node, iso, agg) {
  let tip;
  node.addEventListener("mouseenter", (e) => {
    tip = document.createElement("div");
    tip.className = "tooltip";
    if (!agg) {
      tip.textContent = `${iso}\nno activity`;
    } else {
      tip.textContent =
        `${iso}\n` +
        `tokens: ${fmtInt(agg.input + agg.output + agg.cacheRead + agg.cacheWrite)}\n` +
        `input: ${fmtInt(agg.input)}    output: ${fmtInt(agg.output)}\n` +
        `cache read: ${fmtInt(agg.cacheRead)}\n` +
        `messages: ${fmtInt(agg.messages)}    cost: ${fmtCost(agg.cost)}`;
    }
    document.body.appendChild(tip);
    moveTip(e);
  });
  node.addEventListener("mousemove", moveTip);
  node.addEventListener("mouseleave", () => {
    if (tip) {
      tip.remove();
      tip = null;
    }
  });
  function moveTip(e) {
    if (!tip) return;
    tip.style.left = e.clientX + 12 + "px";
    tip.style.top = e.clientY + 12 + "px";
  }
}

// Bind
document.getElementById("metric-select").addEventListener("change", (e) => {
  CURRENT_METRIC = e.target.value;
  if (STATS) renderHeatmap();
});
document.getElementById("refresh").addEventListener("click", () => {
  loadStats().catch((e) => alert(e.message));
});
// 窗口尺寸变化时重绘热力图（防抖 100ms）
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (STATS) renderHeatmap(); }, 100);
});

loadStats().catch((e) => {
  document.body.innerHTML = `<pre style="color:#f85149;padding:32px">load failed: ${e.message}</pre>`;
});
