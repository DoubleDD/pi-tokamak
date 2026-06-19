// tokamak dashboard
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
  // 1) 先画轻量 + 把 meta 状态写回，让用户立刻看到"数据已到达"
  const meta = document.getElementById("meta");
  const s = STATS.summary;
  meta.textContent = `${s.firstDate || "—"} → ${s.lastDate || "—"} · last refreshed ${new Date().toLocaleTimeString()}`;
  renderSummary();
  // 2) 把热力图 + 三个表格这些重活推到下一帧，让浏览器先 paint 上面的内容,
  //    避免长同步任务把 footer 文本变更与重活打包成一帧延迟显示。
  requestAnimationFrame(() => {
    renderHeatmap();
    renderTrend();
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
  });
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

// ============== Daily trend (smooth line/area chart) ==============
const TREND_H = 240;

// Catmull-Rom 样条 → 三次贝塞尔，得到平滑曲线
function smoothPath(pts) {
  if (!pts.length) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

function renderTrend() {
  const wrap = document.getElementById("trend");
  wrap.innerHTML = "";

  const days = STATS.byDay || {};
  const summary = STATS.summary;
  if (!summary.firstDate) {
    wrap.textContent = "no data yet";
    return;
  }

  // 从 firstDate 到今天构建连续日序列，缺失日补 0 → 曲线连续
  const getter = METRIC_GETTERS[CURRENT_METRIC];
  const fmtVal = CURRENT_METRIC === "cost" ? fmtCost : fmtCompact;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const series = [];
  for (let d = new Date(summary.firstDate + "T00:00:00Z"); d <= today; d = addDays(d, 1)) {
    const iso = isoDate(d);
    const agg = days[iso];
    series.push({ iso, date: new Date(d), v: agg ? getter(agg) : 0, agg });
  }

  const wrapStyle = getComputedStyle(wrap);
  const padX = parseFloat(wrapStyle.paddingLeft || "0") + parseFloat(wrapStyle.paddingRight || "0");
  const W = Math.max(320, (wrap.clientWidth || 1100) - padX);
  const H = TREND_H;
  const M = { top: 16, right: 18, bottom: 28, left: 56 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  let maxVal = 0;
  for (const s of series) if (s.v > maxVal) maxVal = s.v;
  maxVal = maxVal || 1;

  const xOf = (i) => M.left + (series.length === 1 ? plotW / 2 : (plotW * i) / (series.length - 1));
  const yOf = (v) => M.top + plotH - (plotH * v) / maxVal;
  const pts = series.map((s, i) => ({ x: xOf(i), y: yOf(s.v) }));

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", H);
  svg.setAttribute("class", "trend-svg");

  // 渐变填充（跟随主题 --accent）
  const defs = document.createElementNS(SVG_NS, "defs");
  const grad = document.createElementNS(SVG_NS, "linearGradient");
  grad.setAttribute("id", "trend-grad");
  grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0");
  grad.setAttribute("x2", "0"); grad.setAttribute("y2", "1");
  for (const [off, op] of [["0", "0.35"], ["1", "0"]]) {
    const stop = document.createElementNS(SVG_NS, "stop");
    stop.setAttribute("offset", off);
    stop.style.stopColor = "var(--accent)";
    stop.style.stopOpacity = op;
    grad.appendChild(stop);
  }
  defs.appendChild(grad);
  svg.appendChild(defs);

  // 水平网格 + Y 轴刻度
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (maxVal * i) / ticks;
    const y = yOf(v);
    const ln = document.createElementNS(SVG_NS, "line");
    ln.setAttribute("x1", M.left); ln.setAttribute("x2", M.left + plotW);
    ln.setAttribute("y1", y); ln.setAttribute("y2", y);
    ln.setAttribute("class", "trend-grid");
    svg.appendChild(ln);
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", M.left - 8); t.setAttribute("y", y + 3);
    t.setAttribute("text-anchor", "end");
    t.setAttribute("class", "trend-axis");
    t.textContent = fmtVal(v);
    svg.appendChild(t);
  }

  // X 轴月份标签（每月第一个出现的日）
  let lastMonth = -1;
  series.forEach((s, i) => {
    const m = s.date.getUTCMonth();
    if (m === lastMonth) return;
    lastMonth = m;
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", xOf(i)); t.setAttribute("y", H - 8);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("class", "trend-axis");
    const monthStr = s.date.toLocaleString("en-US", { month: "short" });
    t.textContent = m === 0 ? `${monthStr} '${String(s.date.getUTCFullYear()).slice(2)}` : monthStr;
    svg.appendChild(t);
  });

  // 面积 + 平滑曲线
  const lineD = smoothPath(pts);
  const baseY = M.top + plotH;
  const area = document.createElementNS(SVG_NS, "path");
  area.setAttribute("d", `${lineD} L ${pts[pts.length - 1].x.toFixed(2)} ${baseY} L ${pts[0].x.toFixed(2)} ${baseY} Z`);
  area.setAttribute("class", "trend-area");
  area.setAttribute("fill", "url(#trend-grad)");
  svg.appendChild(area);

  const line = document.createElementNS(SVG_NS, "path");
  line.setAttribute("d", lineD);
  line.setAttribute("class", "trend-line");
  svg.appendChild(line);

  // 悬浮指示：竖线 + 圆点 + tooltip
  const guide = document.createElementNS(SVG_NS, "line");
  guide.setAttribute("class", "trend-guide");
  guide.setAttribute("y1", M.top); guide.setAttribute("y2", baseY);
  guide.style.display = "none";
  svg.appendChild(guide);
  const dot = document.createElementNS(SVG_NS, "circle");
  dot.setAttribute("r", 4);
  dot.setAttribute("class", "trend-dot");
  dot.style.display = "none";
  svg.appendChild(dot);

  const overlay = document.createElementNS(SVG_NS, "rect");
  overlay.setAttribute("x", M.left); overlay.setAttribute("y", M.top);
  overlay.setAttribute("width", plotW); overlay.setAttribute("height", plotH);
  overlay.setAttribute("fill", "transparent");
  svg.appendChild(overlay);

  let tip;
  const showAt = (i, clientX, clientY) => {
    const s = series[i];
    guide.setAttribute("x1", pts[i].x); guide.setAttribute("x2", pts[i].x);
    guide.style.display = ""; dot.style.display = "";
    dot.setAttribute("cx", pts[i].x); dot.setAttribute("cy", pts[i].y);
    if (!tip) { tip = document.createElement("div"); tip.className = "tooltip"; document.body.appendChild(tip); }
    const a = s.agg;
    tip.textContent = a
      ? `${s.iso}\n${METRIC_LABELS[CURRENT_METRIC]}: ${fmtVal(s.v)}\nmessages: ${fmtInt(a.messages)}    cost: ${fmtCost(a.cost)}`
      : `${s.iso}\nno activity`;
    tip.style.left = clientX + 12 + "px";
    tip.style.top = clientY + 12 + "px";
  };
  const clearHover = () => {
    guide.style.display = "none"; dot.style.display = "none";
    if (tip) { tip.remove(); tip = null; }
  };
  overlay.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    const scale = W / rect.width;             // viewBox → 实际像素
    const px = (e.clientX - rect.left) * scale;
    let i = Math.round(((px - M.left) / plotW) * (series.length - 1));
    i = Math.max(0, Math.min(series.length - 1, i));
    showAt(i, e.clientX, e.clientY);
  });
  overlay.addEventListener("mouseleave", clearHover);

  wrap.appendChild(svg);
}

