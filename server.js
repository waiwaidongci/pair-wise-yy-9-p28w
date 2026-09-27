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
      "reworks": [
        {
          "id": "RW-1718900000001",
          "at": "2026-06-21T02:10:00.000Z",
          "reason": "复晒后右上角仍显影不足",
          "developStatus": "不合格",
          "defect": "边角显影不均",
          "note": "阴天光照不足",
          "resolvedAt": null,
          "resolveNote": null
        }
      ],
      "repairs": [
        {
          "id": "RP-1718900200001",
          "at": "2026-06-21T02:30:00.000Z",
          "defect": "边角显影不均",
          "result": "右上角补涂药液，等待再次复晒",
          "completed": false,
          "note": ""
        }
      ],
      "logs": [
        {
          "at": "2026-06-20",
          "step": "曝光",
          "note": "阴天补时2分钟"
        }
      ]
    }
  ]
};
const fields = [["code","底片编号","text"],["plateSize","玻璃板尺寸","text"],["chemicalBatch","药液批次","text"],["exposure","曝光时间","text"],["waterSource","冲洗水源","text"],["box","存放盒位","text"]];
const editableFields = new Set(fields.map(([key]) => key));
const stages = ["待曝光","冲洗中","待入盒","已交付"];
const statLabels = ["待曝光","冲洗中","待入盒","已交付"];
const extraFields = [["step","步骤"],["developStatus","显影状态"],["defect","缺陷类型"],["note","备注"]];

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  return JSON.parse(await readFile(dbPath, "utf8"));
}
async function saveDb(db) { await writeFile(dbPath, JSON.stringify(db, null, 2)); }
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
function newId(prefix) { return prefix + "-" + Date.now() + "-" + Math.floor(Math.random() * 1000); }
function now() { return new Date().toISOString(); }
function openReworks(item) { return (item.reworks || []).filter(r => !r.resolvedAt); }
function unfinishedRepairs(item) { return (item.repairs || []).filter(r => !r.completed && !r.closedAt); }
function findItem(db, key) { return db.items.find(x => x.id === key || x.code === key); }
function addLog(item, step, note) {
  item.logs ||= [];
  item.logs.push({ at: now(), step, note: note || "" });
}
function addStep(item, step, data) {
  item.steps ||= [];
  item.steps.push({ at: now(), step, ...data });
}
function computeStats(items) {
  const stats = Object.fromEntries(statLabels.map(label => [label, 0]));
  for (const item of items) {
    if (stats[item.status] !== undefined) stats[item.status] += 1;
  }
  return stats;
}
function summarize(item) {
  const logCount = (item.logs || []).length + (item.steps || []).length;
  return {
    ...item,
    logCount,
    openReworkCount: openReworks(item).length,
    unfinishedRepairCount: unfinishedRepairs(item).length
  };
}
function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>古法蓝晒底片整理室</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; --ok:#3f6450; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; } textarea { min-height:68px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; } button.secondary { background:#69736a; } button.small { padding:6px 9px; font-size:12px; font-weight:400; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:160px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; } .card { display:grid; gap:8px; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .record { border-top:1px dashed var(--line); padding-top:6px; font-size:13px; } .record b { font-size:12px; color:var(--muted); }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:110px; overflow:auto; font-size:13px; }
    .warn { color:var(--warn); font-weight:700; } .ok { color:var(--ok); } .tag { border-radius:4px; padding:1px 6px; font-size:12px; } .tag.open { background:#f4e3de; color:var(--warn); } .tag.done { background:#e3ede6; color:var(--ok); }
    .actions { display:flex; gap:6px; flex-wrap:wrap; border-top:1px solid var(--line); padding-top:8px; }
    .modal-bg { position:fixed; inset:0; background:rgba(20,24,20,.45); display:flex; align-items:center; justify-content:center; z-index:10; }
    .modal { background:#fff; border-radius:8px; padding:20px; width:min(440px,92vw); display:grid; gap:6px; } .modal .row { display:flex; justify-content:flex-end; gap:10px; margin-top:10px; }
    .checkline { display:flex; align-items:center; gap:8px; margin-top:10px; } .checkline input { width:auto; } .checkline label { margin:0; color:var(--ink); }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header><div><h1>古法蓝晒底片整理室</h1><div class="meta">底片任务、工艺步骤、返工修补与入盒交付</div></div><button id="reload">刷新</button></header>
  <main>
    <section>
      <form id="createForm"><h2>新增底片</h2><div id="fields"></div><label>初始状态</label><select name="status">${stages.map(s => '<option>'+s+'</option>').join('')}</select><button>保存底片</button></form>
      <form id="actionForm" style="margin-top:14px"><h2>记录工艺步骤</h2><label>选择底片</label><select name="id" id="itemSelect"></select><div id="extraFields"></div><button>提交记录</button></form>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="toolbar"><select id="statusFilter"><option value="">全部状态</option>${stages.map(s => '<option>'+s+'</option>').join('')}</select><input id="search" placeholder="搜索编号、返工原因或处理结果"></div>
      <div class="panel"><h2>冲洗后流程：复晒不合格记返工并回到冲洗中；修补记录处理结果，未完不能入盒；有未结返工不能交付。</h2><div class="grid" id="cards"></div></div>
    </section>
  </main>
  <script>
    const fields = [["code","底片编号","text"],["plateSize","玻璃板尺寸","text"],["chemicalBatch","药液批次","text"],["exposure","曝光时间","text"],["waterSource","冲洗水源","text"],["box","存放盒位","text"]];
    const stages = ["待曝光","冲洗中","待入盒","已交付"];
    const extraFields = [["step","步骤"],["developStatus","显影状态"],["defect","缺陷类型"],["note","备注"]];
    const createForm = document.querySelector('#createForm');
    const actionForm = document.querySelector('#actionForm');
    const cards = document.querySelector('#cards');
    const statsEl = document.querySelector('#stats');
    const itemSelect = document.querySelector('#itemSelect');
    let items = [];
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ 'Content-Type':'application/json' } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '请求失败');
      return data;
    }
    function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function dayOf(at) { return esc(at).slice(0, 10); }
    function renderForms() {
      document.querySelector('#fields').innerHTML = fields.map(([key,label,type]) => '<label>'+label+'</label><input name="'+key+'" type="'+type+'" '+(key==='code'?'required':'')+'>').join('');
      document.querySelector('#extraFields').innerHTML = extraFields.map(([key,label]) => '<label>'+label+'</label><input name="'+key+'">').join('');
    }
    function render() {
      itemSelect.innerHTML = items.map(item => '<option value="'+esc(item.id || item.code)+'">'+esc(item.code || item.id)+' · '+esc(item.plateSize || item.chemicalBatch || '')+'</option>').join('');
      const stats = Object.fromEntries(stages.map(s => [s, items.filter(i => i.status === s).length]));
      statsEl.innerHTML = Object.entries(stats).map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join('');
      const status = document.querySelector('#statusFilter').value;
      const q = document.querySelector('#search').value.trim();
      const visible = items.filter(item => (!status || item.status === status) && (!q || JSON.stringify(item).includes(q)));
      cards.innerHTML = visible.map(item => cardHtml(item)).join('');
      document.querySelectorAll('[data-note]').forEach(btn => btn.onclick = async () => { const id = btn.dataset.note; const note = prompt('记录备注'); if (note) { await callApi(() => api('/api/items/'+encodeURIComponent(id)+'/logs', { method:'POST', body: JSON.stringify({ step:'备注', note }) })); } });
    }
    async function callApi(fn) {
      try { await fn(); await load(); } catch (e) { alert(e.message); }
    }
    function actionButtons(item) {
      const id = encodeURIComponent(item.id || item.code);
      const btns = [];
      if (item.status === '待曝光') btns.push(['wash','开始冲洗','']);
      if (item.status === '冲洗中' || item.status === '待入盒') {
        if (item.openReworkCount > 0) btns.push(['pass','返工复验合格','']);
        else btns.push(['pass','复晒合格','']);
        btns.push(['fail','复晒不合格','secondary']);
        btns.push(['repair','修补','secondary']);
        btns.push(['box','入盒','']);
      }
      if (item.status === '待入盒') btns.push(['deliver','交付','']);
      btns.push(['note','追加备注','secondary']);
      return '<div class="actions">'+btns.map(([act,label,cls]) => '<button class="small '+cls+'" data-act="'+act+'" data-item="'+id+'">'+label+'</button>').join('')+'</div>';
    }
    function cardHtml(item) {
      const main = fields.slice(1).map(([key,label]) => '<div><b>'+label+'</b> '+esc(item[key])+'</div>').join('');
      const warnings = [];
      if (item.openReworkCount > 0) warnings.push('<div class="warn">⚠ 有 '+item.openReworkCount+' 条未结返工，交付前必须先复验合格</div>');
      if (item.unfinishedRepairCount > 0) warnings.push('<div class="warn">⚠ 有 '+item.unfinishedRepairCount+' 处修补未处理完，不能入盒</div>');
      const lastRework = (item.reworks || []).at(-1);
      const reworkBlock = lastRework
        ? '<div class="record"><b>最近返工</b> '+(lastRework.resolvedAt
            ? '<span class="tag done">已复验合格</span>'
            : '<span class="tag open">未结</span>')+'<div>'+dayOf(lastRework.at)+' 原因：'+esc(lastRework.reason)+'</div>'+(lastRework.resolvedAt ? '<div class="meta">复验：'+dayOf(lastRework.resolvedAt)+' '+esc(lastRework.resolveNote || '')+'</div>' : '')+'</div>'
        : '<div class="record"><b>最近返工</b> <span class="meta">暂无</span></div>';
      const lastRepair = (item.repairs || []).at(-1);
      const repairDone = r => r.completed || r.closedAt;
      const repairBlock = lastRepair
        ? '<div class="record"><b>最近修补</b> '+(repairDone(lastRepair)
            ? '<span class="tag done">已处理完</span>'
            : '<span class="tag open">处理未完</span>')+'<div>'+dayOf(lastRepair.at)+' '+esc(lastRepair.defect || '')+'</div><div>'+esc(lastRepair.result)+'</div>'+(lastRepair.closedAt && !lastRepair.completed ? '<div class="meta">闭环：'+dayOf(lastRepair.closedAt)+' '+esc(lastRepair.closeNote || '')+'</div>' : '')+'</div>'
        : '<div class="record"><b>最近修补</b> <span class="meta">暂无</span></div>';
      const logs = (item.logs || []).slice(-5).reverse().map(l => '<div>'+dayOf(l.at)+' '+esc(l.step)+'：'+esc(l.note)+'</div>').join('');
      return '<article class="card"><h3 style="margin:0">'+esc(item.code || item.id)+'</h3><span class="pill">'+esc(item.status)+'</span>'
        + main + warnings.join('') + reworkBlock + repairBlock
        + '<div class="logs meta">'+(logs || '暂无记录')+'</div>'
        + actionButtons(item) + '</article>';
    }
    function openModal(title, fieldHtml, onSubmit) {
      const bg = document.createElement('div');
      bg.className = 'modal-bg';
      bg.innerHTML = '<form class="modal"><h2 style="margin:0">'+title+'</h2>'+fieldHtml+'<div class="row"><button type="button" class="secondary" data-cancel>取消</button><button type="submit">提交</button></div></form>';
      document.body.appendChild(bg);
      const form = bg.querySelector('form');
      bg.querySelector('[data-cancel]').onclick = () => bg.remove();
      bg.onclick = e => { if (e.target === bg) bg.remove(); };
      form.onsubmit = async e => { e.preventDefault(); const payload = onSubmit(new FormData(form)); if (!payload) return; bg.remove(); await callApi(() => payload); };
    }
    function reworkModal(itemId) {
      openModal('复晒不合格 · 登记返工',
        '<label>返工原因 *</label><textarea name="reason" required placeholder="如：右上角复晒后仍显影不足"></textarea>'
        + '<label>显影状态</label><input name="developStatus" value="不合格">'
        + '<label>缺陷类型</label><input name="defect" placeholder="如：边角显影不均">'
        + '<label>备注</label><input name="note">',
        fd => api('/api/items/'+itemId+'/rework', { method:'POST', body: JSON.stringify(Object.fromEntries(fd.entries())) }));
    }
    function repairModal(itemId) {
      openModal('记录修补',
        '<label>缺陷/部位</label><input name="defect" placeholder="如：边角显影不均">'
        + '<label>处理结果 *</label><textarea name="result" required placeholder="如：补涂药液后静置阴干"></textarea>'
        + '<div class="checkline"><input type="checkbox" id="repairDone" name="completed" value="1"><label for="repairDone">已处理完（不勾选则处理未完，不能入盒）</label></div>'
        + '<label>备注</label><input name="note">',
        fd => { const data = Object.fromEntries(fd.entries()); data.completed = fd.has('completed'); return api('/api/items/'+itemId+'/repairs', { method:'POST', body: JSON.stringify(data) }); });
    }
    cards.addEventListener('click', async e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const itemId = btn.dataset.item;
      const act = btn.dataset.act;
      if (act === 'fail') return reworkModal(itemId);
      if (act === 'repair') return repairModal(itemId);
      if (act === 'wash') return callApi(() => api('/api/items/'+itemId+'/action', { method:'POST', body: JSON.stringify({ step:'冲洗', note:'进入冲洗' }) }));
      if (act === 'pass') return callApi(() => api('/api/items/'+itemId+'/inspection', { method:'POST', body: JSON.stringify({ passed:true, note:'复晒复验合格' }) }));
      if (act === 'box') {
        const item = items.find(i => encodeURIComponent(i.id || i.code) === itemId);
        const box = prompt('确认存放盒位（保留原盒位可直接确定）', item?.box || '');
        if (box === null) return;
        return callApi(() => api('/api/items/'+itemId+'/box', { method:'POST', body: JSON.stringify({ box, note: box ? '放入 '+box : '入盒' }) }));
      }
      if (act === 'deliver') return callApi(() => api('/api/items/'+itemId+'/deliver', { method:'POST', body: JSON.stringify({ note:'底片交付' }) }));
    });
    async function load() { items = await api('/api/items'); render(); }
    createForm.onsubmit = async event => { event.preventDefault(); await api('/api/items', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(createForm).entries())) }); createForm.reset(); await load(); };
    actionForm.onsubmit = async event => { event.preventDefault(); await callApi(() => api('/api/items/'+itemSelect.value+'/action', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(actionForm).entries())) })); actionForm.reset(); await load(); };
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
      const item = {
        id: newId("CN"),
        ...Object.fromEntries(fields.map(([key]) => [key, input[key] ?? ""])),
        status: stages.includes(input.status) ? input.status : "待曝光",
        reworks: [],
        repairs: [],
        logs: [{ at: now(), step: "建档", note: "创建底片" }]
      };
      db.items.unshift(item);
      await saveDb(db);
      return send(res, 201, summarize(item));
    }
    const patch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
    if (patch && req.method === "PATCH") {
      const item = findItem(db, decodeURIComponent(patch[1]));
      if (!item) return send(res, 404, { error: "底片不存在" });
      const input = await body(req);
      // 只允许改档案字段，状态必须走进流程接口，返工/修补记录只追加不改写
      for (const key of editableFields) {
        if (input[key] !== undefined) item[key] = input[key];
      }
      addLog(item, "编辑", "更新底片档案");
      await saveDb(db);
      return send(res, 200, summarize(item));
    }
    const log = url.pathname.match(/^\/api\/items\/([^/]+)\/logs$/);
    if (log && req.method === "POST") {
      const item = findItem(db, decodeURIComponent(log[1]));
      if (!item) return send(res, 404, { error: "底片不存在" });
      const input = await body(req);
      addLog(item, input.step || "备注", input.note || "");
      await saveDb(db);
      return send(res, 201, summarize(item));
    }
    const action = url.pathname.match(/^\/api\/items\/([^/]+)\/action$/);
    if (action && req.method === "POST") {
      const item = findItem(db, decodeURIComponent(action[1]));
      if (!item) return send(res, 404, { error: "底片不存在" });
      const input = await body(req);
      const step = input.step || "工艺";
      const data = {};
      for (const key of ["developStatus","defect","repair","note"]) if (input[key]) data[key] = input[key];
      addStep(item, step, data);
      // 只有“冲洗”推动状态到冲洗中，其余步骤记录留痕，不再把状态重置回待曝光
      if (step === "冲洗" && item.status === "待曝光") item.status = "冲洗中";
      addLog(item, step, input.note || input.developStatus || "步骤记录");
      await saveDb(db);
      return send(res, 201, summarize(item));
    }
    // 复晒不合格：登记返工原因，底片回到冲洗中；曝光、水源、盒位一律保留
    const rework = url.pathname.match(/^\/api\/items\/([^/]+)\/rework$/);
    if (rework && req.method === "POST") {
      const item = findItem(db, decodeURIComponent(rework[1]));
      if (!item) return send(res, 404, { error: "底片不存在" });
      const input = await body(req);
      const reason = (input.reason || "").trim();
      if (!reason) return send(res, 400, { error: "请填写返工原因" });
      if (item.status !== "冲洗中" && item.status !== "待入盒") {
        return send(res, 400, { error: "当前状态为「" + item.status + "」，不能登记复晒返工" });
      }
      const record = {
        id: newId("RW"),
        at: now(),
        reason,
        developStatus: input.developStatus || "不合格",
        defect: input.defect || "",
        note: input.note || "",
        resolvedAt: null,
        resolveNote: null
      };
      item.reworks ||= [];
      item.reworks.push(record);
      addStep(item, "复晒", { developStatus: "不合格", defect: record.defect, note: "返工：" + reason });
      item.status = "冲洗中";
      addLog(item, "复晒不合格", "登记返工，底片回到冲洗中；原因：" + reason);
      await saveDb(db);
      return send(res, 201, summarize(item));
    }
    // 复晒复验：合格则结掉全部未结返工（旧记录保留，只补复验结论）；不合格则新增一条返工
    const inspection = url.pathname.match(/^\/api\/items\/([^/]+)\/inspection$/);
    if (inspection && req.method === "POST") {
      const item = findItem(db, decodeURIComponent(inspection[1]));
      if (!item) return send(res, 404, { error: "底片不存在" });
      const input = await body(req);
      if (input.passed === false) {
        const reason = (input.reason || input.note || "").trim();
        if (!reason) return send(res, 400, { error: "复验不合格请填写返工原因" });
        const record = {
          id: newId("RW"),
          at: now(),
          reason,
          developStatus: input.developStatus || "复验不合格",
          defect: input.defect || "",
          note: "复验仍不合格",
          resolvedAt: null,
          resolveNote: null
        };
        item.reworks ||= [];
        item.reworks.push(record);
        item.status = "冲洗中";
        addStep(item, "复晒复验", { developStatus: "不合格", note: "再次返工：" + reason });
        addLog(item, "复验不合格", "底片回到冲洗中；原因：" + reason);
        await saveDb(db);
        return send(res, 201, summarize(item));
      }
      const open = openReworks(item);
      const note = (input.note || "复晒复验合格").trim();
      const at = now();
      for (const r of open) {
        r.resolvedAt = at;
        r.resolveNote = note;
      }
      addStep(item, "复晒复验", { developStatus: "合格", note: open.length ? "结掉返工 " + open.length + " 条" : note });
      addLog(item, "复晒合格", open.length ? "复验合格，结掉返工 " + open.length + " 条，可办理入盒" : note);
      await saveDb(db);
      return send(res, 201, summarize(item));
    }
    // 修补：记录处理结果；未处理完的修补会拦住入盒
    const repairs = url.pathname.match(/^\/api\/items\/([^/]+)\/repairs$/);
    if (repairs && req.method === "POST") {
      const item = findItem(db, decodeURIComponent(repairs[1]));
      if (!item) return send(res, 404, { error: "底片不存在" });
      const input = await body(req);
      const result = (input.result || "").trim();
      if (!result) return send(res, 400, { error: "请填写修补处理结果" });
      if (item.status !== "冲洗中" && item.status !== "待入盒") {
        return send(res, 400, { error: "当前状态为「" + item.status + "」，不能登记修补" });
      }
      const record = {
        id: newId("RP"),
        at: now(),
        defect: input.defect || "",
        result,
        completed: input.completed === true || input.completed === "1" || input.completed === "true",
        note: input.note || "",
        closedAt: null,
        closeNote: null
      };
      item.repairs ||= [];
      // 本次修补处理完时，结掉此前未完的修补；旧记录保留，只追加闭环时间与说明
      if (record.completed) {
        const open = unfinishedRepairs(item);
        const at = now();
        for (const r of open) {
          r.closedAt = at;
          r.closeNote = "由后续修补「" + result.slice(0, 30) + "」确认处理完";
        }
      }
      item.repairs.push(record);
      addStep(item, "修补", { defect: record.defect, repair: result, note: record.completed ? "已处理完" : "处理未完" });
      addLog(item, "修补", (record.completed ? "已处理完：" : "处理未完：") + result);
      await saveDb(db);
      return send(res, 201, summarize(item));
    }
    // 入盒：未结返工或未处理完的修补都不能入盒
    const box = url.pathname.match(/^\/api\/items\/([^/]+)\/box$/);
    if (box && req.method === "POST") {
      const item = findItem(db, decodeURIComponent(box[1]));
      if (!item) return send(res, 404, { error: "底片不存在" });
      const rw = openReworks(item);
      if (rw.length > 0) {
        return send(res, 400, { error: "有 " + rw.length + " 条复晒返工未复验合格，不能入盒（最近原因：" + rw.at(-1).reason + "）" });
      }
      const rp = unfinishedRepairs(item);
      if (rp.length > 0) {
        return send(res, 400, { error: "有 " + rp.length + " 处修补未处理完，不能入盒（最近处理：" + rp.at(-1).result + "）" });
      }
      if (item.status !== "冲洗中" && item.status !== "待入盒") {
        return send(res, 400, { error: "当前状态为「" + item.status + "」，不能入盒" });
      }
      const input = await body(req);
      if ((input.box || "").trim()) item.box = input.box.trim();
      item.status = "待入盒";
      addStep(item, "入盒", { note: input.note || ("放入 " + (item.box || "待定盒位")) });
      addLog(item, "入盒", input.note || ("放入 " + (item.box || "待定盒位")));
      await saveDb(db);
      return send(res, 201, summarize(item));
    }
    // 交付：有未结返工先提示处理
    const deliver = url.pathname.match(/^\/api\/items\/([^/]+)\/deliver$/);
    if (deliver && req.method === "POST") {
      const item = findItem(db, decodeURIComponent(deliver[1]));
      if (!item) return send(res, 404, { error: "底片不存在" });
      const rw = openReworks(item);
      if (rw.length > 0) {
        return send(res, 400, { error: "还有 " + rw.length + " 条未结返工，请先复验合格再交付（最近原因：" + rw.at(-1).reason + "）" });
      }
      if (item.status !== "待入盒") {
        return send(res, 400, { error: "当前状态为「" + item.status + "」，需先入盒才能交付" });
      }
      const input = await body(req);
      item.status = "已交付";
      addStep(item, "交付", { note: input.note || "底片交付" });
      addLog(item, "交付", input.note || "底片交付");
      await saveDb(db);
      return send(res, 201, summarize(item));
    }
    if (req.method === "GET" && url.pathname === "/api/stats") return send(res, 200, computeStats(db.items));
    send(res, 404, { error: "not_found" });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});
server.listen(port, () => console.log("古法蓝晒底片整理室 listening on http://localhost:" + port));
