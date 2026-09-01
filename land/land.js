/* land.js — 土地分割シミュレーター
 *
 * 考え方はふたつだけ。
 *   1. ワールド座標は「メートル」。画面はそこへの平行移動＋一様拡大でしか写さない（回転しない）。
 *   2. 区画は多角形ではなく「50cm セルの集合」で持つ。だから斜めの線は原理的に生まれず、
 *      面積は数え上げるだけで厳密に出る。
 *
 * 画像のほうを回して・拡大してグリッドに合わせる（寸法モード）。
 * グリッドは常に真っ直ぐなので、分割モード側は何も考えずに済む。
 */
"use strict";
(function () {

/* ============================ 定数 ============================ */

const CELL  = 0.5;            // グリッドの目（m）
const TSUBO = 3.3057851;      // 1坪 = 400/121 ㎡
const KEY   = "landsim/doc/v1";
const IKEY  = "landsim/img/v1";
const PAL = ["#E8582C","#2E9BD6","#3FA24A","#B8860B","#7C5CD0","#D2477E","#0E9C96","#6B7A8F"];

/* ============================ 小物 ============================ */

const $  = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const uid = () => Math.random().toString(36).slice(2, 9);

/* 長さ。グリッド上の値は 6.5m のように末尾の 0 を落とす。 */
function mStr(m) {
  const s = Math.abs(m) < 100 ? m.toFixed(2) : m.toFixed(1);
  return s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") + "m";
}
function mCm(m) { return mStr(m) + "（" + Math.round(m * 100).toLocaleString() + "cm）"; }
const m2Str = a => a.toFixed(2) + "㎡";
const tsuboStr = a => (a / TSUBO).toFixed(2) + "坪";

let toastT = 0;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2200);
}

/* ============================ セル ============================ */
/* セルは "cx,cy" の文字列キー。cx = floor(x / CELL)。 */

const ckey = (cx, cy) => cx + "," + cy;
const cxOf = k => +k.slice(0, k.indexOf(","));
const cyOf = k => +k.slice(k.indexOf(",") + 1);
const cellAt = (x, y) => ckey(Math.floor(x / CELL), Math.floor(y / CELL));

/* 連続する整数を [開始, 終了] にまとめる */
function toRuns(nums) {
  nums = [...nums].sort((a, b) => a - b);
  const out = []; let s = nums[0], p = nums[0];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] === p) continue;
    if (nums[i] === p + 1) { p = nums[i]; continue; }
    out.push([s, p]); s = p = nums[i];
  }
  if (nums.length) out.push([s, p]);
  return out;
}

/* 保存用に行ごとの連長圧縮にする。[cy, cx開始, 個数] の配列。 */
function packCells(set) {
  const rows = new Map();
  for (const k of set) {
    const y = cyOf(k); if (!rows.has(y)) rows.set(y, []); rows.get(y).push(cxOf(k));
  }
  const out = [];
  for (const [y, xs] of [...rows].sort((a, b) => a[0] - b[0]))
    for (const [a, b] of toRuns(xs)) out.push([y, a, b - a + 1]);
  return out;
}
function unpackCells(runs) {
  const s = new Set();
  for (const r of runs || []) for (let i = 0; i < r[2]; i++) s.add(ckey(r[1] + i, r[0]));
  return s;
}

/* セルの外周を、まとまった直線の辺として返す。ここが「何mから何mまで」の元になる。 */
function outline(set) {
  const H = new Map(), V = new Map();
  const add = (m, k, i) => { if (!m.has(k)) m.set(k, []); m.get(k).push(i); };
  for (const k of set) {
    const x = cxOf(k), y = cyOf(k);
    if (!set.has(ckey(x, y - 1))) add(H, y + "|t", x);
    if (!set.has(ckey(x, y + 1))) add(H, (y + 1) + "|b", x);
    if (!set.has(ckey(x - 1, y))) add(V, x + "|l", y);
    if (!set.has(ckey(x + 1, y))) add(V, (x + 1) + "|r", y);
  }
  const segs = [];
  for (const [key, xs] of H) {
    const gy = +key.slice(0, key.indexOf("|")), nyv = key.endsWith("t") ? -1 : 1;
    for (const [a, b] of toRuns(xs))
      segs.push({ x1: a * CELL, y1: gy * CELL, x2: (b + 1) * CELL, y2: gy * CELL,
                  len: (b - a + 1) * CELL, nx: 0, ny: nyv });
  }
  for (const [key, ys] of V) {
    const gx = +key.slice(0, key.indexOf("|")), nxv = key.endsWith("l") ? -1 : 1;
    for (const [a, b] of toRuns(ys))
      segs.push({ x1: gx * CELL, y1: a * CELL, x2: gx * CELL, y2: (b + 1) * CELL,
                  len: (b - a + 1) * CELL, nx: nxv, ny: 0 });
  }
  return segs;
}

/* 塗り用。行ごとに横方向へつないだ矩形の集合。 */
function fillRects(set) {
  const rows = new Map();
  for (const k of set) { const y = cyOf(k); if (!rows.has(y)) rows.set(y, []); rows.get(y).push(cxOf(k)); }
  const out = [];
  for (const [y, xs] of rows) for (const [a, b] of toRuns(xs))
    out.push([a * CELL, y * CELL, (b - a + 1) * CELL, CELL]);
  return out;
}

function bbox(set) {
  if (!set.size) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const k of set) {
    const x = cxOf(k), y = cyOf(k);
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x: x0 * CELL, y: y0 * CELL, w: (x1 - x0 + 1) * CELL, h: (y1 - y0 + 1) * CELL };
}
const areaOf = set => set.size * CELL * CELL;

/* ============================ 図面（保存対象） ============================ */

function newParcel(plan) {
  const used = new Set(plan.parcels.map(p => p.color));
  const color = PAL.find(c => !used.has(c)) || PAL[plan.parcels.length % PAL.length];
  const name = "区画" + String.fromCharCode(65 + plan.parcels.length);
  return { id: uid(), name, color, cells: new Set(), type: doc.price.types[0].id };
}

/* 価格のはじきかた。
   総額はいじらず、区画のあいだで配り方だけを変える。
   重み = 面積 × 地型の係数。旗竿地の係数を 0.7 にすれば、その分だけ整形地が高くなる。 */
function defPrice() {
  const t1 = uid(), t2 = uid();
  return {
    total: 0,                          // 全体の価格（万円）
    areaManual: false, totalArea: 0,   // 全体面積。既定は敷地の実測。
    types: [{ id: t1, name: "整形地" }, { id: t2, name: "旗竿地" }],
    cases: [{ id: uid(), name: "ケース1", coef: { [t1]: 1, [t2]: 0.7 } }],
    cur: 0
  };
}
const pcase = () => doc.price.cases[clamp(doc.price.cur, 0, doc.price.cases.length - 1)];
const coefOf = tid => { const c = pcase().coef[tid]; return c == null ? 1 : c; };
const typeName = tid => { const t = doc.price.types.find(t => t.id === tid); return t ? t.name : "—"; };
function totalArea() {
  const p = doc.price;
  if (p.areaManual && p.totalArea > 0) return p.totalArea;
  if (doc.site.size) return areaOf(doc.site);
  return plan().parcels.reduce((a, q) => a + areaOf(q.cells), 0);
}
/* 現在の案について、区画ごとの面積・重み・価格を出す。合計は必ず総額に一致する。 */
function priceTable() {
  const rows = plan().parcels.filter(p => p.cells.size).map(p => {
    const a = areaOf(p.cells), c = coefOf(p.type);
    return { p, a, c, w: a * c };
  });
  const sw = rows.reduce((s, r) => s + r.w, 0);
  const total = doc.price.total || 0;
  for (const r of rows) {
    r.price = sw > 0 ? total * r.w / sw : 0;
    r.perTsubo = r.a > 0 ? r.price / (r.a / TSUBO) : 0;
    r.perM2 = r.a > 0 ? r.price / r.a : 0;
  }
  return { rows, sumArea: rows.reduce((s, r) => s + r.a, 0), total, n: rows.length };
}
const manStr = v => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(1).replace(/\.0$/, "")) + "万円";
function newPlan(name) { const p = { id: uid(), name, parcels: [] }; p.parcels.push(newParcel(p)); return p; }

let doc = {
  img: null,        // {w,h,cx,cy,mpp,rot,op} — cx,cy は画像中心のワールド座標、mpp は画像1px あたりの m
  ref: null,        // {ax,ay,bx,by,len} — 基準線。座標は画像ピクセル、len は実長(m)
  site: new Set(),  // 敷地
  siteName: "敷地",
  price: null,      // 下で入れる（defPrice は doc を参照しないが、newParcel が doc.price を見るため）
  plans: [],
  cur: 0
};
doc.price = defPrice();
doc.plans = [newPlan("案A")];
let imgSrc = null;                       // 画像の dataURL（履歴には積まない）
let imgEl = null;                        // 読み込み済み Image

let ui = {
  mode: "dim", tool: "ref", sel: null,   // sel: "site" または区画 id
  grid: true, dims: true, tsubo: true, theme: "light", panel: true
};
let view = { x: -6, y: -5, k: 26 };      // 画面左上のワールド座標と、1m あたりの px

const plan = () => doc.plans[doc.cur];
const SITE = { id: "site", name: "敷地", color: "#0E9C96" };
function target() {                       // いま描き込む先
  if (ui.sel === "site") return { kind: "site", obj: SITE, cells: doc.site };
  const p = plan().parcels.find(q => q.id === ui.sel);
  return p ? { kind: "parcel", obj: p, cells: p.cells } : null;
}