// Bind
document.getElementById("metric-select").addEventListener("change", (e) => {
  CURRENT_METRIC = e.target.value;
  if (STATS) { renderHeatmap(); renderTrend(); }
});
document.getElementById("refresh").addEventListener("click", () => {
  loadStats().catch((e) => alert(e.message));
});
// 窗口尺寸变化时重绘热力图（防抖 100ms）
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (STATS) { renderHeatmap(); renderTrend(); } }, 100);
});

loadStats().catch((e) => {
  document.body.innerHTML = `<pre style="color:#f85149;padding:32px">load failed: ${e.message}</pre>`;
});

// Theme toggle: default <-> cyberpunk, persisted in localStorage.
// 热力图 / 表格 / 卡片颜色都走 CSS 变量，切换时浏览器自动重绘，无需重渲染。
(() => {
  const KEY = "tokamak-theme";
  const btn = document.getElementById("theme-toggle");
  const apply = (t) => {
    if (t === "cyberpunk") document.documentElement.setAttribute("data-theme", "cyberpunk");
    else document.documentElement.removeAttribute("data-theme");
    if (btn) btn.textContent = t === "cyberpunk" ? "default" : "cyberpunk";
  };
  // URL ?theme=cyberpunk 优先于 localStorage（方便截图等场景）
  const urlTheme = new URLSearchParams(window.location.search).get("theme");
  apply(urlTheme || localStorage.getItem(KEY) || "default");
  btn?.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "cyberpunk" ? "default" : "cyberpunk";
    localStorage.setItem(KEY, next);
    apply(next);
  });
})();

