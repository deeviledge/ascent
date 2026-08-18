/* domain.js — 計算だけを担当する層。DOM も localStorage も触らない。 */
(function (root) {
"use strict";

/* 到達の刻み。既存6座（harukas/takao/fuji5/fuji/kilimanjaro/everest）は
   IDも標高も変えずに残し、あいだを埋めている。
   art はどの山シルエットを使うかの指定（素材は6種）。 */
/* 到達の刻み。序盤ほど細かく、身近な建物で刻む。
   旧6座（harukas/takao/fuji5/fuji/kilimanjaro/everest）はIDも標高も変えずに残してある。
   art はどの山シルエットを使うかの指定（素材は6種）。 */
var RANKS = [
  {id:"tokyostation", m:45,   name:"東京駅 丸の内駅舎",   art:"harukas",     note:"東京"},
  {id:"toji",         m:55,   name:"東寺 五重塔",        art:"harukas",     note:"日本一高い木造塔"},
  {id:"liberty",      m:93,   name:"自由の女神",         art:"harukas",     note:"台座込み・ニューヨーク"},
  {id:"tsutenkaku",   m:108,  name:"通天閣",            art:"harukas",     note:"大阪"},
  {id:"kyototower",   m:131,  name:"京都タワー",         art:"harukas",     note:"京都"},
  {id:"pyramid",      m:139,  name:"クフ王のピラミッド",  art:"harukas",     note:"エジプト"},
  {id:"sapporotv",    m:147,  name:"さっぽろテレビ塔",    art:"harukas",     note:"札幌"},
  {id:"umeda",        m:173,  name:"梅田スカイビル",      art:"harukas",     note:"大阪"},
  {id:"nagoyatv",     m:180,  name:"名古屋テレビ塔",      art:"harukas",     note:"日本初の集約電波塔"},
  {id:"nakanoshima",  m:200,  name:"中之島フェスティバルタワー", art:"harukas", note:"大阪"},
  {id:"shibuyasq",    m:229,  name:"渋谷スクランブルスクエア", art:"harukas", note:"渋谷"},
  {id:"roppongi",     m:238,  name:"六本木ヒルズ 森タワー", art:"harukas",   note:"東京"},
  {id:"tocho",        m:243,  name:"東京都庁 第一本庁舎", art:"harukas",     note:"新宿"},
  {id:"midtown",      m:248,  name:"ミッドタウン・タワー", art:"harukas",    note:"東京"},
  {id:"toranomon",    m:256,  name:"虎ノ門ヒルズ 森タワー", art:"harukas",   note:"東京"},
  {id:"landmark",     m:296,  name:"横浜ランドマークタワー", art:"harukas",  note:"横浜"},
  {id:"harukas",      m:300,  name:"あべのハルカス",      art:"harukas",     note:"大阪"},
  {id:"azabudai",     m:325,  name:"麻布台ヒルズ 森JPタワー", art:"harukas", note:"日本一高いビル"},
  {id:"tokyotower",   m:333,  name:"東京タワー",         art:"harukas",     note:"東京"},
  {id:"empire",       m:381,  name:"エンパイア・ステート・ビル", art:"takao", note:"ニューヨーク"},
  {id:"petronas",     m:452,  name:"ペトロナスツインタワー", art:"takao",    note:"クアラルンプール"},
  {id:"taipei101",    m:508,  name:"台北101",           art:"takao",       note:"台湾"},
  {id:"cntower",      m:553,  name:"CNタワー",          art:"takao",       note:"トロント"},
  {id:"takao",        m:599,  name:"高尾山",            art:"takao",       note:"東京・八王子"},
  {id:"canton",       m:604,  name:"広州タワー",         art:"takao",       note:"中国"},
  {id:"shanghai",     m:632,  name:"上海タワー",         art:"takao",       note:"世界2位のビル"},
  {id:"skytree",      m:634,  name:"東京スカイツリー",    art:"takao",       note:"世界一高い塔"},
  {id:"burj",         m:828,  name:"ブルジュ・ハリファ",  art:"takao",       note:"世界一高いビル"},
  {id:"hiei",         m:848,  name:"比叡山",            art:"takao",       note:"京都・滋賀"},
  {id:"tsukuba",      m:877,  name:"筑波山",            art:"takao",       note:"茨城"},
  {id:"rokko",        m:931,  name:"六甲山",            art:"takao",       note:"兵庫"},
  {id:"kongo",        m:1125, name:"金剛山",            art:"fuji5",       note:"大阪最高峰"},
  {id:"gozaisho",     m:1212, name:"御在所岳",          art:"fuji5",       note:"三重・滋賀"},
  {id:"ibuki",        m:1377, name:"伊吹山",            art:"fuji5",       note:"滋賀・岐阜"},
  {id:"amagi",        m:1406, name:"天城山",            art:"fuji5",       note:"静岡"},
  {id:"fuji5",        m:1450, name:"富士山 五合目→山頂", art:"fuji5",       note:"五合目からの標高差"},
  {id:"aso",          m:1592, name:"阿蘇山（高岳）",     art:"fuji5",       note:"熊本"},
  {id:"odaigahara",   m:1695, name:"大台ヶ原山",         art:"fuji5",       note:"奈良・三重"},
  {id:"daisen",       m:1729, name:"大山",              art:"fuji5",       note:"鳥取"},
  {id:"zao",          m:1841, name:"蔵王山（熊野岳）",   art:"fuji5",       note:"山形・宮城"},
  {id:"ishizuchi",    m:1982, name:"石鎚山",            art:"fuji5",       note:"西日本最高峰"},
  {id:"kumotori",     m:2017, name:"雲取山",            art:"fuji",        note:"東京都最高峰"},
  {id:"enasan",       m:2191, name:"恵那山",            art:"fuji",        note:"長野・岐阜"},
  {id:"tateshina",    m:2531, name:"蓼科山",            art:"fuji",        note:"長野"},
  {id:"hakusan",      m:2702, name:"白山",              art:"fuji",        note:"石川・岐阜"},
  {id:"akadake",      m:2899, name:"赤岳（八ヶ岳）",     art:"fuji",        note:"長野・山梨"},
  {id:"kisokoma",     m:2956, name:"木曽駒ヶ岳",         art:"fuji",        note:"中央アルプス最高峰"},
  {id:"ontake",       m:3067, name:"御嶽山",            art:"fuji",        note:"長野・岐阜"},
  {id:"yarigatake",   m:3180, name:"槍ヶ岳",            art:"fuji",        note:"北アルプス"},
  {id:"kitadake",     m:3193, name:"北岳",              art:"fuji",        note:"日本第2位"},
  {id:"fuji",         m:3776, name:"富士山",            art:"fuji",        note:"日本最高峰"},
  {id:"yushan",       m:3952, name:"玉山",              art:"kilimanjaro", note:"台湾最高峰"},
  {id:"kinabalu",     m:4095, name:"キナバル山",         art:"kilimanjaro", note:"ボルネオ"},
  {id:"matterhorn",   m:4478, name:"マッターホルン",     art:"kilimanjaro", note:"スイス・イタリア"},
  {id:"montblanc",    m:4808, name:"モンブラン",         art:"kilimanjaro", note:"アルプス最高峰"},
  {id:"kenya",        m:5199, name:"ケニア山",          art:"kilimanjaro", note:"アフリカ2位"},
  {id:"elbrus",       m:5642, name:"エルブルス",         art:"kilimanjaro", note:"ヨーロッパ最高峰"},
  {id:"kilimanjaro",  m:5895, name:"キリマンジャロ",     art:"kilimanjaro", note:"アフリカ最高峰"},
  {id:"denali",       m:6190, name:"デナリ",            art:"kilimanjaro", note:"北米最高峰"},
  {id:"aconcagua",    m:6961, name:"アコンカグア",       art:"everest",     note:"南米最高峰"},
  {id:"muztagh",      m:7546, name:"ムスターグ・アタ",   art:"everest",     note:"中国・パミール"},
  {id:"shishapangma", m:8027, name:"シシャパンマ",       art:"everest",     note:"8000m峰14座の1つ"},
  {id:"manaslu",      m:8163, name:"マナスル",          art:"everest",     note:"世界8位"},
  {id:"lhotse",       m:8516, name:"ローツェ",          art:"everest",     note:"世界4位"},
  {id:"k2",           m:8611, name:"K2",               art:"everest",     note:"世界2位"},
  {id:"everest",      m:8848, name:"エベレスト",         art:"everest",     note:"世界最高峰"}
];
var BOUNDS=[0].concat(RANKS.map(function(r){return r.m;}));
var NTIER=RANKS.length;
var CONF_RANK={"実測":4,"確定":3,"導出":2,"推定":1};

/* 6区間を等分割。序盤でもバーが動くようにするための設計（変更不可）。 */
/* 全体ゲージは各座を等分割。実距離だと序盤が1pxも動かず離脱するため（設計上の確定事項）。 */
function pos(t){
  if(t>=RANKS[NTIER-1].m) return 1;
  for(var i=0;i<NTIER;i++){
    if(t<BOUNDS[i+1]) return (i+(t-BOUNDS[i])/(BOUNDS[i+1]-BOUNDS[i]))/NTIER;
  }
  return 1;
}
function tierOf(t){
  var i=-1;
  for(var k=0;k<RANKS.length;k++){ if(t<RANKS[k].m){ i=k; break; } }
  if(i===-1) return {idx:-1,tier:RANKS[NTIER-1],cleared:NTIER,remain:0,done:true,inTier:1};
  return {idx:i,tier:RANKS[i],cleared:i,remain:RANKS[i].m-t,done:false,
          inTier:(t-BOUNDS[i])/(BOUNDS[i+1]-BOUNDS[i])};
}
/* 6座それぞれの状態。どの標高がどの山かを一覧で見せるための表。 */
function mountainTable(t){
  return RANKS.map(function(r,i){
    var prev=BOUNDS[i];
    var reached=t>=r.m;
    var cur=!reached && t>=prev;
    return {i:i+1,id:r.id,name:r.name,m:r.m,note:r.note,art:r.art,
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
  var extra=o.extraSegs&&o.extraSegs.length, hidden=o.segHide&&Object.keys(o.segHide).length;
  if(!m&&!o.hidden&&!extra&&!hidden) return sp;
  var out={}; for(var k in sp) out[k]=sp[k];
  if(extra||hidden){
    out.segs=(sp.segs||[]).filter(function(g){ return !(o.segHide&&o.segHide[g.id]); })
      .concat((o.extraSegs||[]).map(function(g){ var c={}; for(var k2 in g) c[k2]=g[k2]; c.added=true; return c; }));
  }
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

/* 区間の追加・非表示。seed.js は書き換えず over 側に持つ。 */
function addSeg(S,spotId,seg){
  var o=ovW(S,spotId); o.extraSegs=o.extraSegs||[];
  var n=1, id;
  do{ id="x"+(n++); }while(o.extraSegs.some(function(g){return g.id===id;})
      || ((root.SEED||[]).concat(S.customSpots||[]).filter(function(x){return x.id===spotId;})[0]||{segs:[]})
         .segs.some(function(g){return g.id===id;}));
  var g={id:id,label:seg.label||"追加した区間",layers:seg.layers||1};
  if(seg.height!=null){ g.height=Math.round(seg.height*100)/100; g.src=seg.src||"confirmed"; }
  o.extraSegs.push(g);
  return g;
}
function updateSeg(S,spotId,segId,patch){
  var o=S.over[spotId]; if(!o||!o.extraSegs) return null;
  var g=o.extraSegs.filter(function(x){return x.id===segId;})[0]; if(!g) return null;
  for(var k in patch){ if(patch[k]==null) delete g[k]; else g[k]=patch[k]; }
  return g;
}
function removeSeg(S,spotId,segId){
  var o=S.over[spotId]; if(!o) return;
  if(o.extraSegs) o.extraSegs=o.extraSegs.filter(function(g){ return g.id!==segId; });
  if(o.segs) delete o.segs[segId];
  if(o.extraSegs&&!o.extraSegs.length) delete o.extraSegs;
}
function hideSeg(S,spotId,segId,on){
  var o=ovW(S,spotId); o.segHide=o.segHide||{};
  if(on) o.segHide[segId]=true; else delete o.segHide[segId];
  if(!Object.keys(o.segHide).length) delete o.segHide;
}
function isSegHidden(S,spotId,segId){
  var o=S.over[spotId]||{}; return !!(o.segHide&&o.segHide[segId]);
}

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
    var hasExtra=o.extraSegs&&o.extraSegs.length, hasHide=o.segHide&&Object.keys(o.segHide).length;
    if(!o.rise&&!o.floorH&&!hasSeg&&!hasMeta&&!o.hidden&&!o.stairs&&!hasExtra&&!hasHide) delete S.over[sid];
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
/* ===== 日別の到達 =====
   累計とは別軸で、その日の合計mが66座のどこまで届いたかを見る。
   1日に登れるのは実用上600m程度までなので、日別の目盛りはそこで固定する。
   そうすると日どうしを同じ物差しで比べられる。 */
var DAY_CAP=600;
/* その高さで到達済みになる一番高い座。equivalent と違い座そのものを返す。 */
function reachedRank(m){
  var pick=null;
  if(m>0) for(var i=0;i<RANKS.length;i++){ if(m>=RANKS[i].m) pick=RANKS[i]; else break; }
  return pick;
}
function nextRank(m){
  for(var i=0;i<RANKS.length;i++){ if(m<RANKS[i].m) return RANKS[i]; }
  return null;
}
function dailyRanks(S,days){
  return lastDays(S,days).map(function(d){
    var rc=reachedRank(d.m), nx=nextRank(d.m);
    var lo=rc?rc.m:0;
    return { date:d.date, dow:d.dow, m:d.m, n:d.n, kcal:d.kcal, reached:rc, next:nx,
             ratio: nx? Math.max(0,Math.min(1,(d.m-lo)/(nx.m-lo))) : 1 };
  });
}
/* グラフの目安線。600m以下の座から、80m以上あけて上から拾う。 */
function dayGuides(){
  var pool=RANKS.filter(function(r){ return r.m<=DAY_CAP; }), out=[], last=1e9;
  for(var i=pool.length-1;i>=0;i--){ if(last-pool[i].m>=80){ out.push(pool[i]); last=pool[i].m; } }
  return out.reverse();
}
/* 座ごとに「そこまで届いた日」が何日あったか。高い順。 */
function rankDayCounts(S){
  var by=byDate(S), cnt={}, top={};
  Object.keys(by).forEach(function(k){
    var r=reachedRank(by[k]);
    if(!r) return;
    cnt[r.id]=(cnt[r.id]||0)+1;
    if(!top[r.id]||by[k]>top[r.id].m) top[r.id]={date:k,m:by[k]};
  });
  return RANKS.filter(function(r){ return cnt[r.id]; })
    .map(function(r){ return {rank:r, days:cnt[r.id], top:top[r.id]}; })
    .reverse();
}
/* 日別の自己ベスト */
function bestDayRank(S){
  var b=bestDay(S);
  return { date:b.date, m:b.m, reached:reachedRank(b.m) };
}
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
  var un=spots.filter(function(s){return !visited.has(s.id) && stairsOf(S,s.id)!=="no";})
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
var EVENT_PRIORITY={SUMMIT_COMPLETED:5,DAILY_BEST:4,MISSION_COMPLETED:3,ACHIEVEMENT_UNLOCKED:2,ENTRY_RECORDED:1};
function snapshot(S,missionProgress,dailyDone){
  /* 累計に加えて「今日ぶん」も持つ。累計の到達と日別の到達は別の出来事として扱う。 */
  var td=today(), dm=dayStats(S,td).m, dr=reachedRank(dm);
  var by=byDate(S), pb=0;
  Object.keys(by).forEach(function(k){ if(k!==td && by[k]>pb) pb=by[k]; });
  return {
    lifetime:lifetime(S),
    summits:Object.keys(S.summits||{}),
    missions:(missionProgress&&missionProgress.items||[]).filter(function(p){return p.done;})
              .map(function(p){return p.item.id;}),
    achievements:achievements(S).filter(function(a){return a.got;}).map(function(a){return a.name;}),
    dayM:dm, dayRank:dr?dr.id:null, prevBest:pb,
    dailyDone:!!dailyDone
  };
}
function nameOfRank(id){ var r=RANKS.filter(function(x){return x.id===id;})[0]; return r?r.name:""; }
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
  /* 今日ぶんの合計が新しく届いた座。毎日くり返すので優先度は持たせない（軽く出す）。 */
  if(after.dayRank && after.dayRank!==before.dayRank){
    ev.push({type:"DAILY_RANK_REACHED",priority:0,id:after.dayRank,
             name:nameOfRank(after.dayRank),m:after.dayM});
  }
  /* 今日のお題を達成した瞬間。日課なのでトーストで軽く出す。 */
  if(after.dailyDone && !before.dailyDone){
    ev.push({type:"DAILY_TASK_DONE",priority:0});
  }
  /* 今日ぶんが過去の最高日を初めて超えた瞬間。稀なので大きく扱う。 */
  if(after.prevBest>0 && after.dayM>after.prevBest && before.dayM<=before.prevBest){
    ev.push({type:"DAILY_BEST",priority:EVENT_PRIORITY.DAILY_BEST,
             m:after.dayM,prev:after.prevBest,id:after.dayRank,
             name:after.dayRank?nameOfRank(after.dayRank):null});
  }
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
  var _c=condStats(S);
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
    ["全カテゴリ","4種すべての場所",cats.size>=4],
    ["早朝の登攀","7時前に登る",condStats(S).early>=1],
    ["夜の稜線","21時以降に登る",condStats(S).night>=1],
    ["雨天決行","雨の日に登る",condStats(S).rain>=1],
    ["縦走","1日で同じエリアを2ヶ所",traverses(S).length>=1],
    ["月間認定","ひと月であべのハルカス",monthlyCerts(S).some(function(c){return c.m>=300;})],
    ["初コンプリート","1ヶ所を完全制覇",overallComplete(S).done>=1],
    ["5ヶ所コンプリート","5ヶ所を完全制覇",overallComplete(S).done>=5],
    ["エリア制覇","1エリアを完全制覇",areaComplete(S).some(function(a){return a.total>=2&&a.done===a.total;})],
    ["実測者","自分で測った区間が5件",Object.keys(S.over||{}).reduce(function(a,k){
        var o=S.over[k]||{}; return a+Object.keys(o.segs||{}).length; },0)>=5]
  ].map(function(x){ return {name:x[0],desc:x[1],got:!!x[2]}; });
}

/* ===== コンプリート =====
   施設の全区間の合計 × 倍率 を目標とし、どの区間で稼いだかは問わず累計mで判定する。
   ある区間が閉鎖中でも、別の区間で同じ高さを稼げば達成できる。 */
var COMPLETE_TIERS=[[400,1],[300,2],[200,3],[100,5],[0,10]];
function completeMult(baseM){
  for(var i=0;i<COMPLETE_TIERS.length;i++) if(baseM>=COMPLETE_TIERS[i][0]) return COMPLETE_TIERS[i][1];
  return 10;
}
function spotComplete(S,sp){
  var base=spotTotal(S,sp);
  var mult=completeMult(base);
  var target=base*mult;
  var got=S.entries.reduce(function(a,e){ return e.spotId===sp.id? a+e.meters : a; },0);
  return { id:sp.id, name:sp.name, area:sp.area, base:base, mult:mult, target:target, got:got,
           ratio: target>0? Math.min(1,got/target) : 0,
           done: target>0 && got>=target,
           remain: Math.max(0,target-got) };
}
function completeAll(S){
  return allSpots(S).filter(function(sp){ return sp.segs.length; })
    .map(function(sp){ return spotComplete(S,sp); });
}
function areaComplete(S){
  var m={};
  completeAll(S).forEach(function(c){
    var a=(c.area&&c.area!=="—")?c.area:"その他";
    var x=m[a]=m[a]||{area:a,total:0,done:0,target:0,got:0};
    x.total++; if(c.done) x.done++;
    x.target+=c.target; x.got+=Math.min(c.got,c.target);
  });
  return Object.keys(m).map(function(k){ var x=m[k];
    x.ratio=x.target>0?Math.min(1,x.got/x.target):0; return x; })
    .sort(function(a,b){ return (b.done/b.total)-(a.done/a.total)||b.total-a.total; });
}
function overallComplete(S){
  var all=completeAll(S), tgt=0, got=0, done=0;
  all.forEach(function(c){ tgt+=c.target; got+=Math.min(c.got,c.target); if(c.done) done++; });
  return { done:done, total:all.length, target:tgt, got:got,
           ratio: tgt>0? Math.min(1,got/tgt) : 0 };
}
/* 区間ごとの登った回数（参考表示用。判定には使わない） */
function segVisits(S,spotId){
  var out={};
  S.entries.forEach(function(e){
    if(e.spotId!==spotId) return;
    (e.segIds||[]).forEach(function(id){ out[id]=(out[id]||0)+(e.reps||1); });
  });
  return out;
}

/* ===== 月間認定 ===== 月ごとの合計が届いた山。累計とは別ゲーム。 */
function monthKey(d){ return d.slice(0,7); }
function monthlyCerts(S){
  var m={};
  S.entries.forEach(function(e){ var k=monthKey(e.date); m[k]=(m[k]||0)+e.meters; });
  return Object.keys(m).sort().reverse().map(function(k){
    var total=m[k], hit=null;
    for(var i=RANKS.length-1;i>=0;i--){ if(total>=RANKS[i].m){ hit=RANKS[i]; break; } }
    var next=RANKS.filter(function(r){ return r.m>total; })[0]||null;
    return {month:k, m:total, mountain:hit, next:next,
            remain:next?next.m-total:0, ratio:next?Math.min(1,total/next.m):1};
  });
}
/* ===== ゴースト対決（先月の自分） ===== */
function ghost(S){
  var now=new Date(), cur=ymd(now).slice(0,7);
  var pv=new Date(now.getFullYear(),now.getMonth()-1,1), prev=ymd(pv).slice(0,7);
  function series(mk,days){
    var a=[],sum=0;
    for(var d=1;d<=days;d++){
      var key=mk+"-"+p2(d);
      S.entries.forEach(function(e){ if(e.date===key) sum+=e.meters; });
      a.push(sum);
    }
    return a;
  }
  var dCur=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
  var dPrev=new Date(pv.getFullYear(),pv.getMonth()+1,0).getDate();
  var c=series(cur,dCur), p=series(prev,dPrev), day=now.getDate();
  return {cur:c, prev:p, day:day, curM:c[day-1]||0,
          prevM:p[Math.min(day,dPrev)-1]||0,
          lead:(c[day-1]||0)-(p[Math.min(day,dPrev)-1]||0),
          curMonth:cur, prevMonth:prev};
}
/* ===== 縦走（1日で同じエリアの複数地点） ===== */
function traverses(S){
  var byDay={};
  S.entries.forEach(function(e){ if(!e.spotId) return;
    (byDay[e.date]=byDay[e.date]||{})[e.spotId]=1; });
  var out=[];
  Object.keys(byDay).sort().reverse().forEach(function(d){
    var byArea={};
    Object.keys(byDay[d]).forEach(function(id){
      var sp=spotOf(S,id); if(!sp||!sp.area||sp.area==="—") return;
      (byArea[sp.area]=byArea[sp.area]||[]).push(sp.name);
    });
    Object.keys(byArea).forEach(function(a){
      if(byArea[a].length>=2) out.push({date:d,area:a,spots:byArea[a],n:byArea[a].length});
    });
  });
  return out;
}
/* ===== 時間帯・天候 ===== */
function hourOf(e){
  if(!e.createdAt) return null;
  var h=new Date(e.createdAt).getHours();
  return isNaN(h)?null:h;
}
function condStats(S){
  var early=0,night=0,rain=0;
  S.entries.forEach(function(e){
    var h=hourOf(e);
    if(h!=null&&h<7) early++;
    if(h!=null&&h>=21) night++;
    if(e.cond&&e.cond.rain) rain++;
  });
  return {early:early,night:night,rain:rain};
}
/* ===== 地点カード ===== */
function spotStats(S,spotId){
  var list=S.entries.filter(function(e){ return e.spotId===spotId; });
  if(!list.length) return {visits:0,first:null,last:null,total:0,best:0};
  var ds=list.map(function(e){return e.date;}).sort();
  return { visits:list.length, first:ds[0], last:ds[ds.length-1],
           total:list.reduce(function(a,e){return a+e.meters;},0),
           best:list.reduce(function(a,e){return Math.max(a,e.meters);},0) };
}
function spotConfidence(S,sp){
  var best=null;
  sp.segs.forEach(function(g){ var c=resolve(S,sp,g).conf;
    if(best===null||CONF_RANK[c]<CONF_RANK[best]) best=c; });   // 最も弱い区間で代表する
  return best||"推定";
}
/* ===== 階段の有無 ===== */
function stairsOf(S,id){ return (S.over[id]||{}).stairs||"unknown"; }
function setStairs(S,id,v){
  var o=ovW(S,id);
  if(!v||v==="unknown") delete o.stairs; else o.stairs=v;
}

/* ===== 身体データ ===== */
function measures(S,field){
  return (S.measurements||[]).filter(function(m){ return m[field]!=null; })
    .sort(function(a,b){ return a.date<b.date?-1:1; });
}
function latestMeasure(S,field){ var a=measures(S,field); return a.length?a[a.length-1]:null; }
function avgMeasure(S,field,days){
  var from=dayShift(-(days-1)), a=measures(S,field).filter(function(m){ return m.date>=from; });
  if(!a.length) return null;
  return a.reduce(function(x,m){return x+m[field];},0)/a.length;
}
function addMeasure(S,date,weightKg,waistCm){
  S.measurements=S.measurements||[];
  var ex=S.measurements.filter(function(m){ return m.date===date; })[0];
  // 1日1件なので、日付そのものをIDにする。Date.now()だと同一ミリ秒で衝突する。
  if(!ex){ ex={id:"m_"+date,date:date,source:"user_input"}; S.measurements.push(ex); }
  if(ex.id==null||/^\d+$/.test(String(ex.id))) ex.id="m_"+date;
  if(weightKg!=null) ex.weightKg=Math.round(weightKg*10)/10;
  if(waistCm!=null) ex.waistCm=Math.round(waistCm*10)/10;
  S.measurements.sort(function(a,b){ return a.date<b.date?-1:1; });
  return ex;
}
/* 脂肪換算（理論値）の累積。単純なエネルギー換算であり、実際の脂肪の増減ではない。 */
function removeMeasure(S,id){
  S.measurements=(S.measurements||[]).filter(function(m){ return String(m.id)!==String(id); });
}
function measureRows(S){
  return (S.measurements||[]).slice().sort(function(a,b){ return a.date<b.date?1:-1; })
    .map(function(m,i,arr){
      var prev=arr[i+1];
      return { id:m.id, date:m.date, weightKg:m.weightKg, waistCm:m.waistCm,
        dW:(prev&&prev.weightKg!=null&&m.weightKg!=null)?Math.round((m.weightKg-prev.weightKg)*10)/10:null,
        dA:(prev&&prev.waistCm!=null&&m.waistCm!=null)?Math.round((m.waistCm-prev.waistCm)*10)/10:null };
    });
}
function fatCumulative(S,days){
  var from=dayShift(-(days-1)), out=[], sum=0, d=new Date(); d.setDate(d.getDate()-(days-1));
  var byDay={};
  S.entries.forEach(function(e){ if(e.date>=from) byDay[e.date]=(byDay[e.date]||0)+kcalOf(S,e); });
  for(var i=0;i<days;i++){
    var k=ymd(d); sum+=byDay[k]||0;
    out.push({date:k, kcal:sum, g:fatG(sum,S)});
    d.setDate(d.getDate()+1);
  }
  return out;
}

/* ===== エネルギー分析 =====
   同じ集計を 標高m / kcal / 脂肪換算g の3指標で切り替えられるようにする。 */
var METRICS={ m:{key:"m",label:"標高",unit:"m",dec:1},
              kcal:{key:"kcal",label:"エネルギー",unit:"kcal",dec:0},
              g:{key:"g",label:"脂肪換算",unit:"g",dec:0} };
function valOf(S,e,metric){
  if(metric==="m") return e.meters;
  var k=kcalOf(S,e);
  return metric==="kcal"? k : fatG(k,S);
}
function seriesDaily(S,days,metric){
  var from=dayShift(-(days-1)), map={};
  S.entries.forEach(function(e){ if(e.date>=from) map[e.date]=(map[e.date]||0)+valOf(S,e,metric); });
  var out=[], acc=0, d=new Date(); d.setDate(d.getDate()-(days-1));
  for(var i=0;i<days;i++){
    var k=ymd(d), v=map[k]||0; acc+=v;
    out.push({date:k, v:v, cum:acc, dow:new Date(k+"T00:00:00").getDay()});
    d.setDate(d.getDate()+1);
  }
  return out;
}
function movingAvg(arr,n){
  var out=[], sum=0;
  for(var i=0;i<arr.length;i++){
    sum+=arr[i].v;
    if(i>=n) sum-=arr[i-n].v;
    out.push(sum/Math.min(i+1,n));
  }
  return out;
}
function breakdown(S,days,metric,by){
  var from=dayShift(-(days-1)), m={};
  S.entries.forEach(function(e){
    if(e.date<from) return;
    var key;
    if(by==="spot") key=e.name||"—";
    else if(by==="cat") key={daily:"日常",mall:"商業・駅ビル",station:"駅",boss:"山・タワー"}[e.cat]||"その他";
    else { var sp=e.spotId?spotOf(S,e.spotId):null; key=(sp&&sp.area&&sp.area!=="—")?sp.area:"その他"; }
    m[key]=(m[key]||0)+valOf(S,e,metric);
  });
  var total=0; Object.keys(m).forEach(function(k){ total+=m[k]; });
  return { total:total, rows:Object.keys(m).map(function(k){
      return {name:k, v:m[k], ratio:total>0?m[k]/total:0}; })
    .sort(function(a,b){ return b.v-a.v; }) };
}
var SLOTS=[["早朝",0,7],["午前",7,12],["午後",12,18],["夜",18,24]];
function slotOf(h){ for(var i=0;i<SLOTS.length;i++) if(h>=SLOTS[i][1]&&h<SLOTS[i][2]) return i; return 3; }
function dowSlotMatrix(S,days,metric){
  var from=dayShift(-(days-1));
  var grid=[0,1,2,3,4,5,6].map(function(){ return [0,0,0,0]; });
  var used=0, skipped=0, max=0;
  S.entries.forEach(function(e){
    if(e.date<from) return;
    var h=hourOf(e);
    if(h==null||e.createdAtEstimated){ skipped++; return; }
    var d=new Date(e.date+"T00:00:00").getDay();
    grid[d][slotOf(h)]+=valOf(S,e,metric); used++;
  });
  grid.forEach(function(r){ r.forEach(function(v){ if(v>max) max=v; }); });
  return {grid:grid, max:max, used:used, skipped:skipped, slots:SLOTS.map(function(x){return x[0];})};
}
function confBreakdown(S,days,metric){
  var from=dayShift(-(days-1)), m={"実測":0,"確定":0,"導出":0,"推定":0,"不明":0}, total=0;
  S.entries.forEach(function(e){
    if(e.date<from) return;
    var c=(e.confidence&&e.confidence.max)||"不明";
    if(m[c]==null) c="不明";
    var v=valOf(S,e,metric); m[c]+=v; total+=v;
  });
  return { total:total, rows:["実測","確定","導出","推定","不明"].map(function(k){
    return {name:k, v:m[k], ratio:total>0?m[k]/total:0}; }).filter(function(r){ return r.v>0; }) };
}
var MILESTONES=[50,100,250,500,1000,2000,5000];
function fatMilestones(S){
  var total=S.entries.reduce(function(a,e){ return a+kcalOf(S,e); },0);
  var g=fatG(total,S);
  var sorted=S.entries.slice().sort(function(a,b){ return a.date<b.date?-1:1; });
  var acc=0, hit={};
  sorted.forEach(function(e){
    acc+=kcalOf(S,e);
    var gg=fatG(acc,S);
    MILESTONES.forEach(function(ms){ if(!hit[ms]&&gg>=ms) hit[ms]=e.date; });
  });
  return MILESTONES.map(function(ms){
    return { g:ms, done:!!hit[ms], date:hit[ms]||null,
             ratio:Math.min(1,g/ms), remain:Math.max(0,ms-g) };
  });
}

/* ===== 積み上げ予測 =====
   実績を単純に延長するだけ。摂取側を知らないので体重の増減は予測しない。 */
function paceFrom(S,weeks){
  var from=dayShift(-(weeks*7-1));
  var m=S.entries.reduce(function(a,e){ return e.date>=from? a+e.meters : a; },0);
  return m/weeks;
}
function bestMonthPace(S){
  var mo={};
  S.entries.forEach(function(e){ var k=e.date.slice(0,7); mo[k]=(mo[k]||0)+e.meters; });
  var vals=Object.keys(mo).map(function(k){return mo[k];});
  return vals.length? Math.max.apply(null,vals)/(30/7) : 0;
}
function project(S,weeklyM,days){
  var m=weeklyM*(days/7);
  var w=S.weight||60;
  var rt=roundRatio(S);
  var kcal=w*m*0.01*(1+0.3*rt);
  return { m:m, kcal:kcal, g:fatG(kcal,S) };
}
function roundRatio(S){
  if(!S.entries.length) return 0;
  var n=S.entries.length, r=S.entries.filter(function(e){return e.round;}).length;
  return r/n;
}
/* 目標(脂肪換算g)に到達するまでの週数 */
function weeksToFat(S,weeklyM,targetG){
  var already=fatG(S.entries.reduce(function(a,e){return a+kcalOf(S,e);},0),S);
  if(already>=targetG) return 0;
  var perWeek=project(S,weeklyM,7).g;
  if(perWeek<=0) return null;
  return (targetG-already)/perWeek;
}
/* 山への到達予測 */
function mountainETA(S,weeklyM){
  var t=lifetime(S), perDay=weeklyM/7;
  return RANKS.map(function(r){
    if(t>=r.m) return {name:r.name, m:r.m, done:true};
    if(perDay<=0) return {name:r.name, m:r.m, done:false, days:null};
    var d=Math.ceil((r.m-t)/perDay);
    var dt=new Date(); dt.setDate(dt.getDate()+d);
    return {name:r.name, m:r.m, done:false, days:d, date:ymd(dt), remain:r.m-t};
  });
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

root.D={RANKS:RANKS,BOUNDS:BOUNDS,NTIER:NTIER,CONF_RANK:CONF_RANK,pos:pos,tierOf:tierOf,lifetime:lifetime,mountainTable:mountainTable,equivalent:equivalent,
  allSpots:allSpots,spotOf:spotOf,isHidden:isHidden,setMeta:setMeta,resetMeta:resetMeta,addSeg:addSeg,updateSeg:updateSeg,removeSeg:removeSeg,hideSeg:hideSeg,isSegHidden:isSegHidden,ov:ov,segOv:segOv,ovW:ovW,segOvW:segOvW,pruneOver:pruneOver,
  riseFor:riseFor,floorHFor:floorHFor,resolve:resolve,spotTotal:spotTotal,backRise:backRise,
  stepsForSegs:stepsForSegs,kcalRaw:kcalRaw,kcalOf:kcalOf,stepsOf:stepsOf,fatG:fatG,
  today:today,ymd:ymd,dayShift:dayShift,periodStats:periodStats,allTimeStats:allTimeStats,
  heatmap:heatmap,weekday:weekday,areaProgress:areaProgress,exploration:exploration,
  streak:streak,achievements:achievements,syncAchievements:syncAchievements,achievementView:achievementView,recomputeSummits:recomputeSummits,snapshot:snapshot,buildEvents:buildEvents,topEvent:topEvent,EVENT_PRIORITY:EVENT_PRIORITY,dayStats:dayStats,DAY_CAP:DAY_CAP,reachedRank:reachedRank,nextRank:nextRank,dailyRanks:dailyRanks,dayGuides:dayGuides,rankDayCounts:rankDayCounts,bestDayRank:bestDayRank,lastDays:lastDays,bestDay:bestDay,METRICS:METRICS,valOf:valOf,seriesDaily:seriesDaily,movingAvg:movingAvg,breakdown:breakdown,dowSlotMatrix:dowSlotMatrix,confBreakdown:confBreakdown,fatMilestones:fatMilestones,MILESTONES:MILESTONES,paceFrom:paceFrom,bestMonthPace:bestMonthPace,project:project,roundRatio:roundRatio,weeksToFat:weeksToFat,mountainETA:mountainETA,checkSeg:checkSeg,checkSpot:checkSpot,derive:derive,completeMult:completeMult,spotComplete:spotComplete,completeAll:completeAll,areaComplete:areaComplete,overallComplete:overallComplete,segVisits:segVisits,monthlyCerts:monthlyCerts,ghost:ghost,traverses:traverses,hourOf:hourOf,condStats:condStats,spotStats:spotStats,spotConfidence:spotConfidence,stairsOf:stairsOf,setStairs:setStairs,measures:measures,latestMeasure:latestMeasure,avgMeasure:avgMeasure,addMeasure:addMeasure,removeMeasure:removeMeasure,measureRows:measureRows,fatCumulative:fatCumulative};
})(typeof window!=="undefined"?window:globalThis);