/* ---- 保存 ---- */
function serialize() {
  return {
    v: 1, img: doc.img, ref: doc.ref, site: packCells(doc.site), cur: doc.cur, siteName: SITE.name, price: doc.price,
    plans: doc.plans.map(p => ({ id: p.id, name: p.name,
      parcels: p.parcels.map(q => ({ id: q.id, name: q.name, color: q.color, type: q.type, cells: packCells(q.cells) })) })),
    ui: { mode: ui.mode, tool: ui.tool, sel: ui.sel, grid: ui.grid, dims: ui.dims, tsubo: ui.tsubo, theme: ui.theme },
    view
  };
}
let saveT = 0;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(serialize())); }
    catch (e) { toast("保存できませんでした（容量オーバー）"); }
  }, 400);
}
function saveImage() {
  try { imgSrc ? localStorage.setItem(IKEY, imgSrc) : localStorage.removeItem(IKEY); }
  catch (e) { toast("画像が大きすぎて保存できません。この画面では使えます"); }
}
function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
  if (!raw) return false;
  const price = raw.price && raw.price.types && raw.price.types.length ? raw.price : defPrice();
  if (!price.cases || !price.cases.length) price.cases = defPrice().cases;
  doc = {
    img: raw.img || null, ref: raw.ref || null, site: unpackCells(raw.site), price,
    plans: (raw.plans || []).map(p => ({ id: p.id, name: p.name,
      parcels: (p.parcels || []).map(q => ({ id: q.id, name: q.name, color: q.color,
        type: q.type || price.types[0].id, cells: unpackCells(q.cells) })) })),
    cur: raw.cur || 0, siteName: raw.siteName || "敷地"
  };
  if (!doc.plans.length) doc.plans = [newPlan("案A")];
  doc.cur = clamp(doc.cur, 0, doc.plans.length - 1);
  Object.assign(ui, raw.ui || {});
  if (raw.view) view = raw.view;
  try { imgSrc = localStorage.getItem(IKEY); } catch (e) {}
  return true;
}

/* ---- 元に戻す ---- */
function cloneDoc(d) {
  return {
    img: d.img ? { ...d.img } : null, ref: d.ref ? { ...d.ref } : null, site: new Set(d.site),
    siteName: d.siteName, price: JSON.parse(JSON.stringify(d.price)),
    plans: d.plans.map(p => ({ id: p.id, name: p.name,
      parcels: p.parcels.map(q => ({ id: q.id, name: q.name, color: q.color, type: q.type, cells: new Set(q.cells) })) })),
    cur: d.cur
  };
}
let past = [], future = [];
function mark() {                    // 変更する「直前」に呼ぶ
  past.push(cloneDoc(doc));
  if (past.length > 60) past.shift();
  future = [];
  syncHistBtns();
}
function commit() { save(); draw(); renderPanel(); }
function undo() {
  if (!past.length) return toast("これ以上は戻せません");
  future.push(cloneDoc(doc)); doc = past.pop(); fixSel(); syncHistBtns(); commit();
}
function redo() {
  if (!future.length) return toast("やり直せる操作はありません");
  past.push(cloneDoc(doc)); doc = future.pop(); fixSel(); syncHistBtns(); commit();
}
function syncHistBtns() {
  const u = document.getElementById("btn-undo"), r = document.getElementById("btn-redo");
  if (u) u.disabled = !past.length;
  if (r) r.disabled = !future.length;
}
function fixSel() {
  if (ui.sel === "site") return;
  if (!plan().parcels.some(p => p.id === ui.sel)) ui.sel = plan().parcels[0] ? plan().parcels[0].id : "site";
}

/* ============================ 座標変換 ============================ */

const w2s = (x, y) => ({ x: (x - view.x) * view.k, y: (y - view.y) * view.k });
const s2w = (x, y) => ({ x: x / view.k + view.x, y: y / view.k + view.y });
const snapNode = v => Math.round(v / CELL) * CELL;   // 一番近い格子点へ

/* 画像ピクセル → ワールド */
function i2w(px, py) {
  const g = doc.img, c = Math.cos(g.rot), s = Math.sin(g.rot);
  const ex = (px - g.w / 2) * g.mpp, ey = (py - g.h / 2) * g.mpp;
  return { x: g.cx + ex * c - ey * s, y: g.cy + ex * s + ey * c };
}
/* ワールド → 画像ピクセル */
function w2i(x, y) {
  const g = doc.img, c = Math.cos(g.rot), s = Math.sin(g.rot);
  const dx = x - g.cx, dy = y - g.cy;
  const ex = dx * c + dy * s, ey = -dx * s + dy * c;
  return { x: ex / g.mpp + g.w / 2, y: ey / g.mpp + g.h / 2 };
}
/* 画像のある1点（画像ピクセル座標）を動かさずに、拡大や回転をやり直す */
function keepFixed(imgPt, fn) {
  const before = i2w(imgPt.x, imgPt.y);
  fn();
  const after = i2w(imgPt.x, imgPt.y);
  doc.img.cx += before.x - after.x;
  doc.img.cy += before.y - after.y;
}
/* 拡大・回転の軸。基準線があればその始点、なければ画像の中心。 */
function pivot() {
  if (doc.ref) return { x: doc.ref.ax, y: doc.ref.ay };
  return { x: doc.img.w / 2, y: doc.img.h / 2 };
}
function refWorld() {
  if (!doc.img || !doc.ref) return null;
  return { a: i2w(doc.ref.ax, doc.ref.ay), b: i2w(doc.ref.bx, doc.ref.by) };
}

/* ============================ 描画 ============================ */

const cv = $("#cv");
let ctx = cv.getContext("2d");
let exporting = false;
let W = 0, H = 0, dpr = 1, C = {};
let raf = 0;

function readTheme() {
  const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim();
  C = { bg: g("--ink-1"), ink: g("--text"), ink2: g("--text-2"), muted: g("--muted"),
        line: g("--hairline"), line2: g("--hairline-2"), surface: g("--surface"),
        orange: g("--orange"), blue: g("--blue"), green: g("--green"), danger: g("--danger") };
}
function resize() {
  const r = cv.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  W = r.width; H = r.height;
  cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
  draw();
}
function draw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); }

/* セル集合を画面座標の Path2D にする */
function cellPath(cells) {
  const p = new Path2D(), k = view.k;
  for (const r of fillRects(cells)) {
    const a = w2s(r[0], r[1]);
    p.rect(a.x, a.y, r[2] * k, r[3] * k);
  }
  return p;
}
function segPath(segs) {
  const p = new Path2D();
  for (const s of segs) {
    const a = w2s(s.x1, s.y1), b = w2s(s.x2, s.y2);
    p.moveTo(a.x, a.y); p.lineTo(b.x, b.y);
  }
  return p;
}
/* 縁取り付きの文字。図の上でも必ず読める。 */
let boxes = [];                     // すでに文字を置いた場所。重ねないため。
function fontOf(o) {
  return (o.bold ? "700 " : "600 ") + (o.size || 12) + "px " +
    (o.num ? "ui-monospace,SFMono-Regular,Menlo,monospace" : "system-ui,sans-serif");
}
function free(x, y, w, h) {
  const b = { x: x - w / 2 - 3, y: y - h / 2 - 2, w: w + 6, h: h + 4 };
  for (const o of boxes)
    if (!(b.x + b.w < o.x || o.x + o.w < b.x || b.y + b.h < o.y || o.y + o.h < b.y)) return null;
  return b;
}
/* 置ければ置く。先に置いたものを優先する。 */
function tryLabel(txt, x, y, opt) {
  ctx.font = fontOf(opt);
  const b = free(x, y, ctx.measureText(txt).width, (opt.size || 12) * 1.25);
  if (!b) return false;
  boxes.push(b); label(txt, x, y, opt); return true;
}
function label(txt, x, y, opt) {
  const o = opt || {};
  ctx.font = fontOf(o);
  ctx.textAlign = o.align || "center"; ctx.textBaseline = o.base || "middle";
  ctx.lineJoin = "round"; ctx.lineWidth = o.halo || 3.5;
  ctx.strokeStyle = C.bg; ctx.strokeText(txt, x, y);
  ctx.fillStyle = o.color || C.ink; ctx.fillText(txt, x, y);
}

function paint() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  boxes = [];

  drawImage();
  if (ui.grid) drawGrid();

  /* 敷地 */
  if (doc.site.size) {
    const p = cellPath(doc.site);
    ctx.fillStyle = hexA(SITE.color, .10); ctx.fill(p);
    ctx.setLineDash([7, 5]); ctx.lineWidth = 2; ctx.strokeStyle = SITE.color;
    ctx.stroke(segPath(outline(doc.site))); ctx.setLineDash([]);
  }

  /* 区画 */
  for (const p of plan().parcels) {
    if (!p.cells.size) continue;
    const on = p.id === ui.sel;
    ctx.fillStyle = hexA(p.color, on ? .40 : .26); ctx.fill(cellPath(p.cells));
    const sp = segPath(outline(p.cells));
    if (on) { ctx.lineWidth = 6; ctx.strokeStyle = hexA(p.color, .28); ctx.stroke(sp); }
    ctx.lineWidth = on ? 3 : 2; ctx.strokeStyle = p.color; ctx.lineJoin = "round"; ctx.stroke(sp);
  }

  if (ui.mode === "dim") drawRef();
  drawDrag();
  if (ui.dims) drawDims();
  drawMeasure();
  drawScaleBar();
}

function hexA(hex, a) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")";
}