// Cyberpunk 随机故障引擎：每次故障持续 0.5~2s，间隔 2~5s。
// 内存：故障结束/标签页隐藏时立即清空所有色块 DOM；CPU：后台暂停、限制满屏滤镜频率。
(() => {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const active = () => document.documentElement.getAttribute("data-theme") === "cyberpunk";
  const rand = (a, b) => a + Math.random() * (b - a);
  const neon = ["#05d9e8", "#ff2a6d", "#f9f871"];
  let layer, timers = [], scheduleId = 0;

  const getLayer = () => (layer ??= document.body.appendChild(
    Object.assign(document.createElement("div"), { id: "glitch-layer" })));

  const makeBlock = () => {
    const el = document.createElement("div");
    el.className = "glitch-block";
    const big = Math.random() < 0.2;              // 20% 大色块，80% 小色块
    const full = big && Math.random() < 0.4;      // 大色块里偶尔才是满屏横带
    const w = full ? 100 : big ? rand(20, 50) : rand(2, 12);
    const h = full ? rand(2, 8) : big ? rand(4, 12) : rand(0.4, 3);
    el.style.cssText = `left:${full ? 0 : rand(0, 100 - w)}vw;top:${rand(0, 100 - h)}vh;width:${w}vw;height:${h}vh`;
    el.style.setProperty("--c", neon[Math.floor(Math.random() * neon.length)]);
    el.style.setProperty("--sx", rand(-30, 30) + "px");
    if (Math.random() < 0.5) el.dataset.stripe = "1";
    getLayer().appendChild(el);
  };

  const clearGlitch = () => {                     // 一次性释放：清空色块 + 撤掉滤镜
    timers.forEach(clearTimeout);
    timers = [];
    layer?.replaceChildren();
    document.body.classList.remove("glitch-rgb");
  };

  const episode = () => {
    const end = performance.now() + rand(500, 2000);
    if (Math.random() < 0.3) {                     // 满屏 RGB 抖动只在开头来一下，避免整页滤镜反复重绘
      document.body.classList.add("glitch-rgb");
      timers.push(setTimeout(() => document.body.classList.remove("glitch-rgb"), rand(150, 350)));
    }
    const tick = () => {
      if (!active() || document.hidden || performance.now() >= end) { clearGlitch(); schedule(); return; }
      layer?.replaceChildren();                    // 每波先清掉上一波，DOM 数量恒定不累积
      makeBlock();                                 // 每波只出 1 个色块
      timers.push(setTimeout(tick, rand(80, 160)));
    };
    tick();
  };

  const schedule = () => {
    scheduleId = setTimeout(() => {
      if (active() && !document.hidden) episode();
      else schedule();
    }, rand(2000, 5000));
  };

  document.addEventListener("visibilitychange", () => {   // 后台标签停摆，不空耗 CPU
    clearTimeout(scheduleId);
    clearGlitch();
    if (!document.hidden) schedule();
  });

  schedule();
})();

