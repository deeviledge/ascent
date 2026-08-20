/* tools/test_height.js — 高さと段数の整合を検証する。
   「段数×蹴上げ」を最優先にした（A案）あとで、
   高さ ÷ 段数 が必ず設定した蹴上げに一致することを確かめる。
   実行: node tools/test_height.js */
"use strict";
global.window = global; 
require("../seed.js");
require("../domain.js");
require("../data.migrate.js");

var FAILS = [];
function check(name, got, want) {
  var ok = (typeof got === "number" && typeof want === "number")
    ? Math.abs(got - want) < 1e-9 : got === want;
  if (ok) console.log("  ok   " + pad(name) + " = " + fmt(got));
  else { console.log("  FAIL " + pad(name) + " got=" + fmt(got) + " want=" + fmt(want)); FAILS.push(name); }
}
function pad(s){ return (s + "                                        ").slice(0, 40); }
function fmt(v){ return typeof v === "number" ? Math.round(v * 10000) / 10000 : String(v); }

function baseState(rise) {
  return { schemaVersion:5, entries:[], weight:60, baseRise:rise, baseFloorH:4.0,
           over:{}, customSpots:[], missions:{}, missionState:{}, summits:{},
           measurements:[], recaps:{}, settings:{fatKcalPerKg:7200} };
}

var RISE = 0.163;

console.log("\n[1] 段数×蹴上げが、層数×階高より優先されるか]");
(function () {
  var S = baseState(RISE);
  // 層数3 = 12.0m と評価される区間に、実際に数えた 81段 を入れる
  var sp = { id:"t1", name:"テスト", cat:"daily", area:"x", min:1,
             segs:[{ id:"a", label:"1F→4F", layers:3 }] };
  S.customSpots.push(sp);
  var spd = D.spotOf(S, "t1"), g = spd.segs[0];

  check("段数なし: 層数×階高", D.resolve(S, spd, g).m, 12.0);

  D.segOvW(S, "t1", "a").steps = 81;
  spd = D.spotOf(S, "t1"); g = spd.segs[0];
  var r = D.resolve(S, spd, g);
  check("段数81 × 163mm", r.m, 81 * 0.163);
  check("段数を数えたら12.0mに戻らない", r.m > 13, true);
  check("段数と高さが一致する蹴上げ", r.m / D.stepsForSegs(S, spd, [g]) * 1000, 163);
})();

console.log("\n[2] 実測高さより段数×蹴上げが勝つか（A案の核心）]");
(function () {
  var S = baseState(RISE);
  var sp = { id:"t2", name:"テスト2", cat:"daily", area:"x", min:1,
             segs:[{ id:"a", label:"seg", layers:3, height:12.0, src:"confirmed" }] };
  S.customSpots.push(sp);
  var so = D.segOvW(S, "t2", "a");
  so.height = 12.0;   // 以前に高さとして保存されていた値
  so.steps  = 81;     // 実際に数えた段数
  var spd = D.spotOf(S, "t2"), g = spd.segs[0];
  var r = D.resolve(S, spd, g);
  check("段数×蹴上げが採用される", r.m, 81 * 0.163);
  check("確度は実測扱いでない(base蹴上げ)", r.conf, "導出");

  D.ovW(S, "t2").rise = 0.163;  // 地点ごとに蹴上げを実測した場合
  spd = D.spotOf(S, "t2"); g = spd.segs[0];
  check("地点で蹴上げを実測 → 実測扱い", D.resolve(S, spd, g).conf, "実測");
})();

console.log("\n[3] seed 全地点で 高さ÷段数 = 蹴上げ になるか（回帰）]");
(function () {
  var S = baseState(RISE);
  var bad = [], n = 0;
  (window.SEED || []).forEach(function (sp0) {
    var sp = D.spotOf(S, sp0.id); if (!sp) return;
    sp.segs.forEach(function (g) {
      var m = D.resolve(S, sp, g).m, st = D.stepsForSegs(S, sp, [g]);
      if (!(m > 0) || !(st > 0)) return;
      n++;
      var implied = m / st * 1000;
      if (Math.abs(implied - 163) > 1e-6) bad.push(sp.name + " " + implied.toFixed(2) + "mm");
    });
  });
  check("検査した区間数 > 0", n > 0, true);
  check("163mmからズレる区間", bad.length, 0);
  if (bad.length) console.log("       " + bad.slice(0, 5).join(" / "));
})();