function drawImage() {
  if (!imgEl || !doc.img) return;
  const g = doc.img, c = w2s(g.cx, g.cy), s = g.mpp * view.k;
  ctx.save();
  ctx.globalAlpha = g.op == null ? 1 : g.op;
  ctx.translate(c.x, c.y); ctx.rotate(g.rot); ctx.scale(s, s);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  try { ctx.drawImage(imgEl, -g.w / 2, -g.h / 2); } catch (e) {}
  ctx.restore();
  if (ui.mode === "dim") {          /* 画像の外周。どこまでが画像か分かるように。 */
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(g.rot); ctx.scale(s, s);
    ctx.lineWidth = 1 / s; ctx.strokeStyle = C.line2; ctx.setLineDash([6 / s, 4 / s]);
    ctx.strokeRect(-g.w / 2, -g.h / 2, g.w, g.h);
    ctx.restore(); ctx.setLineDash([]);
  }
}

function drawGrid() {
  const k = view.k;
  const tiers = [];
  if (CELL * k >= 7) tiers.push([CELL, C.line, 1, .55]);
  if (1 * k >= 7) tiers.push([1, C.line, 1, 1]);
  let big = 5; while (big * k < 34) big *= 2;
  tiers.push([big, C.line2, 1.3, 1]);
  const x0 = view.x, y0 = view.y, x1 = view.x + W / k, y1 = view.y + H / k;
  for (const [step, col, lw, al] of tiers) {
    if ((x1 - x0) / step > 900 || (y1 - y0) / step > 900) continue;
    ctx.beginPath();
    for (let g = Math.ceil(x0 / step) * step; g <= x1; g += step) {
      const sx = Math.round((g - x0) * k) + .5; ctx.moveTo(sx, 0); ctx.lineTo(sx, H);
    }
    for (let g = Math.ceil(y0 / step) * step; g <= y1; g += step) {
      const sy = Math.round((g - y0) * k) + .5; ctx.moveTo(0, sy); ctx.lineTo(W, sy);
    }
    ctx.globalAlpha = al; ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.stroke(); ctx.globalAlpha = 1;
  }
  /* 大目盛りに実距離の目印を置く。「ここからここまで何m」を目で追えるように。 */
  if (big * k >= 46) {
    const top = 62, o = { size: 10, align: "left", base: "top", color: C.muted, num: true, halo: 3 };
    for (let g = Math.ceil(x0 / big) * big; g <= x1; g += big) {
      const sx = (g - x0) * k + 3; if (sx < 14) continue;
      ctx.font = fontOf(o);
      boxes.push({ x: sx - 3, y: top - 2, w: ctx.measureText(fmtGrid(g)).width + 6, h: 16 });
      label(fmtGrid(g), sx, top, o);
    }
    for (let g = Math.ceil(y0 / big) * big; g <= y1; g += big) {
      const sy = (g - y0) * k + 2; if (sy < top) continue;
      ctx.font = fontOf(o);
      boxes.push({ x: 0, y: sy - 2, w: ctx.measureText(fmtGrid(g)).width + 6, h: 16 });
      label(fmtGrid(g), 3, sy, o);
    }
  }
}
const fmtGrid = v => (Math.abs(v) < 1e-9 ? "0" : (v % 1 ? v.toFixed(1) : String(v))) + "m";

function drawRef() {
  const r = refWorld(); if (!r) return;
  const a = w2s(r.a.x, r.a.y), b = w2s(r.b.x, r.b.y);
  ctx.setLineDash([]); ctx.lineWidth = 3; ctx.strokeStyle = C.orange;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  for (const p of [a, b]) {
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 7); ctx.fillStyle = C.bg; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = C.orange; ctx.stroke();
  }
  const t = "基準 " + mStr(doc.ref.len), o = { color: C.orange, bold: true, size: 13, num: true };
  const lx = (a.x + b.x) / 2, ly = (a.y + b.y) / 2 - 14;
  ctx.font = fontOf(o);
  boxes.push({ x: lx - ctx.measureText(t).width / 2 - 3, y: ly - 10, w: ctx.measureText(t).width + 6, h: 20 });
  label(t, lx, ly, o);
}

/* 区画名・面積と、外周の各辺の長さ。
   狭いところに詰め込んでも読めないので、重なるものは黙って捨てる。
   優先順位は「選択中の区画 → ほかの区画 → 敷地 → 辺の長さ」。 */
function drawDims() {
  const sel = plan().parcels.find(p => p.id === ui.sel);
  const order = [];
  if (sel && sel.cells.size) order.push(sel);
  for (const p of plan().parcels) if (p.cells.size && p !== sel) order.push(p);
  const pr = new Map(priceTable().rows.map(r => [r.p.id, r]));

  for (const p of order) parcelTag(p, pr.get(p.id));
  if (doc.site.size) siteTag();
  for (const p of order) edgeTags(p, p === sel);
}
function parcelTag(p, pr) {
  const bb = bbox(p.cells), c = anchor(p.cells, bb), s = w2s(c.x, c.y);
  const wpx = bb.w * view.k, hpx = bb.h * view.k;
  if (wpx < 46 || hpx < 28) return;
  const a = areaOf(p.cells);
  const lines = [
    { t: p.name, o: { size: 13, bold: true, color: p.color } },
    { t: a.toFixed(2) + "㎡" + (ui.tsubo ? " / " + (a / TSUBO).toFixed(2) + "坪" : ""), o: { size: 11, num: true, color: C.ink2 } },
    { t: mStr(bb.w) + " × " + mStr(bb.h), o: { size: 10, num: true, color: C.muted } }
  ];
  if (pr && doc.price.total > 0) {
    lines.push({ t: manStr(pr.price), o: { size: 12, num: true, bold: true, color: C.ink } });
    lines.push({ t: pr.perTsubo.toFixed(1) + "万/坪", o: { size: 10, num: true, color: C.muted } });
  }
  /* 幅に収まる行だけを使う */
  const use = [];
  for (const l of lines) {
    ctx.font = fontOf(l.o);
    if (ctx.measureText(l.t).width + 8 <= wpx) use.push(l);
    else if (l === lines[1] && ui.tsubo) {          // 坪を落とせば入るなら落とす
      const t2 = a.toFixed(2) + "㎡";
      if (ctx.measureText(t2).width + 8 <= wpx) use.push({ t: t2, o: l.o });
    }
  }
  if (!use.length) return;
  const gap = 15, hAll = use.length * gap;
  if (hAll + 6 > hpx) use.length = Math.max(1, Math.floor((hpx - 6) / gap));
  let wMax = 0;
  for (const l of use) { ctx.font = fontOf(l.o); wMax = Math.max(wMax, ctx.measureText(l.t).width); }
  const h = use.length * gap;
  const b = free(s.x, s.y, wMax, h);
  if (!b) return;
  boxes.push(b);
  use.forEach((l, i) => label(l.t, s.x, s.y - h / 2 + gap / 2 + i * gap, l.o));
}
/* 敷地は真ん中を区画に譲り、左上の角に控えめに置く。 */
function siteTag() {
  const bb = bbox(doc.site), s = w2s(bb.x, bb.y);
  const a = areaOf(doc.site);
  const t = SITE.name + " " + a.toFixed(2) + "㎡" + (ui.tsubo ? " / " + (a / TSUBO).toFixed(2) + "坪" : "");
  const o = { size: 11, bold: true, num: true, color: SITE.color, align: "left", base: "top" };
  ctx.font = fontOf(o);
  const w = ctx.measureText(t).width;
  const x = s.x + 5, y = s.y + 5;
  const b = free(x + w / 2, y + 7, w, 15);
  if (!b) return;
  boxes.push(b); label(t, x, y, o);
}
function edgeTags(p, prio) {
  for (const g of outline(p.cells)) {
    const a = w2s(g.x1, g.y1), b = w2s(g.x2, g.y2);
    if (Math.hypot(b.x - a.x, b.y - a.y) < 40) continue;
    tryLabel(mStr(g.len), (a.x + b.x) / 2 + g.nx * 13, (a.y + b.y) / 2 + g.ny * 13,
             { size: 11, color: p.color, num: true, bold: true });
  }
}
/* ラベルを置く点。図形の内側で、いちばん幅のある行の中央。 */
function anchor(cells, bb) {
  const cy = Math.floor((bb.y + bb.h / 2) / CELL), cx = Math.floor((bb.x + bb.w / 2) / CELL);
  if (cells.has(ckey(cx, cy))) return { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 };
  const rows = new Map();
  for (const k of cells) { const y = cyOf(k); if (!rows.has(y)) rows.set(y, []); rows.get(y).push(cxOf(k)); }
  let best = null;
  for (const [y, xs] of rows) for (const [a, b] of toRuns(xs))
    if (!best || b - a > best.n) best = { n: b - a, x: (a + b + 1) / 2 * CELL, y: (y + .5) * CELL };
  return best || { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 };
}

function drawScaleBar() {
  if (exporting) return;
  const bar = $("#scalebar");
  let m = 1; const want = Math.min(140, W * .3);
  const steps = [.5, 1, 2, 5, 10, 20, 50, 100, 200];
  m = steps.find(s => s * view.k >= 60) || 200;
  if (m * view.k > want) m = steps[Math.max(0, steps.indexOf(m) - 1)] || .5;
  bar.querySelector("i").style.width = (m * view.k) + "px";
  bar.querySelector("span").textContent = mStr(m);
}

/* ============================ 操作 ============================ */
/* 指1本＝道具、指2本＝地図の移動と拡大。ここを混ぜないのが、スマホで迷わないコツ。 */

const ptrs = new Map();
let drag = null, gest = null, measure = null, space = false;

const sp = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

