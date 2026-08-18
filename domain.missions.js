/* domain.missions.js — 週次ミッション。
   ・週の識別子は「その週の月曜の日付」。ISO週番号は年跨ぎで壊れやすいので使わない。
   ・生成はその週に初めて開いたとき1回だけ。以後は凍結され、途中で目標が動かない。
   ・進捗は保存せず、毎回 entries から数え直す（唯一のSoTは entries）。 */
(function (root) {
"use strict";
var D=root.D;

/* ===== 週 ===== */
function weekStartOf(dateStr){
  var d=new Date(dateStr+"T00:00:00"), wd=(d.getDay()+6)%7; // 月曜=0
  d.setDate(d.getDate()-wd); return D.ymd(d);
}
function weekEndOf(k){ var d=new Date(k+"T00:00:00"); d.setDate(d.getDate()+6); return D.ymd(d); }
function currentWeek(){ return weekStartOf(D.today()); }
function prevWeek(k){ var d=new Date(k+"T00:00:00"); d.setDate(d.getDate()-7); return D.ymd(d); }
function weekLabel(k){
  var a=k.slice(5).replace("-","/"), b=weekEndOf(k).slice(5).replace("-","/");
  return a+" — "+b;
}
function daysLeft(k){
  var end=new Date(weekEndOf(k)+"T23:59:59"), n=Math.ceil((end-new Date())/864e5);
  return Math.max(0,n);
}
function entriesOfWeek(S,k){
  var a=k, b=weekEndOf(k);
  return S.entries.filter(function(e){ return e.date>=a && e.date<=b; });
}
function weekSummary(S,k){
  var list=entriesOfWeek(S,k), days={}, spots={};
  list.forEach(function(e){ days[e.date]=(days[e.date]||0)+e.meters; if(e.spotId) spots[e.spotId]=1; });
  var seen={};
  S.entries.forEach(function(e){ if(e.date<k && e.spotId) seen[e.spotId]=1; });
  var fresh=Object.keys(spots).filter(function(id){ return !seen[id]; });
  return {
    weekKey:k, label:weekLabel(k),
    m:list.reduce(function(a,e){return a+e.meters;},0),
    kcal:list.reduce(function(a,e){return a+D.kcalOf(S,e);},0),
    steps:list.reduce(function(a,e){return a+D.stepsOf(S,e);},0),
    days:Object.keys(days).length, n:list.length,
    spots:Object.keys(spots).length, newSpots:fresh.length,
    byDay:[0,1,2,3,4,5,6].map(function(i){
      var d=new Date(k+"T00:00:00"); d.setDate(d.getDate()+i);
      var key=D.ymd(d);
      return {date:key, dow:["月","火","水","木","金","土","日"][i], m:days[key]||0};
    })
  };
}

/* ===== 目標の下敷き（直近4週の完了ぶんだけ） ===== */
function baseline(S,k){
  var ws=[], c=k;
  for(var i=0;i<4;i++){ c=prevWeek(c); ws.push(weekSummary(S,c)); }
  var have=ws.filter(function(w){ return w.n>0; });
  var avg=function(f){ return have.length? have.reduce(function(a,w){return a+f(w);},0)/have.length : 0; };
  var maxDay=0;
  ws.forEach(function(w){ w.byDay.forEach(function(d){ if(d.m>maxDay) maxDay=d.m; }); });
  // 今週ぶんは下敷きに含めない。含めると「今週の実績で今週の目標が動く」自己参照になる。
  var maxSingle=0;
  S.entries.forEach(function(e){
    if(e.date>=ws[3].weekKey && e.date<k && e.meters>maxSingle) maxSingle=e.meters; });
  return { weeks:have.length, m:avg(function(w){return w.m;}), days:avg(function(w){return w.days;}),
           newSpots:avg(function(w){return w.newSpots;}), maxDay:maxDay, maxSingle:maxSingle };
}
function momentum(S,k){
  var done=0, total=0, c=k;
  for(var i=0;i<4;i++){ c=prevWeek(c);
    var mm=(S.missions||{})[c];
    if(mm&&mm.items){ mm.items.forEach(function(it){ total++; if(progress(S,it,c).done) done++; }); }
  }
  if(!total) return 0;
  var rate=done/total;
  return Math.max(-0.20, Math.min(0.20, (rate-0.6)*0.5));
}

/* ===== 決定的な乱数 ===== */
function fnv(str){ var h=2166136261;
  for(var i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619); }
  return (h>>>0); }
function rng(seed){ var s=seed||1; return function(){ s=(Math.imul(s,1664525)+1013904223)>>>0; return s/4294967296; }; }

/* ===== カタログ ===== */
function round5(n){ return Math.max(5,Math.round(n/5)*5); }
function round10(n){ return Math.max(10,Math.round(n/10)*10); }

var CAT={ascent:"ASCENT",consistency:"CONSISTENCY",exploration:"EXPLORATION",challenge:"CHALLENGE"};
var CATJP={ascent:"高度を稼ぐ",consistency:"継続する",exploration:"探索する",challenge:"自分を超える"};

var TPL=[
 {id:"ASCENT_TARGET",cat:"ascent",
  target:function(b){ return round10(Math.max(60,b.m||80)); },
  title:function(t){ return t+"mを目指せ"; }, unit:"m",
  desc:"今週の合計獲得標高を "+"{t}m 以上にしよう。",
  val:function(S,k){ return weekSummary(S,k).m; }},

 {id:"ASCENT_NEXT_TIER",cat:"ascent",
  need:function(S){ return !D.tierOf(D.lifetime(S)).done; },
  target:function(b,S){ var k=D.tierOf(D.lifetime(S));
    return round10(Math.min(k.remain, Math.max(40,(b.m||80)*1.1))); },
  title:function(t){ return "次の山へ "+t+"m 詰めろ"; }, unit:"m",
  desc:"次の山までの残りを {t}m ぶん縮めよう。",
  val:function(S,k){ return weekSummary(S,k).m; }},

 {id:"LOG_DAYS",cat:"consistency",
  target:function(b){ return Math.max(2,Math.min(6,Math.round((b.days||2)+0.5))); },
  title:function(t){ return t+"日 記録せよ"; }, unit:"日",
  desc:"今週のうち {t}日 以上、記録を残そう。",
  val:function(S,k){ return weekSummary(S,k).days; }},

 {id:"WEEKDAY_3",cat:"consistency",
  target:function(b){ return Math.max(2,Math.min(5,Math.round(b.days||2))); },
  title:function(t){ return "平日に "+t+"日 記録せよ"; }, unit:"日",
  desc:"月〜金のうち {t}日 以上、ついでの一本を残そう。",
  val:function(S,k){ return weekSummary(S,k).byDay.slice(0,5).filter(function(d){return d.m>0;}).length; }},

 {id:"STREAK_3",cat:"consistency",
  target:function(){ return 3; },
  title:function(t){ return t+"日 続けて登れ"; }, unit:"日",
  desc:"今週のうち {t}日 連続で記録しよう。",
  val:function(S,k){
    var b=weekSummary(S,k).byDay, run=0, best=0;
    b.forEach(function(d){ run=d.m>0?run+1:0; if(run>best) best=run; });
    return best; }},

 {id:"NEW_SPOTS",cat:"exploration",
  target:function(b){ return Math.max(1,Math.min(3,Math.round((b.newSpots||1)+0.4))); },
  title:function(t){ return "新しい場所を "+t+"つ"; }, unit:"ヶ所",
  desc:"まだ登っていない地点を {t}ヶ所 開拓しよう。",
  val:function(S,k){ return weekSummary(S,k).newSpots; }},

 {id:"NEW_AREA_1",cat:"exploration",
  need:function(S){
    var vis={}; S.entries.forEach(function(e){ if(e.spotId) vis[e.spotId]=1; });
    var byArea={};
    D.allSpots(S).forEach(function(s){ if(s.area&&s.area!=="—"){ byArea[s.area]=byArea[s.area]||{t:0,v:0};
      byArea[s.area].t++; if(vis[s.id]) byArea[s.area].v++; } });
    return Object.keys(byArea).some(function(a){ return byArea[a].t>=2 && byArea[a].v===0; }); },
  target:function(){ return 1; },
  title:function(){ return "新しいエリアを開拓せよ"; }, unit:"エリア",
  desc:"まだ足を踏み入れていないエリアで1本登ろう。",
  val:function(S,k){
    var before={};
    S.entries.forEach(function(e){ if(e.date<k&&e.spotId){ var s=D.spotOf(S,e.spotId); if(s) before[s.area]=1; } });
    var now={};
    entriesOfWeek(S,k).forEach(function(e){ if(e.spotId){ var s=D.spotOf(S,e.spotId);
      if(s&&s.area&&s.area!=="—"&&!before[s.area]) now[s.area]=1; } });
    return Object.keys(now).length; }},

 {id:"SINGLE_SESSION",cat:"challenge",
  target:function(b){ return round5(Math.max(20,(b.maxSingle||30)*0.9)); },
  title:function(t){ return "1回で "+t+"m 登れ"; }, unit:"m",
  desc:"一度の記録で {t}m 以上を稼ごう。",
  val:function(S,k){
    return entriesOfWeek(S,k).reduce(function(a,e){ return Math.max(a,e.meters); },0); },
  gauge:true},

 {id:"BIG_DAY",cat:"challenge",
  target:function(b){ return round10(Math.max(40,(b.maxDay||60)*0.95)); },
  title:function(t){ return "1日で "+t+"m 登れ"; }, unit:"m",
  desc:"どこか1日で {t}m 以上を積み上げよう。",
  val:function(S,k){ return weekSummary(S,k).byDay.reduce(function(a,d){return Math.max(a,d.m);},0); },
  gauge:true},

 {id:"WEEKEND_BURST",cat:"challenge",
  target:function(b){ return round10(Math.max(40,(b.m||80)*0.55)); },
  title:function(t){ return "土日で合計 "+t+"m"; }, unit:"m",
  desc:"土曜と日曜の合計を {t}m 以上にしよう。",
  val:function(S,k){ var b=weekSummary(S,k).byDay; return b[5].m+b[6].m; }},

 {id:"MORNING_2",cat:"challenge",
  need:function(S){ return S.entries.some(function(e){ return e.createdAt&&!e.createdAtEstimated; }); },
  target:function(){ return 2; },
  title:function(t){ return "朝のうちに "+t+"回 登れ"; }, unit:"回",
  desc:"10時までに {t}回 記録しよう。",
  val:function(S,k){
    return entriesOfWeek(S,k).filter(function(e){
      if(!e.createdAt) return false;
      return new Date(e.createdAt).getHours()<10; }).length; }}
];
/* ===== 今日のお題 =====
   週ミッションは目標の大きさを競う。こちらは「毎日おなじことをしている」状態を崩すのが目的なので、
   量ではなく行動の中身を日替わりで変える。週と同じく日付シードの決定的生成で、
   直近に出たお題は避ける。 */
function dailyBaseline(S){
  var days=D.lastDays(S,14).filter(function(d){ return d.m>0; });
  var m=0,mx=0; days.forEach(function(d){ m+=d.m; if(d.m>mx) mx=d.m; });
  var td=D.today(), single=0, reps=0;
  S.entries.forEach(function(e){
    if(e.date>=D.dayShift(-13) && e.date<td){
      if(e.meters>single) single=e.meters;
      if((e.reps||1)>reps) reps=e.reps||1;
    }
  });
  return { days:days.length, avg:days.length?m/days.length:0, maxDay:mx,
           maxSingle:single, maxReps:reps };
}
function todaySpots(S){
  var d=D.today(), s={};
  S.entries.forEach(function(e){ if(e.date===d) s[e.spotId]=1; });
  return Object.keys(s);
}
function areaOfSpot(S,id){ var sp=D.spotOf(S,id); return sp&&sp.area?sp.area:"—"; }
var DTPL=[
 {id:"D_BEAT_YESTERDAY",tag:"昨日超え",
  need:function(S){ return D.dayStats(S,D.dayShift(-1)).m>0; },
  target:function(b,S){ return round5(D.dayStats(S,D.dayShift(-1)).m+5); },
  title:function(t){ return "昨日より上へ"; }, unit:"m",
  desc:function(t,S){ return "昨日の合計は "+fmtn(D.dayStats(S,D.dayShift(-1)).m)+"m。今日は "+fmtn(t)+"m まで積もう。"; },
  val:function(S){ return D.dayStats(S,D.today()).m; }},

 {id:"D_NEW_SPOT",tag:"開拓",
  need:function(S){ var e=D.exploration(S); return e.total-e.done>0; },
  target:function(){ return 1; },
  title:function(){ return "まだ登っていない地点へ"; }, unit:"ヶ所",
  desc:function(){ return "今日、初めての地点をひとつ登ろう。いつもの階段から一歩ずらす日。"; },
  val:function(S){
    var d=D.today(), before={}, seen={}, n=0;
    S.entries.forEach(function(e){ if(e.date<d) before[e.spotId]=1; });
    S.entries.forEach(function(e){
      if(e.date===d && !before[e.spotId] && !seen[e.spotId]){ seen[e.spotId]=1; n++; } });
    return n; }},

 {id:"D_TWO_SPOTS",tag:"はしご",
  need:function(S){ return D.allSpots(S).length>=2; },
  target:function(){ return 2; },
  title:function(t){ return t+"ヶ所をはしご"; }, unit:"ヶ所",
  desc:function(t){ return "今日のうちに違う地点を "+t+"ヶ所。同じエリアで揃えば縦走にもなる。"; },
  val:function(S){ return todaySpots(S).length; }},

 {id:"D_MORNING",tag:"朝",
  target:function(){ return 1; },
  title:function(){ return "10時前に一本"; }, unit:"本",
  desc:function(){ return "午前10時より前に1回記録しよう。朝のうちに済ませる日。"; },
  val:function(S){ var d=D.today();
    return S.entries.filter(function(e){ return e.date===d && e.createdAt
      && new Date(e.createdAt).getHours()<10; }).length; }},

 {id:"D_NIGHT",tag:"夜",
  target:function(){ return 1; },
  title:function(){ return "21時以降に一本"; }, unit:"本",
  desc:function(){ return "夜に1回記録しよう。帰り道のひと登り。"; },
  val:function(S){ var d=D.today();
    return S.entries.filter(function(e){ return e.date===d && e.createdAt
      && new Date(e.createdAt).getHours()>=21; }).length; }},

 {id:"D_ONE_SHOT",tag:"一撃",
  need:function(S){ return dailyBaseline(S).maxSingle>0; },
  target:function(b){ return round5(Math.max(20,(b.maxSingle||20)*1.1)); },
  title:function(t){ return "一度に "+t+"m"; }, unit:"m",
  desc:function(t){ return "1回の記録で "+t+"m 以上を積もう。刻まずにまとめて登る日。"; },
  val:function(S){ var d=D.today();
    return S.entries.filter(function(e){ return e.date===d; })
      .reduce(function(a,e){ return Math.max(a,e.meters); },0); }},

 {id:"D_REACH_RANK",tag:"到達",
  target:function(b,S){
    var base=Math.max(D.dayStats(S,D.today()).m, b.avg||60);
    var nx=D.nextRank(base);
    return nx? nx.m : round10(base*1.2); },
  title:function(t,S){ var r=D.reachedRank(t); return (r?r.name:fmtn(t)+"m")+" まで"; }, unit:"m",
  desc:function(t,S){ var r=D.reachedRank(t);
    return "今日ぶんの合計で "+(r?r.name+"（"+fmtn(t)+"m）":fmtn(t)+"m")+" に届かせよう。"; },
  val:function(S){ return D.dayStats(S,D.today()).m; }},

 {id:"D_ROUND",tag:"往復",
  target:function(){ return 1; },
  title:function(){ return "下りも歩く"; }, unit:"本",
  desc:function(){ return "往復（下りも歩いた）で1回記録しよう。同じ階段でも負荷が変わる。"; },
  val:function(S){ var d=D.today();
    return S.entries.filter(function(e){ return e.date===d && e.round; }).length; }},

 {id:"D_QUIET_AREA",tag:"ごぶさた",
  need:function(S){ return quietAreas(S).length>0; },
  target:function(){ return 1; },
  title:function(){ return "しばらく行っていないエリアへ"; }, unit:"ヶ所",
  desc:function(t,S){ var q=quietAreas(S);
    return "この2週間で登っていないエリアへ。"+(q.length?"例: "+q.slice(0,3).join(" / "):""); },
  val:function(S){
    var recent={};
    S.entries.forEach(function(e){
      if(e.date>=D.dayShift(-14) && e.date<D.today()) recent[areaOfSpot(S,e.spotId)]=1; });
    return todaySpots(S).filter(function(id){ return !recent[areaOfSpot(S,id)]; }).length; }},

 {id:"D_REPS",tag:"反復",
  need:function(S){ return dailyBaseline(S).maxReps>0; },
  target:function(b){ return Math.max(2,Math.min(12,(b.maxReps||1)+1)); },
  title:function(t){ return "同じ階段を "+t+"本"; }, unit:"本",
  desc:function(t){ return "ひとつの記録で "+t+"本。往復して数を積む日。"; },
  val:function(S){ var d=D.today();
    return S.entries.filter(function(e){ return e.date===d; })
      .reduce(function(a,e){ return Math.max(a,e.reps||1); },0); }}
];
function fmtn(n){ return Math.round(n).toLocaleString(); }
function quietAreas(S){
  var all={}, recent={};
  D.allSpots(S).forEach(function(sp){ if(sp.area&&sp.area!=="—") all[sp.area]=1; });
  S.entries.forEach(function(e){
    if(e.date>=D.dayShift(-14)) recent[areaOfSpot(S,e.spotId)]=1; });
  return Object.keys(all).filter(function(a){ return !recent[a]; });
}
function dtplOf(id){ for(var i=0;i<DTPL.length;i++) if(DTPL[i].id===id) return DTPL[i]; return null; }
/* 直近に出たお題は避ける */
function recentDailyIds(S,dateStr,back){
  var out={};
  for(var i=1;i<=(back||6);i++){
    var k=shiftFrom(dateStr,-i), it=(S.daily||{})[k];
    if(it&&it.tpl) out[it.tpl]=1;
  }
  return out;
}
function shiftFrom(dateStr,n){
  var d=new Date(dateStr+"T00:00:00"); d.setDate(d.getDate()+n); return D.ymd(d);
}
var DAILY_VERSION=1;
function generateDaily(S,dateStr){
  var b=dailyBaseline(S), r=rng(fnv(dateStr+"|d"+DAILY_VERSION)), recent=recentDailyIds(S,dateStr);
  var pool=DTPL.filter(function(t){ return !t.need||t.need(S); });
  var fresh=pool.filter(function(t){ return !recent[t.id]; });
  if(fresh.length) pool=fresh;
  var t=pool[Math.floor(r()*pool.length)]||DTPL[3];
  var target=t.target(b,S);
  if(t.unit==="m") target=round5(target);
  return { date:dateStr, tpl:t.id, tag:t.tag, target:target, unit:t.unit,
           title:t.title(target,S), desc:t.desc(target,S),
           generatorVersion:DAILY_VERSION };
}
function ensureDaily(S){
  var k=D.today();
  S.daily=S.daily||{};
  if(!S.daily[k]||S.daily[k].generatorVersion!==DAILY_VERSION) S.daily[k]=generateDaily(S,k);
  /* 30日より前は捨てる。ここを残しても誰も見ない。 */
  var cut=D.dayShift(-30);
  Object.keys(S.daily).forEach(function(d){ if(d<cut) delete S.daily[d]; });
  return S.daily[k];
}
function dailyProgress(S){
  var it=(S.daily||{})[D.today()];
  if(!it) return null;
  var t=dtplOf(it.tpl);
  var cur=t? t.val(S) : 0;
  return { item:it, current:cur, target:it.target,
           ratio:Math.max(0,Math.min(1,cur/it.target)), done:cur>=it.target };
}
function tplOf(id){ for(var i=0;i<TPL.length;i++) if(TPL[i].id===id) return TPL[i]; return null; }

/* ===== 生成 ===== */
function recentIds(S,k){
  var out={}, c=k;
  for(var i=0;i<2;i++){ c=prevWeek(c);
    var mm=(S.missions||{})[c];
    if(mm&&mm.items) mm.items.forEach(function(it){ out[it.tpl]=1; }); }
  return out;
}
var GENERATOR_VERSION=1;
function generate(S,k){
  var b=baseline(S,k), mo=momentum(S,k), r=rng(fnv(k+"|v"+GENERATOR_VERSION)), recent=recentIds(S,k);
  var items=[];
  ["ascent","consistency","exploration","challenge"].forEach(function(cat){
    var pool=TPL.filter(function(t){
      if(t.cat!==cat) return false;
      if(t.need&&!t.need(S)) return false;
      return true; });
    var fresh=pool.filter(function(t){ return !recent[t.id]; });
    if(fresh.length) pool=fresh;
    var t=pool[Math.floor(r()*pool.length)]||pool[0];
    if(!t) return;
    var base=t.target(b,S);
    var target=Math.max(1, Math.round(base*(1+(b.weeks>=2?mo:0))));
    if(t.unit==="m") target=round10(target);
    items.push({ id:k+":"+t.id, tpl:t.id, cat:cat, catLabel:CAT[cat], catJp:CATJP[cat],
      title:t.title(target.toLocaleString()), desc:t.desc.replace("{t}",target.toLocaleString()),
      target:target, unit:t.unit, difficulty:"STANDARD",
      // なぜこの目標になったのかを後から追えるようにする（UIには出さない）
      trace:{ base:base, adjust:Math.round((b.weeks>=2?mo:0)*1000)/10, applied:target } });
  });
  // EASY 1 / STANDARD 2 / STRETCH 1 になるよう、目標の重さ順に割り当てる
  var order=items.map(function(it,i){ return {i:i,w:ratioGuess(S,k,it,b)}; })
    .sort(function(a,c){ return c.w-a.w; });
  var tags=["EASY","STANDARD","STANDARD","STRETCH"];
  order.forEach(function(o,ix){ items[o.i].difficulty=tags[ix]||"STANDARD"; });
  return { generatedAt:new Date().toISOString(), weekKey:k, items:items,
    generatorVersion:GENERATOR_VERSION,
    baseline:{ weeks:b.weeks, m:Math.round(b.m*10)/10, days:Math.round(b.days*100)/100,
               newSpots:Math.round(b.newSpots*100)/100, maxDay:Math.round(b.maxDay*10)/10,
               maxSingle:Math.round(b.maxSingle*10)/10, momentum:Math.round(mo*1000)/10 } };
}
function ratioGuess(S,k,it,b){
  var per={ASCENT_TARGET:b.m,ASCENT_NEXT_TIER:b.m,LOG_DAYS:b.days,WEEKDAY_3:b.days,
    STREAK_3:b.days,NEW_SPOTS:b.newSpots,NEW_AREA_1:0.7,SINGLE_SESSION:b.maxSingle,
    BIG_DAY:b.maxDay,WEEKEND_BURST:b.m*0.5,MORNING_2:1.2}[it.tpl];
  if(!per) return 1;
  return it.target/Math.max(0.001,per);
}
function ensure(S){
  var k=currentWeek();
  S.missions=S.missions||{};
  if(!S.missions[k]) S.missions[k]=generate(S,k);
  // 達成の台帳から、もう達成していないものを外す（記録を消したら未達成に戻す）
  S.missionState=S.missionState||{};
  Object.keys(S.missionState).forEach(function(id){
    var wkey=id.slice(0,10), wk=S.missions[wkey];
    if(!wk) return;
    var it=wk.items.filter(function(x){return x.id===id;})[0];
    if(it && !progress(S,it,wkey).done) delete S.missionState[id];
  });
  return S.missions[k];
}

/* ===== 進捗（保存せず毎回数え直す） ===== */
function progress(S,item,k){
  var t=tplOf(item.tpl);
  var cur=t? t.val(S,k||item.id.slice(0,10)) : 0;
  return { current:cur, target:item.target,
           ratio:Math.max(0,Math.min(1,cur/item.target)),
           done:cur>=item.target };
}
function weekProgress(S,k){
  var wk=(S.missions||{})[k];
  if(!wk) return {done:0,total:0,items:[]};
  var items=wk.items.map(function(it){
    var p=progress(S,it,k); p.item=it; return p; });
  return { done:items.filter(function(p){return p.done;}).length, total:items.length, items:items };
}
/* 記録の前後で新たに達成されたものを返す */
function newlyCompleted(before,after){
  var was={}; before.items.forEach(function(p){ if(p.done) was[p.item.id]=1; });
  return after.items.filter(function(p){ return p.done && !was[p.item.id]; }).map(function(p){ return p.item; });
}

root.M={ weekStartOf:weekStartOf, weekEndOf:weekEndOf, currentWeek:currentWeek, prevWeek:prevWeek,
  weekLabel:weekLabel, daysLeft:daysLeft, weekSummary:weekSummary, entriesOfWeek:entriesOfWeek,
  baseline:baseline, generate:generate, ensure:ensure, progress:progress, weekProgress:weekProgress,
  newlyCompleted:newlyCompleted, tplOf:tplOf, TPL:TPL, GENERATOR_VERSION:GENERATOR_VERSION,
  DTPL:DTPL, dtplOf:dtplOf, dailyBaseline:dailyBaseline, generateDaily:generateDaily,
  ensureDaily:ensureDaily, dailyProgress:dailyProgress, DAILY_VERSION:DAILY_VERSION };
})(typeof window!=="undefined"?window:globalThis);