console.log("\n[4] 過去エントリの引き直し]");
(function () {
  var S = baseState(RISE);
  var sp = { id:"t4", name:"テスト4", cat:"daily", area:"x", min:1,
             segs:[{ id:"a", label:"seg", layers:3 }] };
  S.customSpots.push(sp);
  D.segOvW(S, "t4", "a").steps = 81;

  // 旧仕様（層数×階高 12.0m、段数は 12.0/0.18=67段）で保存された記録
  S.entries.push({ id:1, date:"2026-08-01", spotId:"t4", name:"テスト4", segIds:["a"],
                   unitM:12.0, reps:2, meters:24.0, steps:133, round:false,
                   cat:"daily", weightAtSave:60, kcal:14.4 });

  var before = S.entries[0].meters;
  var rc = D.recomputeEntries(S);
  var e = S.entries[0];
  check("引き直した件数", rc.changed, 1);
  check("合計 before", rc.before, 24.0);
  check("meters = 81段×163mm×2本", e.meters, 81 * 0.163 * 2);
  check("steps = 81×2", e.steps, 162);
  check("高さ÷段数 = 163mm", e.meters / e.steps * 1000, 163);
  check("元の値を legacy に退避", e.legacy.meters, before);
  check("kcal も引き直す", e.kcal, Math.round(60 * e.meters * 0.01 * 100) / 100);

  var rc2 = D.recomputeEntries(S);
  check("2回目は何も変わらない(冪等)", rc2.changed, 0);
  check("legacy を上書きしない", e.legacy.meters, before);
})();

console.log("\n[5] 定義が失われた記録を壊さないか]");
(function () {
  var S = baseState(RISE);
  S.entries.push({ id:2, date:"2026-08-01", spotId:"missing", name:"消えた地点",
                   segIds:["a"], unitM:10, reps:1, meters:10, steps:61, round:false });
  var rc = D.recomputeEntries(S);
  check("引き直さずスキップ", rc.skipped, 1);
  check("meters はそのまま", S.entries[0].meters, 10);
  check("合計に算入される", rc.after, 10);
})();

console.log("\n[6] マイグレーション v4→v5]");
(function () {
  var v4 = { schemaVersion:4, entries:[{ id:1, date:"2026-08-01", spotId:"t", name:"x",
             segIds:["a"], unitM:12, reps:1, meters:12, steps:67, round:false,
             cat:"daily", createdAt:"2026-08-01T12:00:00", weightAtSave:60, kcal:7.2 }] };
  var r = window.AscentMigrate.run(v4, { seed: window.SEED, baseRise: RISE });
  check("v4 と判定", r.from, 4);
  check("移行が走る", r.migrated, true);
  check("pendingRecompute が立つ", r.data.pendingRecompute, true);
  check("schemaVersion", r.data.schemaVersion, 5);
  check("記録は失われない", r.data.entries.length, 1);
  check("バックアップを取る", typeof r.backup, "string");

  var v5 = JSON.parse(JSON.stringify(r.data));
  delete v5.pendingRecompute;
  var r2 = window.AscentMigrate.run(v5, { seed: window.SEED, baseRise: RISE });
  check("v5 は再移行しない", r2.migrated, false);
  check("フラグは立たない", r2.data.pendingRecompute, undefined);

  var empty = window.AscentMigrate.run({ schemaVersion:4, entries:[] },
                                       { seed: window.SEED, baseRise: RISE });
  check("記録ゼロならフラグ不要", empty.data.pendingRecompute, undefined);
})();