cv.addEventListener("pointerdown", e => {
  e.preventDefault();
  try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  ptrs.set(e.pointerId, sp(e));
  if (ptrs.size === 2) { drag = null; hideTip(); startGest(); return; }
  if (ptrs.size > 2) return;
  const forcePan = e.button === 1 || e.button === 2 || space;
  startDrag(sp(e), forcePan ? "pan" : ui.tool);
});
cv.addEventListener("pointermove", e => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, sp(e));
  if (gest) return moveGest();
  if (drag) moveDrag(sp(e));
});
for (const ev of ["pointerup", "pointercancel"]) cv.addEventListener(ev, e => {
  ptrs.delete(e.pointerId);
  if (gest) {
    if (ptrs.size < 2) { gest = null; save(); }
    if (ptrs.size === 1) startDrag([...ptrs.values()][0], "pan");   // 残った指でそのまま移動へ
    return;
  }
  if (drag && ptrs.size === 0) { endDrag(); drag = null; hideTip(); }
});
cv.addEventListener("contextmenu", e => e.preventDefault());
cv.addEventListener("wheel", e => {
  e.preventDefault();
  const p = sp(e);
  if (e.ctrlKey || !e.shiftKey) zoomAt(p.x, p.y, view.k * Math.exp(-e.deltaY * 0.0016));
  else { view.x += e.deltaX / view.k; view.y += e.deltaY / view.k; draw(); save(); }
}, { passive: false });

function zoomAt(sx, sy, k) {
  const w = s2w(sx, sy);
  view.k = clamp(k, 1.5, 900);
  view.x = w.x - sx / view.k; view.y = w.y - sy / view.k;
  draw(); save();
}
function startGest() {
  const a = [...ptrs.values()], mid = { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 };
  gest = { d0: Math.max(1, Math.hypot(a[1].x - a[0].x, a[1].y - a[0].y)), k0: view.k, w: s2w(mid.x, mid.y) };
}
function moveGest() {
  const a = [...ptrs.values()]; if (a.length < 2) return;
  const mid = { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 };
  const d = Math.max(1, Math.hypot(a[1].x - a[0].x, a[1].y - a[0].y));
  view.k = clamp(gest.k0 * (d / gest.d0), 1.5, 900);
  view.x = gest.w.x - mid.x / view.k; view.y = gest.w.y - mid.y / view.k;
  draw();
}

/* ---- 道具 ---- */
function startDrag(p, tool) {
  drag = { tool, s0: p, s: p, a: s2w(p.x, p.y), b: s2w(p.x, p.y), moved: false, marked: false,
           v0: { x: view.x, y: view.y },
           g0: doc.img ? { cx: doc.img.cx, cy: doc.img.cy } : null, cells0: null, own: null };
  if (tool === "pick") {
    const hit = pickAt(drag.a);
    if (hit) { ui.sel = hit; renderPanel(); }
    const t = target();
    if (t && t.cells.has(cellAt(drag.a.x, drag.a.y))) { drag.cells0 = new Set(t.cells); drag.own = t; }
    draw();
  }
  if (tool === "ref" && !doc.img) { toast("先に画像を取り込んでください"); drag = null; return; }
  if ((tool === "draw" || tool === "erase") && !target()) { toast("描き込む先を選んでください"); drag = null; return; }
  showTipFor();
}
function moveDrag(p) {
  drag.s = p; drag.b = s2w(p.x, p.y);
  if (Math.hypot(p.x - drag.s0.x, p.y - drag.s0.y) > 4) drag.moved = true;
  const dxw = (p.x - drag.s0.x) / view.k, dyw = (p.y - drag.s0.y) / view.k;

  if (drag.tool === "pan") { view.x = drag.v0.x - dxw; view.y = drag.v0.y - dyw; }
  else if (drag.tool === "img") {
    if (!doc.img) return;
    if (drag.moved && !drag.marked) { mark(); drag.marked = true; }
    doc.img.cx = drag.g0.cx + dxw; doc.img.cy = drag.g0.cy + dyw;
  } else if (drag.tool === "pick" && drag.cells0) {
    if (drag.moved && !drag.marked) { mark(); drag.marked = true; drag.own = target(); }
    const dcx = Math.round(dxw / CELL), dcy = Math.round(dyw / CELL);
    const s = new Set();
    for (const k of drag.cells0) s.add(ckey(cxOf(k) + dcx, cyOf(k) + dcy));
    drag.own.cells.clear(); for (const k of s) drag.own.cells.add(k);
  }
  showTipFor(); draw();
}
function endDrag() {
  const d = drag;
  if (d.tool === "draw" || d.tool === "erase") {
    const rc = rectCells(d.a, d.b);
    if (rc) applyCells(rc, d.tool === "draw");
  } else if (d.tool === "ref" && d.moved) {
    askRef(d.a, d.b);
  } else if (d.tool === "measure") {
    if (d.moved) { measure = { a: snapPoint(d.a), b: snapPoint(d.b) }; }
    else measure = null;
  } else if (d.tool === "pick" && d.cells0 && d.marked) {
    const t = target();
    if (t && t.kind === "parcel") for (const p of plan().parcels)
      if (p.id !== t.obj.id) for (const k of t.cells) p.cells.delete(k);
  }
  save(); renderPanel(); draw();
}
function snapPoint(p) {
  return ui.mode === "div" ? { x: snapNode(p.x), y: snapNode(p.y) } : p;
}
function pickAt(w) {
  const k = cellAt(w.x, w.y);
  const ps = plan().parcels;
  for (let i = ps.length - 1; i >= 0; i--) if (ps[i].cells.has(k)) return ps[i].id;
  if (doc.site.has(k)) return "site";
  return null;
}
/* 2点を対角とする矩形が覆うセル。ここで必ずグリッドに吸着するので、斜めの線は出ない。 */
function rectCells(a, b) {
  const x0 = Math.min(Math.floor(a.x / CELL), Math.floor(b.x / CELL));
  const x1 = Math.max(Math.floor(a.x / CELL), Math.floor(b.x / CELL));
  const y0 = Math.min(Math.floor(a.y / CELL), Math.floor(b.y / CELL));
  const y1 = Math.max(Math.floor(a.y / CELL), Math.floor(b.y / CELL));
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 250000) { toast("範囲が広すぎます"); return null; }
  return { x0, y0, x1, y1 };
}
function applyCells(r, add) {
  const t = target(); if (!t) return;
  mark();
  const touched = [];
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
    const k = ckey(x, y);
    if (add) { t.cells.add(k); touched.push(k); } else t.cells.delete(k);
  }
  /* 区画同士は重ねない。あとから引いたほうが勝つ。 */
  if (add && t.kind === "parcel")
    for (const p of plan().parcels) if (p.id !== t.obj.id) for (const k of touched) p.cells.delete(k);
  commit();
}

/* ---- ドラッグ中の表示 ---- */
function drawDrag() {
  if (!drag || !drag.moved) return;
  if (drag.tool === "draw" || drag.tool === "erase") {
    const r = rectCells(drag.a, drag.b); if (!r) return;
    const t = target(); if (!t) return;
    const a = w2s(r.x0 * CELL, r.y0 * CELL);
    const w = (r.x1 - r.x0 + 1) * CELL * view.k, h = (r.y1 - r.y0 + 1) * CELL * view.k;
    const col = drag.tool === "draw" ? t.obj.color : C.danger;
    ctx.fillStyle = hexA(col, .30); ctx.fillRect(a.x, a.y, w, h);
    ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.setLineDash([6, 4]);
    ctx.strokeRect(a.x, a.y, w, h); ctx.setLineDash([]);
  } else if (drag.tool === "ref" || drag.tool === "measure") {
    const a0 = snapPoint(drag.a), b0 = snapPoint(drag.b);
    const a = w2s(a0.x, a0.y), b = w2s(b0.x, b0.y);
    ctx.lineWidth = 2.5; ctx.strokeStyle = drag.tool === "ref" ? C.orange : C.blue;
    ctx.setLineDash([8, 5]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
  }
}
function drawMeasure() {
  if (!measure) return;
  const a = w2s(measure.a.x, measure.a.y), b = w2s(measure.b.x, measure.b.y);
  ctx.lineWidth = 2.5; ctx.strokeStyle = C.blue;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  for (const p of [a, b]) {
    ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 7); ctx.fillStyle = C.bg; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = C.blue; ctx.stroke();
  }
  const d = Math.hypot(measure.b.x - measure.a.x, measure.b.y - measure.a.y);
  label(mStr(d), (a.x + b.x) / 2, (a.y + b.y) / 2 - 13, { color: C.blue, bold: true, size: 13, num: true });
}

function showTipFor() {
  if (!drag || !drag.moved) return hideTip();
  let txt = "";
  if (drag.tool === "draw" || drag.tool === "erase") {
    const r = rectCells(drag.a, drag.b); if (!r) return;
    const w = (r.x1 - r.x0 + 1) * CELL, h = (r.y1 - r.y0 + 1) * CELL;
    txt = mStr(w) + " × " + mStr(h) + "  " + m2Str(w * h) + (ui.tsubo ? " / " + tsuboStr(w * h) : "");
  } else if (drag.tool === "ref" || drag.tool === "measure") {
    const a = snapPoint(drag.a), b = snapPoint(drag.b);
    txt = mCm(Math.hypot(b.x - a.x, b.y - a.y));
  } else if (drag.tool === "img" && doc.img) {
    txt = "画像を移動";
  } else return hideTip();
  const t = $("#tip"); t.hidden = false; t.textContent = txt;
  t.style.left = drag.s.x + "px"; t.style.top = drag.s.y + "px";
}
function hideTip() { $("#tip").hidden = true; }

/* ============================ 画像 ============================ */

function pickFile() { $("#file").value = ""; $("#file").click(); }
$("#file").addEventListener("change", e => { const f = e.target.files[0]; if (f) readImage(f); });

