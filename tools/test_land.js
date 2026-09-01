/* tools/test_land.js — 土地分割シミュレーターを実際のブラウザで動かして検証する。
   実行: node tools/test_land.js
   前提: playwright が入っていること（例: npm i -g playwright、ブラウザは同梱のものを使う）。
   このファイルの中で静的サーバとテスト用の画像を用意するので、ほかに要るものはない。 */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), zlib = require("zlib");
const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(require("os").tmpdir(), "landtest-"));

/* ---- テスト用の画像。1m = 40px、敷地 12m x 10m、下に道路。 ---- */
let CRC = null;
function crc32(b){ if(!CRC){CRC=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;CRC[n]=c>>>0;}}
  let c=0xFFFFFFFF; for(const x of b) c=CRC[(c^x)&255]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
function chunk(t,d){ const l=Buffer.alloc(4); l.writeUInt32BE(d.length,0); const ty=Buffer.from(t,"ascii");
  const c=Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([ty,d])),0); return Buffer.concat([l,ty,d,c]); }
function plotPng(){
  const w=900,h=700, px=Buffer.alloc(w*h*4,255);
  const set=(x,y,r,g,b)=>{ x|=0; y|=0; if(x<0||y<0||x>=w||y>=h) return; const i=(y*w+x)*4;
    px[i]=r; px[i+1]=g; px[i+2]=b; px[i+3]=255; };
  for(let y=600;y<h;y++) for(let x=0;x<w;x++) set(x,y,200,208,214);          // 道路
  const line=(x0,y0,x1,y1,t)=>{ const n=Math.ceil(Math.hypot(x1-x0,y1-y0)*2);
    for(let i=0;i<=n;i++){ const x=x0+(x1-x0)*i/n, y=y0+(y1-y0)*i/n;
      for(let dy=-t;dy<=t;dy++) for(let dx=-t;dx<=t;dx++) set(x+dx,y+dy,30,40,50); } };
  const X0=180,Y0=120,X1=660,Y1=520;
  line(X0,Y0,X1,Y0,2); line(X1,Y0,X1,Y1,2); line(X1,Y1,X0,Y1,2); line(X0,Y1,X0,Y0,2);
  const raw=Buffer.alloc((w*4+1)*h);
  for(let y=0;y<h;y++){ raw[y*(w*4+1)]=0; px.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4); }
  const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4); ihdr[8]=8; ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),
    chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]);
}
const PLOT = path.join(TMP, "plot.png");
fs.writeFileSync(PLOT, plotPng());

/* ---- 静的サーバ ---- */
const MIME={".html":"text/html",".css":"text/css",".js":"text/javascript",".json":"application/json",".png":"image/png"};
const server = http.createServer((req,res)=>{
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, {"content-type": MIME[path.extname(f)] || "application/octet-stream", "cache-control":"no-store"});
  fs.createReadStream(f).pipe(res);
});

const ok=[], bad=[];
const check=(n,c,x)=> (c?ok:bad).push(n + (x ? " — " + x : ""));