console.log("\n[7] 実測完全優先 / 未実測は記録不可]");
(function () {
  var S = baseState(RISE);
  var sp = { id:"t7", name:"テスト7", cat:"daily", area:"x", min:1,
             segs:[{ id:"a", label:"実測あり", layers:3 },
                   { id:"b", label:"未実測", layers:2 },
                   { id:"c", label:"公表値のみ", layers:2, height:8.0, src:"confirmed" }] };
  S.customSpots.push(sp);
  D.segOvW(S, "t7", "a").steps = 81;
  var spd = D.spotOf(S, "t7");

  check("段数を入れた区間は実測", D.isMeasured(S, spd, spd.segs[0]), true);
  check("層数だけの区間は未実測", D.isMeasured(S, spd, spd.segs[1]), false);
  check("公表値だけの区間も未実測", D.isMeasured(S, spd, spd.segs[2]), false);
  check("実測区間の数", D.measuredSegs(S, spd).length, 1);
  check("この地点は記録できる", D.recordable(S, spd), true);

  // 高さを実測した場合も実測として扱う
  D.segOvW(S, "t7", "b").height = 8.5;
  spd = D.spotOf(S, "t7");
  check("高さの実測も実測扱い", D.isMeasured(S, spd, spd.segs[1]), true);

  // 実測ゼロの地点
  var sp2 = { id:"t7b", name:"未実測だけ", cat:"daily", area:"x", min:1,
              segs:[{ id:"a", label:"層数のみ", layers:3 }] };
  S.customSpots.push(sp2);
  var spd2 = D.spotOf(S, "t7b");
  check("実測ゼロなら記録不可", D.recordable(S, spd2), false);
  check("参考値は出せる", D.resolve(S, spd2, spd2.segs[0]).m, 12.0);
})();

console.log("\n[8] seed は全区間が未実測（初期状態では記録不可）]");
(function () {
  var S = baseState(RISE);
  var total = 0, rec = 0;
  (window.SEED || []).forEach(function (sp0) {
    var sp = D.spotOf(S, sp0.id); if (!sp) return;
    total++; if (D.recordable(S, sp)) rec++;
  });
  check("seed 地点数 > 0", total > 0, true);
  check("実測前に記録できる地点", rec, 0);

  // 1区間だけ実測を入れれば、その地点は記録可能になる
  var first = (window.SEED || [])[0];
  D.segOvW(S, first.id, first.segs[0].id).steps = 100;
  check("実測を入れれば記録可能", D.recordable(S, D.spotOf(S, first.id)), true);
})();

console.log("\n[9] 未実測を含む記録は引き直さない（凍結を守る）]");
(function () {
  var S = baseState(RISE);
  var sp = { id:"t9", name:"テスト9", cat:"daily", area:"x", min:1,
             segs:[{ id:"a", label:"実測", layers:3 }, { id:"b", label:"未実測", layers:2 }] };
  S.customSpots.push(sp);
  D.segOvW(S, "t9", "a").steps = 81;

  S.entries.push({ id:1, date:"2026-08-01", spotId:"t9", name:"テスト9", segIds:["a"],
                   unitM:12.0, reps:1, meters:12.0, steps:67, round:false, weightAtSave:60 });
  S.entries.push({ id:2, date:"2026-08-01", spotId:"t9", name:"テスト9", segIds:["a","b"],
                   unitM:20.0, reps:1, meters:20.0, steps:111, round:false, weightAtSave:60 });

  var rc = D.recomputeEntries(S);
  check("引き直したのは実測のみの1件", rc.changed, 1);
  check("未実測を含む記録はスキップ", rc.skipped, 1);
  check("実測のみ: 81×163mm", S.entries[0].meters, 81 * 0.163);
  check("未実測混在: 保存時のまま", S.entries[1].meters, 20.0);
  check("凍結された記録に legacy は付かない", S.entries[1].legacy, undefined);
})();

console.log("\n" + (FAILS.length ? "失敗: " + FAILS.join(", ") : "すべて成功"));
process.exit(FAILS.length ? 1 : 0);