function readImage(file) {
  if (!/^image\//.test(file.type)) return toast("画像ファイルを選んでください");
  const fr = new FileReader();
  fr.onload = () => shrink(fr.result);
  fr.onerror = () => toast("読み込みに失敗しました");
  fr.readAsDataURL(file);
}
/* 端末の写真はそのままだと保存に収まらない。長辺 2000px / JPEG に落とす。 */
function shrink(src) {
  const im = new Image();
  im.onload = () => {
    const MAX = 2000, w = im.naturalWidth, h = im.naturalHeight;
    if (Math.max(w, h) <= MAX && src.length < 1400000) return setImage(src, true);
    const s = Math.min(1, MAX / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    const cx = c.getContext("2d");
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, c.height);
    cx.drawImage(im, 0, 0, c.width, c.height);
    setImage(c.toDataURL("image/jpeg", 0.88), true);
  };
  im.onerror = () => toast("画像を読み込めませんでした");
  im.src = src;
}
function setImage(src, fresh) {
  const im = new Image();
  im.onload = () => {
    imgEl = im; imgSrc = src;
    if (fresh) {
      mark();
      const w = im.naturalWidth, h = im.naturalHeight;
      doc.img = { w, h, cx: 0, cy: 0, mpp: 20 / Math.max(w, h), rot: 0, op: 1 };
      doc.ref = null;
      saveImage();
      ui.mode = "dim"; ui.tool = "ref";
      toast("画像の中の「長さが分かっている辺」をなぞって、実寸を入れてください");
    }
    commit(); syncMode();
    if (fresh) requestAnimationFrame(fitAll);   // ドックの高さが決まってから合わせる
  };
  im.onerror = () => toast("画像を表示できませんでした");
  im.src = src;
}
function dropImage() {
  if (!doc.img) return;
  mark(); doc.img = null; doc.ref = null; imgEl = null; imgSrc = null;
  saveImage(); commit();
}

/* 画像とグリッドの対応づけ。ここが寸法モードの中心。 */
function askRef(aw, bw) {
  const a = w2i(aw.x, aw.y), b = w2i(bw.x, bw.y);
  if (Math.hypot(b.x - a.x, b.y - a.y) < 3) return;
  const cur = Math.hypot(b.x - a.x, b.y - a.y) * doc.img.mpp;

  const box = el("div");
  box.innerHTML =
    '<h2>この線の実際の長さ</h2>' +
    '<p class="hint" style="margin:0 0 12px">いま引いた線が、現地で何mあるかを入れてください。' +
    'これだけで画像全体の縮尺が決まり、50cmグリッドと一致します。</p>' +
    '<div class="row"><input type="number" id="rf-len" step="0.01" min="0.01" inputmode="decimal">' +
    '<select id="rf-unit"><option value="1">m</option><option value="0.01">cm</option></select></div>' +
    '<label class="chk"><input type="checkbox" id="rf-snap" checked>グリッドに合わせる（線をまっすぐ／端を格子点に）</label>' +
    '<div class="acts"><button class="btn" id="rf-no">やめる</button><button class="btn pri" id="rf-ok">この長さにする</button></div>';
  openModal(box);
  const inp = box.querySelector("#rf-len");
  inp.value = cur.toFixed(2); inp.select();
  box.querySelector("#rf-no").onclick = closeModal;
  box.querySelector("#rf-ok").onclick = () => {
    const v = parseFloat(inp.value) * parseFloat(box.querySelector("#rf-unit").value);
    if (!(v > 0)) return toast("長さを入れてください");
    applyRef(a, b, v, box.querySelector("#rf-snap").checked);
    closeModal();
  };
}
function applyRef(a, b, len, snap) {
  mark();
  const g = doc.img, px = Math.hypot(b.x - a.x, b.y - a.y);
  keepFixed(a, () => {
    g.mpp = len / px;
    if (snap) {
      const cur = g.rot + Math.atan2(b.y - a.y, b.x - a.x);          // いまのワールド上の向き
      const tgt = Math.round(cur / (Math.PI / 2)) * (Math.PI / 2);   // 一番近い直角へ倒す
      g.rot += tgt - cur;
    }
  });
  if (snap) {   // 起点を格子の交点に載せる
    const now = i2w(a.x, a.y);
    g.cx += snapNode(now.x) - now.x; g.cy += snapNode(now.y) - now.y;
  }
  doc.ref = { ax: a.x, ay: a.y, bx: b.x, by: b.y, len };
  commit(); requestAnimationFrame(fitAll);
  toast("縮尺を合わせました。分割モードへどうぞ");
}
/* 微調整。基準線の始点を軸に回す／伸ばすので、合わせた点がずれない。 */
function nudgeRot(deg) {
  if (!doc.img) return; mark();
  keepFixed(pivot(), () => { doc.img.rot += deg * Math.PI / 180; });
  commit();
}
function nudgeScale(pct) {
  if (!doc.img) return; mark();
  keepFixed(pivot(), () => { doc.img.mpp *= (1 + pct / 100); });
  if (doc.ref) doc.ref.len = Math.hypot(doc.ref.bx - doc.ref.ax, doc.ref.by - doc.ref.ay) * doc.img.mpp;
  commit();
}
function nudgeMove(dx, dy) {
  if (!doc.img) return; mark();
  doc.img.cx += dx; doc.img.cy += dy; commit();
}

/* ============================ 表示合わせ ============================ */

const wide = () => window.innerWidth >= 820;
function dockH() { const d = $("#dock"); return wide() ? 0 : d.getBoundingClientRect().height; }
function contentBox() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; };
  if (doc.img) for (const c of [[0, 0], [doc.img.w, 0], [0, doc.img.h], [doc.img.w, doc.img.h]]) {
    const p = i2w(c[0], c[1]); add(p.x, p.y);
  }
  for (const set of [doc.site].concat(plan().parcels.map(p => p.cells))) {
    const b = bbox(set); if (b) { add(b.x, b.y); add(b.x + b.w, b.y + b.h); }
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 20, h: 16 };
  return { x: x0, y: y0, w: Math.max(x1 - x0, .5), h: Math.max(y1 - y0, .5) };
}
function fitAll() {
  const b = contentBox();
  const L = 14, R = W - (wide() ? 360 : 0) - 14, T = 66, B = H - dockH() - 14;
  const aw = Math.max(60, R - L), ah = Math.max(60, B - T);
  view.k = clamp(Math.min(aw / b.w, ah / b.h), 1.5, 900);
  view.x = b.x + b.w / 2 - (L + aw / 2) / view.k;
  view.y = b.y + b.h / 2 - (T + ah / 2) / view.k;
  draw(); save();
}

/* ============================ 画面（下部ドック） ============================ */

const TOOLS = {
  dim: [["ref", "基準線"], ["img", "画像を動かす"], ["measure", "計測"], ["pan", "表示を動かす"]],
  div: [["draw", "区画を引く"], ["erase", "消す"], ["pick", "選択・移動"], ["measure", "計測"], ["pan", "表示を動かす"]]
};
function syncMode() {
  document.querySelectorAll(".modes button").forEach(b => b.classList.toggle("on", b.dataset.mode === ui.mode));
  if (!TOOLS[ui.mode].some(t => t[0] === ui.tool)) ui.tool = TOOLS[ui.mode][0][0];
  if (ui.mode === "div" && !target()) ui.sel = plan().parcels[0] ? plan().parcels[0].id : "site";
  renderTools(); renderPanel(); draw(); save();
}
function renderTools() {
  const box = $("#tools"); box.innerHTML = "";
  for (const [id, name] of TOOLS[ui.mode]) {
    const b = el("button", ui.tool === id ? "on" : "", name);
    b.onclick = () => { ui.tool = id; measure = null; renderTools(); renderPanel(); draw(); save(); };
    box.appendChild(b);
  }
}

function renderPanel() {
  const p = $("#panel"); p.innerHTML = "";
  p.appendChild(ui.mode === "dim" ? panelDim() : panelDiv());
  syncHistBtns();
}

