/* domain.js — 計算だけを担当する層。DOM も localStorage も触らない。 */
(function (root) {
"use strict";

var RANKS = [
  {id:"harukas",    m:300,  name:"あべのハルカス"},
  {id:"takao",      m:599,  name:"高尾山"},
  {id:"fuji5",      m:1450, name:"富士山 五合目→山頂"},
  {id:"fuji",       m:3776, name:"富士山 標高ぜんぶ"},
  {id:"kilimanjaro",m:5895, name:"キリマンジャロ"},
  {id:"everest",    m:8848, name:"エベレスト"}
];
var BOUNDS=[0,300,599,1450,3776,5895,8848];
var CONF_RANK={"実測":4,"確定":3,"導出":2,"推定":1};

/* 6区間を等分割。序盤でもバーが動くようにするための設計（変更不可）。 */
function pos(t){
  if(t>=8848) return 1;
  for(var i=0;i<6;i++){ if(t<BOUNDS[i+1]) return (i+(t-BOUNDS[i])/(BOUNDS[i+1]-BOUNDS[i]))/6; }
  return 1;
}
function tierOf(t){
  var i=-1;
  for(var k=0;k<RANKS.length;k++){ if(t<RANKS[k].m){ i=k; break; } }
  if(i===-1) return {idx:-1,tier:RANKS[5],cleared:6,remain:0,done:true,inTier:1};
  return {idx:i,tier:RANKS[i],cleared:i,remain:RANKS[i].m-t,done:false,
          inTier:(t-BOUNDS[i])/(BOUNDS[i+1]-BOUNDS[i])};
}
/* 6座それぞれの状態。どの標高がどの山かを一覧で見せるための表。 */
function mountainTable(t){
  return RANKS.map(function(r,i){
    var prev=BOUNDS[i];
    var reached=t>=r.m;
    var cur=!reached && t>=prev;
    return {i:i+1,id:r.id,name:r.name,m:r.m,
      reached:reached, current:cur,
      done:Math.min(t,r.m),
      ratio: reached?1:(cur?(t-prev)/(r.m-prev):0),
      absRatio: Math.min(1,t/r.m),
      remain: Math.max(0,r.m-t)};
  });
}
/* 期間の合計が、どの山いくつぶんに当たるか */
function equivalent(m){
  if(m<=0) return null;
  var pick=RANKS[0];
  for(var i=RANKS.length-1;i>=0;i--){ if(m>=RANKS[i].m){ pick=RANKS[i]; break; } }
  return {name:pick.name, m:pick.m, times:m/pick.m};
}
function lifetime(S){ return S.entries.reduce(function(a,e){return a+e.meters;},0); }

/* ===== 地点 =====
   マスタ(seed.js)は差し替わりうるので、名前などの編集は seed を書き換えず
   over[id].meta に持ち、読み出すときに重ねる。非表示も同じ場所に持つ。 */
function decorate(S,sp){
  var o=S.over[sp.id]||{}, m=o.meta;
  if(!m&&!o.hidden) return sp;
  var out={}; for(var k in sp) out[k]=sp[k];
  if(m){
    if(m.name) out.name=m.name;
    if(m.area) out.area=m.area;
    if(m.cat)  out.cat=m.cat;
    if(m.min!=null) out.min=m.min;
    out.edited=true;
  }
  out.hidden=!!o.hidden;
  return out;
}
function allSpots(S,withHidden){
  var a=(root.SEED||[]).concat(S.customSpots||[]).map(function(sp){return decorate(S,sp);});
  return withHidden? a : a.filter(function(sp){return !sp.hidden;});
}
function spotOf(S,id){ var a=allSpots(S,true);
  for(var i=0;i<a.length;i++) if(a[i].id===id) return a[i]; return null; }
function isHidden(S,id){ return !!((S.over[id]||{}).hidden); }
function setMeta(S,id,k,v){
  var o=ovW(S,id); o.meta=o.meta||{};
  if(v==null||v==="") delete o.meta[k]; else o.meta[k]=v;
  if(!Object.keys(o.meta).length) delete o.meta;
}
function resetMeta(S,id){ var o=S.over[id]; if(o) delete o.meta; }

var EMPTY_OV={segs:{}}, EMPTY_SEG={};
function ov(S,id){ return S.over[id]||EMPTY_OV; }
function segOv(S,sid,gid){ return ((S.over[sid]||EMPTY_OV).segs||EMPTY_SEG)[gid]||EMPTY_SEG; }
function ovW(S,id){ var o=(S.over[id]=S.over[id]||{}); o.segs=o.segs||{}; return o; }
function segOvW(S,sid,gid){ var o=ovW(S,sid); return (o.segs[gid]=o.segs[gid]||{}); }
function pruneOver(S){
  Object.keys(S.over||{}).forEach(function(sid){
    var o=S.over[sid]||{};
    if(o.segs) Object.keys(o.segs).forEach(function(gid){
      if(!Object.keys(o.segs[gid]||{}).length) delete o.segs[gid]; });
    var hasSeg=o.segs&&Object.keys(o.segs).length;
    var hasMeta=o.meta&&Object.keys(o.meta).length;
    if(!o.rise&&!o.floorH&&!hasSeg&&!hasMeta&&!o.hidden) delete S.over[sid];
  });
}

/* ===== 3段カスケード（確定仕様・変更不可） ===== */
function riseFor(S,sp,g){
  var so=segOv(S,sp.id,g.id), o=ov(S,sp.id);
  if(so.rise) return {v:so.rise,lv:"seg"};
  if(o.rise)  return {v:o.rise,lv:"spot"};
  return {v:S.baseRise,lv:"base"};
}
function floorHFor(S,sp){
  var o=ov(S,sp.id);
  if(o.floorH) return {v:o.floorH,lv:"spot"};
  if(sp.floorH) return {v:sp.floorH,lv:"seed",src:sp.floorHSrc};
  return {v:S.baseFloorH,lv:"base"};
}
function resolve(S,sp,g){
  var so=segOv(S,sp.id,g.id);
  if(so.height) return {m:so.height,conf:"実測",cls:"c-meas"};
  if(so.steps){ var r=riseFor(S,sp,g);
    return {m:so.steps*r.v,conf:r.lv==="base"?"導出":"実測",cls:r.lv==="base"?"c-der":"c-meas"}; }
  if(g.height!=null){
    if(g.src==="confirmed") return {m:g.height,conf:"確定",cls:"c-conf"};
    if(g.src==="derived")   return {m:g.height,conf:"導出",cls:"c-der"};
    return {m:g.height,conf:"推定",cls:"c-est"};
  }
  var f=floorHFor(S,sp), L=g.layers||1;
  if(f.lv==="spot") return {m:L*f.v,conf:"導出",cls:"c-der"};
  if(f.lv==="seed") return f.src==="derived"
    ? {m:L*f.v,conf:"導出",cls:"c-der"} : {m:L*f.v,conf:"確定",cls:"c-conf"};
  return {m:L*f.v,conf:"推定",cls:"c-est"};
}
function spotTotal(S,sp){ return sp.segs.reduce(function(a,g){return a+resolve(S,sp,g).m;},0); }
function backRise(S,sp,g){
  var so=segOv(S,sp.id,g.id);
  var h=so.height||(g.height!=null?g.height:null);
  return (h&&so.steps)? h/so.steps : null;
}
function stepsForSegs(S,sp,gs){
  return gs.reduce(function(a,g){
    var so=segOv(S,sp.id,g.id);
    if(so.steps) return a+so.steps;
    return a+resolve(S,sp,g).m/riseFor(S,sp,g).v; },0);
}

/* ===== 計算式（確定・変更不可） ===== */
function kcalRaw(m,w,round){ return Math.round(w*m*0.01*(round?1.3:1)*100)/100; }
function kcalOf(S,e){ return Math.round(e.kcal!=null?e.kcal
  :(e.weightAtSave||S.weight)*e.meters*0.01*(e.round?1.3:1)); }
function stepsOf(S,e){ return e.steps!=null?Math.round(e.steps):Math.round(e.meters/S.baseRise); }
function fatG(kcal,S){ return kcal/(((S.settings&&S.settings.fatKcalPerKg)||7200))*1000; }

/* ===== 日付 ===== */
function p2(n){ return String(n).padStart(2,"0"); }
function ymd(d){ return d.getFullYear()+"-"+p2(d.getMonth()+1)+"-"+p2(d.getDate()); }
function today(){ return ymd(new Date()); }
function dayShift(n){ var d=new Date(); d.setDate(d.getDate()+n); return ymd(d); }

/* ===== 分析 ===== */
function agg(S,list){
  return { m:list.reduce(function(a,e){return a+e.meters;},0),
           kcal:list.reduce(function(a,e){return a+kcalOf(S,e);},0),
           steps:list.reduce(function(a,e){return a+stepsOf(S,e);},0),
           days:new Set(list.map(function(e){return e.date;})).size,
           n:list.length };
}
function periodStats(S,days){
  var end=today(), start=dayShift(-(days-1)), pStart=dayShift(-(days*2-1)), pEnd=dayShift(-days);
  var c=agg(S,S.entries.filter(function(e){return e.date>=start&&e.date<=end;}));
  var p=agg(S,S.entries.filter(function(e){return e.date>=pStart&&e.date<=pEnd;}));
  function d(a,b){ return b>0?Math.round((a-b)/b*100):(a>0?null:0); }
  return {cur:c,prev:p,span:days,dM:d(c.m,p.m),dK:d(c.kcal,p.kcal),dS:d(c.steps,p.steps),
          dD:d(c.days,p.days),rate:Math.round(c.days/days*100)};
}
function allTimeStats(S){
  if(!S.entries.length) return {cur:{m:0,kcal:0,steps:0,days:0,n:0},prev:{m:0},span:0,
    dM:null,dK:null,dS:null,dD:null,rate:0};
  var ds=S.entries.map(function(e){return e.date;}).sort();
  var span=Math.max(1,Math.round((new Date(ds[ds.length-1])-new Date(ds[0]))/864e5)+1);
  var c=agg(S,S.entries);
  return {cur:c,prev:{m:0},span:span,dM:null,dK:null,dS:null,dD:null,
          rate:Math.round(c.days/span*100)};
}
/* 日単位の集計 */
function dayStats(S,date){
  return agg(S,S.entries.filter(function(e){return e.date===date;}));
}
function lastDays(S,n){
  var out=[], d=new Date(); d.setDate(d.getDate()-(n-1));
  for(var i=0;i<n;i++){
    var k=ymd(d), a=dayStats(S,k);
    out.push({date:k,dow:new Date(k+"T00:00:00").getDay(),m:a.m,kcal:a.kcal,steps:a.steps,n:a.n});
    d.setDate(d.getDate()+1);
  }
  return out;
}
function bestDay(S){
  var m=byDate(S), best={date:null,m:0};
  Object.keys(m).forEach(function(k){ if(m[k]>best.m) best={date:k,m:m[k]}; });
  return best;
}
function byDate(S){ var m={};
  S.entries.forEach(function(e){ m[e.date]=(m[e.date]||0)+e.meters; }); return m; }
function heatmap(S,weeks){
  var map=byDate(S), out=[], d=new Date(), max=0;
  d.setDate(d.getDate()-(weeks*7-1));
  for(var i=0;i<weeks*7;i++){
    var k=ymd(d), v=map[k]||0; if(v>max)max=v;
    out.push({date:k,m:v}); d.setDate(d.getDate()+1);
  }
  out.forEach(function(o){ o.lv=(o.m<=0||max<=0)?0:Math.min(4,1+Math.floor(o.m/max*3.99)); });
  return out;
}
function weekday(S){ var a=[0,0,0,0,0,0,0];
  S.entries.forEach(function(e){ a[new Date(e.date+"T00:00:00").getDay()]+=e.meters; }); return a; }
function exploration(S){
  var spots=allSpots(S), visited=new Set(S.entries.map(function(e){return e.spotId;}));
  var un=spots.filter(function(s){return !visited.has(s.id);})
    .sort(function(a,b){ return (a.min==null?999:a.min)-(b.min==null?999:b.min); });
  return {done:spots.length-un.length,total:spots.length,next:un.slice(0,3),visited:visited};
}
function areaProgress(S){
  var visited=exploration(S).visited, m={};
  allSpots(S).forEach(function(s){
    var a=s.area||"—"; m[a]=m[a]||{area:a,total:0,done:0};
    m[a].total++; if(visited.has(s.id)) m[a].done++;
  });
  return Object.keys(m).map(function(k){return m[k];})
    .filter(function(x){return x.area!=="—";})
    .sort(function(x,y){ return (y.done/y.total)-(x.done/x.total)||y.total-x.total; });
}
function streak(S){
  var set=new Set(S.entries.map(function(e){return e.date;}));
  var cur=0,d=new Date();
  if(!set.has(ymd(d))) d.setDate(d.getDate()-1);
  while(set.has(ymd(d))){ cur++; d.setDate(d.getDate()-1); }
  var best=0,run=0,prev=null;
  Array.from(set).sort().forEach(function(k){
    run=(prev&&(new Date(k)-new Date(prev))===864e5)?run+1:1;
    if(run>best) best=run; prev=k; });
  return {current:cur,best:best};
}
/* 実績は「いま満たしているか」と「かつて解除したか」を分ける。
   記録を消すと統計は戻るが、解除の履歴は残す。ゲームとして自然な扱い。 */
function syncAchievements(S){
  S.achievementLog=S.achievementLog||{};
  var now=achievements(S), fresh=[];
  now.forEach(function(a){
    if(a.got && !S.achievementLog[a.name]){
      S.achievementLog[a.name]={unlockedAt:new Date().toISOString()};
      fresh.push(a);
    }
  });
  return fresh;
}
function achievementView(S){
  var log=S.achievementLog||{};
  return achievements(S).map(function(a){
    var ever=!!log[a.name];
    return {name:a.name,desc:a.desc,got:a.got||ever,now:a.got,ever:ever,
            lapsed:(ever&&!a.got), unlockedAt:ever?log[a.name].unlockedAt:null};
  });
}
/* 到達済みSummitは現在の累計から数え直す。記録を消せば山を下る。 */
function recomputeSummits(S){
  var t=lifetime(S); S.summits=S.summits||{};
  var changed=false;
  RANKS.forEach(function(r){
    if(t>=r.m){ if(!S.summits[r.id]){ S.summits[r.id]={reachedAt:null,atElevationM:t}; changed=true; } }
    else if(S.summits[r.id]){ delete S.summits[r.id]; changed=true; }
  });
  return changed;
}

/* ===== 内部イベント =====
   ひとつの記録から複数の出来事が起きうるので、検出と演出を分ける。 */
var EVENT_PRIORITY={SUMMIT_COMPLETED:4,MISSION_COMPLETED:3,ACHIEVEMENT_UNLOCKED:2,ENTRY_RECORDED:1};
function snapshot(S,missionProgress){
  return {
    lifetime:lifetime(S),
    summits:Object.keys(S.summits||{}),
    missions:(missionProgress&&missionProgress.items||[]).filter(function(p){return p.done;})
              .map(function(p){return p.item.id;}),
    achievements:achievements(S).filter(function(a){return a.got;}).map(function(a){return a.name;})
  };
}
function buildEvents(before,after,ctx){
  ctx=ctx||{};
  var ev=[];
  ev.push({type:"ENTRY_RECORDED",priority:EVENT_PRIORITY.ENTRY_RECORDED,
           meters:after.lifetime-before.lifetime,from:before.lifetime,to:after.lifetime,entry:ctx.entry});
  ev.push({type:"SUMMIT_PROGRESS_UPDATED",priority:0,from:before.lifetime,to:after.lifetime});
  ev.push({type:"MISSION_PROGRESS_UPDATED",priority:0});
  diff(before.summits,after.summits).forEach(function(id){
    ev.push({type:"SUMMIT_COMPLETED",priority:EVENT_PRIORITY.SUMMIT_COMPLETED,id:id,
             name:(RANKS.filter(function(r){return r.id===id;})[0]||{}).name});
  });
  diff(before.missions,after.missions).forEach(function(id){
    ev.push({type:"MISSION_COMPLETED",priority:EVENT_PRIORITY.MISSION_COMPLETED,id:id,
             item:(ctx.missionById||{})[id]});
  });
  diff(before.achievements,after.achievements).forEach(function(n){
    ev.push({type:"ACHIEVEMENT_UNLOCKED",priority:EVENT_PRIORITY.ACHIEVEMENT_UNLOCKED,name:n});
  });
  return ev;
}
function diff(a,b){ var s={}; a.forEach(function(x){s[x]=1;}); return b.filter(function(x){return !s[x];}); }
function topEvent(events){
  var best=null;
  events.forEach(function(e){ if(e.priority>0 && (!best||e.priority>best.priority)) best=e; });
  return best;
}

function achievements(S){
  var map=byDate(S), st=streak(S), ex=exploration(S);
  var vals=Object.keys(map).map(function(k){return map[k];});
  var maxDay=vals.length?Math.max.apply(null,vals):0;
  var mo={}; S.entries.forEach(function(e){ var k=e.date.slice(0,7); mo[k]=(mo[k]||0)+e.meters; });
  var mv=Object.keys(mo).map(function(k){return mo[k];});
  var maxMonth=mv.length?Math.max.apply(null,mv):0;
  var steps=S.entries.reduce(function(a,e){return a+stepsOf(S,e);},0);
  var kcal=S.entries.reduce(function(a,e){return a+kcalOf(S,e);},0);
  var cats=new Set(S.entries.map(function(e){return e.cat;}));
  var seedIds=new Set((root.SEED||[]).map(function(s){return s.id;}));
  var seedDone=Array.from(ex.visited).filter(function(id){return seedIds.has(id);}).length;
  return [
    ["初登頂","はじめての記録",S.entries.length>=1],
    ["7日連続","7日続けて登る",st.best>=7],
    ["30日連続","30日続けて登る",st.best>=30],
    ["1日100m","1日で100m",maxDay>=100],
    ["1日300m","1日で300m",maxDay>=300],
    ["月間500m","ひと月で500m",maxMonth>=500],
    ["1万段","累計10,000段",steps>=10000],
    ["10万段","累計100,000段",steps>=100000],
    ["1万kcal","累計10,000kcal",kcal>=10000],
    ["初ボス戦","山・タワーを登る",cats.has("boss")],
    ["5地点","5ヶ所を踏破",seedDone>=5],
    ["15地点","15ヶ所を踏破",seedDone>=15],
    ["全地点","34ヶ所すべて",seedDone>=seedIds.size],
    ["全カテゴリ","4種すべての場所",cats.size>=4]
  ].map(function(x){ return {name:x[0],desc:x[1],got:!!x[2]}; });
}

/* ===== 入力の整合チェック（弾かずに警告して判断を委ねる） ===== */
function checkSeg(v){
  var w=[];
  if(v.rise&&(v.rise<140||v.rise>230))
    w.push({lv:"warn",msg:"蹴上げ "+Math.round(v.rise)+"mm は一般的な階段の範囲(140〜230mm)から外れています。単位はmmで合っていますか。"});
  if(v.steps&&v.layers){
    var per=v.steps/v.layers;
    if(per<12||per>32) w.push({lv:"warn",msg:"1層あたり "+Math.round(per)+"段 です。層数の入力を確認してください。"});
  }
  if(v.steps&&v.rise&&v.height){
    var calc=v.steps*v.rise/1000;
    if(Math.abs(calc-v.height)/v.height>0.05)
      w.push({lv:"conflict",
        msg:"段数×蹴上げ＝"+(Math.round(calc*10)/10)+"m ですが、高さに "+v.height+"m と入力されています。どちらを採用しますか。",
        a:{label:"段数×蹴上げ "+(Math.round(calc*10)/10)+"m",height:Math.round(calc*100)/100},
        b:{label:"入力した高さ "+v.height+"m",height:v.height}});
  }
  return w;
}
function checkSpot(v){
  var w=[];
  if(v.floorH&&(v.floorH<2.5||v.floorH>6.5))
    w.push({lv:"warn",msg:"階高 "+(Math.round(v.floorH*100)/100)+"m は通常の範囲(2.5〜6.5m)から外れています。吹抜や機械室階の可能性はありますか。"});
  if(v.totalM&&v.segSum){
    var d=Math.abs(v.segSum-v.totalM)/v.totalM;
    if(d>0.2) w.push({lv:"warn",msg:"区間の合計 "+(Math.round(v.segSum*10)/10)+"m が、建物全体の高さ "+v.totalM+"m と "+Math.round(d*100)+"% ずれています。"});
  }
  return w;
}
function derive(v){
  var o={};
  if(v.steps&&v.rise&&!v.height) o.height=Math.round(v.steps*v.rise/1000*100)/100;
  if(v.steps&&v.height&&!v.rise) o.rise=Math.round(v.height/v.steps*1000*10)/10;
  if(v.rise&&v.height&&!v.steps) o.steps=Math.round(v.height/(v.rise/1000));
  return o;
}

root.D={RANKS:RANKS,BOUNDS:BOUNDS,CONF_RANK:CONF_RANK,pos:pos,tierOf:tierOf,lifetime:lifetime,mountainTable:mountainTable,equivalent:equivalent,
  allSpots:allSpots,spotOf:spotOf,isHidden:isHidden,setMeta:setMeta,resetMeta:resetMeta,ov:ov,segOv:segOv,ovW:ovW,segOvW:segOvW,pruneOver:pruneOver,
  riseFor:riseFor,floorHFor:floorHFor,resolve:resolve,spotTotal:spotTotal,backRise:backRise,
  stepsForSegs:stepsForSegs,kcalRaw:kcalRaw,kcalOf:kcalOf,stepsOf:stepsOf,fatG:fatG,
  today:today,ymd:ymd,dayShift:dayShift,periodStats:periodStats,allTimeStats:allTimeStats,
  heatmap:heatmap,weekday:weekday,areaProgress:areaProgress,exploration:exploration,
  streak:streak,achievements:achievements,syncAchievements:syncAchievements,achievementView:achievementView,recomputeSummits:recomputeSummits,snapshot:snapshot,buildEvents:buildEvents,topEvent:topEvent,EVENT_PRIORITY:EVENT_PRIORITY,dayStats:dayStats,lastDays:lastDays,bestDay:bestDay,checkSeg:checkSeg,checkSpot:checkSpot,derive:derive};
})(typeof window!=="undefined"?window:globalThis);