// Cyberpunk 屏幕两侧断铜线：垂在左右空白区，受重力自然弯曲下垂，断口冒火星、电流发光带流动。
// 每根存活 3~6s 后自动移除；后台标签暂停。
(() => {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const active = () => document.documentElement.getAttribute("data-theme") === "cyberpunk";
  const rand = (a, b) => a + Math.random() * (b - a);
  let layer, scheduleId = 0;
  const getLayer = () => (layer ??= document.body.appendChild(
    Object.assign(document.createElement("div"), { id: "wire-layer" })));

  const poly = (pts) => "M" + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L ");

  // 生成一根悬垂的铜线点序列：从顶部锚点向下，受重力下垂，金属自身有缓弯，末端是断口
  const hangPts = (ax, ay, len, gw, dir) => {
    const a1 = rand(gw * 0.12, gw * 0.3);         // 主弯曲幅度
    const a2 = rand(gw * 0.03, gw * 0.1);         // 次级抖动（金属不规则）
    const f1 = rand(0.6, 1.1), ph = rand(0, Math.PI * 2);
    const pts = [], N = 24;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const y = ay + len * t * (0.6 + 0.4 * t);   // 越往下越密 → 末端更垂直（重力）
      let x = ax + dir * a1 * Math.sin(t * Math.PI * f1) + a2 * Math.sin(t * Math.PI * 3 + ph);
      x = Math.max(3, Math.min(gw - 3, x));
      pts.push([x, y]);
    }
    return pts;
  };

  const buildSideWire = (gw, vh) => {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const ax = rand(gw * 0.35, gw * 0.65);
    const ay = rand(-30, 20);                      // 从屏幕顶部边缘外垂入
    const len = rand(vh * 0.4, vh * 0.82);
    const up = hangPts(ax, ay, len, gw, dir);
    const tip = up[up.length - 1];
    const bx = tip[0], by = tip[1];                // 断口
    let frag = "";
    if (Math.random() < 0.5) {                     // 偶尔下方还挂着断落的另一截
      const fp = hangPts(bx + rand(-12, 12), by + rand(24, 50), rand(vh * 0.08, vh * 0.2), gw, dir * (Math.random() < 0.5 ? -1 : 1));
      const fd = poly(fp);
      frag = `<path class="cable-base" d="${fd}"/><path class="cable-mid" d="${fd}"/><path class="cable-hi" d="${fd}"/>`;
    }
    let sparks = "";
    for (let i = 0; i < 4; i++) {                  // 断口放射状火星
      const a = rand(-0.6, Math.PI + 0.6), r = rand(4, 11);
      sparks += `<line class="spark" x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${(bx + Math.cos(a) * r).toFixed(1)}" y2="${(by - Math.sin(a) * r).toFixed(1)}" style="animation-delay:${rand(0, 0.16).toFixed(2)}s"/>`;
    }
    for (let i = 0; i < 4; i++) {                  // 坠落火花
      sparks += `<circle class="ember" cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="1.3" style="--dx:${rand(-8, 8).toFixed(1)}px;--ed:${rand(0.6, 1.1).toFixed(2)}s;animation-delay:${rand(0, 0.7).toFixed(2)}s"/>`;
    }
    const d = poly(up);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${gw} ${vh}`);
    svg.setAttribute("class", "wire");
    svg.style.setProperty("--s", Math.random() < 0.5 ? "#f9f871" : "#fff");
    svg.style.setProperty("--life", rand(3, 6).toFixed(2) + "s");
    const pulse = Math.random() < 0.7 ? `<path class="pulse" d="${d}"/>` : "";
    svg.innerHTML = `<path class="cable-base" d="${d}"/><path class="cable-mid" d="${d}"/><path class="cable-hi" d="${d}"/>${frag}${pulse}${sparks}`;
    return svg;
  };

  const spawn = () => {
    const m = document.querySelector("main")?.getBoundingClientRect();
    if (!m) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const gutters = [];
    if (m.left > 70) gutters.push([0, m.left]);            // 左侧空白
    if (vw - m.right > 70) gutters.push([m.right, vw]);    // 右侧空白
    if (!gutters.length) return;                            // 窄屏没有空白则不挂
    const [g0, g1] = gutters[Math.floor(Math.random() * gutters.length)];
    const gw = g1 - g0;
    const svg = buildSideWire(gw, vh);
    svg.style.left = g0 + "px";
    svg.style.top = "0px";
    svg.style.width = gw + "px";
    svg.style.height = vh + "px";
    getLayer().appendChild(svg);
    setTimeout(() => svg.remove(), parseFloat(svg.style.getPropertyValue("--life")) * 1000 + 100);
  };

  const schedule = () => {
    scheduleId = setTimeout(() => {
      if (active() && !document.hidden) {
        spawn();
        if (Math.random() < 0.3) spawn();          // 偶尔同时两根
      }
      schedule();
    }, rand(4000, 9000));
  };

  document.addEventListener("visibilitychange", () => {
    clearTimeout(scheduleId);
    layer?.replaceChildren();                       // 释放所有电线
    if (!document.hidden) schedule();
  });

  schedule();
})();