/* ---- 寸法モード ---- */
function panelDim() {
  const w = el("div");
  if (!doc.img) {
    w.innerHTML =
      '<div class="sec"><h3>まず画像を取り込む</h3>' +
      '<p class="hint">測量図・公図・現況図・マイソクなど、土地の形が写っているものなら何でも。' +
      '取り込んだあと「基準線」で長さの分かっている辺をなぞり、実寸を入れると縮尺が決まります。</p></div>';
    const b = el("button", "btn pri wide", "画像を取り込む");
    b.onclick = pickFile; w.appendChild(b);
    const b2 = el("button", "btn wide", "画像なしで、グリッドだけで始める");
    b2.style.marginTop = "8px";
    b2.onclick = () => { ui.mode = "div"; syncMode(); };
    w.appendChild(b2);
    return w;
  }
  const g = doc.img;
  const s1 = sec("縮尺");
  s1.appendChild(kv("基準線", doc.ref ? mCm(doc.ref.len) : "未設定"));
  s1.appendChild(kv("画像1px", (g.mpp * 100).toFixed(2) + "cm"));
  s1.appendChild(kv("画像の実寸", mStr(g.w * g.mpp) + " × " + mStr(g.h * g.mpp)));
  s1.appendChild(kv("傾き", (((g.rot * 180 / Math.PI) % 360 + 360) % 360).toFixed(2) + "°"));
  const r1 = el("div", "row"); r1.style.marginTop = "8px";
  r1.appendChild(btn(doc.ref ? "基準線を引き直す" : "基準線を引く", "pri grow", () => {
    ui.tool = "ref"; renderTools(); toast("画像の上を、長さの分かっている辺に沿ってなぞってください");
  }));
  if (doc.ref) r1.appendChild(btn("長さを直す", "", () => {
    askRef(i2w(doc.ref.ax, doc.ref.ay), i2w(doc.ref.bx, doc.ref.by));
  }));
  s1.appendChild(r1);
  w.appendChild(s1);

  const s2 = sec("微調整");
  s2.appendChild(pad3("回転", ["-1°", "-0.1°", "±0", "+0.1°", "+1°"],
    [() => nudgeRot(-1), () => nudgeRot(-0.1), null, () => nudgeRot(0.1), () => nudgeRot(1)]));
  s2.appendChild(pad3("大きさ", ["-1%", "-0.1%", "±0", "+0.1%", "+1%"],
    [() => nudgeScale(-1), () => nudgeScale(-0.1), null, () => nudgeScale(0.1), () => nudgeScale(1)]));
  const step = el("div", "row"); step.style.marginTop = "10px";
  step.appendChild(el("span", "lab", "位置"));
  const sel = el("select");
  for (const v of [0.05, 0.1, 0.5, 1]) { const o = el("option", "", v + "m 動かす"); o.value = v; sel.appendChild(o); }
  sel.value = "0.1"; step.appendChild(sel); s2.appendChild(step);
  const pd = el("div", "pad"); pd.style.margin = "8px 0 0";
  const d = () => +sel.value;
  const cells = [["", null], ["↑", () => nudgeMove(0, -d())], ["", null],
                 ["←", () => nudgeMove(-d(), 0)], ["＋", () => { const p = pivot(); const wpt = i2w(p.x, p.y); nudgeMove(snapNode(wpt.x) - wpt.x, snapNode(wpt.y) - wpt.y); }], ["→", () => nudgeMove(d(), 0)],
                 ["", null], ["↓", () => nudgeMove(0, d())], ["", null]];
  for (const [t, fn] of cells) {
    const b = el("button", fn ? "" : "sp", t === "＋" ? "格子へ" : t);
    if (t === "＋") b.style.fontSize = "11px";
    if (fn) b.onclick = fn; else b.disabled = true;
    pd.appendChild(b);
  }
  s2.appendChild(pd);
  s2.appendChild(el("p", "hint", "画面を指1本でなぞると「画像を動かす」、指2本で表示の拡大・移動です。"));
  w.appendChild(s2);

  const s3 = sec("画像の濃さ");
  const rg = el("input"); rg.type = "range"; rg.min = "0.15"; rg.max = "1"; rg.step = "0.05";
  rg.value = String(g.op == null ? 1 : g.op);
  rg.oninput = () => { g.op = +rg.value; draw(); };
  rg.onchange = save;
  s3.appendChild(rg);
  w.appendChild(s3);
  return w;
}

/* ---- 分割モード ---- */
function panelDiv() {
  const w = el("div");
  const s0 = sec("案");
  const r = el("div", "row wrap");
  const sel = el("select");
  doc.plans.forEach((p, i) => { const o = el("option", "", p.name); o.value = i; sel.appendChild(o); });
  sel.value = String(doc.cur);
  sel.onchange = () => { doc.cur = +sel.value; fixSel(); commit(); };
  r.appendChild(sel);
  r.appendChild(btn("＋新規", "sm", () => { mark(); doc.plans.push(newPlan("案" + String.fromCharCode(65 + doc.plans.length))); doc.cur = doc.plans.length - 1; fixSel(); commit(); }));
  r.appendChild(btn("複製", "sm", () => {
    mark();
    const src = plan();
    const cp = { id: uid(), name: src.name + "の写し",
      parcels: src.parcels.map(q => ({ id: uid(), name: q.name, color: q.color, type: q.type, cells: new Set(q.cells) })) };
    doc.plans.splice(doc.cur + 1, 0, cp); doc.cur++; fixSel(); commit();
  }));
  r.appendChild(btn("名前", "sm", () => askText("案の名前", plan().name, v => { mark(); plan().name = v; commit(); })));
  r.appendChild(btn("削除", "sm", () => {
    if (doc.plans.length < 2) return toast("案は1つ以上必要です");
    confirmBox("「" + plan().name + "」を削除しますか", () => {
      mark(); doc.plans.splice(doc.cur, 1); doc.cur = clamp(doc.cur, 0, doc.plans.length - 1); fixSel(); commit();
    });
  }));
  s0.appendChild(r);
  w.appendChild(s0);

  const pt = priceTable();
  const byId = new Map(pt.rows.map(r => [r.p.id, r]));

  const s1 = sec("描き込む先");
  const list = el("div", "list");
  list.appendChild(itemRow({ id: "site", name: SITE.name, color: SITE.color, cells: doc.site }, true, null));
  for (const p of plan().parcels) list.appendChild(itemRow(p, false, byId.get(p.id)));
  s1.appendChild(list);
  s1.appendChild(btn("＋ 区画を追加", "wide", () => {
    mark(); const p = newParcel(plan()); plan().parcels.push(p); ui.sel = p.id; commit();
  }));
  s1.appendChild(el("p", "hint", "選んだ先に、画面をなぞった四角が 50cm 単位で足されます。" +
    "何回か足せば L 字や旗竿もそのまま作れます。区画どうしは重なりません（あとから引いたほうが取ります）。"));
  w.appendChild(s1);

  /* ---- 合計 ---- */
  const all = totalArea(), used = pt.sumArea;
  const s2 = sec("合計");
  const t = el("div", "tot");
  t.appendChild(totBox("分割数", pt.n + " 区画", ""));
  t.appendChild(totBox("全体", all.toFixed(2) + "㎡", (all / TSUBO).toFixed(2) + "坪"));
  t.appendChild(totBox("残り", (all - used).toFixed(2) + "㎡", ((all - used) / TSUBO).toFixed(2) + "坪"));
  s2.appendChild(t);
  if (all - used > 0.005 && doc.price.total > 0)
    s2.appendChild(el("p", "hint", "価格は「区画の合計 " + used.toFixed(2) + "㎡」に対して割り戻しています。" +
      "残り " + (all - used).toFixed(2) + "㎡（道路・のりばなど）は配分していません。"));
  w.appendChild(s2);

  w.appendChild(panelPrice(pt, all));
  return w;
}

