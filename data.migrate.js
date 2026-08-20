/* data.migrate.js — スキーマ移行
   ここは最も壊してはいけないコードなので、他から独立させて単体で検証できるようにしてある。
   DOM も localStorage も参照しない。入力を受けて新しいオブジェクトを返すだけ。

   v1 : {id,date,name,unitM,reps,meters,round,kind}
   v2 : {id,date,spotId,name,segIds,unitM,reps,meters,round,cat}
   v3 : v2 + {createdAt,kcal,weightAtSave,confidence}  ＋ 各種コンテナ
   v4 : v3 + {steps}
   v5 : 高さを「段数×蹴上げ」優先で決めるようにしたため、過去の unitM/meters/steps を
        引き直す必要がある。移行側は状態を持てないので pendingRecompute を立てるだけにして、
        実際の再計算は読み込み側（D.recomputeEntries）に任せる。
*/
(function (root) {
  "use strict";

  var TARGET = 5;
  var CONF_RANK = { "実測": 4, "確定": 3, "導出": 2, "推定": 1 };
  var EPOCH_MIN = Date.UTC(2020, 0, 1);

  function defaults() {
    return {
      schemaVersion: TARGET,
      entries: [], weight: 60, baseRise: 0.18, baseFloorH: 4.0, over: {},
      customSpots: [],
      missions: {}, missionState: {}, summits: {},
      measurements: [], recaps: {},
      settings: { fatKcalPerKg: 7200, reducedMotion: "auto" }
    };
  }

  function detect(d) {
    if (!d || typeof d !== "object") return 0;
    if (Number(d.schemaVersion) >= 5) return 5;
    if (Number(d.schemaVersion) === 4) return 4;
    if (Number(d.schemaVersion) === 3) return 3;
    var e = (d.entries || [])[0];
    if (e && (("spotId" in e) || ("segIds" in e) || ("cat" in e))) return 2;
    if (e) return 1;
    return 2; // 記録ゼロなら v2 相当として扱う
  }

  function num(v, fb) { var n = Number(v); return isFinite(n) ? n : fb; }

  function kcalOf(meters, weight, round) {
    return Math.round(weight * meters * 0.01 * (round ? 1.3 : 1) * 100) / 100;
  }

  /* --- v1 → v2 : kind を cat に、名前から spotId を逆引き --- */
  function up1to2(d, ctx) {
    var byName = {};
    (ctx.seed || []).forEach(function (s) { byName[s.name] = s; });
    d.entries = (d.entries || []).map(function (e) {
      if ("cat" in e && "spotId" in e) return e;
      var sp = byName[e.name] || null;
      return {
        id: e.id, date: e.date,
        spotId: sp ? sp.id : null,
        name: e.name,
        segIds: Array.isArray(e.segIds) ? e.segIds : [],
        unitM: num(e.unitM, num(e.meters, 0)),
        reps: num(e.reps, 1),
        meters: num(e.meters, 0),
        round: !!e.round,
        cat: e.cat || e.kind || (sp ? sp.cat : "daily")
      };
    });
    return d;
  }

  /* --- v2 → v3 : 保存時点の値を焼き付ける --- */
  function enrich(d, ctx) {
    var w = num(d.weight, 60);
    d.entries = (d.entries || []).map(function (e) {
      var out = {};
      for (var k in e) out[k] = e[k];

      // createdAt : id が Date.now() ならそれが実時刻。過去日入力機能は無かったので信頼できる。
      if (!out.createdAt) {
        var t = Number(e.id);
        if (isFinite(t) && t > EPOCH_MIN && t < Date.now() + 864e5) {
          out.createdAt = new Date(t).toISOString();
        } else {
          out.createdAt = String(e.date || "") + "T12:00:00";
          out.createdAtEstimated = true;
        }
      }

      // kcal : 体重を変えても過去が動かないよう、この時点の体重で確定させる
      if (out.weightAtSave == null) out.weightAtSave = w;
      if (out.kcal == null) out.kcal = kcalOf(num(out.meters, 0), num(out.weightAtSave, w), out.round);

      // confidence : 表示時解決だと基準値変更で過去の確度が動くため、ここで固定
      if (!out.confidence) out.confidence = resolveConfidence(out, ctx);

      // steps : 実績「累計◯段」に必要。蹴上げ基準を変えても過去が動かないよう固定する。
      if (out.steps == null) out.steps = resolveSteps(out, ctx);

      return out;
    });
    d.schemaVersion = TARGET;
    return d;
  }

  function resolveSteps(entry, ctx) {
    if (entry.spotId && ctx && typeof ctx.stepsFor === "function") {
      try {
        var v = ctx.stepsFor(entry.spotId, entry.segIds || [], entry.reps || 1);
        if (isFinite(v) && v > 0) return Math.round(v);
      } catch (e) {}
    }
    var rise = (ctx && ctx.baseRise) || 0.18;
    return Math.round(num(entry.meters, 0) / rise);
  }

  function resolveConfidence(entry, ctx) {
    if (!entry.spotId || !ctx || typeof ctx.resolveSeg !== "function") return null;
    var ids = Array.isArray(entry.segIds) ? entry.segIds : [];
    if (!ids.length) return null;
    var segs = {}, best = null;
    for (var i = 0; i < ids.length; i++) {
      var r = null;
      try { r = ctx.resolveSeg(entry.spotId, ids[i]); } catch (err) { r = null; }
      if (!r || !r.conf) continue;
      segs[ids[i]] = r.conf;
      if (best === null || CONF_RANK[r.conf] > CONF_RANK[best]) best = r.conf;
    }
    if (best === null) return null;
    return { max: best, segs: segs };
  }

  /* --- 入口 --- */
  function run(raw, ctx) {
    ctx = ctx || {};
    var log = [], base = defaults();
    var d = base;

    if (raw && typeof raw === "object") {
      for (var k in raw) if (raw[k] !== undefined) d[k] = raw[k];
    }
    d.over = d.over || {};

    var from = detect(raw);
    log.push("検出したスキーマ: v" + from);

    if (from >= TARGET) {
      d.schemaVersion = TARGET;
      return { data: d, from: from, migrated: false, log: log, backup: null };
    }

    var backup = raw ? JSON.stringify(raw) : null;
    var n0 = (d.entries || []).length;

    if (from <= 1) { d = up1to2(d, ctx); log.push("v1→v2: kind→cat、名前から地点IDを逆引き"); }
    d = enrich(d, ctx);
    log.push("→v"+TARGET+": " + d.entries.length + "件に createdAt / kcal / weightAtSave / confidence を付与");

    if (from < 5 && (d.entries || []).length) {
      d.pendingRecompute = true;
      log.push("v5: 高さを段数×蹴上げ優先で引き直すフラグを立てた（再計算は読み込み側で実施）");
    }

    if (d.entries.length !== n0) log.push("警告: 件数が " + n0 + " → " + d.entries.length + " に変化");

    var est = d.entries.filter(function (e) { return e.createdAtEstimated; }).length;
    if (est) log.push("時刻を推定で補ったもの: " + est + "件");

    return { data: d, from: from, migrated: true, log: log, backup: backup };
  }

  root.AscentMigrate = { run: run, detect: detect, defaults: defaults, TARGET: TARGET, kcalOf: kcalOf };

})(typeof window !== "undefined" ? window : globalThis);
