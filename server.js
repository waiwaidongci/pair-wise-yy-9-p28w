import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "cyanotype-negative-room.json");
const port = Number(process.env.PORT || 3040);
const seed = {
  "items": [
    {
      "code": "CN-001",
      "plateSize": "18x24cm",
      "chemicalBatch": "B-0620",
      "exposure": "8分钟",
      "waterSource": "井水过滤",
      "box": "蓝盒A-03",
      "status": "冲洗中",
      "defect": "边角显影不均",
      "logs": [
        {
          "at": "2026-06-20",
          "step": "曝光",
          "note": "阴天补时2分钟"
        }
      ],
      "reworks": [],
      "repairs": []
    }
  ]
};
const fields = [["code","底片编号","text"],["plateSize","玻璃板尺寸","text"],["chemicalBatch","药液批次","text"],["exposure","曝光时间","text"],["waterSource","冲洗水源","text"],["box","存放盒位","text"]];
const stages = ["待曝光","冲洗中","待入盒","已交付"];
const statLabels = ["待曝光","冲洗中","待入盒","已交付"];
const stepOptions = ["涂布","晾干","曝光","冲洗","复晒","修补","入盒","交付"];

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  let changed = false;
  for (const item of db.items) changed = normalize(item) || changed;
  if (changed) await saveDb(db);
  return db;
}
async function saveDb(db) { await writeFile(dbPath, JSON.stringify(db, null, 2)); }
// 补齐记录数组，并把旧 steps 里的修补信息迁移为修补记录（不改动旧记录本身）
function normalize(item) {
  let changed = false;
  for (const key of ["logs", "steps", "reworks", "repairs"]) {
    if (!Array.isArray(item[key])) { item[key] = []; changed = true; }
  }
  for (const s of item.steps) {
    if (s && s.repair && !item.repairs.some(r => r.at === s.at && r.note === s.repair)) {
      item.repairs.push({ at: s.at, defect: s.defect || "", result: "已修复", note: s.repair, done: true });
      changed = true;
    }
  }
  return changed;
}
async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function html(res, text) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(text);
}
function newId() { return "CN-" + Date.now(); }
function computeStats(items) {
  const stats = Object.fromEntries(statLabels.map(label => [label, 0]));
  for (const item of items) {
    if (stats[item.status] !== undefined) stats[item.status] += 1;
  }
  return stats;
}
const openReworksOf = item => (item.reworks || []).filter(r => !r.resolved);
const openRepairsOf = item => (item.repairs || []).filter(r => !r.done);
function summarize(item) {
  const logCount = (item.logs || []).length + (item.tasks || []).reduce((n, t) => n + (t.logs || []).length, 0);
  return { ...item, logCount, openReworks: openReworksOf(item).length, openRepairs: openRepairsOf(item).length };
}
function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>古法蓝晒底片整理室</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; } textarea { min-height:68px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; } button.secondary { background:#69736a; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:160px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; } .card { display:grid; gap:8px; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.warn { border-color:var(--warn); color:var(--warn); font-weight:700; }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:90px; overflow:auto; } .warn { color:var(--warn); font-weight:700; }
    .banner { display:none; background:#f8e9e5; border:1px solid var(--warn); color:var(--warn); border-radius:6px; padding:10px 14px; margin-bottom:14px; font-weight:700; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header><div><h1>古法蓝晒底片整理室</h1><div class="meta">底片任务、工艺步骤、缺陷和入盒交付</div></div><button id="reload">刷新</button></header>
  <main>
    <section>
      <form id="createForm"><h2>新增底片</h2><div id="fields"></div><label>初始状态</label><select name="status">${stages.map(s => '<option>'+s+'</option>').join('')}</select><button>保存底片</button></form>
      <form id="actionForm" style="margin-top:14px"><h2>记录工艺步骤</h2><label>选择底片</label><select name="id" id="itemSelect"></select><div id="extraFields"></div><button>提交记录</button></form>
    </section>
    <section>
      <div class="banner" id="banner"></div>
      <div class="stats" id="stats"></div>
      <div class="toolbar"><select id="statusFilter"><option value="">全部状态</option>${stages.map(s => '<option>'+s+'</option>').join('')}</select><input id="search" placeholder="搜索编号或关键词"></div>
      <div class="panel"><h2>创建蓝晒任务后，按涂布、晾干、曝光、冲洗、复晒、修补、入盒记录每一步历史。</h2><div class="grid" id="cards"></div></div>
    </section>
  </main>
  <script>
    const fields = [["code","底片编号","text"],["plateSize","玻璃板尺寸","text"],["chemicalBatch","药液批次","text"],["exposure","曝光时间","text"],["waterSource","冲洗水源","text"],["box","存放盒位","text"]];
    const stages = ["待曝光","冲洗中","待入盒","已交付"];
    const stepOptions = ["涂布","晾干","曝光","冲洗","复晒","修补","入盒","交付"];
    const createForm = document.querySelector('#createForm');
    const actionForm = document.querySelector('#actionForm');
    const cards = document.querySelector('#cards');
    const statsEl = document.querySelector('#stats');
    const itemSelect = document.querySelector('#itemSelect');
    const banner = document.querySelector('#banner');
    let items = [];
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ 'Content-Type':'application/json' } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '请求失败');
      return data;
    }
    function showError(msg) { banner.textContent = msg || ''; banner.style.display = msg ? 'block' : 'none'; }
    function fmtAt(at) { const d = new Date(at); return isNaN(d) ? (at || '') : d.toLocaleString('zh-CN', { hour12:false }); }
    function renderForms() {
      document.querySelector('#fields').innerHTML = fields.map(([key,label,type]) => '<label>'+label+'</label><input name="'+key+'" type="'+type+'" '+(key==='code'?'required':'')+'>').join('');
      document.querySelector('#extraFields').innerHTML =
        '<label>步骤</label><select name="step">'+stepOptions.map(s => '<option>'+s+'</option>').join('')+'</select>'+
        '<label>显影状态</label><input name="developStatus">'+
        '<label>缺陷类型</label><input name="defect">'+
        '<label>复晒结果</label><select name="recheckResult"><option>合格</option><option>不合格</option></select>'+
        '<label>返工原因</label><input name="reworkReason" placeholder="复晒不合格时必填">'+
        '<label>修补结果</label><select name="repairResult"><option>已修复</option><option>未处理完</option></select>'+
        '<label>备注</label><input name="note">';
    }
    function render() {
      itemSelect.innerHTML = items.map(item => '<option value="'+(item.id || item.code)+'">'+(item.code || item.id)+' · '+(item.name || item.shipType || item.source || item.plateSize || '')+'</option>').join('');
      const stats = Object.fromEntries(stages.map(s => [s, items.filter(i => i.status === s).length]));
      statsEl.innerHTML = Object.entries(stats).map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join('');
      const status = document.querySelector('#statusFilter').value;
      const q = document.querySelector('#search').value.trim();
      const visible = items.filter(item => (!status || item.status === status) && (!q || JSON.stringify(item).includes(q)));
      cards.innerHTML = visible.map(item => cardHtml(item)).join('');
      document.querySelectorAll('[data-status]').forEach(sel => sel.onchange = async () => {
        try { await api('/api/items/'+sel.dataset.status, { method:'PATCH', body: JSON.stringify({ status: sel.value }) }); showError(''); }
        catch (e) { showError(e.message); }
        await load();
      });
      document.querySelectorAll('[data-note]').forEach(btn => btn.onclick = async () => {
        const id = btn.dataset.note; const note = prompt('记录备注');
        if (note) { try { await api('/api/items/'+id+'/logs', { method:'POST', body: JSON.stringify({ step:'备注', note }) }); showError(''); } catch (e) { showError(e.message); } await load(); }
      });
    }
    function cardHtml(item) {
      const main = fields.map(([key,label]) => '<div><b>'+label+'</b> '+(item[key] ?? '')+'</div>').join('');
      const reworks = item.reworks || [];
      const repairs = item.repairs || [];
      const lastRework = reworks[reworks.length - 1];
      const lastRepair = repairs[repairs.length - 1];
      const openReworks = reworks.filter(r => !r.resolved).length;
      const openRepairs = repairs.filter(r => !r.done).length;
      const flags = (openReworks ? '<span class="pill warn">未结返工×'+openReworks+'</span> ' : '') + (openRepairs ? '<span class="pill warn">修补未处理完×'+openRepairs+'</span>' : '');
      const reworkLine = lastRework
        ? '<div class="'+(lastRework.resolved ? 'meta' : 'warn')+'">最近返工：'+lastRework.reason+'（'+(lastRework.resolved ? '已结' : '未结')+'，'+fmtAt(lastRework.at)+'）</div>'
        : '<div class="meta">最近返工：无</div>';
      const repairLine = lastRepair
        ? '<div class="'+(lastRepair.done ? 'meta' : 'warn')+'">最近修补：'+(lastRepair.defect || '—')+' · '+lastRepair.result+'（'+fmtAt(lastRepair.at)+'）</div>'
        : '<div class="meta">最近修补：无</div>';
      const defectLine = item.defect ? '<div><b>当前缺陷</b> '+item.defect+'</div>' : '';
      const logs = (item.logs || []).slice(-4).map(l => '<div>'+l.step+'：'+l.note+'</div>').join('');
      return '<article class="card"><h3>'+(item.code || item.id)+'</h3><div><span class="pill">'+item.status+'</span> '+(flags || '')+'</div>'+main+defectLine+reworkLine+repairLine+'<label>状态</label><select data-status="'+(item.id || item.code)+'">'+stages.map(s => '<option '+(s===item.status?'selected':'')+'>'+s+'</option>').join('')+'</select><button class="secondary" data-note="'+(item.id || item.code)+'">追加备注</button><div class="logs meta">'+(logs || '暂无记录')+'</div></article>';
    }
    async function load() { items = await api('/api/items'); render(); }
    createForm.onsubmit = async event => {
      event.preventDefault();
      try { await api('/api/items', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(createForm).entries())) }); createForm.reset(); showError(''); }
      catch (e) { showError(e.message); }
      await load();
    };
    actionForm.onsubmit = async event => {
      event.preventDefault();
      try { await api('/api/items/'+itemSelect.value+'/action', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(actionForm).entries())) }); actionForm.reset(); showError(''); }
      catch (e) { showError(e.message); }
      await load();
    };
    document.querySelector('#statusFilter').onchange = render; document.querySelector('#search').oninput = render; document.querySelector('#reload').onclick = load;
    renderForms(); load();
  </script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();
    if (req.method === "GET" && url.pathname === "/") return html(res, page());
    if (req.method === "GET" && url.pathname === "/api/items") return send(res, 200, db.items.map(summarize));
    if (req.method === "POST" && url.pathname === "/api/items") {
      const input = await body(req);
      const item = { id: newId(), ...input, logs: [{ at: new Date().toISOString(), step: "建档", note: "创建底片" }], steps: [], reworks: [], repairs: [] };

      db.items.unshift(item);
      await saveDb(db);
      return send(res, 201, item);
    }
    const patch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
    if (patch && req.method === "PATCH") {
      const item = db.items.find(x => x.id === patch[1] || x.code === patch[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      const input = await body(req);
      if (input.status === "已交付" && openReworksOf(item).length) {
        return send(res, 409, { error: "还有" + openReworksOf(item).length + "条返工未结，请先处理复晒返工再交付" });
      }
      if (input.status === "待入盒" && openRepairsOf(item).length) {
        return send(res, 409, { error: "还有" + openRepairsOf(item).length + "条修补未处理完，不能入盒" });
      }
      // 历史记录不允许被覆盖
      const { id, logs, steps, reworks, repairs, ...rest } = input;
      Object.assign(item, rest);
      item.logs ||= [];
      item.logs.push({ at: new Date().toISOString(), step: "状态", note: "更新为" + item.status });
      await saveDb(db);
      return send(res, 200, item);
    }
    const log = url.pathname.match(/^\/api\/items\/([^/]+)\/logs$/);
    if (log && req.method === "POST") {
      const item = db.items.find(x => x.id === log[1] || x.code === log[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      const input = await body(req);
      item.logs ||= [];
      item.logs.push({ at: new Date().toISOString(), step: input.step || "记录", note: input.note || "" });
      await saveDb(db);
      return send(res, 201, item);
    }
    const action = url.pathname.match(/^\/api\/items\/([^/]+)\/action$/);
    if (action && req.method === "POST") {
      const item = db.items.find(x => x.id === action[1] || x.code === action[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      const input = await body(req);
      const now = new Date().toISOString();
      item.logs ||= [];
      item.steps ||= [];
      item.reworks ||= [];
      item.repairs ||= [];
      const step = (input.step || "").trim();

      if (step === "复晒") {
        const result = input.recheckResult === "不合格" ? "不合格" : "合格";
        if (result === "不合格") {
          const reason = (input.reworkReason || input.note || "").trim();
          if (!reason) return send(res, 400, { error: "复晒不合格必须填写返工原因" });
          // 记录返工原因，底片退回冲洗中；曝光、水源、盒位保持不变
          item.reworks.push({ at: now, reason, note: input.note || "", resolved: false });
          item.status = "冲洗中";
          item.logs.push({ at: now, step: "复晒", note: "不合格，返工原因：" + reason + "，退回冲洗中" });
        } else {
          for (const r of item.reworks) if (!r.resolved) { r.resolved = true; r.resolvedAt = now; }
          item.status = "待入盒";
          item.logs.push({ at: now, step: "复晒", note: "合格" + (input.note ? "：" + input.note : "") });
        }
        item.steps.push({ at: now, ...input, recheckResult: result });
        await saveDb(db);
        return send(res, 201, item);
      }

      if (step === "修补") {
        const done = input.repairResult !== "未处理完";
        const result = done ? "已修复" : "未处理完";
        if (done) for (const r of item.repairs) if (!r.done) { r.done = true; r.doneAt = now; }
        item.repairs.push({ at: now, defect: input.defect || item.defect || "", result, note: input.note || "", done });
        if (input.defect) item.defect = input.defect;
        item.logs.push({ at: now, step: "修补", note: (input.defect ? input.defect + " " : "") + result + (input.note ? "：" + input.note : "") });
        item.steps.push({ at: now, ...input, repairResult: result });
        await saveDb(db);
        return send(res, 201, item);
      }

      if (step === "入盒") {
        const open = openRepairsOf(item);
        if (open.length) return send(res, 409, { error: "还有" + open.length + "条修补未处理完，不能入盒" });
        item.status = "待入盒";
        item.logs.push({ at: now, step: "入盒", note: input.note || ("放入" + (item.box || "盒位")) });
        item.steps.push({ at: now, ...input });
        await saveDb(db);
        return send(res, 201, item);
      }

      if (step === "交付") {
        const open = openReworksOf(item);
        if (open.length) return send(res, 409, { error: "还有" + open.length + "条返工未结，请先处理复晒返工再交付" });
        item.status = "已交付";
        item.logs.push({ at: now, step: "交付", note: input.note || "交付出厂" });
        item.steps.push({ at: now, ...input });
        await saveDb(db);
        return send(res, 201, item);
      }

      // 其余步骤：涂布、晾干、曝光、冲洗等
      if (input.defect) item.defect = input.defect;
      if (step === "冲洗") item.status = "冲洗中";
      else if (["涂布", "晾干", "曝光"].includes(step)) item.status = "待曝光";
      item.steps.push({ at: now, ...input });
      item.logs.push({ at: now, step: step || "工艺", note: input.note || input.developStatus || "步骤记录" });
      await saveDb(db);
      return send(res, 201, item);
    }
    if (req.method === "GET" && url.pathname === "/api/stats") return send(res, 200, computeStats(db.items));
    send(res, 404, { error: "not_found" });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});
server.listen(port, () => console.log("古法蓝晒底片整理室 listening on http://localhost:" + port));