/* ---- 価格（面積按分と、地型ごとの係数） ---- */
function panelPrice(pt, all) {
  const P = doc.price;
  const s = sec("価格");

  const r1 = el("div", "row");
  r1.appendChild(el("span", "lab", "全体価格"));
  const inT = el("input"); inT.type = "number"; inT.step = "1"; inT.min = "0"; inT.inputMode = "decimal";
  inT.value = P.total || ""; inT.placeholder = "例）5800";
  inT.onchange = () => { mark(); P.total = Math.max(0, parseFloat(inT.value) || 0); commit(); };
  r1.appendChild(inT); r1.appendChild(el("span", "lab", "万円"));
  s.appendChild(r1);

  const r2 = el("div", "row");
  r2.appendChild(el("span", "lab", "全体面積"));
  const inA = el("input"); inA.type = "number"; inA.step = "0.01"; inA.min = "0"; inA.inputMode = "decimal";
  inA.value = P.areaManual ? (P.totalArea || "") : all.toFixed(2);
  inA.disabled = !P.areaManual;
  inA.onchange = () => { mark(); P.totalArea = Math.max(0, parseFloat(inA.value) || 0); commit(); };
  r2.appendChild(inA); r2.appendChild(el("span", "lab", "㎡"));
  s.appendChild(r2);
  const lm = el("label", "chk");
  const cm = el("input"); cm.type = "checkbox"; cm.checked = P.areaManual;
  cm.onchange = () => { mark(); P.areaManual = cm.checked; if (cm.checked && !P.totalArea) P.totalArea = +all.toFixed(2); commit(); };
  lm.appendChild(cm); lm.appendChild(document.createTextNode("全体面積を手で入れる（既定は敷地の実測）"));
  s.appendChild(lm);

  if (P.total > 0 && all > 0)
    s.appendChild(kv("全体の坪単価", (P.total / (all / TSUBO)).toFixed(2) + " 万円/坪"));

  /* ケース（係数の組み合わせ） */
  const r3 = el("div", "row wrap"); r3.style.marginTop = "10px";
  r3.appendChild(el("span", "lab", "ケース"));
  const cs = el("select");
  P.cases.forEach((c, i) => { const o = el("option", "", c.name); o.value = i; cs.appendChild(o); });
  cs.value = String(clamp(P.cur, 0, P.cases.length - 1));
  cs.onchange = () => { P.cur = +cs.value; commit(); };
  r3.appendChild(cs);
  r3.appendChild(btn("＋新規", "sm", () => {
    mark(); const c = pcase();
    P.cases.push({ id: uid(), name: "ケース" + (P.cases.length + 1), coef: { ...c.coef } });
    P.cur = P.cases.length - 1; commit();
  }));
  r3.appendChild(btn("名前", "sm", () => askText("ケースの名前", pcase().name, v => { mark(); pcase().name = v; commit(); })));
  r3.appendChild(btn("削除", "sm", () => {
    if (P.cases.length < 2) return toast("ケースは1つ以上必要です");
    mark(); P.cases.splice(P.cur, 1); P.cur = clamp(P.cur, 0, P.cases.length - 1); commit();
  }));
  s.appendChild(r3);

  /* 地型ごとの係数 */
  for (const t of P.types) {
    const r = el("div", "row");
    const nm = el("button", "btn sm grow", t.name);
    nm.style.textAlign = "left";
    nm.onclick = () => askText("地型の名前", t.name, v => { mark(); t.name = v; commit(); });
    r.appendChild(nm);
    const inC = el("input"); inC.type = "number"; inC.step = "0.01"; inC.min = "0.01"; inC.inputMode = "decimal";
    inC.style.maxWidth = "92px";
    inC.value = coefOf(t.id);
    inC.onchange = () => { mark(); pcase().coef[t.id] = Math.max(0.01, parseFloat(inC.value) || 1); commit(); };
    r.appendChild(inC);
    r.appendChild(el("span", "lab", "倍"));
    if (P.types.length > 1) r.appendChild(iconBtn("i-trash", () => {
      confirmBox("地型「" + t.name + "」を消しますか", () => {
        mark();
        P.types = P.types.filter(x => x.id !== t.id);
        for (const c of P.cases) delete c.coef[t.id];
        for (const pl of doc.plans) for (const q of pl.parcels) if (q.type === t.id) q.type = P.types[0].id;
        commit();
      });
    }));
    s.appendChild(r);
  }
  s.appendChild(btn("＋ 地型を追加", "wide sm", () => {
    mark(); const t = { id: uid(), name: "地型" + (P.types.length + 1) };
    P.types.push(t); for (const c of P.cases) c.coef[t.id] = 1; commit();
  }));
  s.appendChild(el("p", "hint", "総額はそのままに、地型の係数の比で配り直します。" +
    "旗竿地を 0.7 にすれば、その分だけ整形地の坪単価が上がり、合計は全体価格に一致します。"));

  if (P.total > 0 && pt.rows.length) {
    const tb = el("div", "list"); tb.style.marginTop = "10px";
    for (const r of pt.rows) {
      const d = el("div", "item");
      const hd = el("div", "hd");
      const chip = el("span", "chip"); chip.style.background = r.p.color; hd.appendChild(chip);
      const body = el("div", "body");
      body.appendChild(el("b", "", r.p.name));
      body.appendChild(el("span", "mt", typeName(r.p.type) + " ×" + r.c + " / " + r.a.toFixed(2) + "㎡"));
      hd.appendChild(body);
      const ar = el("div", "ar", manStr(r.price));
      ar.appendChild(el("i", "", r.perTsubo.toFixed(2) + "万/坪"));
      hd.appendChild(ar);
      d.appendChild(hd);
      tb.appendChild(d);
    }
    s.appendChild(tb);
  }
  return s;
}
function totBox(name, big, small) {
  const d = el("div");
  d.appendChild(el("span", "", name));
  d.appendChild(el("b", "", big));
  if (small) { const i = el("span", "", small); i.style.color = "var(--muted)"; d.appendChild(i); }
  return d;
}
function itemRow(p, isSite, pr) {
  const on = ui.sel === p.id;
  const row = el("div", "item" + (on ? " on" : ""));
  const hd = el("div", "hd");
  const chip = el("span", "chip"); chip.style.background = p.color; hd.appendChild(chip);
  const body = el("button", "body");
  body.appendChild(el("b", "", p.name));
  const bb = bbox(p.cells);
  body.appendChild(el("span", "mt", bb ? mStr(bb.w) + " × " + mStr(bb.h) + "（外形）" : "まだ描かれていません"));
  body.onclick = () => { ui.sel = p.id; if (ui.tool === "pan") ui.tool = "draw"; syncMode(); };
  hd.appendChild(body);
  const a = areaOf(p.cells);
  const ar = el("div", "ar", a.toFixed(2) + "㎡");
  if (ui.tsubo) ar.appendChild(el("i", "", (a / TSUBO).toFixed(2) + "坪"));
  hd.appendChild(ar);
  hd.appendChild(iconBtn("i-pen", () => askText(isSite ? "表示名" : "区画の名前", p.name, v => {
    mark();
    if (isSite) { SITE.name = v; doc.siteName = v; }
    else plan().parcels.find(q => q.id === p.id).name = v;
    commit();
  })));
  hd.appendChild(iconBtn("i-trash", () => {
    confirmBox("「" + p.name + "」の中身を消しますか", () => {
      mark();
      if (isSite) doc.site.clear();
      else { const i = plan().parcels.findIndex(q => q.id === p.id); if (i >= 0) plan().parcels.splice(i, 1); fixSel(); }
      commit();
    });
  }));
  row.appendChild(hd);

  if (!isSite) {                       /* 地型と価格 */
    const ft = el("div", "ft");
    const ts = el("select");
    for (const t of doc.price.types) { const o = el("option", "", t.name); o.value = t.id; ts.appendChild(o); }
    ts.value = p.type || doc.price.types[0].id;
    ts.onchange = () => { mark(); plan().parcels.find(q => q.id === p.id).type = ts.value; commit(); };
    ft.appendChild(ts);
    const pv = el("div", "ar");
    if (pr && doc.price.total > 0) {
      pv.textContent = manStr(pr.price);
      pv.appendChild(el("i", "", pr.perTsubo.toFixed(2) + "万/坪"));
    } else pv.appendChild(el("i", "", "全体価格を入れると出ます"));
    pv.style.flex = "1";
    ft.appendChild(pv);
    row.appendChild(ft);
  }
  return row;
}

/* ---- パネルの小道具 ---- */
function sec(title) { const s = el("div", "sec"); if (title) s.appendChild(el("h3", "", title)); return s; }
function kv(k, v) { const d = el("div", "kv"); d.appendChild(el("span", "", k)); d.appendChild(el("b", "", v)); return d; }
function btn(text, cls, fn) { const b = el("button", "btn " + (cls || ""), text); b.onclick = fn; return b; }
function iconBtn(icon, fn) {
  const b = el("button", "ico");
  b.innerHTML = '<svg><use href="#' + icon + '"/></svg>';
  b.onclick = fn; return b;
}
function pad3(name, labels, fns) {
  const r = el("div", "row"); r.style.marginTop = "8px";
  r.appendChild(el("span", "lab", name));
  labels.forEach((t, i) => {
    const b = el("button", "btn sm num", t);
    if (fns[i]) b.onclick = fns[i]; else b.disabled = true;
    b.style.flex = "1"; r.appendChild(b);
  });
  return r;
}

/* ============================ シート・モーダル ============================ */

function openSheet(node) {
  const s = $("#sheet"); s.innerHTML = ""; s.hidden = false;
  const inn = el("div", "sheet-in"); inn.appendChild(node); s.appendChild(inn);
  s.onclick = e => { if (e.target === s) closeSheet(); };
}
function closeSheet() { $("#sheet").hidden = true; }
function openModal(node) {
  const m = $("#modal"); m.innerHTML = ""; m.hidden = false;
  const inn = el("div", "modal-in"); inn.appendChild(node); m.appendChild(inn);
  m.onclick = e => { if (e.target === m) closeModal(); };
}
function closeModal() { $("#modal").hidden = true; }

function askText(title, value, cb) {
  const box = el("div");
  box.innerHTML = '<h2></h2><input type="text" id="tx-v">' +
    '<div class="acts"><button class="btn" id="tx-no">やめる</button><button class="btn pri" id="tx-ok">決定</button></div>';
  box.querySelector("h2").textContent = title;
  openModal(box);
  const i = box.querySelector("#tx-v"); i.value = value; i.focus(); i.select();
  const ok = () => { const v = i.value.trim(); closeModal(); if (v) cb(v); };
  box.querySelector("#tx-ok").onclick = ok;
  box.querySelector("#tx-no").onclick = closeModal;
  i.onkeydown = e => { if (e.key === "Enter") ok(); };
}
function confirmBox(title, cb) {
  const box = el("div");
  box.innerHTML = '<h2></h2><div class="acts"><button class="btn" id="cf-no">やめる</button>' +
    '<button class="btn pri" id="cf-ok">実行</button></div>';
  box.querySelector("h2").textContent = title;
  openModal(box);
  box.querySelector("#cf-ok").onclick = () => { closeModal(); cb(); };
  box.querySelector("#cf-no").onclick = closeModal;
}

function menu() {
  const box = el("div");
  box.appendChild(el("h2", "", "メニュー"));
  const m = el("div", "menu");
  const add = (t, fn, cls) => { const b = el("button", cls || "", t); b.onclick = () => { closeSheet(); fn(); }; m.appendChild(b); };
  add(doc.img ? "画像を差し替える" : "画像を取り込む", pickFile);
  if (doc.img) add("画像を消す", () => confirmBox("画像を消しますか（区画は残ります）", dropImage));
  add("全体を表示する", fitAll);
  m.appendChild(document.createElement("hr"));
  m.appendChild(toggle("50cm グリッドを見せる", "grid"));
  m.appendChild(toggle("寸法と面積を図に出す", "dims"));
  m.appendChild(toggle("坪も併記する", "tsubo"));
  const th = el("label", "chk");
  const ci = el("input"); ci.type = "checkbox"; ci.checked = ui.theme === "dark";
  ci.onchange = () => { ui.theme = ci.checked ? "dark" : "light"; applyTheme(); save(); };
  th.appendChild(ci); th.appendChild(document.createTextNode("暗い配色にする"));
  m.appendChild(th);
  m.appendChild(document.createElement("hr"));
  add("図を画像で書き出す", exportPng);
  add("面積の一覧をコピーする", copySummary);
  m.appendChild(document.createElement("hr"));
  add("この案の区画を全部消す", () => confirmBox("「" + plan().name + "」の区画をすべて消しますか", () => {
    mark(); for (const p of plan().parcels) p.cells.clear(); commit();
  }), "warn");
  add("最初からやり直す", () => confirmBox("画像も区画もすべて消して、最初からやり直しますか", reset), "warn");
  box.appendChild(m);
  const v = el("p", "hint", "データはこの端末の中だけに保存されます。");
  box.appendChild(v);
  openSheet(box);
}
function toggle(text, key) {
  const l = el("label", "chk");
  const i = el("input"); i.type = "checkbox"; i.checked = !!ui[key];
  i.onchange = () => { ui[key] = i.checked; draw(); renderPanel(); save(); };
  l.appendChild(i); l.appendChild(document.createTextNode(text));
  return l;
}
function applyTheme() {
  document.documentElement.dataset.theme = ui.theme === "dark" ? "dark" : "light";
  const mt = document.querySelector('meta[name="theme-color"]');
  if (mt) mt.content = ui.theme === "dark" ? "#0B1220" : "#EDF1F2";
  readTheme(); draw();
}
function reset() {
  mark();
  doc = { img: null, ref: null, site: new Set(), price: defPrice(), plans: [], cur: 0, siteName: "敷地" };
  doc.plans = [newPlan("案A")];
  imgEl = null; imgSrc = null; measure = null;
  SITE.name = "敷地";
  ui.sel = doc.plans[0].parcels[0].id; ui.mode = "dim"; ui.tool = "ref";
  saveImage(); fitAll(); syncMode(); commit();
}