(async () => {
  let chromium;
  try { chromium = require("playwright").chromium; }
  catch (e) {
    try { chromium = require(path.join(process.execPath, "../../lib/node_modules/playwright")).chromium; }
    catch (e2) { console.log("playwright が見つからないので飛ばす（npm i -g playwright）"); process.exit(0); }
  }
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, hasTouch:true });
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", m => { if (m.type()==="error") errs.push("console: " + m.text()); });
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  await page.goto(base + "/land/index.html", { waitUntil:"networkidle" });
  await page.waitForTimeout(400);

  const st = async () => JSON.parse(await page.evaluate(() => localStorage.getItem("landsim/doc/v1")));
  const box = await page.locator("#cv").boundingBox();
  const img = async (px,py) => { const g=(await st()).img, c=Math.cos(g.rot), s=Math.sin(g.rot);
    const ex=(px-g.w/2)*g.mpp, ey=(py-g.h/2)*g.mpp;
    return { x:g.cx+ex*c-ey*s, y:g.cy+ex*s+ey*c }; };
  const scr = async (wx,wy) => { const v=(await st()).view; return { x:box.x+(wx-v.x)*v.k, y:box.y+(wy-v.y)*v.k }; };
  const swipe = async (a,b) => { await page.mouse.move(a.x,a.y); await page.mouse.down();
    await page.mouse.move((a.x+b.x)/2,(a.y+b.y)/2,{steps:4}); await page.mouse.move(b.x,b.y,{steps:4});
    await page.mouse.up(); await page.waitForTimeout(150); };
  const area = runs => runs.reduce((a,r)=>a+r[2],0)*0.25;

  /* 1. 画像 → 基準線 → 縮尺 */
  await page.setInputFiles("#file", PLOT);
  await page.waitForTimeout(900);
  check("画像を取り込める", !!(await st()).img);
  await swipe(await scr(...Object.values(await img(180,120))), await scr(...Object.values(await img(660,120))));
  await page.waitForTimeout(300);
  await page.fill("#rf-len", "12"); await page.click("#rf-ok");
  await page.waitForTimeout(700);
  const g = (await st()).img;
  check("基準線の実長どおりに縮尺が決まる", Math.abs(480*g.mpp-12)<1e-3, (480*g.mpp).toFixed(4)+"m");
  check("画像がグリッドに正対する", Math.abs(g.rot%(Math.PI/2))<1e-9, g.rot.toFixed(6));

  /* 2. 分割 */
  await page.click('.modes button[data-mode="div"]'); await page.waitForTimeout(300);
  const P0 = await img(180,120), P1 = await img(660,520);
  await page.locator(".item .body", { hasText:"敷地" }).click(); await page.waitForTimeout(200);
  await swipe(await scr(P0.x+.1,P0.y+.1), await scr(P1.x-.1,P1.y-.1)); await page.waitForTimeout(300);
  check("敷地が 120㎡ になる", Math.abs(area((await st()).site)-120)<1e-3, area((await st()).site)+"㎡");

  await page.locator(".item .body", { hasText:"区画A" }).click(); await page.waitForTimeout(200);
  await swipe(await scr(P0.x+.1,P0.y+.1), await scr(P0.x+5.9,P1.y-.1)); await page.waitForTimeout(250);
  await page.click("text=＋ 区画を追加"); await page.waitForTimeout(250);
  await swipe(await scr(P0.x+5.1,P0.y+.1), await scr(P1.x-.1,P1.y-.1)); await page.waitForTimeout(400);
  let a = (await st()).plans[0].parcels.map(p=>area(p.cells));
  check("あとから引いた区画が重なりを取る", Math.abs(a[0]-50)<1e-3 && Math.abs(a[1]-70)<1e-3, JSON.stringify(a));
  check("区画の合計が敷地に一致する", Math.abs(a[0]+a[1]-120)<1e-3);

  /* 3. 元に戻す */
  await page.click("#btn-undo"); await page.waitForTimeout(400);
  let u = (await st()).plans[0].parcels.map(p=>area(p.cells));
  check("元に戻せる", u[1]===0, JSON.stringify(u));
  await page.click("#btn-redo"); await page.waitForTimeout(400);
  let r2 = (await st()).plans[0].parcels.map(p=>area(p.cells));
  check("やり直せる", Math.abs(r2[1]-70)<1e-3, JSON.stringify(r2));

  /* 4. 価格の按分 */
  await page.locator("#panel input[type=number]").first().fill("6000");
  await page.locator("#panel input[type=number]").first().dispatchEvent("change");
  await page.waitForTimeout(400);
  await page.locator(".item .ft select").nth(1).selectOption({ label:"旗竿地" });
  await page.waitForTimeout(400);
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll("#panel .item .ft .ar")].map(e => e.firstChild ? e.firstChild.textContent : ""));
  /* 50㎡×1.0 と 70㎡×0.7 → 6000 を 50:49 で分ける */
  check("係数つきで総額を配り直す", /3,?030/.test(shown[0]) && /2,?970/.test(shown[1]), JSON.stringify(shown));
  const sum = shown.reduce((t, x) => t + (parseFloat(String(x).replace(/[^0-9.]/g, "")) || 0), 0);
  check("配った合計が総額に戻る", Math.abs(sum - 6000) < 1.5, sum + " 万円");

  /* 5. ズーム */
  const k0 = (await st()).view.k;
  await page.mouse.move(box.x+195, box.y+300); await page.mouse.wheel(0,-400);
  await page.waitForTimeout(500);
  check("ホイールで拡大できる", (await st()).view.k > k0*1.2);
  const k1 = (await st()).view.k;
  await page.evaluate(() => { const cv=document.querySelector("#cv");
    const e=(t,id,x,y)=>cv.dispatchEvent(new PointerEvent(t,{pointerId:id,clientX:x,clientY:y,bubbles:true,pointerType:"touch",isPrimary:id===1}));
    e("pointerdown",1,150,400); e("pointerdown",2,250,400);
    e("pointermove",1,100,400); e("pointermove",2,300,400);
    e("pointerup",1,100,400); e("pointerup",2,300,400); });
  await page.waitForTimeout(600);
  check("2本指のピンチで拡大できる", (await st()).view.k > k1*1.5);

  /* 6. 書き出しと保存 */
  await page.click("#btn-menu"); await page.waitForTimeout(250);
  await page.click("text=図を画像で書き出す"); await page.waitForTimeout(900);
  check("PNG を書き出せる", await page.locator("#modal img.shot").isVisible().catch(()=>false));
  await page.click("#modal .btn:has-text('閉じる')"); await page.waitForTimeout(200);
  await page.reload({ waitUntil:"networkidle" }); await page.waitForTimeout(700);
  const after = await st();
  check("再読み込みしても残る", !!after.img && after.price.total===6000);

  await browser.close(); server.close();
  console.log("\n" + ok.map(s => "  ok   " + s).join("\n"));
  if (bad.length) console.log("\n" + bad.map(s => "  FAIL " + s).join("\n"));
  if (errs.length) console.log("\n  例外:\n    " + errs.join("\n    "));
  console.log("\n" + ok.length + " 件 ok / " + bad.length + " 件 FAIL\n");
  process.exit(bad.length || errs.length ? 1 : 0);
})();