/* ---- 書き出し ---- */
function summaryRows() {
  const rows = [];
  const pr = new Map(priceTable().rows.map(r => [r.p.id, r]));
  if (doc.site.size) { const b = bbox(doc.site); rows.push({ name: SITE.name, color: SITE.color, a: areaOf(doc.site), b }); }
  for (const p of plan().parcels) if (p.cells.size) {
    const r = pr.get(p.id);
    rows.push({ name: p.name, color: p.color, a: areaOf(p.cells), b: bbox(p.cells),
                type: typeName(p.type), price: r && doc.price.total > 0 ? r.price : 0,
                perTsubo: r ? r.perTsubo : 0 });
  }
  return rows;
}
function copySummary() {
  const rows = summaryRows();
  if (!rows.length) return toast("まだ区画がありません");
  const pt = priceTable(), all = totalArea();
  let t = plan().name + "（" + pt.n + "区画" +
    (doc.price.total > 0 ? " / 全体 " + manStr(doc.price.total) + " / " + pcase().name : "") + "）\n";
  t += "名前\t面積㎡\t坪\t外形\t地型\t価格万円\t万円/坪\n";
  for (const r of rows) t += [r.name, r.a.toFixed(2), (r.a / TSUBO).toFixed(2),
    mStr(r.b.w) + "×" + mStr(r.b.h), r.type || "", r.price ? r.price.toFixed(1) : "",
    r.perTsubo ? r.perTsubo.toFixed(2) : ""].join("\t") + "\n";
  t += "残り\t" + (all - pt.sumArea).toFixed(2) + "\n";
  (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject())
    .then(() => toast("コピーしました")).catch(() => showText(t));
}
function showText(t) {
  const box = el("div");
  box.appendChild(el("h2", "", "面積の一覧"));
  const ta = document.createElement("textarea");
  ta.value = t; ta.rows = 8; ta.style.cssText = "width:100%;font-family:var(--font-num);font-size:12px;background:var(--ink-2);border:1px solid var(--hairline);border-radius:6px;padding:8px;";
  box.appendChild(ta);
  const acts = el("div", "acts"); acts.appendChild(btn("閉じる", "pri", closeModal)); box.appendChild(acts);
  openModal(box); ta.select();
}
function exportPng() {
  const rows = summaryRows();
  const b = contentBox(), pad = 1;
  const k = clamp(1500 / Math.max(b.w + pad * 2, b.h + pad * 2), 4, 160);
  const drawW = (b.w + pad * 2) * k, ch = Math.round((b.h + pad * 2) * k);
  const lh = 30 + rows.length * 26 + 12;
  const cw = Math.max(Math.round(drawW), 760);
  const off = document.createElement("canvas");
  off.width = cw; off.height = ch + lh;
  const keep = { ctx, W, H, dpr, view: { ...view } };
  exporting = true; ctx = off.getContext("2d"); W = cw; H = ch; dpr = 1;
  view = { x: b.x - pad - (cw - drawW) / (2 * k), y: b.y - pad, k };
  try { paint(); } catch (e) {}
  /* 凡例 */
  ctx.fillStyle = C.surface; ctx.fillRect(0, ch, cw, lh);
  ctx.fillStyle = C.line; ctx.fillRect(0, ch, cw, 1);
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.font = "700 15px system-ui,sans-serif"; ctx.fillStyle = C.ink;
  const pt0 = priceTable();
  ctx.fillText(plan().name + "  " + pt0.n + "区画  全体 " + totalArea().toFixed(2) + "㎡" +
    (doc.price.total > 0 ? "  " + manStr(doc.price.total) + "（" + pcase().name + "）" : ""), 14, ch + 18);
  rows.forEach((r, i) => {
    const y = ch + 40 + i * 26;
    ctx.fillStyle = r.color; ctx.fillRect(14, y - 7, 14, 14);
    ctx.font = "600 14px system-ui,sans-serif"; ctx.fillStyle = C.ink;
    ctx.fillText(r.name + (r.type ? "（" + r.type + "）" : ""), 36, y);
    ctx.font = "600 14px ui-monospace,Menlo,monospace"; ctx.textAlign = "right";
    ctx.fillText(r.a.toFixed(2) + "㎡ / " + (r.a / TSUBO).toFixed(2) + "坪  " + mStr(r.b.w) + "×" + mStr(r.b.h) +
      (r.price ? "  " + manStr(r.price) + " / " + r.perTsubo.toFixed(2) + "万/坪" : ""), cw - 14, y);
    ctx.textAlign = "left";
  });
  ctx = keep.ctx; W = keep.W; H = keep.H; dpr = keep.dpr; view = keep.view; exporting = false;
  draw();

  const url = off.toDataURL("image/png");
  const name = (plan().name || "分割案") + ".png";
  const box = el("div");
  box.appendChild(el("h2", "", "書き出し"));
  const im = el("img", "shot"); im.src = url; box.appendChild(im);
  box.appendChild(el("p", "hint", "画像を長押し（PC は右クリック）でも保存できます。"));
  const acts = el("div", "acts");
  acts.appendChild(btn("閉じる", "", closeModal));
  acts.appendChild(btn("保存", "pri", () => savePng(off, url, name)));
  box.appendChild(acts);
  openModal(box);
}
/* 保存の口は場所によって違う。埋め込みで開かれている時は、そちらの保存を通す。 */
async function savePng(canvas, url, name) {
  let dl = null;
  try { if (window.claude && window.claude.use) dl = await window.claude.use("downloads"); } catch (e) {}
  if (dl) {
    const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
    if (!blob) return toast("画像を作れませんでした");
    try { await dl.save({ filename: name, data: blob }); toast("保存しました"); }
    catch (e) { if (!e || e.code !== "declined") toast("保存できませんでした"); }
    return;
  }
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}

/* ============================ 起動 ============================ */

function wire() {
  $("#btn-menu").onclick = menu;
  $("#btn-undo").onclick = undo;
  $("#btn-redo").onclick = redo;
  $("#btn-zin").onclick = () => zoomAt(W / 2, (H - dockH()) / 2, view.k * 1.5);
  $("#btn-zout").onclick = () => zoomAt(W / 2, (H - dockH()) / 2, view.k / 1.5);
  $("#btn-fit").onclick = fitAll;
  $("#grip").onclick = () => { ui.panel = !ui.panel; $("#dock").classList.toggle("min", !ui.panel); };
  document.querySelectorAll(".modes button").forEach(b => {
    b.onclick = () => { ui.mode = b.dataset.mode; measure = null; syncMode(); };
  });

  /* 画像はドロップと貼り付けでも受ける */
  document.addEventListener("dragover", e => e.preventDefault());
  document.addEventListener("drop", e => {
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) readImage(f);
  });
  document.addEventListener("paste", e => {
    const it = [...(e.clipboardData ? e.clipboardData.items : [])].find(i => i.type.startsWith("image/"));
    if (it) readImage(it.getAsFile());
  });
  document.addEventListener("gesturestart", e => e.preventDefault());

  document.addEventListener("keydown", e => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === " ") { space = true; e.preventDefault(); return; }
    if (e.key === "Escape") { closeModal(); closeSheet(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (e.key === "1") { ui.mode = "dim"; syncMode(); }
    if (e.key === "2") { ui.mode = "div"; syncMode(); }
    if (e.key === "f") fitAll();
    if (e.key === "g") { ui.grid = !ui.grid; draw(); save(); }
  });
  document.addEventListener("keyup", e => { if (e.key === " ") space = false; });

  window.addEventListener("resize", () => { resize(); });
  if ("ResizeObserver" in window) new ResizeObserver(() => resize()).observe($("#stage"));
}

function boot() {
  const had = load();
  /* 初回だけ端末の設定に従う。以降はメニューでの選択を覚える。 */
  if (!had && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) ui.theme = "dark";
  applyTheme();
  if (!had) ui.sel = doc.plans[0].parcels[0].id;
  if (doc.siteName) SITE.name = doc.siteName;
  fixSel();
  wire();
  resize();
  syncMode();
  if (imgSrc && doc.img) setImage(imgSrc, false);
  else if (!had) fitAll();
  $("#dock").classList.toggle("min", !ui.panel);
  if (!had) toast("まずは画像を取り込んで、寸法を合わせましょう");
  /* 単体ページとして配った版（マニフェストが無い）では登録しない */
  if ("serviceWorker" in navigator && document.querySelector('link[rel="manifest"]'))
    navigator.serviceWorker.register("../sw.js").catch(() => {});
}
boot();

})();
