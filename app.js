/* app.js — 状態・描画・イベント。計算は domain.js に委ねる。 */
"use strict";
var BUILD="2026-08-17.14";
var KEY="ascent:v2";
var CATS=[["daily","日常"],["mall","商業・駅ビル"],["station","駅"],["boss","山・タワー"]];
var PERIODS=[[30,"30日"],[60,"60日"],[90,"90日"],[180,"180日"],[0,"全期間"]];

var S={schemaVersion:4,entries:[],weight:60,baseRise:0.18,baseFloorH:4.0,over:{},
  customSpots:[],missions:{},missionState:{},summits:{},measurements:[],recaps:{},
  settings:{fatKcalPerKg:7200,theme:"dark"}};

var ui={screen:"home",tab:"home",cat:"mall",spotId:null,sel:{},reps:1,round:true,
  editSpot:null,period:30,draft:null,summitFx:null,undo:null,cFilter:"live",fcView:"mtn",sView:"sum"};

/* ===== サブタブ =====
   分析と探索は中身が多い。以前は画面の最下部のボタンから奥へ潜る構造だったが、
   ヘッダー直下の横並びで直接切り替える。SUBS の並び順がそのまま表示順になる。 */
var SUBS={
  stats:[["stats","概要"],["energy","エネルギー"],["body","ボディ"],["forecast","予測"],["presence","存在感"]],
  spots:[["spots","地点"],["map","攻略マップ"],["complete","コンプリート"],["cards","カード"]]
};
/* 画面 → 所属するサブタブ群 */
var SUBOF=(function(){ var o={};
  Object.keys(SUBS).forEach(function(g){ SUBS[g].forEach(function(x){ o[x[0]]=g; }); });
  return o; })();

/* ===== 保存 ===== */
function save(){ try{ localStorage.setItem(KEY,JSON.stringify(S)); }
  catch(e){ toast("保存できませんでした。端末の空き容量をご確認ください。","error"); } }

function load(){
  var raw=null;
  try{ var r=localStorage.getItem(KEY); if(r) raw=JSON.parse(r); }catch(e){}
  if(raw&&typeof raw==="object") S=Object.assign(S,raw);
  S.over=S.over||{}; S.settings=Object.assign({fatKcalPerKg:7200,theme:"dark"},S.settings||{});
  if(!window.AscentMigrate){ D.pruneOver(S);
    setTimeout(function(){toast("data.migrate.js が読み込めません。再アップロードしてください。","error");},400); return; }
  var res=window.AscentMigrate.run(raw,{
    seed:window.SEED, baseRise:S.baseRise,
    resolveSeg:function(sid,gid){ var sp=D.spotOf(S,sid); if(!sp) return null;
      var g=sp.segs.filter(function(x){return x.id===gid;})[0]; return g?D.resolve(S,sp,g):null; },
    stepsFor:function(sid,ids,reps){ var sp=D.spotOf(S,sid); if(!sp) return null;
      var gs=sp.segs.filter(function(g){return ids.indexOf(g.id)>=0;});
      return gs.length? D.stepsForSegs(S,sp,gs)*(reps||1) : null; }
  });
  S=res.data; S.over=S.over||{}; D.pruneOver(S); M.ensure(S); save();
  D.recomputeSummits(S); M.ensure(S); D.syncAchievements(S);
  if(res.migrated){
    try{ if(res.backup&&!localStorage.getItem(KEY+":backup:pre"))
      localStorage.setItem(KEY+":backup:pre",res.backup); }catch(e){}
    save();
  }
}

/* ===== 小道具 ===== */
function $(id){ return document.getElementById(id); }
function qa(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); }
function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
function num(v){ var n=parseFloat(v); return isFinite(n)&&n>0?n:null; }
function r1(n){ return Math.round(n*10)/10; }
function fmt(n){ return r1(n).toLocaleString(); }
function icon(n){ return '<svg aria-hidden="true"><use href="#i-'+n+'"/></svg>'; }

var tt;
function toast(msg,type,action){
  var el=$("toast");
  el.innerHTML=esc(msg)+(action?' <button id="tAct">'+esc(action.label)+'</button>':"");
  el.className="show "+(type||"");
  if(action&&$("tAct")) $("tAct").onclick=function(){ el.className=""; action.fn(); };
  clearTimeout(tt); tt=setTimeout(function(){ el.className=""; }, action?5600:2600);
}

/* ===== 描画 ===== */
function render(){
  document.documentElement.setAttribute("data-theme",S.settings.theme==="light"?"light":"dark");
  var body="";
  if(ui.screen==="home") body=vHome();
  else if(ui.screen==="record") body=vRecord();
  else if(ui.screen==="mountains") body=vMountains();
  else if(ui.screen==="mission") body=vMission();
  else if(ui.screen==="recap") body=vRecap();
  else if(ui.screen==="body") body=vBody();
  else if(ui.screen==="map") body=vMap();
  else if(ui.screen==="edit") body=vEdit();
  else if(ui.screen==="cards") body=vCards();
  else if(ui.screen==="welcome") body=vWelcome();
  else if(ui.screen==="presence") body=vPresence();
  else if(ui.screen==="mdetail") body=vMissionDetail();
  else if(ui.screen==="complete") body=vComplete();
  else if(ui.screen==="energy") body=vEnergy();
  else if(ui.screen==="forecast") body=vForecast();
  else if(ui.screen==="stats") body=vStats();
  else if(ui.screen==="history") body=vHistory();
  else if(ui.screen==="spots") body=vSpots();
  else if(ui.screen==="spot") body=vSpotDetail();
  else if(ui.screen==="newspot") body=vNewSpot();
  else if(ui.screen==="settings") body=vSettings();
  $("app").innerHTML=header()+subtabs()+body;
  $("bars").innerHTML=((ui.screen==="home"||ui.screen==="spots")?repeatBar():"")+tabs();
  bind();
}
/* 現在の画面がサブタブ群に属していれば、その切り替えバーを返す */
function subtabs(){
  var g=SUBOF[ui.screen];
  if(!g) return "";
  return '<nav class="subtabs" aria-label="表示の切り替え"><div class="in">'
    + SUBS[g].map(function(x){
        var on=(x[0]===ui.screen);
        return '<button data-go="'+x[0]+'" class="'+(on?"on":"")+'"'
          + (on?' aria-current="page"':'')+'>'+esc(x[1])+'</button>'; }).join("")
    + '</div></nav>';
}

function header(){
  /* サブタブで横に並んだ画面は入れ子ではないので、戻るボタンは出さない */
  var back=SUBOF[ui.screen]?null:
    {record:"home",spot:"spots",newspot:"spots",settings:"home",mission:"home",recap:"home",
     edit:"history",mdetail:"mission"}[ui.screen];
  var title={home:"VERTEX",record:"記録する",stats:"分析",history:"履歴",
    spots:"探索",spot:"地点の計測",newspot:"地点を追加",settings:"設定",
    mountains:"全行程",mission:"今週の遠征",recap:"週の記録",
    body:"ボディインパクト",map:"都市攻略",edit:"記録を編集",cards:"地点カード",
    welcome:"VERTEX",presence:"垂直的存在感",mdetail:"ミッション詳細",complete:"コンプリート",energy:"エネルギー",forecast:"予測"}[ui.screen];
  return '<div class="hd">'
    + (back?'<button class="ico" data-go="'+back+'" aria-label="戻る">'+icon("back")+'</button>':"")
    + '<div class="brand">'+esc(title)+(ui.screen==="home"?'<small>都市を、登れ。</small>':"")+'</div>'
    + '<button class="ico" data-act="theme" aria-label="表示を切り替える">'+icon(S.settings.theme==="light"?"moon":"sun")+'</button>'
    + (ui.screen==="home"?'<button class="ico" data-go="settings" aria-label="設定">'+icon("gear")+'</button>':"")
    + '</div>';
}
function tabs(){
  var T=[["home","ホーム","home"],["mountains","全行程","mountain"],["stats","分析","chart"],
         ["spots","探索","map"],["history","履歴","history"]];
  // 地点の詳細・追加から来たときも「探索」を点灯させる
  var here={spot:"spots",newspot:"spots",record:"home",settings:"home",mission:"home",
    recap:"home",body:"stats",map:"spots",edit:"history",cards:"spots",
    presence:"stats",mdetail:"home",welcome:"home",complete:"spots",energy:"stats",forecast:"stats"}[ui.screen]||ui.screen;
  return '<nav class="tabs">'+T.map(function(t){
    return '<button data-go="'+t[0]+'" class="'+(here===t[0]?"on":"")+'">'
      +icon(t[2])+'<span>'+t[1]+'</span></button>'; }).join("")+'</nav>';
}
function repeatBar(){
  var e=S.entries[0];
  if(!e || S.settings.repeatBar===false || ui.hideRepeat) return "";
  return '<div class="repeat"><button data-act="again">'+icon("repeat")
    +'<span class="t"><b>直前と同じ</b><span>'+esc(e.name)+' · '+fmt(e.unitM)+'m × '+e.reps+'</span></span>'
    +'<span class="v num">'+fmt(e.meters)+'m</span></button>'
    +'<button data-act="hideRep" class="rx" aria-label="このバーを隠す">×</button></div>';
}

/* ===== S1 ホーム ===== */
function vWelcome(){
  var ex=D.exploration(S);
  return '<div class="hero">'+Mountain.render(D.RANKS[0].id,0,{label:D.RANKS[0].name,art:D.RANKS[0].art})
    + '<div class="cap"><div class="tier">WELCOME</div>'
    + '<div class="big num">0<i>m</i></div>'
    + '<div class="sub">都市は、山になる。</div></div></div>'
    + '<div class="card"><h3>はじめかた</h3>'
    + '<div class="steps">'
    + '<div><b>1</b><span>近くの階段をひとつ選ぶ</span></div>'
    + '<div><b>2</b><span>登った区間にチェックを入れて「記録する」</span></div>'
    + '<div><b>3</b><span>登った高さ(m)が積み上がる</span></div>'
    + '</div>'
    + '<div class="note">速さも休憩も関係ありません。登った高さだけが残ります。'
    + 'あべのハルカス300mから始まり、最後はエベレスト8,848mです。</div></div>'
    + '<div class="card"><h3>まずはこの辺から</h3>'
    + ex.next.map(function(sp){
        return '<button class="row" data-pick="'+sp.id+'"><span class="mk"></span>'
          + '<span class="bd"><span class="nm">'+esc(sp.name)+'</span>'
          + '<span class="sb">'+area(sp)+(sp.min?" · "+sp.min+"分":"")+'</span></span>'
          + '<span class="vl num">'+fmt(D.spotTotal(S,sp))+'<i>m</i></span></button>'; }).join("")
    + '<button class="ghost" data-go="spots">すべての地点から選ぶ</button></div>'
    + '<div class="note">記録はこの端末の中だけに保存されます。'
    + 'アカウントも通信もありません。設定からいつでも書き出せます。</div>';
}

function vHome(){
  if(!S.entries.length && !ui.skipWelcome) return vWelcome();
  var t=D.lifetime(S), k=D.tierOf(t);
  var fx=ui.summitFx; ui.summitFx=null;
  var ex=D.exploration(S);
  var freq={}; S.entries.slice(0,60).forEach(function(e){ if(e.spotId) freq[e.spotId]=(freq[e.spotId]||0)+1; });
  var top=Object.keys(freq).sort(function(a,b){return freq[b]-freq[a];}).slice(0,4)
    .map(function(id){return D.spotOf(S,id);}).filter(Boolean);
  var cards=top.length?top:ex.next;

  return '<div class="hero">'
    + Mountain.render(k.tier.id,k.inTier,{label:k.tier.name,art:k.tier.art,snap:!!fx,summit:!!fx})
    + '<div class="cap"><div class="tier">'+(k.done?"ALL CLEAR":esc(k.tier.name))+'</div>'
    + '<div class="big num">'+fmt(t)+'<i>m</i></div>'
    + '<div class="sub">'+(k.remain>0
        ? '次の <b>'+esc(k.tier.name)+'</b> まで あと '+fmt(k.remain)+'m'
          +(k.tier.note?'<small>'+esc(k.tier.note)+'</small>':'')
        : '全'+D.NTIER+'座を制覇。ここから先は自分で目標を置く領域です。')+'</div></div></div>'
    + ladderBar(t,k)

    + todayCard()
    + recapCard()
    + missionCard()

    + '<div class="card"><h3>よく行く場所</h3><div class="grid">'
    + cards.map(function(s){ return spotCard(s,ex.visited); }).join("")
    + '</div><button class="ghost" data-go="spots">＋ すべての地点から選ぶ</button></div>'

    + '<div class="grid" style="margin-top:var(--s3)">'
    + '<button class="sc" data-go="body"><span class="a">BODY IMPACT</span>'
    + '<span class="n">今週の身体への影響</span>'
    + '<span class="h num">'+D.periodStats(S,7).cur.kcal.toLocaleString()+'<i>kcal</i></span></button>'
    + '<button class="sc" data-go="map"><span class="a">EXPLORATION</span>'
    + '<span class="n">都市攻略マップ</span>'
    + '<span class="h num">'+ex.done+'<i>/'+ex.total+'</i></span></button>'
    + '</div>'
    + (ex.next.length?'<div class="card"><h3>まだ登っていない近場</h3>'
      + ex.next.map(function(s){ return '<button class="row" data-pick="'+s.id+'">'
        + '<span class="mk"></span><span class="bd"><span class="nm">'+esc(s.name)+'</span>'
        + '<span class="sb">'+area(s)+(s.min?(area(s)?" · ":"")+"徒歩/電車 "+s.min+"分":"")+'</span></span>'
        + '<span class="vl num">'+fmt(D.spotTotal(S,s))+'<i>m</i></span></button>'; }).join("")
      + '</div>':"");
}
/* ===== 今週の遠征 ===== */
function diffTag(d){ return '<span class="dif '+d.toLowerCase()+'">'+d+'</span>'; }
function missionRow(p,i,detail){
  var it=p.item, cur=p.item.unit==="m"? fmt(p.current) : Math.round(p.current);
  return '<'+(detail?'button data-mid="'+it.id+'"':'div')+' class="ms'+(p.done?" done":"")+'">'
    + '<span class="no num">'+("0"+(i+1)).slice(-2)+'</span>'
    + '<span class="bd"><span class="cat">'+it.catLabel+(detail?' <span class="j">'+it.catJp+'</span>':'')+' '+diffTag(it.difficulty)+'</span>'
    + '<span class="ttl">'+esc(it.title)+'</span>'
    + '<span class="pb"><i style="width:'+Math.round(p.ratio*100)+'%"></i></span>'
    + '<span class="val num">'+(p.done?"COMPLETE":cur+" / "+it.target.toLocaleString()+it.unit)+'</span>'
    + (detail?'<span class="dsc">'+esc(it.desc)+' ›</span>':'')
    + '</span></'+(detail?'button':'div')+'>';
}
function missionCard(){
  var k=M.currentWeek(), wp=M.weekProgress(S,k), left=M.daysLeft(k);
  if(!wp.total) return "";
  return '<button class="card mcard" data-go="mission"><h3>今週の遠征 <span class="rt">'
    + M.weekLabel(k)+' · 残り'+left+'日</span></h3>'
    + '<div class="msum"><span class="num v">'+wp.done+'<i>/'+wp.total+'</i></span>'
    + '<span class="k">'+(wp.done===wp.total?"全ミッション達成":"達成したミッション")+'</span></div>'
    + wp.items.map(function(p,i){ return missionRow(p,i,false); }).join("")
    + '</button>';
}
function vMission(){
  var k=M.currentWeek(), wp=M.weekProgress(S,k), w=M.weekSummary(S,k), left=M.daysLeft(k);
  var pw=M.weekSummary(S,M.prevWeek(k)), d=w.m-pw.m;
  return '<div class="card"><h3>EXPEDITION '+M.weekLabel(k)+'</h3>'
    + '<div class="eqline"><span class="num v" style="font-size:var(--f-hero)">'+fmt(w.m)+'<i>m</i></span>'
    + '<span class="k" style="color:'+(d>=0?"var(--green)":"var(--muted)")+'">'
    + (d>=0?"+":"")+fmt(d)+' m vs 先週</span></div>'
    + '<div class="note" style="margin-bottom:0">残り'+left+'日 ・ '+w.days+'日記録 ・ '+w.spots+'ヶ所</div></div>'
    + '<div class="card"><h3>EXPEDITION BRIEFING</h3>'
    + wp.items.map(function(p,i){ return missionRow(p,i,true); }).join("")
    + '<div class="note" style="margin-bottom:0">ミッションは毎週月曜に自動で決まります。'
    + '目標は直近4週の実績から調整され、週の途中では変わりません。</div></div>'
    + '<div class="card"><h3>今週の日別</h3><div class="days">'
    + (function(){ var mx=Math.max.apply(null,w.byDay.map(function(x){return x.m;}))||1;
        return w.byDay.map(function(x){
          return '<div class="'+(x.date===D.today()?"now":"")+'"><i style="height:'+Math.max(3,x.m/mx*54)+'px"></i>'
            + '<span>'+x.dow+'</span></div>'; }).join(""); })()
    + '</div></div>';
}

/* ===== 週の記録（Recap） ===== */
function recapCard(){
  var last=M.prevWeek(M.currentWeek());
  var w=M.weekSummary(S,last);
  if(!w.n) return "";
  if((S.recaps||{})[last]&&S.recaps[last].seen) return "";
  return '<button class="card rcard" data-go="recap"><h3>先週の記録</h3>'
    + '<div class="msum"><span class="num v">'+fmt(w.m)+'<i>m</i></span>'
    + '<span class="k">'+M.weekLabel(last)+' の遠征がまとまりました</span></div>'
    + '<div class="note" style="margin-bottom:0">ひらいて見る ›</div></button>';
}
function vRecap(){
  var k=ui.recapWeek||M.prevWeek(M.currentWeek());
  var w=M.weekSummary(S,k), pw=M.weekSummary(S,M.prevWeek(k));
  var d=w.m-pw.m, pct=pw.m>0?Math.round(d/pw.m*100):null;
  var wp=M.weekProgress(S,k);
  var t=D.lifetime(S), tier=D.tierOf(t);
  var mx=Math.max.apply(null,w.byDay.map(function(x){return x.m;}))||1;
  return '<div class="card"><h3>WEEKLY EXPEDITION '+M.weekLabel(k)+'</h3>'
    + '<div class="eqline"><span class="num v" style="font-size:var(--f-hero)">'+fmt(w.m)+'<i>m</i></span>'
    + (w.n?'<span class="k" style="color:'+(d>=0?"var(--green)":"var(--muted)")+'">'
      +(d>=0?"+":"")+fmt(d)+' m'+(pct!==null?' / '+(pct>=0?"+":"")+pct+'%':'')+'</span>':'')+'</div></div>'
    + (w.n? '<div class="stats">'
        + '<div><div class="k">記録日数</div><div class="v num">'+w.days+'<i>日</i></div></div>'
        + '<div><div class="k">登った場所</div><div class="v num">'+w.spots+'<i>ヶ所</i></div></div>'
        + '<div><div class="k">消費エネルギー</div><div class="v num">'+w.kcal.toLocaleString()+'<i>kcal</i></div></div>'
        + '<div><div class="k">のぼった段数</div><div class="v num">'+w.steps.toLocaleString()+'<i>段</i></div></div>'
        + '</div>'
      : '<div class="empty">この週の記録はありません。</div>')
    + '<div class="card"><h3>この週の遠征</h3><div class="days">'
    + w.byDay.map(function(x){
        return '<div><i style="height:'+Math.max(3,x.m/mx*54)+'px"></i><span>'+x.dow+'</span></div>'; }).join("")
    + '</div></div>'
    + (wp.total?'<div class="card"><h3>ミッション '+wp.done+' / '+wp.total+'</h3>'
        + wp.items.map(function(p,i){ return missionRow(p,i,false); }).join("")+'</div>':'')
    + '<div class="card"><h3>SUMMIT</h3>'
    + '<div style="font-size:var(--f-lg);font-weight:700">'+esc(tier.tier.name)+'</div>'
    + '<div class="note" style="border:none;padding:0">'+fmt(t)+' / '+tier.tier.m.toLocaleString()+' m'
    + (tier.remain>0?' — あと '+fmt(tier.remain)+'m':' — 制覇')+'</div>'
    + '<div class="pb" style="margin-top:var(--s2)"><i style="width:'+Math.round(tier.inTier*100)+'%"></i></div></div>'
    + '<div class="card" style="text-align:center"><div style="font-size:var(--f-md);font-weight:700">'
    + (w.m>0?'今週も、ひとつ高くなった。':'次の遠征は今日から始まります。')+'</div>'
    + '<div class="note" style="border:none;justify-content:center;margin-bottom:0">Keep climbing.</div></div>'
    + '<button class="ghost" data-act="shareRecap">この週の結果をコピー</button>'
    + '<button class="ghost" data-act="recapSeen">確認した</button>';
}

/* 今日の積み上げ。日々の手応えは週や生涯より先に見えるべき。 */
function todayCard(){
  var t=D.dayStats(S,D.today()), w=D.periodStats(S,7).cur;
  var days=D.lastDays(S,7), mx=Math.max.apply(null,days.map(function(d){return d.m;}))||1;
  var DOW=["日","月","火","水","木","金","土"];
  return '<div class="card"><h3>今日</h3>'
    + '<div class="today">'
    +   '<div class="t-main"><span class="v num">'+fmt(t.m)+'<i>m</i></span>'
    +     '<span class="k">'+(t.n?t.n+'本 記録':'まだ記録なし')+'</span></div>'
    +   '<div class="t-sub"><div><span class="k">消費エネルギー</span>'
    +     '<span class="v num">'+t.kcal.toLocaleString()+'<i>kcal</i></span></div>'
    +     '<div><span class="k">のぼった段数</span>'
    +     '<span class="v num">'+t.steps.toLocaleString()+'<i>段</i></span></div></div>'
    + '</div>'
    + '<div class="days">'+days.map(function(d,i){
        var on=(i===days.length-1);
        return '<div class="'+(on?"now":"")+'"><i style="height:'+Math.max(3,d.m/mx*54)+'px"></i>'
          + '<span>'+DOW[d.dow]+'</span></div>'; }).join("")+'</div>'
    + '<div class="note" style="margin-bottom:0">直近7日で '+fmt(w.m)+'m ・ '+w.kcal.toLocaleString()+'kcal ・ '+w.days+'日</div>'
    + '</div>';
}
/* 32座を横一列には並べられないので、全体の進み具合を1本＋現在地の内訳で見せる */
function ladderBar(t,k){
  var nxt=k.done?null:D.RANKS[Math.min(D.NTIER-1,k.idx+1)];
  return '<div class="ladder2">'
    + '<div class="all"><i style="width:'+(D.pos(t)*100).toFixed(1)+'%"></i>'
    + D.RANKS.map(function(r){ return '<b style="left:'+(D.pos(r.m)*100).toFixed(1)+'%" class="'+(t>=r.m?"on":"")+'"></b>'; }).join("")
    + '</div>'
    + '<div class="ladderL"><span>制覇 '+k.cleared+'/'+D.NTIER+'</span>'
    + '<span>'+(k.done?'全'+D.NTIER+'座 制覇':(nxt&&nxt!==k.tier?'その次は '+esc(nxt.name):''))+'</span></div>'
    + '</div>';
}
function area(s){ return (!s.area||s.area==="—")?"":esc(s.area); }
function spotCard(s,visited){
  return '<button class="sc '+(visited.has(s.id)?"":"new")+'" data-pick="'+s.id+'">'
    + '<span class="n">'+esc(s.name)+'</span><span class="a">'+area(s)+'</span>'
    + '<span class="h num">'+fmt(D.spotTotal(S,s))+'<i>m</i></span></button>';
}

/* ===== S2 記録 ===== */
function vRecord(){
  var sp=D.spotOf(S,ui.spotId); if(!sp) return '<div class="empty">地点が見つかりません。</div>';
  var picked=sp.segs.filter(function(g){return ui.sel[g.id];});
  var unit=picked.reduce(function(a,g){return a+D.resolve(S,sp,g).m;},0);
  var add=unit*(Number(ui.reps)||0);
  var kc=Math.round(S.weight*add*0.01*(ui.round?1.3:1));
  var st=picked.length?Math.round(D.stepsForSegs(S,sp,picked)*(Number(ui.reps)||0)):0;

  var dt=ui.date||D.today();
  return '<div class="card"><h3>'+esc(sp.area)+(sp.min?' · '+sp.min+'分':'')+'</h3>'
    + '<div style="font-size:var(--f-lg);font-weight:700">'+esc(sp.name)+'</div>'
    + (sp.note?'<div class="note">'+esc(sp.note)+'</div>':'')
    + '<div class="fr" style="margin-top:var(--s3)"><label>日付</label>'
    + '<input id="recDate" type="date" value="'+dt+'" max="'+D.today()+'">'
    + (dt!==D.today()?'<button class="chip" data-act="today" style="margin-left:6px">今日</button>':'')+'</div>'
    + (dt!==D.today()?'<div class="note" style="margin-bottom:0">過去の日付で記録します。</div>':'')+'</div>'
    + '<div class="card"><h3>登った区間</h3>'
    + '<div class="mini"><button data-act="selAll">全区間</button><button data-act="selFree">改札外のみ</button>'
    + '<button data-act="selNone">クリア</button></div>'
    + (sp.segs.length? sp.segs.map(function(g){
        var r=D.resolve(S,sp,g), on=!!ui.sel[g.id];
        return '<label class="seg '+(on?"on":"")+'"><input type="checkbox" data-seg="'+g.id+'" '+(on?"checked":"")+'>'
          + '<span class="l">'+esc(g.label)+(g.paid?'<span class="paid">入場券</span>':'')+'</span>'
          + '<span class="cf '+r.cls+'">'+r.conf+'</span><span class="m num">'+fmt(r.m)+'m</span></label>';
      }).join("") : '<div class="empty">区間が未登録です。</div>')
    + '<div class="fr" style="margin-top:var(--s4)"><label>本数</label>'
    + '<span class="stepper"><button data-act="minus">−</button>'
    + '<input id="reps" type="number" inputmode="numeric" value="'+ui.reps+'"><button data-act="plus">＋</button></span></div>'
    + '<div class="fr"><label>下りも歩いた（＋30%）</label>'
    + '<input type="checkbox" id="rt" '+(ui.round?"checked":"")+' style="width:20px;height:20px;accent-color:var(--orange)"></div>'
    + '<div class="fr"><label>雨の日だった</label>'
    + '<input type="checkbox" id="rain" '+(ui.rain?"checked":"")+' style="width:20px;height:20px;accent-color:var(--orange)"></div>'
    + '</div>'
    + '<div class="card" style="text-align:center">'
    + '<div class="big num" style="font-size:var(--f-hero);font-weight:700">'+fmt(add)+'<i style="font-style:normal;font-size:var(--f-lg);color:var(--muted)">m</i></div>'
    + '<div class="note" style="border:none;justify-content:center;padding:0;margin-top:6px">約 '+kc.toLocaleString()+' kcal ・ 約 '+st.toLocaleString()+' 段</div>'
    + '<button class="primary" data-act="commit" '+(add>0?"":"disabled")+'>記録する</button></div>';
}

/* ===== 全行程（6座） ===== */
function mountainRows(t,note){
  return D.mountainTable(t).map(function(r){
    var state = r.reached ? '<span class="cf c-meas">登頂</span>'
      : r.current ? '<span class="cf c-conf">現在地</span>' : '';
    return '<div class="mrow'+(r.current?" now":"")+(r.reached?" done":"")+'">'
      + '<span class="ix num">'+r.i+'</span>'
      + '<span class="bd"><span class="nm">'+esc(r.name)+' '+state
      + (r.note?' <span class="nt">'+esc(r.note)+'</span>':'')+'</span>'
      + '<span class="pb"><i style="width:'+Math.round(r.ratio*100)+'%"></i></span>'
      + '<span class="sb num">'+(r.reached
          ? r.m.toLocaleString()+' m 登頂済み'
          : r.current
            ? fmt(r.done)+' / '+r.m.toLocaleString()+' m　あと '+fmt(r.remain)+' m'
            : r.m.toLocaleString()+' m　あと '+fmt(r.remain)+' m')+'</span></span>'
      + '<span class="pc num">'+Math.round(r.ratio*100)+'%</span></div>';
  }).join("");
}
function vMountains(){
  var t=D.lifetime(S), k=D.tierOf(t);
  return '<div class="hero">'
    + Mountain.render(k.tier.id,k.inTier,{label:k.tier.name,art:k.tier.art})
    + '<div class="cap"><div class="tier">'+(k.done?"ALL CLEAR":esc(k.tier.name))+'</div>'
    + '<div class="big num">'+fmt(t)+'<i>m</i></div></div></div>'
    + '<div class="card"><h3>行程の断面図</h3>'
    + '<div class="scrollx" id="prof">'+Mountain.profile(t,fmt)+'</div>'
    + '<div class="note" style="margin-bottom:0">横にスクロールすると、この先の山がどれだけ離れているか見えます。'
    + '目盛りは1,000mごと、旗が現在地です。高さは見やすさのために圧縮してあり、'
    + '横の距離が実際の獲得標高に対応します。</div></div>'

    + '<div class="card"><h3>生涯累計 — 6座</h3>'+mountainRows(t)+'</div>'

    /* 断面図は密集地帯でラベルを出しきれない（173〜381mは62px幅に12座）。
       名前がこの画面にしか無いので、全座を一覧でも読めるようにする。 */
    + '<div class="card"><h3>全'+D.RANKS.length+'座</h3><div class="rlist">'
    + D.RANKS.map(function(r,i){
        var done=t>=r.m, cur=(!done && D.RANKS.filter(function(x){return x.m>t;})[0]===r);
        return '<div class="'+(done?"done":cur?"cur":"")+'">'
          + '<span class="ix num">'+(i+1)+'</span>'
          + '<span class="nm">'+esc(r.name)+'</span>'
          + '<span class="mm num">'+r.m.toLocaleString()+'m</span></div>'; }).join("")
    + '</div><div class="note" style="margin-bottom:0">緑が登頂済み、オレンジが現在の目標です。</div></div>'
    + '<div class="card"><h3>この期間で登った山</h3>'
    + '<div class="chips">'+PERIODS.map(function(x){
        return '<button class="chip '+(ui.period===x[0]?"on":"")+'" data-per="'+x[0]+'">'+x[1]+'</button>'; }).join("")+'</div>'
    + periodMountain()
    + '</div>'
    + '<div class="note">同じ高さでも、駅の地下1本と山ひとつは同じ「m」です。'
    + '速さも休憩も関係なく、登った高さだけが積み上がります。</div>';
}
function periodMountain(){
  var p=ui.period? D.periodStats(S,ui.period) : D.allTimeStats(S);
  var m=p.cur.m, eq=D.equivalent(m);
  if(!m) return '<div class="empty" style="margin-top:var(--s3)">この期間の記録はまだありません。</div>';
  var k=D.tierOf(m);
  return '<div style="margin-top:var(--s3)">'
    + '<div class="eqline"><span class="num v">'+fmt(m)+'<i>m</i></span>'
    + '<span class="k">'+esc(eq.name)+' ×'+ (Math.round(eq.times*100)/100) +'</span></div>'
    + '<div class="mrow now" style="border:none;padding-top:var(--s3)">'
    + '<span class="bd"><span class="nm">'+esc(k.tier.name)+'</span>'
    + '<span class="pb"><i style="width:'+Math.round(k.inTier*100)+'%"></i></span>'
    + '<span class="sb num">'+fmt(m)+' / '+k.tier.m.toLocaleString()+' m'
    + (k.done?'':'　あと '+fmt(k.remain)+' m')+'</span></span>'
    + '<span class="pc num">'+Math.round(k.inTier*100)+'%</span></div>'
    + '<div class="note" style="margin-bottom:0">この期間ぶんだけを積み上げた場合の到達点です。</div></div>';
}

/* ===== Body Impact =====
   減量管理の画面ではない。登った結果として身体に何が積み上がったかを見る画面。
   優先順位: 獲得標高 > 消費エネルギー > 体重実測 > 脂肪換算(理論値) > ウエスト実測 */
function sparkline(pts,key,color){
  if(pts.length<2) return '<div class="note" style="margin:var(--s2) 0 0">まだ線を引くには足りません。</div>';
  var W=300,H=88,pad=8;
  var vs=pts.map(function(p){return p[key];});
  var mn=Math.min.apply(null,vs), mx=Math.max.apply(null,vs);
  if(mx-mn<1e-9){ mn-=1; mx+=1; }
  var t0=new Date(pts[0].date), t1=new Date(pts[pts.length-1].date);
  var span=Math.max(1,(t1-t0));
  var xy=pts.map(function(p){
    var x=pad+(new Date(p.date)-t0)/span*(W-pad*2);
    var y=H-pad-((p[key]-mn)/(mx-mn))*(H-pad*2);
    return {x:x,y:y,v:p[key],d:p.date};
  });
  var d="M"+xy.map(function(q){return q.x.toFixed(1)+" "+q.y.toFixed(1);}).join(" L");
  return '<svg class="prof spark" viewBox="0 0 '+W+' '+H+'" width="100%" height="'+H+'">'
    + '<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="2" stroke-linejoin="round"/>'
    + xy.map(function(q){ return '<circle cx="'+q.x.toFixed(1)+'" cy="'+q.y.toFixed(1)+'" r="2.6" fill="'+color+'"/>'; }).join("")
    + '<text x="'+pad+'" y="12" fill="var(--muted)" font-size="10">'+(Math.round(mx*10)/10)+'</text>'
    + '<text x="'+pad+'" y="'+(H-1)+'" fill="var(--muted)" font-size="10">'+(Math.round(mn*10)/10)+'</text>'
    + '</svg>';
}
function vBody(){
  var days=ui.bodyPeriod||30;
  var p=D.periodStats(S,days), wk=M.weekSummary(S,M.currentWeek());
  var all=D.allTimeStats(S);
  var w=D.measures(S,"weightKg"), wa=D.measures(S,"waistCm");
  var lastW=w.length?w[w.length-1]:null, firstW=w.length?w[0]:null;
  var lastA=wa.length?wa[wa.length-1]:null, firstA=wa.length?wa[0]:null;
  var avg7=D.avgMeasure(S,"weightKg",7), avg30=D.avgMeasure(S,"weightKg",30);
  var fat=D.fatCumulative(S,days);
  var g=function(k){ return Math.round(D.fatG(k,S)); };

  return '<div class="chips">'+[[30,"30日"],[90,"90日"],[180,"180日"]].map(function(x){
      return '<button class="chip '+(days===x[0]?"on":"")+'" data-bper="'+x[0]+'">'+x[1]+'</button>'; }).join("")+'</div>'

    + '<div class="card"><h3>この期間の登攀</h3>'
    + '<div class="chain"><div class="hi"><span class="k">獲得標高</span>'
    + '<span class="v num">'+fmt(p.cur.m)+'<i>m</i></span></div>'
    + '<div class="arw">↓</div>'
    + '<div><span class="k">消費エネルギー</span>'
    + '<span class="v num">'+p.cur.kcal.toLocaleString()+'<i>kcal</i></span></div>'
    + '<div class="arw">↓</div>'
    + '<div><span class="k">脂肪換算（理論値）</span>'
    + '<span class="v num amb">約 '+g(p.cur.kcal).toLocaleString()+'<i>g</i></span></div></div>'
    + '<div class="note" style="margin-bottom:0">消費エネルギーを 7,200kcal/kg として換算した参考値です。'
    + '実際の体脂肪の増減を示すものではありません。</div></div>'

    + '<div class="stats">'
    + '<div><div class="k">今週</div><div class="v num">'+fmt(wk.m)+'<i>m</i></div>'
    + '<span class="d">'+wk.kcal.toLocaleString()+'kcal ・ 約'+g(wk.kcal)+'g</span></div>'
    + '<div><div class="k">累計</div><div class="v num">'+fmt(all.cur.m)+'<i>m</i></div>'
    + '<span class="d">'+all.cur.kcal.toLocaleString()+'kcal ・ 約'+(g(all.cur.kcal)>=1000
        ? (Math.round(g(all.cur.kcal)/100)/10)+'kg' : g(all.cur.kcal)+'g')+'</span></div></div>'

    + (w.length? '<div class="card"><h3>体重（実測）</h3>'
        + '<div class="eqline"><span class="num v">'+r1v(lastW.weightKg)+'<i>kg</i></span>'
        + (w.length>1?'<span class="k">'+r1v(firstW.weightKg)+' → '+r1v(lastW.weightKg)
            +'（'+((lastW.weightKg-firstW.weightKg)>=0?"+":"")+r1v(lastW.weightKg-firstW.weightKg)+'kg）</span>':'')
        + '</div>'
        + sparkline(w.filter(function(m){return m.date>=D.dayShift(-(days-1));}),"weightKg","var(--cyan)")
        + '<div class="vrow"><span>7日平均</span><b class="num">'+(avg7?Math.round(avg7*10)/10+" kg":"—")+'</b></div>'
        + '<div class="vrow"><span>30日平均</span><b class="num">'+(avg30?Math.round(avg30*10)/10+" kg":"—")+'</b></div>'
        + '<div class="note" style="margin-bottom:0">実測した日だけを点で結んでいます。'
        + '体重は日々ぶれるので、単日より平均を見てください。</div></div>' : '')

    + '<div class="card"><h3>脂肪換算（理論値・累積）</h3>'
    + '<div class="eqline"><span class="num v amb">約 '+Math.round(fat[fat.length-1].g).toLocaleString()+'<i>g</i></span>'
    + '<span class="k">直近'+days+'日の積み上げ</span></div>'
    + sparkline(fat,"g","var(--amber)")
    + '<div class="note" style="margin-bottom:0">エネルギー換算による理論値です。体重の増減とは別のものです。</div></div>'

    + (wa.length? '<div class="card"><h3>ウエスト（実測）</h3>'
        + '<div class="eqline"><span class="num v">'+r1v(lastA.waistCm)+'<i>cm</i></span>'
        + (wa.length>1?'<span class="k">'+r1v(firstA.waistCm)+' → '+r1v(lastA.waistCm)+' cm</span>':'')+'</div>'
        + sparkline(wa.filter(function(m){return m.date>=D.dayShift(-(days-1));}),"waistCm","var(--cyan)")
        + '</div>' : '')

    + '<div class="card"><h3>身体データを記録</h3>'
    + '<div class="fr"><label>日付</label><input id="mDate" type="date" value="'+(ui.mDate||D.today())+'"></div>'
    + '<div class="fr"><label>体重</label><input id="mW" type="number" inputmode="decimal" step="0.1" placeholder="'
      +(lastW?r1v(lastW.weightKg):"—")+'"><span class="u">kg</span></div>'
    + '<div class="fr"><label>ウエスト</label><input id="mA" type="number" inputmode="decimal" step="0.1" placeholder="'
      +(lastA?r1v(lastA.waistCm):"—")+'"><span class="u">cm</span></div>'
    + '<button class="primary" data-act="saveMeasure">記録する</button>'
    + '<div class="note" style="margin-bottom:0">入力した実測値だけを使います。'
    + '活動量から体重や体脂肪を推定することはしません。</div></div>'

    + (function(){ var rows=D.measureRows(S);
        if(!rows.length) return '';
        return '<div class="card"><h3>記録した身体データ '+rows.length+'件</h3>'
          + rows.slice(0,ui.mAll?999:8).map(function(r){
              return '<div class="row"><span class="mk"></span><span class="bd">'
                + '<span class="nm num">'+r.date.replace(/-/g,"/")+'</span>'
                + '<span class="sb num">'
                + (r.weightKg!=null?'体重 '+r1v(r.weightKg)+'kg'
                    +(r.dW!=null?'（'+(r.dW>=0?"+":"")+r.dW+'）':''):'')
                + (r.waistCm!=null?'　ウエスト '+r1v(r.waistCm)+'cm'
                    +(r.dA!=null?'（'+(r.dA>=0?"+":"")+r.dA+'）':''):'')
                + '</span></span>'
                + '<button class="x" data-delm="'+r.id+'" aria-label="削除">×</button></div>'; }).join("")
          + (rows.length>8&&!ui.mAll?'<button class="ghost" data-act="showAllM">すべて表示</button>':'')
          + '<div class="note" style="margin-bottom:0">カッコ内は前回との差です。'
          + '同じ日に入れ直すと上書きされます。</div></div>'; })()

    + (w.length>1? '<div class="card"><h3>同じ期間の活動量</h3>'
        + '<div class="vrow"><span>獲得標高</span><b class="num">'+fmt(p.cur.m)+' m</b></div>'
        + '<div class="vrow"><span>消費エネルギー</span><b class="num">'+p.cur.kcal.toLocaleString()+' kcal</b></div>'
        + '<div class="vrow"><span>記録した日</span><b class="num">'+p.cur.days+' 日</b></div>'
        + '<div class="note" style="margin-bottom:0">参考として並べています。'
        + '体重の変化がこの活動によるものだと判断することはできません。</div></div>' : '');
}

/* ===== Vertical Presence =====
   今週、都市の中でどれだけ上へ進んだか。 */
function vPresence(){
  var k=M.currentWeek(), w=M.weekSummary(S,k), pw=M.weekSummary(S,M.prevWeek(k));
  var d=w.m-pw.m, mx=Math.max.apply(null,w.byDay.map(function(x){return x.m;}))||1;
  var best=w.byDay.reduce(function(a,x){ return x.m>a.m?x:a; },{m:0,dow:"—"});
  var run=0,bestRun=0; w.byDay.forEach(function(x){ run=x.m>0?run+1:0; if(run>bestRun)bestRun=run; });
  var t=D.lifetime(S), tier=D.tierOf(t);
  return '<div class="card"><h3>今週の垂直的存在感 '+M.weekLabel(k)+'</h3>'
    + '<div class="eqline"><span class="num v" style="font-size:var(--f-hero)">'+fmt(w.m)+'<i>m</i></span>'
    + '<span class="k" style="color:'+(d>=0?"var(--green)":"var(--muted)")+'">'
    + (d>=0?"+":"")+fmt(d)+' m vs 先週</span></div></div>'
    + '<div class="card"><h3>DAILY ASCENT</h3><div class="days">'
    + w.byDay.map(function(x){
        return '<div class="'+(x.m===best.m&&x.m>0?"now":"")+'">'
          + '<i style="height:'+Math.max(3,x.m/mx*62)+'px"></i><span>'+x.dow+'</span></div>'; }).join("")
    + '</div></div>'
    + '<div class="stats">'
    + '<div><div class="k">最高単日</div><div class="v num">'+fmt(best.m)+'<i>m</i></div>'
    + '<span class="d">'+(best.m>0?best.dow+'曜':'—')+'</span></div>'
    + '<div><div class="k">最長連続</div><div class="v num">'+bestRun+'<i>日</i></div>'
    + '<span class="d">今週のうち</span></div>'
    + '<div><div class="k">活動日数</div><div class="v num">'+w.days+'<i>日</i></div>'
    + '<span class="d">7日中</span></div>'
    + '<div><div class="k">登った場所</div><div class="v num">'+w.spots+'<i>ヶ所</i></div>'
    + '<span class="d">新規 '+w.newSpots+'</span></div></div>'
    + '<div class="card"><h3>CURRENT SUMMIT</h3>'
    + '<div style="font-size:var(--f-lg);font-weight:700">'+esc(tier.tier.name)+'</div>'
    + '<div class="note" style="border:none;padding:0">'+fmt(t)+' / '+tier.tier.m.toLocaleString()+' m'
    + (tier.remain>0?' — 次の山まで あと '+fmt(tier.remain)+'m':' — 制覇')+'</div>'
    + '<div class="pb" style="margin-top:var(--s2)"><i style="width:'+Math.round(tier.inTier*100)+'%"></i></div>'
    + '<button class="ghost" data-go="mountains">全行程を見る</button></div>';
}

/* ===== ミッション詳細 ===== */
function vMissionDetail(){
  var k=M.currentWeek(), wp=M.weekProgress(S,k);
  var p=wp.items.filter(function(x){ return x.item.id===ui.missionId; })[0];
  if(!p) return '<div class="empty">ミッションが見つかりません。</div>';
  var it=p.item, cur=it.unit==="m"?fmt(p.current):Math.round(p.current);
  var t=D.lifetime(S), tier=D.tierOf(t);
  var gain=(it.cat==="ascent")?Math.max(0,it.target-p.current):0;
  return '<div class="card mdet"><div class="cat">'+it.catLabel+' <span class="j">'+it.catJp+'</span>'
    + diffTag(it.difficulty)+'</div>'
    + '<div class="ttl">'+esc(it.title)+'</div>'
    + '<div class="dsc">'+esc(it.desc)+'</div></div>'
    + '<div class="card"><h3>進捗</h3>'
    + '<div class="eqline"><span class="num v" style="font-size:var(--f-hero)">'+cur+'</span>'
    + '<span class="k">/ '+it.target.toLocaleString()+it.unit+'</span></div>'
    + '<div class="pb" style="margin-top:var(--s2)"><i style="width:'+Math.round(p.ratio*100)+'%;background:'
    + (p.done?"var(--green)":"var(--orange)")+'"></i></div>'
    + '<div class="note" style="margin-bottom:0">'
    + (p.done?'<b style="color:var(--green)">達成済み</b>'
             :'残り '+(it.unit==="m"?fmt(it.target-p.current):Math.ceil(it.target-p.current))+it.unit
              +' ・ 締切まで '+M.daysLeft(k)+'日')+'</div></div>'
    + '<div class="card"><h3>遠征上の意味</h3>'
    + '<div class="vrow"><span>いまの山</span><b>'+esc(tier.tier.name)+'</b></div>'
    + '<div class="vrow"><span>山頂まで</span><b class="num">'+fmt(tier.remain)+' m</b></div>'
    + (gain>0?'<div class="vrow"><span>これを達成すると</span><b class="num" style="color:var(--orange)">+'
        +fmt(gain)+' m</b></div>':'')
    + '<div class="note" style="margin-bottom:0">'
    + (it.cat==="ascent"?'高さそのものを稼ぐミッションです。達成ぶんがそのまま山を押し上げます。'
      :it.cat==="consistency"?'続けることを狙うミッションです。1回の大きさより回数が効きます。'
      :it.cat==="exploration"?'まだ登っていない場所を開拓するミッションです。探索率が上がります。'
      :'いつもより一段きついことをするミッションです。')+'</div></div>'
    + '<div class="card"><h3>この目標が出た理由</h3>'
    + (it.trace? '<div class="vrow"><span>下敷きの値</span><b class="num">'+fmt(it.trace.base)+'</b></div>'
      + '<div class="vrow"><span>調整</span><b class="num">'+(it.trace.adjust>=0?"+":"")+it.trace.adjust+'%</b></div>'
      + '<div class="vrow"><span>採用</span><b class="num">'+it.trace.applied.toLocaleString()+it.unit+'</b></div>' : '')
    + '<div class="note" style="margin-bottom:0">直近4週の実績から算出しています。'
    + '週の途中で目標が変わることはありません。</div></div>'
    + '<button class="ghost" data-act="shareMission">この内容をコピー</button>';
}

/* ===== 都市攻略マップ ===== */
function vMap(){
  var visited=D.exploration(S).visited;
  var areas={};
  D.allSpots(S).forEach(function(sp){
    var a=sp.area&&sp.area!=="—"?sp.area:"その他";
    (areas[a]=areas[a]||{name:a,spots:[],done:0,m:0}).spots.push(sp);
    if(visited.has(sp.id)){ areas[a].done++; areas[a].m+=D.spotStats(S,sp.id).total; }
  });
  var list=Object.keys(areas).map(function(k){return areas[k];})
    .sort(function(a,b){ return (b.done/b.spots.length)-(a.done/a.spots.length)||b.spots.length-a.spots.length; });
  var ex=D.exploration(S);
  return '<div class="card"><h3>都市攻略</h3>'
    + '<div class="eqline"><span class="num v">'+ex.done+'<i>/'+ex.total+'</i></span>'
    + '<span class="k">'+Math.round(ex.done/ex.total*100)+'% 攻略</span></div>'
    + '<div class="pb" style="margin-top:var(--s2)"><i style="width:'+(ex.done/ex.total*100)+'%"></i></div>'
    + '<div class="note" style="margin-bottom:0">距離ではなく、この街のどこを登ったかで見る地図です。</div></div>'
    + list.map(function(a){
        var pct=Math.round(a.done/a.spots.length*100);
        return '<div class="card"><h3>'+esc(a.name)+' <span class="rt">'+a.done+'/'+a.spots.length
          + (a.m?' ・ '+fmt(a.m)+'m':'')+'</span></h3>'
          + '<div class="pb" style="margin-bottom:var(--s3)"><i style="width:'+pct+'%"></i></div>'
          + '<div class="mapgrid">'+a.spots.map(function(sp){
              var got=visited.has(sp.id), st=D.spotStats(S,sp.id);
              return '<button class="mp'+(got?" got":"")+'" data-spot="'+sp.id+'">'
                + '<span class="dot"></span>'
                + '<span class="n">'+esc(sp.name)+'</span>'
                + '<span class="h num">'+fmt(D.spotTotal(S,sp))+'m</span>'
                + '<span class="s">'+(got?"登頂 "+st.visits+"回":"未踏")+'</span></button>'; }).join("")
          + '</div></div>'; }).join("");
}

/* ===== エネルギー分析 ===== */
function met(){ return ui.metric||"m"; }
function mfmt(v){ var m=met();
  return m==="m"? fmt(v) : Math.round(v).toLocaleString(); }
function munit(){ return D.METRICS[met()].unit; }
function metricChips(){
  return '<div class="chips">'+["m","kcal","g"].map(function(k){
    return '<button class="chip '+(met()===k?"on":"")+'" data-metric="'+k+'">'
      +D.METRICS[k].label+'</button>'; }).join("")+'</div>';
}
function lineChart(pts,key,color,h){
  h=h||96; var W=320,pad=8;
  if(!pts.length) return '';
  var mx=Math.max.apply(null,pts.map(function(p){return p[key];}))||1;
  var d=pts.map(function(p,i){
    var x=pad+(i/(pts.length-1||1))*(W-pad*2);
    var y=h-pad-(p[key]/mx)*(h-pad*2);
    return x.toFixed(1)+" "+y.toFixed(1); });
  return '<svg class="prof" viewBox="0 0 '+W+' '+h+'" width="100%" height="'+h+'">'
    + '<path d="M'+d.join(" L")+'" fill="none" stroke="'+color+'" stroke-width="2.2" stroke-linejoin="round"/>'
    + '<text x="'+pad+'" y="12" fill="var(--muted)" font-size="10">'+mfmt(mx)+'</text></svg>';
}
function barsWithAvg(pts,avg,h){
  h=h||110; var W=320,pad=8;
  var mx=Math.max.apply(null,pts.map(function(p){return p.v;}))||1;
  var bw=Math.max(1,(W-pad*2)/pts.length-1);
  var bars=pts.map(function(p,i){
    var x=pad+i*((W-pad*2)/pts.length);
    var bh=(p.v/mx)*(h-pad*2);
    return '<rect x="'+x.toFixed(1)+'" y="'+(h-pad-bh).toFixed(1)+'" width="'+bw.toFixed(1)
      +'" height="'+Math.max(0,bh).toFixed(1)+'" fill="var(--cyan)" opacity=".55"/>'; }).join("");
  var line=avg.map(function(v,i){
    var x=pad+i*((W-pad*2)/pts.length)+bw/2;
    return x.toFixed(1)+" "+(h-pad-(v/mx)*(h-pad*2)).toFixed(1); });
  return '<svg class="prof" viewBox="0 0 '+W+' '+h+'" width="100%" height="'+h+'">'+bars
    + '<path d="M'+line.join(" L")+'" fill="none" stroke="var(--orange)" stroke-width="2"/>'
    + '<text x="'+pad+'" y="11" fill="var(--muted)" font-size="10">'+mfmt(mx)+'</text></svg>';
}
function vEnergy(){
  var days=ui.ePeriod||90, m=met();
  var ser=D.seriesDaily(S,days,m), avg=D.movingAvg(ser,7);
  var cur=ser.reduce(function(a,p){return a+p.v;},0);
  var prevSer=D.seriesDaily(S,days*2,m).slice(0,days);
  var prev=prevSer.reduce(function(a,p){return a+p.v;},0);
  var diff=prev>0?Math.round((cur-prev)/prev*100):null;
  var by=ui.breakBy||"area";
  var bd=D.breakdown(S,days,m,by);
  var mx=D.dowSlotMatrix(S,days,m);
  var cb=D.confBreakdown(S,days,m);
  var ms=D.fatMilestones(S);
  var CONFC={"実測":"var(--conf-measured)","確定":"var(--conf-confirmed)","導出":"var(--conf-derived)","推定":"var(--conf-estimated)","不明":"var(--muted)"};

  return '<div class="chips">'+[[30,"30日"],[90,"90日"],[180,"180日"],[365,"1年"]].map(function(x){
      return '<button class="chip '+(days===x[0]?"on":"")+'" data-eper="'+x[0]+'">'+x[1]+'</button>'; }).join("")+'</div>'
    + '<div style="margin-top:var(--s2)">'+metricChips()+'</div>'

    + '<div class="card"><h3>累積</h3>'
    + '<div class="eqline"><span class="num v" style="font-size:var(--f-hero)">'+mfmt(cur)
    + '<i>'+munit()+'</i></span>'
    + (diff!==null?'<span class="k" style="color:'+(diff>=0?"var(--green)":"var(--muted)")+'">'
        +(diff>=0?"+":"")+diff+'% 前期間</span>':'')+'</div>'
    + lineChart(ser,"cum","var(--orange)",110)
    + (m==="g"&&cur>=1000?'<div class="note" style="margin-bottom:0">約 '+(Math.round(cur/100)/10)+' kg 相当（理論値）</div>':'')
    + '</div>'

    + '<div class="card"><h3>脂肪換算のマイルストーン</h3>'
    + ms.slice(0,5).map(function(x){
        return '<div class="bl"><span class="nm">'+(x.g>=1000?(x.g/1000)+'kg':x.g+'g')+'</span>'
          + '<span class="pb"><i style="width:'+Math.round(x.ratio*100)+'%;background:'
          + (x.done?"var(--green)":"var(--amber)")+'"></i></span>'
          + '<span class="ct num">'+(x.done?x.date.slice(2).replace(/-/g,"/"):Math.round(x.ratio*100)+"%")+'</span></div>'; }).join("")
    + '<div class="note" style="margin-bottom:0">消費エネルギーを 7,200kcal/kg で換算した理論値です。'
    + '実際の体脂肪の増減を示すものではありません。</div></div>'

    + '<div class="card"><h3>推移（日次と7日平均）</h3>'
    + barsWithAvg(ser,avg)
    + '<div class="note" style="margin-bottom:0">薄い棒が日ごと、オレンジの線が7日移動平均です。</div></div>'

    + '<div class="card"><h3>内訳</h3>'
    + '<div class="mini">'+[["area","エリア"],["spot","地点"],["cat","種類"]].map(function(x){
        return '<button data-breakby="'+x[0]+'" class="'+(by===x[0]?"on":"")+'">'+x[1]+'</button>'; }).join("")+'</div>'
    + (bd.rows.length? bd.rows.slice(0,10).map(function(r){
        return '<div class="bl"><span class="nm">'+esc(r.name)+'</span>'
          + '<span class="pb"><i style="width:'+Math.round(r.ratio*100)+'%"></i></span>'
          + '<span class="ct num">'+Math.round(r.ratio*100)+'%</span></div>'; }).join("")
        : '<div class="note" style="margin:0">この期間の記録がありません。</div>')+'</div>'

    + '<div class="card"><h3>曜日 × 時間帯</h3>'
    + '<div class="mtx"><div class="hd3"><span></span>'
    + mx.slots.map(function(s2){ return '<span>'+s2+'</span>'; }).join("")+'</div>'
    + ["日","月","火","水","木","金","土"].map(function(l,i){
        return '<div class="rw"><span class="d">'+l+'</span>'
          + mx.grid[i].map(function(v){
              var a=mx.max>0?v/mx.max:0;
              return '<span class="cl" style="background:color-mix(in srgb,var(--orange) '
                +Math.round(a*100)+'%,var(--ink-2))" title="'+mfmt(v)+'"></span>'; }).join("")
          + '</div>'; }).join("")
    + '</div>'
    + '<div class="note" style="margin-bottom:0">'+mx.used+'件を集計。'
    + (mx.skipped?'時刻が確かでない '+mx.skipped+'件は除外しています。':'')+'</div></div>'

    + '<div class="card"><h3>この数字の確度</h3>'
    + '<div class="stack">'+cb.rows.map(function(r){
        return '<i style="width:'+(r.ratio*100)+'%;background:'+CONFC[r.name]+'" title="'+r.name+'"></i>'; }).join("")+'</div>'
    + cb.rows.map(function(r){
        return '<div class="vrow"><span style="color:'+CONFC[r.name]+'">'+r.name+'</span>'
          + '<b class="num">'+Math.round(r.ratio*100)+'%</b></div>'; }).join("")
    + '<div class="note" style="margin-bottom:0">現地で段数や高さを測るほど、実測の割合が増えます。</div></div>';
}

/* ===== 予測（積み上げの延長） =====
   シミュレーターなので、スライダーを動かした結果がその場で見えないと意味がない。
   以前は結果4枚が縦に並び、上のスライダーを動かしても結果は画面外だった。
   ペース操作＋結果を1画面に収め、結果はチップで切り替える。
   ドラッグ中は render() を呼ばない（input 要素ごと作り直すとドラッグが切れる）。
   代わりに #fcOut だけを差し替える。 */
var FCVIEWS=[["mtn","山の到達"],["stack","積み上げ"],["goal","目標逆算"],["cmp","ペース比較"]];
function fcPace(){
  var base=ui.paceBase||"w4";
  if(base==="manual") return Number(ui.pace!=null?ui.pace:250);
  return Math.round({ w4:D.paceFrom(S,4), w12:D.paceFrom(S,12), best:D.bestMonthPace(S) }[base]);
}
/* 結果部分だけを組み立てる。スライダーの oninput からも呼ぶ。 */
function forecastOut(){
  var pace=fcPace(), v=ui.fcView||"mtn";
  var P=function(d){ return D.project(S,pace,d); };
  var y=P(365);

  /* ドラッグ中でも必ず1つは数字が動くよう、先頭に1年後の要約を置く */
  var head='<div class="card"><h3>1年後（このペース）</h3><div class="stats">'
    + '<div><div class="k">獲得標高</div><div class="v num">'+Math.round(y.m).toLocaleString()+'<i>m</i></div></div>'
    + '<div><div class="k">脂肪換算</div><div class="v num amb">'
    + (y.g>=1000?(Math.round(y.g/100)/10)+'<i>kg</i>':Math.round(y.g)+'<i>g</i>')+'</div></div>'
    + '</div></div>';

  if(v==="mtn"){
    var next=D.mountainETA(S,pace).filter(function(x){ return !x.done; }).slice(0,4);
    return head+'<div class="card"><h3>山の到達予測</h3>'
      + (pace>0? next.map(function(x){
          return '<div class="bl"><span class="nm">'+esc(x.name)+'</span>'
            + '<span class="ct num" style="width:auto;color:var(--orange);font-weight:700">'+x.date.replace(/-/g,"/")+'</span></div>'
            + '<div class="note" style="margin:0 0 9px">あと '+fmt(x.remain)+'m ・ '+x.days.toLocaleString()+'日</div>'; }).join("")
          : '<div class="note" style="margin:0">ペースを1以上にすると予測が出ます。</div>')
      + (next.length===0?'<div class="note" style="margin:0">全6座を制覇しています。</div>':'')+'</div>';
  }
  if(v==="stack"){
    var rows=[[90,"3ヶ月"],[182,"6ヶ月"],[365,"1年"],[1095,"3年"]];
    return head+'<div class="card"><h3>このペースで続けた場合</h3>'
      + '<div class="fcast"><div class="hd3"><span></span>'+rows.map(function(r){return '<span>'+r[1]+'</span>';}).join("")+'</div>'
      + [["m","標高","m"],["kcal","エネルギー","kcal"],["g","脂肪換算","g"]].map(function(mm){
          return '<div class="rw"><span class="d">'+mm[1]+'</span>'
            + rows.map(function(r){ var val=P(r[0])[mm[0]];
                return '<span class="v num">'+(mm[0]==="g"&&val>=1000?(Math.round(val/100)/10)+"kg":Math.round(val).toLocaleString())+'</span>'; }).join("")
            + '</div>'; }).join("")
      + '</div>'
      + '<div class="note" style="margin-bottom:0">体重'+S.weight+'kg、往復の割合は直近の実績（'
      + Math.round(D.roundRatio(S)*100)+'%）を使用。脂肪換算は 7,200kcal/kg の理論値で、'
      + '実際の体重の増減を示すものではありません。</div></div>';
  }
  if(v==="goal"){
    var TG=[[500,"500g"],[1000,"1kg"],[2000,"2kg"],[5000,"5kg"]];
    return head+'<div class="card"><h3>目標までの逆算</h3>'
      + TG.map(function(t){
          var w=D.weeksToFat(S,pace,t[0]);
          if(w===null) return '<div class="vrow"><span>脂肪換算 '+t[1]+'</span><b>—</b></div>';
          if(w===0) return '<div class="vrow"><span>脂肪換算 '+t[1]+'</span><b style="color:var(--green)">到達済み</b></div>';
          var dt=new Date(); dt.setDate(dt.getDate()+Math.ceil(w*7));
          return '<div class="vrow"><span>脂肪換算 '+t[1]+'</span>'
            + '<b class="num">'+D.ymd(dt).replace(/-/g,"/")+'（'+Math.ceil(w)+'週）</b></div>'; }).join("")
      + '<div class="note" style="margin-bottom:0">ペースを上げると、この日付が前に動きます。</div></div>';
  }
  var tbl=[50,150,250,500,1000];
  return head+'<div class="card"><h3>ペース別の1年</h3>'
    + tbl.map(function(w){ var p=D.project(S,w,365);
        var here=Math.abs(w-pace)<=Math.min(75,pace*0.15);
        return '<div class="bl'+(here?" hi":"")+'"><span class="nm num">週 '+w.toLocaleString()+'m</span>'
          + '<span class="ct num" style="width:auto">'+Math.round(p.m).toLocaleString()+'m ・ '
          + Math.round(p.kcal).toLocaleString()+'kcal ・ '
          + (p.g>=1000?(Math.round(p.g/100)/10)+'kg':Math.round(p.g)+'g')+'</span></div>'; }).join("")
    + '<div class="note" style="margin-bottom:0">いまのペースに近い行を強調しています。</div></div>';
}
function vForecast(){
  var base=ui.paceBase||"w4", pace=fcPace(), v=ui.fcView||"mtn";
  return '<div class="card pacer"><h3>ペース</h3>'
    + '<div class="mini">'+[["w4","直近4週"],["w12","直近12週"],["best","最高の月"],["manual","手動"]].map(function(x){
        return '<button data-pacebase="'+x[0]+'" class="'+(base===x[0]?"on":"")+'">'+x[1]+'</button>'; }).join("")+'</div>'
    + '<div class="eqline"><span class="num v" id="paceVal" style="font-size:var(--f-hero)">'
    + pace.toLocaleString()+'<i>m / 週</i></span></div>'
    + '<input id="paceRange" type="range" min="0" max="1500" step="10" value="'+pace+'">'
    + '<div class="note" style="margin-bottom:0">動かすと下の結果がその場で変わります。'
    + (base!=="manual"?'（動かすと手動に切り替わります）':'')+'</div></div>'

    + '<div class="chips">'+FCVIEWS.map(function(x){
        return '<button class="chip '+(v===x[0]?"on":"")+'" data-fcv="'+x[0]+'">'+x[1]+'</button>'; }).join("")+'</div>'

    + '<div id="fcOut" style="margin-top:var(--s3)">'+forecastOut()+'</div>'

    + '<div class="note">この予測は、登った実績をそのまま延長した計算です。'
    + '食事などの摂取側は含んでいないため、体重や体型の変化を予測するものではありません。</div>';
}

/* ===== コンプリート =====
   施設の全区間 × 倍率 が目標。どの区間で稼いだかは問わない。 */
function compBar(c){
  return '<div class="cmp'+(c.done?" done":"")+'" data-spot="'+c.id+'">'
    + '<div class="hd2"><span class="nm">'+esc(c.name)+'</span>'
    + '<span class="pc num">'+Math.round(c.ratio*100)+'%</span></div>'
    + '<div class="pb"><i style="width:'+Math.round(c.ratio*100)+'%"></i></div>'
    + '<div class="sb num">'+fmt(Math.min(c.got,c.target))+' / '+fmt(c.target)+' m'
    + '　<span class="mul">'+fmt(c.base)+'m ×'+c.mult+'</span>'
    + (c.done?'　<b>コンプリート</b>':'　あと '+fmt(c.remain)+'m')+'</div></div>';
}
function vComplete(){
  var ov=D.overallComplete(S), ar=D.areaComplete(S);
  var all=D.completeAll(S).sort(function(a,b){ return b.ratio-a.ratio; });
  var live=all.filter(function(c){ return c.got>0 && !c.done; });
  var done=all.filter(function(c){ return c.done; });
  var yet=all.filter(function(c){ return c.got<=0; });
  var pct=Math.round(ov.ratio*100);
  var f=ui.cFilter||"live";
  var GROUPS={ live:{label:"進行中",rows:live}, done:{label:"達成済み",rows:done},
               yet:{label:"未着手",rows:yet}, all:{label:"すべて",rows:all} };
  var cur=GROUPS[f]||GROUPS.live;

  return '<div class="card"><h3>総合進捗</h3>'
    /* いちばん見たい数字は達成率。以前は下の vrow に埋まっていたのでヒーローに上げた。 */
    + '<div class="eqline"><span class="num v" style="font-size:var(--f-hero)">'+pct+'<i>%</i></span>'
    + '<span class="k">'+fmt(ov.got)+' / '+fmt(ov.target)+' m</span></div>'
    + '<div class="pb" style="margin-top:var(--s2)"><i style="width:'+pct+'%"></i></div>'
    + '<div class="stats" style="margin-top:var(--s3)">'
    + '<div><div class="k">コンプリート</div><div class="v num">'+ov.done+'<i>/'+ov.total+'</i></div>'
    + '<span class="d">地点</span></div>'
    + '<div><div class="k">残り</div><div class="v num">'+fmt(Math.max(0,ov.target-ov.got))+'<i>m</i></div>'
    + '<span class="d">全体の'+Math.max(0,100-pct)+'%</span></div></div>'
    + '<div class="note" style="margin-bottom:0">目標は「その施設の全区間の合計 × 倍率」。'
    + 'どの区間で稼いでも構いません。閉鎖中の階段があっても、別の区間で同じ高さを登れば達成できます。</div></div>'

    /* 3つのセクションを縦に全部並べていたので、チップで切り替える */
    + '<div class="chips">'+["live","yet","done","all"].map(function(k){
        return '<button class="chip '+(f===k?"on":"")+'" data-cfil="'+k+'">'
          + GROUPS[k].label+' '+GROUPS[k].rows.length+'</button>'; }).join("")+'</div>'

    + '<div style="margin-top:var(--s3)">'
    + (cur.rows.length
        ? cur.rows.map(function(c){
            return (c.got>0||c.done) ? compBar(c)
              : '<button class="row" data-spot="'+c.id+'"><span class="mk boss"></span>'
                + '<span class="bd"><span class="nm">'+esc(c.name)+'</span>'
                + '<span class="sb num">目標 '+fmt(c.target)+'m（'+fmt(c.base)+'m ×'+c.mult+'）</span></span></button>'; }).join("")
        : '<div class="empty">この区分の地点はありません。</div>')
    + '</div>'

    + '<div class="card"><h3>エリア</h3>'
    + ar.map(function(a){
        return '<div class="bl"><span class="nm">'+esc(a.area)+'</span>'
          + '<span class="pb"><i style="width:'+Math.round(a.ratio*100)+'%"></i></span>'
          + '<span class="ct num">'+a.done+'/'+a.total+'</span></div>'; }).join("")
    + '<div class="note" style="margin-bottom:0">バーは高さの達成率、右の数字はコンプリートした地点数です。</div></div>'

    + '<div class="card"><h3>倍率</h3>'
    + [["400m以上","×1"],["300m以上","×2"],["200m以上","×3"],["100m以上","×5"],["100m未満","×10"]]
        .map(function(x){ return '<div class="vrow"><span>'+x[0]+'</span><b class="num">'+x[1]+'</b></div>'; }).join("")
    + '<div class="note" style="margin-bottom:0">高い山ほど倍率を下げています。'
    + '高尾山のような400m以上は、1回登れば100%です。</div></div>';
}

/* ===== 地点カード ===== */
function vCards(){
  var visited=D.exploration(S).visited;
  var list=D.allSpots(S).slice().sort(function(a,b){
    var x=visited.has(a.id)?0:1, y=visited.has(b.id)?0:1;
    return x-y || D.spotTotal(S,b)-D.spotTotal(S,a); });
  var CONFCLS={"実測":"c-meas","確定":"c-conf","導出":"c-der","推定":"c-est"};
  return '<div class="note">地点ごとの1枚。現地で測って確度が上がると、カードが格上げされます。</div>'
    + '<div class="cards">'+list.map(function(sp){
        var got=visited.has(sp.id), st=D.spotStats(S,sp.id), cf=D.spotConfidence(S,sp);
        return '<button class="cd '+(got?"got":"")+' '+CONFCLS[cf]+'" data-spot="'+sp.id+'">'
          + '<span class="rank">'+cf+'</span>'
          + '<span class="nm">'+esc(sp.name)+'</span>'
          + '<span class="ar">'+area(sp)+'</span>'
          + '<span class="hh num">'+fmt(D.spotTotal(S,sp))+'<i>m</i></span>'
          + '<span class="ft">'+(got?("初登頂 "+st.first.slice(5).replace("-","/")+" ・ "+st.visits+"回")
                                    :"未踏")+'</span>'
          + (function(){ var c=D.spotComplete(S,sp);
              return c.target? '<span class="cbar"><i style="width:'+Math.round(c.ratio*100)+'%"></i></span>'
                + '<span class="ft'+(c.done?" ok":"")+'">'+(c.done?"コンプリート":"コンプリート "+Math.round(c.ratio*100)+"%")+'</span>':''; })()
          + '</button>'; }).join("")+'</div>';
}

/* ===== 記録の編集 ===== */
function vEdit(){
  var e=S.entries.filter(function(x){ return String(x.id)===String(ui.editEntry); })[0];
  if(!e) return '<div class="empty">記録が見つかりません。</div>';
  var sp=D.spotOf(S,e.spotId);
  var unit=e.unitM, meters=unit*(Number(ui.eReps)||e.reps);
  var round=(ui.eRound==null?e.round:ui.eRound);
  var kc=Math.round((e.weightAtSave||S.weight)*meters*0.01*(round?1.3:1));
  return '<div class="card"><h3>'+esc(e.name)+'</h3>'
    + '<div class="fr"><label>日付</label><input id="eDate" type="date" value="'+(ui.eDate||e.date)+'"></div>'
    + '<div class="fr"><label>本数</label><span class="stepper">'
    + '<button data-act="eMinus">−</button><input id="eReps" type="number" inputmode="numeric" value="'
    + (ui.eReps||e.reps)+'"><button data-act="ePlus">＋</button></span></div>'
    + '<div class="fr"><label>下りも歩いた（＋30%）</label>'
    + '<input type="checkbox" id="eRound" '+(round?"checked":"")+' style="width:20px;height:20px;accent-color:var(--orange)"></div>'
    + '<div class="fr"><label>雨の日だった</label>'
    + '<input type="checkbox" id="eRain" '+((ui.eRain==null?(e.cond&&e.cond.rain):ui.eRain)?"checked":"")+' style="width:20px;height:20px;accent-color:var(--orange)"></div>'
    + '</div>'
    + '<div class="card" style="text-align:center">'
    + '<div class="num" style="font-size:var(--f-hero);font-weight:700">'+fmt(meters)+'<i style="font-style:normal;font-size:var(--f-lg);color:var(--muted)">m</i></div>'
    + '<div class="note" style="border:none;justify-content:center;padding:0;margin-top:6px">約 '+kc.toLocaleString()+' kcal</div>'
    + '<button class="primary" data-act="saveEdit">この内容で更新する</button>'
    + '<button class="ghost" data-del="'+e.id+'" style="border-color:var(--danger);color:var(--danger)">この記録を削除</button></div>'
    + '<div class="note">1本あたりの高さ（'+fmt(unit)+'m）は記録時のまま保持します。'
    + '区間の構成を変えたい場合は、削除して入れ直してください。</div>';
}

/* ===== S3 分析 ===== */
/* ===== S3 分析・概要 =====
   カード13枚を縦に積んでいたので、性質ごとに4つに分けてチップで切り替える。
   期間チップが効くのはサマリーの数字だけなので、サマリー内にだけ置く。 */
var SVIEWS=[["sum","サマリー"],["trend","推移"],["area","エリア"],["ach","実績"]];
function vStats(){
  var v=ui.sView||"sum";
  return '<div class="chips">'+SVIEWS.map(function(x){
      return '<button class="chip '+(v===x[0]?"on":"")+'" data-sv="'+x[0]+'">'+x[1]+'</button>'; }).join("")+'</div>'
    + '<div style="margin-top:var(--s3)">'
    + (v==="trend"?sTrend():v==="area"?sArea():v==="ach"?sAch():sSum())
    + '</div>';
}
function sSum(){
  var p=ui.period? D.periodStats(S,ui.period) : D.allTimeStats(S);
  var t=D.lifetime(S), k=D.tierOf(t);
  function d(v){ return v==null?'<span class="d">前期間なし</span>'
    : '<span class="d '+(v>0?"up":v<0?"dn":"")+'">'+(v>0?"+":"")+v+'% 前期間</span>'; }

  return '<div class="chips">'+PERIODS.map(function(x){
      return '<button class="chip '+(ui.period===x[0]?"on":"")+'" data-per="'+x[0]+'">'+x[1]+'</button>'; }).join("")+'</div>'
    + '<div class="stats" style="margin-top:var(--s3)">'
    + '<div><div class="k">獲得標高</div><div class="v num">'+fmt(p.cur.m)+'<i>m</i></div>'+d(p.dM)+'</div>'
    + '<div><div class="k">消費エネルギー</div><div class="v num">'+p.cur.kcal.toLocaleString()+'<i>kcal</i></div>'+d(p.dK)+'</div>'
    + '<div><div class="k">のぼった段数</div><div class="v num">'+p.cur.steps.toLocaleString()+'<i>段</i></div>'+d(p.dS)+'</div>'
    + '<div><div class="k">記録した日</div><div class="v num">'+p.cur.days+'<i>日</i></div>'
    + '<span class="d">稼働率 '+p.rate+'%</span></div></div>'

    + '<div class="note">脂肪換算 約 '+Math.round(D.fatG(p.cur.kcal,S))+' g（理論値・7,200kcal/kg）。'
    + '単純なエネルギー換算による参考値で、実際の脂肪の増減を示すものではありません。</div>'

    + '<div class="card"><h3>この期間で登った山</h3>'
    + (function(){ var eq=D.equivalent(p.cur.m);
        return eq? '<div class="eqline"><span class="num v">'+fmt(p.cur.m)+'<i>m</i></span>'
          + '<span class="k">'+esc(eq.name)+' ×'+(Math.round(eq.times*100)/100)+'</span></div>'
          : '<div class="note" style="margin:0">この期間の記録はまだありません。</div>'; })()
    + '</div>'

    + '<div class="card"><h3>生涯累計 — 現在の山</h3>'
    + '<div style="font-size:var(--f-lg);font-weight:700">'+esc(k.tier.name)+'</div>'
    + '<div class="note" style="border:none;padding:0">'+fmt(t)+' / '+k.tier.m.toLocaleString()+' m'
    + (k.remain>0?' — あと '+fmt(k.remain)+'m':' — 制覇')+'</div>'
    + '<div class="pb" style="margin-top:var(--s2)"><i style="width:'+Math.round(k.inTier*100)+'%"></i></div>'
    + '<button class="ghost" data-go="mountains">全行程（6座）をひらく</button></div>';
}
function sTrend(){
  var hm=D.heatmap(S,18), wd=D.weekday(S), mx=Math.max.apply(null,wd)||1;
  var st=D.streak(S);
  return '<div class="card"><h3>日別（直近90日）</h3><div class="scrollx" id="dayscroll"><div class="days d90">'
    + (function(){ var ds=D.lastDays(S,90), mx=Math.max.apply(null,ds.map(function(d){return d.m;}))||1;
        return ds.map(function(d,i){
          var first=(d.date.slice(8)==="01");
          return '<div class="'+(i===ds.length-1?"now":"")+(first?" mstart":"")+'" title="'+d.date+' '+fmt(d.m)+'m">'
            + '<i style="height:'+Math.max(3,d.m/mx*64)+'px"></i>'
            + '<span>'+(first?d.date.slice(5,7)+"月":d.date.slice(8))+'</span></div>'; }).join(""); })()
    + '</div></div>'
    + (function(){ var b=D.bestDay(S);
        return b.date?'<div class="note" style="margin-bottom:0">最高単日 '+fmt(b.m)+'m（'+b.date.slice(5).replace("-","/")+'）</div>':''; })()
    + '</div>'

    + '<div class="card"><h3>連続記録</h3>'
    + '<div class="bl"><span class="nm">いま</span><span class="vl num" style="font-weight:700">'+st.current+' 日</span></div>'
    + '<div class="bl"><span class="nm">最長</span><span class="vl num" style="font-weight:700">'+st.best+' 日</span></div>'
    + '<div class="note">途切れても構いません。下山も登山のうちです。</div></div>'

    + '<div class="card"><h3>直近18週</h3><div class="hm">'
    + hm.map(function(o){ return '<i class="l'+o.lv+'" title="'+o.date+' '+fmt(o.m)+'m"></i>'; }).join("")+'</div></div>'

    + '<div class="card"><h3>曜日別のクセ</h3><div class="wk">'
    + ["日","月","火","水","木","金","土"].map(function(l,i){
        return '<div><i style="height:'+Math.max(2,wd[i]/mx*56)+'px"></i><span>'+l+'</span></div>'; }).join("")
    + '</div></div>'

    + (function(){ var g=D.ghost(S);
        if(!g.curM&&!g.prevM) return '';
        var mx=Math.max(Math.max.apply(null,g.cur),Math.max.apply(null,g.prev),1);
        var line=function(arr,color,upto){
          var W=300,H=70,pad=6, n=Math.max(arr.length,1);
          var pts=arr.slice(0,upto||arr.length).map(function(v,i){
            return (pad+i/(n-1||1)*(W-pad*2)).toFixed(1)+" "+(H-pad-(v/mx)*(H-pad*2)).toFixed(1); });
          return pts.length>1?'<path d="M'+pts.join(" L")+'" fill="none" stroke="'+color+'" stroke-width="2.2"/>':'';
        };
        return '<div class="card"><h3>先月の自分との対戦</h3>'
          + '<svg class="prof" viewBox="0 0 300 70" width="100%" height="70">'
          + line(g.prev,"var(--muted)") + line(g.cur,"var(--orange)",g.day) + '</svg>'
          + '<div class="bl"><span class="nm" style="color:var(--orange)">今月</span>'
          + '<span class="ct num">'+fmt(g.curM)+'m</span></div>'
          + '<div class="bl"><span class="nm">先月 同日</span><span class="ct num">'+fmt(g.prevM)+'m</span></div>'
          + '<div class="note" style="margin-bottom:0">'
          + (g.lead>=0?'<b style="color:var(--green)">'+fmt(g.lead)+'m リード</b>'
                      :fmt(-g.lead)+'m ビハインド')+'</div></div>'; })();
}
function sArea(){
  var ar=D.areaProgress(S);
  return '<div class="card"><h3>エリア制覇</h3>'
    + ar.map(function(a){ return '<div class="bl"><span class="nm">'+esc(a.area)+'</span>'
        + '<span class="pb"><i style="width:'+(a.done/a.total*100)+'%"></i></span>'
        + '<span class="ct num">'+a.done+'/'+a.total+'</span></div>'; }).join("")+'</div>'

    + (function(){ var tv=D.traverses(S).slice(0,5);
        if(!tv.length) return '';
        return '<div class="card"><h3>縦走</h3>'
          + tv.map(function(t){
              return '<div class="row" style="background:var(--surface-2)"><span class="mk boss"></span>'
                + '<span class="bd"><span class="nm">'+esc(t.area)+' 縦走 ×'+t.n+'</span>'
                + '<span class="sb">'+t.date.slice(5).replace("-","/")+' ・ '+esc(t.spots.join(" → "))+'</span></span></div>'; }).join("")
          + '<div class="note" style="margin-bottom:0">1日で同じエリアの2ヶ所以上を登ると成立します。</div></div>'; })();
}
function sAch(){
  var ac=D.achievementView(S), got=ac.filter(function(a){return a.got;}).length;
  return (function(){ var cs=D.monthlyCerts(S).slice(0,4);
        if(!cs.length) return '';
        return '<div class="card"><h3>月間認定</h3>'
          + cs.map(function(c){
              return '<div class="bl"><span class="nm">'+c.month.replace("-","/")+'</span>'
                + '<span class="pb"><i style="width:'+Math.round(c.ratio*100)+'%"></i></span>'
                + '<span class="ct num">'+fmt(c.m)+'m</span></div>'
                + '<div class="note" style="margin:0 0 9px">'
                + (c.mountain?'<b style="color:var(--green)">'+esc(c.mountain.name)+' 認定</b>'
                            :'認定なし')
                + (c.next?' ・ '+esc(c.next.name)+'まで あと '+fmt(c.remain)+'m':'')+'</div>'; }).join("")
          + '<div class="note" style="margin-bottom:0">累計とは別に、その月の合計だけで判定します。毎月リセットです。</div></div>'; })()

    + (function(){ var c=D.condStats(S);
        if(!c.early&&!c.night&&!c.rain) return '';
        return '<div class="card"><h3>悪条件での登攀</h3>'
          + '<div class="vrow"><span>早朝（7時前）</span><b class="num">'+c.early+' 回</b></div>'
          + '<div class="vrow"><span>夜（21時以降）</span><b class="num">'+c.night+' 回</b></div>'
          + '<div class="vrow"><span>雨の日</span><b class="num">'+c.rain+' 回</b></div></div>'; })()

    + '<div class="card"><h3>実績 '+got+'/'+ac.length+'</h3><div class="ach">'
    + ac.map(function(a){ return '<div class="'+(a.got?"got":"")+(a.lapsed?" lapsed":"")+'"><b>'+esc(a.name)+'</b>'
        + '<span>'+esc(a.lapsed?"解除済み（現在は条件外）":a.desc)+'</span></div>'; }).join("")
    + '</div></div>';
}

/* ===== S4 履歴 ===== */
function vHistory(){
  if(!S.entries.length) return '<div class="empty">まだ記録がありません。<br>いちばん近い階段から始められます。</div>';
  var byDay={};
  S.entries.forEach(function(e){ (byDay[e.date]=byDay[e.date]||[]).push(e); });
  return Object.keys(byDay).sort().reverse().map(function(dt){
    var list=byDay[dt], sum=list.reduce(function(a,e){return a+e.meters;},0);
    var kc=list.reduce(function(a,e){return a+D.kcalOf(S,e);},0);
    var st=list.reduce(function(a,e){return a+D.stepsOf(S,e);},0);
    var DOW=["日","月","火","水","木","金","土"][new Date(dt+"T00:00:00").getDay()];
    return '<div class="card"><h3>'+dt.slice(5).replace("-","/")+'（'+DOW+'） — '
      + fmt(sum)+'m ・ '+kc.toLocaleString()+'kcal ・ '+st.toLocaleString()+'段</h3>'
      + list.map(function(e){
        return '<div class="row"><span class="mk '+(e.cat==="boss"?"boss":"")+'"></span>'
          + '<span class="bd"><span class="nm">'+esc(e.name)+'</span>'
          + '<span class="sb num">'+fmt(e.unitM)+'m × '+e.reps+(e.round?" · 往復":"")
          + ' · '+D.kcalOf(S,e)+'kcal · '+D.stepsOf(S,e)+'段</span></span>'
          + '<span class="vl num">'+fmt(e.meters)+'<i>m</i></span>'
          + '<button class="x" data-edit="'+e.id+'" aria-label="編集">✎</button>'
          + '<button class="x" data-del="'+e.id+'" aria-label="削除">×</button></div>'; }).join("")
      + '</div>'; }).join("");
}

/* ===== S5 地点一覧 ===== */
function vSpots(){
  var ex=D.exploration(S);
  var hid=D.allSpots(S,true).filter(function(s){return s.hidden;});
  var list=(ui.cat==="hidden") ? hid
    : D.allSpots(S).filter(function(s){return s.cat===ui.cat;});
  return '<div class="card"><h3>探索 '+ex.done+' / '+ex.total+'</h3>'
    + '<div class="pb"><i style="width:'+(ex.done/ex.total*100)+'%"></i></div>'
    + '<button class="ghost" data-go="newspot">＋ 新しい地点を追加</button></div>'
    + '<div class="chips" style="margin-top:var(--s3)">'
    + CATS.map(function(c){ return '<button class="chip '+(ui.cat===c[0]?"on":"")+'" data-cat="'+c[0]+'">'+c[1]+'</button>'; }).join("")
    + (hid.length?'<button class="chip '+(ui.cat==="hidden"?"on":"")+'" data-cat="hidden">非表示 '+hid.length+'</button>':'')
    + '</div><div style="margin-top:var(--s3)">'
    + list.map(function(s){
        return '<button class="row" data-spot="'+s.id+'"><span class="mk '+(ex.visited.has(s.id)?"":"boss")+'"></span>'
          + '<span class="bd"><span class="nm">'+esc(s.name)+(s.isCustom?' <span class="cf c-meas">自分で追加</span>':'')+'</span>'
          + '<span class="sb">'+esc(s.area)+' · '+s.segs.length+'区間'+(s.totalM?' · 公表 '+s.totalM+'m':'')+'</span></span>'
          + '<span class="vl num">'+fmt(D.spotTotal(S,s))+'<i>m</i></span></button>'; }).join("")
    + (list.length?'':'<div class="empty">この種類の地点はまだありません。</div>')
    + '</div>';
}

/* ===== S6 地点の詳細・計測 ===== */
function vSpotDetail(){
  var sp=D.spotOf(S,ui.editSpot); if(!sp) return '<div class="empty">地点が見つかりません。</div>';
  var o=D.ov(S,sp.id), f=D.floorHFor(S,sp);
  return '<div class="card"><div style="font-size:var(--f-lg);font-weight:700">'+esc(sp.name)+'</div>'
    + '<div class="note" style="border:none;padding:0;margin-top:4px">'+esc(sp.area)
    + (sp.totalM?' · 公表 '+sp.totalM+'m':'')+'</div>'
    + (sp.totalSteps?'<div class="note">全区間の実測段数 '+sp.totalSteps+'段（公表）。現在の基準蹴上げ '
      +Math.round(S.baseRise*1000)+'mm なら全体 '+fmt(sp.totalSteps*S.baseRise)+'m。</div>':'')
    + (function(){ var c=D.spotComplete(S,sp);
        if(!c.target) return '';
        return '<div class="cmp'+(c.done?" done":"")+'" style="margin:var(--s3) 0 0">'
          + '<div class="hd2"><span class="nm">コンプリート</span>'
          + '<span class="pc num">'+Math.round(c.ratio*100)+'%</span></div>'
          + '<div class="pb"><i style="width:'+Math.round(c.ratio*100)+'%"></i></div>'
          + '<div class="sb num">'+fmt(Math.min(c.got,c.target))+' / '+fmt(c.target)+' m'
          + '　<span class="mul">'+fmt(c.base)+'m ×'+c.mult+'</span>'
          + (c.done?'　<b>達成</b>':'　あと '+fmt(c.remain)+'m')+'</div></div>'; })()
    + (function(){ var st=D.spotStats(S,sp.id);
        return st.visits? '<div class="vrow"><span>初登頂</span><b class="num">'+st.first.replace(/-/g,"/")+'</b></div>'
          + '<div class="vrow"><span>登頂回数</span><b class="num">'+st.visits+' 回</b></div>'
          + '<div class="vrow"><span>ここでの累計</span><b class="num">'+fmt(st.total)+' m</b></div>' : ''; })()
    + '<button class="primary" data-pick="'+sp.id+'" style="background:var(--surface-2);color:var(--text)">この地点で記録する</button></div>'

    + '<div class="card"><h3>この地点の情報</h3>'
    + '<div class="fr"><label>名前</label></div>'
    + '<div class="fr"><input class="mIn wide" data-k="name" type="text" value="'+esc(sp.name)+'"></div>'
    + '<div class="fr"><label>エリア</label></div>'
    + '<div class="fr"><input class="mIn wide" data-k="area" type="text" value="'+esc(sp.area==="—"?"":sp.area)+'" placeholder="未設定"></div>'
    + '<div class="chips" style="margin:var(--s2) 0">'+CATS.map(function(c){
        return '<button class="chip '+(sp.cat===c[0]?"on":"")+'" data-mcat="'+c[0]+'">'+c[1]+'</button>'; }).join("")+'</div>'
    + '<div class="fr"><label>拠点からの所要</label><input class="mIn" data-k="min" type="number" inputmode="numeric" value="'+(sp.min==null?"":sp.min)+'"><span class="u">分</span></div>'
    + (sp.edited&&!sp.isCustom?'<button class="ghost" data-resetmeta="'+sp.id+'">編集前（マスタの内容）に戻す</button>':'')
    + '</div>'

    + (function(){ var st=D.stairsOf(S,sp.id), L=[["unknown","未確認"],["yes","階段あり"],["no","なし・不可"]];
        return '<div class="card"><h3>階段の有無</h3><div class="chips">'
          + L.map(function(x){ return '<button class="chip '+(st===x[0]?"on":"")+'" data-stairs="'+x[0]+'">'+x[1]+'</button>'; }).join("")
          + '</div><div class="note" style="margin-bottom:0">現地でしか分からない情報です。'
          + '「なし・不可」にした地点は探索の候補から外れます。</div></div>'; })()

    + '<div class="card"><h3>この施設に一括適用</h3>'
    + '<div class="fr"><label>蹴上げ（1段）</label><input class="sIn" data-k="rise" type="number" inputmode="decimal" value="'
    + (o.rise?Math.round(o.rise*1000):"")+'" placeholder="'+Math.round(S.baseRise*1000)+'"><span class="u">mm</span></div>'
    + '<div class="fr"><label>階高（1層）</label><input class="sIn" data-k="floorH" type="number" inputmode="decimal" value="'
    + (o.floorH||"")+'" placeholder="'+r1(f.v)+'"><span class="u">m</span></div>'
    + '<div class="note">空欄なら上位の基準値が使われます。</div></div>'

    + '<div class="card"><h3>区間ごとの計測</h3>'
    + sp.segs.map(function(g){
        var so=D.segOv(S,sp.id,g.id), r=D.resolve(S,sp,g), br=D.backRise(S,sp,g);
        return '<div style="border:var(--hair) solid var(--hairline);border-radius:var(--r-sm);padding:var(--s3);margin-bottom:var(--s2)">'
          + '<div style="display:flex;align-items:center;gap:8px"><span style="flex:1;font-size:var(--f-sm);font-weight:600">'+esc(g.label)
          + (g.added?' <span class="cf c-meas">追加</span>':'')+'</span>'
          + '<span class="cf '+r.cls+'">'+r.conf+'</span><span class="num" style="font-weight:700">'+fmt(r.m)+'m</span></div>'
          + (function(){ var v=D.segVisits(S,sp.id)[g.id]||0;
              return v? '<div class="sb num" style="font-size:var(--f-2xs);color:var(--muted);margin-top:5px">この区間 '+v+'回</div>':''; })()
          + '<div class="segops">'
          + (g.added
              ? '<button data-rmsegx="'+g.id+'">この区間を削除</button>'
              : '<button data-hideseg="'+g.id+'">この区間を隠す</button>')
          + '</div>'
          + '<div class="tri"><div><span>段数</span><input class="gIn" data-g="'+g.id+'" data-k="steps" type="number" inputmode="numeric" value="'+(so.steps||"")+'" placeholder="—"></div>'
          + '<div><span>蹴上げ mm</span><input class="gIn" data-g="'+g.id+'" data-k="rise" type="number" inputmode="decimal" value="'+(so.rise?Math.round(so.rise*1000):"")+'" placeholder="—"></div>'
          + '<div><span>高さ m</span><input class="gIn" data-g="'+g.id+'" data-k="height" type="number" inputmode="decimal" value="'+(so.height||"")+'" placeholder="—"></div></div>'
          + (br?'<div class="hint">逆算 → 蹴上げ '+Math.round(br*1000)+'mm'
            + '<button data-base="'+Math.round(br*1000)+'">これを基準値にする</button></div>':'')
          + '</div>'; }).join("")
    + segAdder(sp)
    + '<button class="ghost" data-clear="'+sp.id+'">計測した値をすべて消す</button></div>'

    + '<div class="card"><h3>使わないとき</h3>'
    + (D.isHidden(S,sp.id)
        ? '<div class="note">いまは一覧に出ていません。過去の記録は残っています。</div>'
          + '<button class="ghost" data-show="'+sp.id+'">一覧に戻す</button>'
        : '<div class="note">一覧から隠します。過去の記録と計測した値は残るので、あとで戻せます。</div>'
          + '<button class="ghost" data-hide="'+sp.id+'">この地点を隠す</button>')
    + (sp.isCustom?'<div class="note" style="margin-top:var(--s4)">自分で追加した地点は完全に削除できます。計測した値も消えます。</div>'
        +'<button class="ghost" data-delspot="'+sp.id+'" style="border-color:var(--danger);color:var(--danger)">この地点を完全に削除</button>':'')
    + '</div>';
}

function segAdder(sp){
  var o=D.ov(S,sp.id), hidden=Object.keys(o.segHide||{});
  var base=(window.SEED||[]).concat(S.customSpots||[]).filter(function(x){return x.id===sp.id;})[0];
  var d=ui.segDraft||{label:"",layers:"",steps:"",rise:"",height:""};
  var v={steps:num(d.steps),rise:num(d.rise),height:num(d.height),layers:num(d.layers)};
  var der=D.derive(v), warn=D.checkSeg(v);
  var f=D.floorHFor(S,sp);
  var h = num(d.height) || (num(d.steps)&&num(d.rise)? num(d.steps)*num(d.rise)/1000 : 0)
        || (num(d.layers)? num(d.layers)*f.v : 0);
  return (hidden.length? '<div class="note">隠している区間：'
      + hidden.map(function(id){
          var g=(base&&base.segs||[]).filter(function(x){return x.id===id;})[0];
          return '<button class="chip" data-showseg="'+id+'" style="margin:3px 4px 0 0">'
            + esc(g?g.label:id)+' を戻す</button>'; }).join("")+'</div>' : '')
    + '<div class="segadd"><div class="edh">区間を追加</div>'
    + '<div class="fr"><input class="aIn wide" data-k="label" type="text" value="'+esc(d.label)+'" placeholder="例：1F→17F"></div>'
    + '<div class="fr"><label>層数</label><input class="aIn" data-k="layers" type="number" inputmode="numeric" value="'+esc(d.layers)+'"><span class="u">層</span></div>'
    + '<div class="tri"><div><span>段数</span><input class="aIn'+(der.steps?" auto":"")+'" data-k="steps" type="number" inputmode="numeric" value="'+(d.steps||der.steps||"")+'"></div>'
    + '<div><span>蹴上げ mm</span><input class="aIn'+(der.rise?" auto":"")+'" data-k="rise" type="number" inputmode="decimal" value="'+(d.rise||der.rise||"")+'"></div>'
    + '<div><span>高さ m</span><input class="aIn'+(der.height?" auto":"")+'" data-k="height" type="number" inputmode="decimal" value="'+(d.height||der.height||"")+'"></div></div>'
    + warn.map(function(x){
        if(x.lv==="conflict") return '<div class="warn conflict">'+esc(x.msg)
          + '<div class="pick"><button data-act="segfixA" data-h="'+x.a.height+'">'+esc(x.a.label)+'</button>'
          + '<button data-act="segfixB" data-h="'+x.b.height+'">'+esc(x.b.label)+'</button></div></div>';
        return '<div class="warn">'+esc(x.msg)+'</div>'; }).join("")
    + '<div class="fr" style="margin-top:var(--s2)"><label>この区間の高さ</label>'
    + '<span class="num" style="font-weight:700">'+fmt(h)+' m</span></div>'
    + (!num(d.height)&&!(num(d.steps)&&num(d.rise))&&num(d.layers)
        ? '<div class="note" style="margin:6px 0 0">高さも段数も無いので、層数 × 階高 '+r1(f.v)+'m で仮置きします（確度＝推定）。</div>' : '')
    + '<button class="ghost" data-act="addSegNow" '+(h>0?"":"disabled")+'>この区間を追加</button></div>';
}

/* ===== S7 地点の新規追加 ===== */
function blankDraft(){ return {name:"",area:"",cat:"mall",min:"",totalM:"",up:"",down:"",
  segs:[{label:"",layers:"",steps:"",rise:"",height:""}]}; }
function vNewSpot(){
  var d=ui.draft=ui.draft||blankDraft();
  var floors=(num(d.up)||0)+(num(d.down)||0);
  var floorH=(num(d.totalM)&&floors)? r1(num(d.totalM)/floors) : null;
  var segSum=d.segs.reduce(function(a,s){ return a+segHeight(s,floorH); },0);
  var spotWarn=D.checkSpot({floorH:floorH,totalM:num(d.totalM),segSum:segSum||null});

  return '<div class="card"><h3>基本</h3>'
    + '<div class="fr"><label>名前</label></div><div class="fr"><input class="dIn wide" data-k="name" type="text" value="'+esc(d.name)+'" placeholder="例：日吉の丘公園"></div>'
    + '<div class="fr"><label>エリア</label></div><div class="fr"><input class="dIn wide" data-k="area" type="text" value="'+esc(d.area)+'" placeholder="例：日吉"></div>'
    + '<div class="chips" style="margin:var(--s2) 0">'+CATS.map(function(c){
        return '<button class="chip '+(d.cat===c[0]?"on":"")+'" data-dcat="'+c[0]+'">'+c[1]+'</button>'; }).join("")+'</div>'
    + '<div class="fr"><label>拠点からの所要</label><input class="dIn" data-k="min" type="number" inputmode="numeric" value="'+esc(d.min)+'"><span class="u">分</span></div></div>'

    + '<div class="card"><h3>分かっている情報だけ入れてください</h3>'
    + '<div class="fr"><label>建物全体の高さ</label><input class="dIn" data-k="totalM" type="number" inputmode="decimal" value="'+esc(d.totalM)+'"><span class="u">m</span></div>'
    + '<div class="fr"><label>地上階数</label><input class="dIn" data-k="up" type="number" inputmode="numeric" value="'+esc(d.up)+'"><span class="u">階</span></div>'
    + '<div class="fr"><label>地下階数</label><input class="dIn" data-k="down" type="number" inputmode="numeric" value="'+esc(d.down)+'"><span class="u">階</span></div>'
    + (floorH?'<div class="hint">階高 '+floorH+'m（自動）</div>':'')
    + spotWarn.map(function(w){ return '<div class="warn">'+esc(w.msg)+'</div>'; }).join("")+'</div>'

    + d.segs.map(function(s,i){ return segEditor(s,i,floorH); }).join("")
    + '<button class="ghost" data-act="addSeg">＋ 区間を追加</button>'

    + '<div class="card"><div class="fr"><label>区間の合計</label><span class="num" style="font-weight:700">'+fmt(segSum)+' m</span></div>'
    + (num(d.totalM)?'<div class="note">公表 '+d.totalM+'m との差 '+fmt(Math.abs(segSum-num(d.totalM)))+'m</div>':'')
    + '<button class="primary" data-act="saveSpot" '+(d.name.trim()&&segSum>0?"":"disabled")+'>この地点を追加</button></div>';
}
function r1v(n){ return Math.round(n*10)/10; }
function segHeight(s,floorH){
  if(num(s.height)) return num(s.height);
  if(num(s.steps)&&num(s.rise)) return num(s.steps)*num(s.rise)/1000;
  if(num(s.layers)&&floorH) return num(s.layers)*floorH;
  return 0;
}
function segEditor(s,i,floorH){
  var v={steps:num(s.steps),rise:num(s.rise),height:num(s.height),layers:num(s.layers)};
  var der=D.derive(v), w=D.checkSeg(v);
  return '<div class="card"><h3>区間 '+(i+1)+'</h3>'
    + '<div class="fr"><input class="qIn wide" data-i="'+i+'" data-k="label" type="text" value="'+esc(s.label)+'" placeholder="例：1F→9F"></div>'
    + '<div class="fr"><label>層数</label><input class="qIn" data-i="'+i+'" data-k="layers" type="number" inputmode="numeric" value="'+esc(s.layers)+'"><span class="u">層</span></div>'
    + '<div class="tri"><div><span>段数</span><input class="qIn'+(der.steps?" auto":"")+'" data-i="'+i+'" data-k="steps" type="number" inputmode="numeric" value="'+(s.steps||(der.steps||""))+'"></div>'
    + '<div><span>蹴上げ mm</span><input class="qIn'+(der.rise?" auto":"")+'" data-i="'+i+'" data-k="rise" type="number" inputmode="decimal" value="'+(s.rise||(der.rise||""))+'"></div>'
    + '<div><span>高さ m</span><input class="qIn'+(der.height?" auto":"")+'" data-i="'+i+'" data-k="height" type="number" inputmode="decimal" value="'+(s.height||(der.height||""))+'"></div></div>'
    + (Object.keys(der).length?'<div class="hint">薄い欄は自動計算です。上書きすると手入力に変わります。</div>':'')
    + w.map(function(x,j){
        if(x.lv==="conflict") return '<div class="warn conflict">'+esc(x.msg)
          + '<div class="pick"><button data-act="fixseg" data-i="'+i+'" data-h="'+x.a.height+'">'+esc(x.a.label)+'</button>'
          + '<button data-act="fixseg" data-i="'+i+'" data-h="'+x.b.height+'">'+esc(x.b.label)+'</button></div></div>';
        return '<div class="warn">'+esc(x.msg)+'</div>'; }).join("")
    + '<div class="fr" style="margin-top:var(--s2)"><label>この区間の高さ</label>'
    + '<span class="num" style="font-weight:700">'+fmt(segHeight(s,floorH))+' m</span></div>'
    + (i>0?'<button class="ghost" data-rmseg="'+i+'">この区間を削除</button>':'')+'</div>';
}

/* ===== S8 設定 ===== */
function vSettings(){
  return '<div class="card"><h3>体重と基準値</h3>'
    + '<div class="fr"><label>体重</label><input id="w" type="number" inputmode="decimal" value="'+S.weight+'"><span class="u">kg</span></div>'
    + '<div class="note">これから記録する分に使われます。過去の記録は保存時の体重のまま変わりません。</div>'
    + '<div class="fr"><label>基準の蹴上げ</label><input id="bRise" type="number" inputmode="decimal" value="'+Math.round(S.baseRise*1000)+'"><span class="u">mm</span></div>'
    + '<div class="fr"><label>基準の階高</label><input id="bFloor" type="number" inputmode="decimal" value="'+S.baseFloorH+'"><span class="u">m</span></div>'
    + '<div class="note">どこにも個別設定がないときに使われます。新高島駅で蹴上げを1回測ると、未測定の全地点の精度が上がります。</div></div>'

    + '<div class="card"><h3>表示</h3>'
    + '<div class="fr"><label>屋外モード（明るい場所向け）</label>'
    + '<input type="checkbox" id="thm2" '+(S.settings.theme==="light"?"checked":"")+' style="width:20px;height:20px;accent-color:var(--orange)"></div>'
    + '<div class="note">ヘッダーのアイコンからも切り替えられます。</div>'
    + '<div class="fr"><label>「直前と同じ」バーを表示</label>'
    + '<input type="checkbox" id="repBar" '+(S.settings.repeatBar===false?"":"checked")+' style="width:20px;height:20px;accent-color:var(--orange)"></div>'
    + '<div class="note">オフにすると、ホームと探索の下に出るバーが消えます。'
    + 'バーの × を押した場合は、次に開いたときにまた出ます。</div></div>'

    + '<div class="card"><h3>バージョン</h3>'
    + '<div class="vrow"><span>ビルド</span><b class="num">'+BUILD+'</b></div>'
    + '<div class="vrow"><span>データ形式</span><b class="num">v'+(S.schemaVersion||"?")+'</b></div>'
    + '<div class="vrow"><span>キャッシュ</span><b class="num" id="swv">確認中…</b></div>'
    + REQUIRED.map(function(r){
        var okk=false; try{ okk=!!r[1](); }catch(e){}
        return '<div class="vrow"><span>'+r[0]+'</span><b class="'+(okk?"okk":"ng")+'">'
          +(okk?"OK":"古い/未着")+'</b></div>'; }).join("")
    + '<div class="note">「未読込」があると、そのファイルが古いか届いていません。</div>'
    + '<button class="ghost" data-act="hardReload">キャッシュを捨てて読み直す</button></div>'

    + '<div class="card"><h3>バックアップ</h3>'
    + '<div class="note">記録はこの端末の中にしかありません。ブラウザのデータを消すと戻せないので、ときどき書き出してファイルを残してください。現在 '+S.entries.length+'件。</div>'
    + '<div class="mini"><button data-act="expJ">書き出す</button><button data-act="impJ">読み込む</button></div>'
    + '<input id="impF" type="file" accept="application/json,.json" style="display:none"></div>'

    + '<div class="card"><h3>計算について</h3><div class="note">'
    + '消費エネルギー ＝ 体重 × 獲得標高 × 0.01。下りも歩いた場合は ×1.3。<br>'
    + '実測＝自分で測った ／ 確定＝公表値 ／ 導出＝確定値からの計算 ／ 推定＝基準値からの仮置き。'
    + '</div></div>';
}

/* ===== バックアップ ===== */
function exportJSON(){
  D.pruneOver(S);
  var payload={app:"ascent-log",format:1,schemaVersion:S.schemaVersion,exportedAt:new Date().toISOString(),data:S};
  try{
    var url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,1)],{type:"application/json"}));
    var a=document.createElement("a"); a.href=url; a.download="ascent-backup-"+D.today()+".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},1000);
    toast("書き出しました（"+S.entries.length+"件）");
  }catch(e){ toast("書き出しに失敗しました。","error"); }
}
function importJSON(file){
  var fr=new FileReader();
  fr.onerror=function(){ toast("ファイルを読めませんでした。","error"); };
  fr.onload=function(){
    var d;
    try{ var p=JSON.parse(fr.result); d=(p&&p.data)?p.data:p; }
    catch(e){ return toast("JSONとして読めませんでした。","error"); }
    if(!d||!Array.isArray(d.entries)) return toast("記録データが見つかりません。","error");
    if(!confirm("読み込むと現在のデータは置き換わります。\n\n現在 "+S.entries.length+"件 → 読込 "+d.entries.length+"件\n\n直前の状態は自動でバックアップされます。続けますか？")) return;
    try{ localStorage.setItem(KEY+":undo",JSON.stringify(S)); }catch(e){}
    S=Object.assign(S,d); S.over=S.over||{};
    S=window.AscentMigrate.run(d,{seed:window.SEED,baseRise:S.baseRise}).data;
    D.pruneOver(S); save(); ui.spotId=null; ui.editSpot=null; ui.sel={};
    render(); toast(d.entries.length+"件を読み込みました");
  };
  fr.readAsText(file);
}

/* ===== 記録のコミット ===== */
function commit(){
  var sp=D.spotOf(S,ui.spotId); if(!sp) return;
  var picked=sp.segs.filter(function(g){return ui.sel[g.id];});
  var unit=picked.reduce(function(a,g){return a+D.resolve(S,sp,g).m;},0);
  var reps=Number(ui.reps)||0, meters=unit*reps;
  if(meters<=0) return toast("区間と本数を選ぶと記録できます。","error");
  var wk=M.currentWeek(), mBefore=M.weekProgress(S,wk);
  var before=D.lifetime(S), now=Date.now(), segs={}, best=null;
  picked.forEach(function(g){ var c=D.resolve(S,sp,g).conf; segs[g.id]=c;
    if(best===null||D.CONF_RANK[c]>D.CONF_RANK[best]) best=c; });
  var dt=ui.date||D.today();
  var e={id:now,date:dt,createdAt:(dt===D.today()?new Date(now).toISOString():dt+"T12:00:00"),
    createdAtEstimated:(dt!==D.today())||undefined, cond:(ui.rain?{rain:true}:undefined),
    spotId:sp.id,name:sp.name,segIds:picked.map(function(g){return g.id;}),
    unitM:unit,reps:reps,meters:meters,round:ui.round,cat:sp.cat,
    steps:Math.round(D.stepsForSegs(S,sp,picked)*reps),
    weightAtSave:S.weight,kcal:D.kcalRaw(meters,S.weight,ui.round),
    confidence:best?{max:best,segs:segs}:null};
  var wk0=M.currentWeek();
  var snapBefore=D.snapshot(S,M.weekProgress(S,wk0));

  S.entries.unshift(e);
  D.recomputeSummits(S);
  M.ensure(S);
  var fresh=D.syncAchievements(S);
  save();

  var wp=M.weekProgress(S,wk0), byId={};
  wp.items.forEach(function(p){ byId[p.item.id]=p.item; });
  var snapAfter=D.snapshot(S,wp);
  var events=D.buildEvents(snapBefore,snapAfter,{entry:e,missionById:byId});

  events.filter(function(x){return x.type==="MISSION_COMPLETED";}).forEach(function(x){
    S.missionState[x.id]={completedAt:new Date().toISOString()}; });
  if(events.some(function(x){return x.type==="MISSION_COMPLETED";})) save();

  ui.reps=1; ui.date=null; ui.rain=false; ui.screen="home";
  var top=D.topEvent(events);
  if(top&&top.type==="SUMMIT_COMPLETED") ui.summitFx=top.id;
  render();
  presentEvents(events,e);
}

/* 同時に複数起きたときは、優先順位の一番高いものだけを演出する。
   SUMMIT > MISSION > ACHIEVEMENT > ENTRY */
function presentEvents(events,entry){
  var top=D.topEvent(events);
  var missions=events.filter(function(x){return x.type==="MISSION_COMPLETED";});
  var achs=events.filter(function(x){return x.type==="ACHIEVEMENT_UNLOCKED";});
  var extra=[];
  if(missions.length) extra.push("ミッション"+missions.length+"件");
  if(achs.length) extra.push("実績"+achs.length+"件");

  if(!top||top.type==="ENTRY_RECORDED"){
    toast(fmt(entry.meters)+"m 記録しました",null,{label:"取り消す",fn:function(){ undoEntry(entry); }});
    return;
  }
  if(top.type==="SUMMIT_COMPLETED"){
    // 登頂はこのアプリの主役なので、いちばん大きい演出を当てる
    var r=D.RANKS.filter(function(x){return x.id===top.id;})[0]||{};
    ui.fx={kind:"summit", title:top.name, sub:(r.m?r.m.toLocaleString()+" m":"")+(r.note?" ・ "+r.note:""),
           from:events[0].from, to:events[0].to,
           note:extra.length?extra.join(" ・ ")+" 達成":""};
    playFx(); return;
  }
  if(top.type==="MISSION_COMPLETED"){
    ui.fx={kind:"mission", items:missions.map(function(x){return x.item;}).filter(Boolean),
           from:events[0].from,to:events[0].to,
           note:achs.length?("実績「"+achs[0].name+"」も解除"):""};
    playFx(); return;
  }
  if(top.type==="ACHIEVEMENT_UNLOCKED"){
    toast("実績「"+top.name+"」解除","summit");
  }
}
function undoEntry(e){
  S.entries=S.entries.filter(function(x){return x.id!==e.id;});
  D.recomputeSummits(S); M.ensure(S); save(); render(); toast("取り消しました");
}

/* ===== MISSION COMPLETE 演出（560ms・CSSのみ） ===== */
function playFx(){
  var fx=ui.fx; ui.fx=null; if(!fx) return;
  var reduce = (S.settings.reducedMotion==="on") ||
    (window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var el=$("fx"); if(!el) return;
  var summit=(fx.kind==="summit");
  var head, cat, name, more="";
  if(summit){ head="SUMMIT"; cat=fx.sub||""; name=fx.title; }
  else { var it=fx.items[0], n=fx.items.length-1;
    head="MISSION COMPLETE"; cat=esc(it.catLabel); name=it.title;
    if(n>0) more='<div class="more">ほか '+n+' 件 達成</div>'; }
  el.innerHTML='<div class="fxin'+(summit?" sm":"")+'"><div class="ring"></div>'
    + '<svg class="peak prof" width="92" height="62" viewBox="0 0 92 62" aria-hidden="true">'
    + '<path d="M2 58 L26 34 L38 42 L52 12 L68 40 L78 32 L90 58 Z" fill="none" stroke="var(--cyan)" stroke-width="2" stroke-linejoin="round"/>'
    + '<path d="M52 12 L45 21 L49 19 L52 22 L56 18 L60 22 Z" fill="var(--text)"/>'
    + '<path d="M52 12 v-11" stroke="var(--text)" stroke-width="2"/>'
    + '<path d="M53 1 h16 l-5 4.5 5 4.5 h-16 z" fill="var(--orange)"/></svg>'
    + '<div class="ttl">'+head+'</div>'
    + '<div class="cat">'+esc(cat)+'</div>'
    + '<div class="nm">'+esc(name)+'</div>'
    + more
    + (fx.note?'<div class="more">'+esc(fx.note)+'</div>':'')
    + '<div class="alt num"><span id="fxn">'+fmt(fx.from)+'</span> m</div></div>';
  el.className=reduce?"show reduce":"show";
  if(!reduce){
    var t0=performance.now(), dur=260;
    var tick=function(t){
      var p=Math.min(1,(t-t0)/dur), v=fx.from+(fx.to-fx.from)*p;
      var n=$("fxn"); if(n) n.textContent=fmt(v);
      if(p<1) requestAnimationFrame(tick);
    };
    setTimeout(function(){ requestAnimationFrame(tick); },200);
  } else { var n=$("fxn"); if(n) n.textContent=fmt(fx.to); }
  clearTimeout(fxT);
  fxT=setTimeout(function(){ el.className=""; }, reduce?900:1500);
  el.onclick=function(){ clearTimeout(fxT); el.className=""; };
}
var fxT;

/* いま実際に使われているキャッシュ名を出す。混在の切り分けに使う。 */
function showCacheName(){
  var el=$("swv"); if(!el) return;
  if(!window.caches){ el.textContent="非対応"; return; }
  caches.keys().then(function(ks){ el.textContent=ks.length?ks.join(", "):"なし"; })
    .catch(function(){ el.textContent="不明"; });
}
/* 古いファイルが混ざったときの脱出口。データは消さない。 */
function hardReload(){
  if(!confirm("保存されたファイルを捨てて、最新を取り直します。\n記録は消えません。続けますか？")) return;
  var done=function(){ location.reload(); };
  var jobs=[];
  if(window.caches) jobs.push(caches.keys().then(function(ks){
    return Promise.all(ks.map(function(k){ return caches.delete(k); })); }));
  if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations)
    jobs.push(navigator.serviceWorker.getRegistrations().then(function(rs){
      return Promise.all(rs.map(function(r){ return r.unregister(); })); }));
  Promise.all(jobs).then(done,done);
  setTimeout(done,2500);
}

/* ===== イベント =====
   クリックは画面全体で1回だけ受ける（イベント委譲）。
   描画のたびにボタンへ個別に付け直す方式だと、途中で1つエラーが出た時点で
   それ以降のボタンが全部無反応になるため。 */
function closestData(el,key){
  while(el&&el!==document.body){
    if(el.getAttribute&&el.getAttribute(key)!=null) return el;
    el=el.parentNode;
  }
  return null;
}
var ACTIONS={
  go:function(v){ ui.screen=v; if(v==="newspot") ui.draft=blankDraft();
    try{window.scrollTo(0,0);}catch(e){} render(); },
  pick:function(v){ var sp=D.spotOf(S,v); if(!sp) return;
    ui.spotId=sp.id; ui.sel={}; sp.segs.forEach(function(g){ui.sel[g.id]=true;});
    ui.reps=1; ui.screen="record"; try{window.scrollTo(0,0);}catch(e){} render(); },
  spot:function(v){ ui.editSpot=v; ui.screen="spot"; try{window.scrollTo(0,0);}catch(e){} render(); },
  cat:function(v){ ui.cat=v; render(); },
  per:function(v){ ui.period=Number(v); render(); },
  del:function(v){ S.entries=S.entries.filter(function(x){ return String(x.id)!==v; });
    D.recomputeSummits(S); M.ensure(S); save(); render(); },
  base:function(v){ S.baseRise=Number(v)/1000; save(); render();
    toast("基準の蹴上げを "+v+"mm にしました"); },
  clear:function(v){ delete S.over[v]; save(); render(); toast("設定を消しました"); },
  hide:function(v){ D.ovW(S,v).hidden=true; save(); ui.screen="spots"; render();
    toast("一覧から隠しました",null,{label:"取り消す",fn:function(){
      if(S.over[v]) delete S.over[v].hidden; D.pruneOver(S); save(); render(); }}); },
  show:function(v){ if(S.over[v]) delete S.over[v].hidden; D.pruneOver(S); save(); render();
    toast("一覧に戻しました"); },
  delspot:function(v){
    if(!confirm("この地点を完全に削除します。計測した値も消えます。\n過去の記録は残ります。続けますか？")) return;
    S.customSpots=S.customSpots.filter(function(s){ return s.id!==v; });
    delete S.over[v]; save(); ui.screen="spots"; ui.cat="mall"; render(); toast("削除しました"); },
  mcat:function(v){ D.setMeta(S,ui.editSpot,"cat",v); save(); render(); toast("保存しました"); },
  resetmeta:function(v){ D.resetMeta(S,v); D.pruneOver(S); save(); render(); toast("元に戻しました"); },
  dcat:function(v){ ui.draft.cat=v; render(); },
  bper:function(v){ ui.bodyPeriod=Number(v); render(); },
  eper:function(v){ ui.ePeriod=Number(v); render(); },
  metric:function(v){ ui.metric=v; render(); },
  breakby:function(v){ ui.breakBy=v; render(); },
  cfil:function(v){ ui.cFilter=v; render(); },
  fcv:function(v){ ui.fcView=v; render(); },
  sv:function(v){ ui.sView=v; try{window.scrollTo(0,0);}catch(e){} render(); },
  pacebase:function(v){ ui.paceBase=v; if(v!=="manual") ui.pace=null; render(); },
  delm:function(v){ D.removeMeasure(S,v); save(); render(); toast("削除しました"); },
  stairs:function(v){ D.setStairs(S,ui.editSpot,v); D.pruneOver(S); save(); render(); toast("保存しました"); },
  mid:function(v){ ui.missionId=v; ui.screen="mdetail"; try{window.scrollTo(0,0);}catch(e){} render(); },
  rmsegx:function(v){ if(!confirm("この区間を削除します。よろしいですか？")) return;
    D.removeSeg(S,ui.editSpot,v); D.pruneOver(S); save(); render(); toast("削除しました"); },
  hideseg:function(v){ D.hideSeg(S,ui.editSpot,v,true); save(); render();
    toast("区間を隠しました",null,{label:"戻す",fn:function(){
      D.hideSeg(S,ui.editSpot,v,false); D.pruneOver(S); save(); render(); }}); },
  showseg:function(v){ D.hideSeg(S,ui.editSpot,v,false); D.pruneOver(S); save(); render(); toast("戻しました"); },
  edit:function(v){ ui.editEntry=v; ui.eDate=null; ui.eReps=null; ui.eRound=null; ui.eRain=null;
    ui.screen="edit"; try{window.scrollTo(0,0);}catch(e){} render(); },
  rmseg:function(v){ ui.draft.segs.splice(Number(v),1); render(); },
  act:function(v,el){ (ACTS[v]||function(){})(el); }
};
var ACTS={
  again:repeatLast,
  hideRep:function(){ ui.hideRepeat=true; render();
    toast("バーを隠しました",null,{label:"元に戻す",fn:function(){ ui.hideRepeat=false; render(); }}); },
  theme:toggleTheme,
  selAll:function(){ var sp=D.spotOf(S,ui.spotId); if(sp){ sp.segs.forEach(function(g){ui.sel[g.id]=true;}); render(); } },
  selFree:function(){ var sp=D.spotOf(S,ui.spotId); if(sp){ sp.segs.forEach(function(g){ui.sel[g.id]=!g.paid;}); render(); } },
  selNone:function(){ ui.sel={}; render(); },
  minus:function(){ ui.reps=Math.max(1,Number(ui.reps)-1); render(); },
  plus:function(){ ui.reps=Number(ui.reps)+1; render(); },
  commit:commit,
  addSeg:function(){ ui.draft.segs.push({label:"",layers:"",steps:"",rise:"",height:""}); render(); },
  saveSpot:saveSpot,
  recapSeen:function(){ var k=ui.recapWeek||M.prevWeek(M.currentWeek());
    S.recaps=S.recaps||{}; S.recaps[k]={seen:true,at:new Date().toISOString()};
    save(); ui.screen="home"; render(); },
  expJ:exportJSON,
  impJ:function(){ var f=$("impF"); if(f) f.click(); },
  hardReload:hardReload,
  today:function(){ ui.date=D.today(); render(); },
  eMinus:function(){ var e=curEntry(); if(e) ui.eReps=Math.max(1,Number(ui.eReps||e.reps)-1); render(); },
  ePlus:function(){ var e=curEntry(); if(e) ui.eReps=Number(ui.eReps||e.reps)+1; render(); },
  saveEdit:saveEdit,
  saveMeasure:saveMeasure,
  addSegNow:addSegNow,
  showAllM:function(){ ui.mAll=true; render(); },
  segfixA:function(el){ ui.segDraft=ui.segDraft||{}; ui.segDraft.height=el.getAttribute("data-h");
    ui.segDraft.steps=""; render(); },
  segfixB:function(el){ ui.segDraft=ui.segDraft||{}; ui.segDraft.height=el.getAttribute("data-h"); render(); },
  shareMission:function(){ var k=M.currentWeek(), wp=M.weekProgress(S,k);
    var p=wp.items.filter(function(x){return x.item.id===ui.missionId;})[0]; if(!p) return;
    copyText("VERTEX 今週の遠征 "+M.weekLabel(k)+"\n"
      +p.item.catLabel+" "+p.item.title+"\n"
      +(p.item.unit==="m"?fmt(p.current):Math.round(p.current))+" / "+p.item.target+p.item.unit
      +(p.done?" 達成":"")); },
  shareRecap:function(){ var k=ui.recapWeek||M.prevWeek(M.currentWeek()), w=M.weekSummary(S,k);
    var wp=M.weekProgress(S,k), t=D.lifetime(S), tier=D.tierOf(t);
    copyText("VERTEX WEEKLY EXPEDITION "+M.weekLabel(k)+"\n"
      +"獲得標高 "+fmt(w.m)+"m ／ "+w.days+"日 ／ "+w.spots+"ヶ所\n"
      +"ミッション "+wp.done+"/"+wp.total+"\n"
      +"現在地 "+tier.tier.name+" "+fmt(t)+" / "+tier.tier.m+"m"); },
  fixseg:function(el){ var s=ui.draft.segs[Number(el.getAttribute("data-i"))];
    s.height=el.getAttribute("data-h"); render(); }
};
var KEYS=["go","pick","spot","cat","per","bper","eper","metric","breakby","cfil","fcv","sv","pacebase","del","delm",
          "edit","mid","base","clear","hide","show","delspot","mcat","resetmeta","dcat","stairs",
          "rmseg","rmsegx","hideseg","showseg","act"];
function onTap(ev){
  for(var i=0;i<KEYS.length;i++){
    var el=closestData(ev.target,"data-"+KEYS[i]);
    if(el){ ev.preventDefault();
      try{ ACTIONS[KEYS[i]](el.getAttribute("data-"+KEYS[i]),el); }
      catch(e){ showError(e); }
      return; }
  }
}
var wired=false;
function wireOnce(){
  if(wired) return; wired=true;
  document.addEventListener("click",onTap,false);
  window.addEventListener("error",function(e){ showError(e.error||e.message); });
}
/* 起動時にファイルの欠落・世代ずれを検出して名指しする。
   ブラウザからのアップロードは一部だけ落ちることがあるため。 */
var REQUIRED=[
  ["seed.js",        function(){ return window.SEED && window.SEED.length; }],
  ["data.migrate.js",function(){ return window.AscentMigrate && AscentMigrate.TARGET>=4; }],
  ["domain.js",      function(){ return window.D && D.buildEvents && D.mountainTable; }],
  ["domain.missions.js",function(){ return window.M && M.ensure && M.GENERATOR_VERSION; }],
  ["view.mountain.js",function(){ return window.Mountain && Mountain.render && Mountain.profile; }]
];
function checkModules(){
  var bad=[];
  REQUIRED.forEach(function(r){
    var okk=false; try{ okk=!!r[1](); }catch(e){}
    if(!okk) bad.push(r[0]);
  });
  if(bad.length){
    var b=$("err"); if(b){
      b.innerHTML="<b>"+bad.join(" / ")+"</b> が古いか、アップロードされていません。<br>"
        +"GitHubに上げ直してから、設定 → キャッシュを捨てて読み直す をお試しください。";
      b.className="show";
    }
  }
  return bad;
}
function showError(e){
  var b=$("err"); if(!b) return;
  b.textContent="エラー: "+(e&&e.message?e.message:String(e))+"（設定 → キャッシュを捨てて読み直す をお試しください）";
  b.className="show";
}

/* 入力欄など、個別に付ける必要があるものだけをここで結ぶ */
function bind(){
  try{
    var pf=$("prof");
    if(pf&&window.Mountain&&Mountain.flagX)
      pf.scrollLeft=Math.max(0,Mountain.flagX(D.lifetime(S))-pf.clientWidth*0.45);
    var dz=$("dayscroll"); if(dz) dz.scrollLeft=dz.scrollWidth;
  }catch(e){ showError(e); }

  try{
    qa("[data-seg]").forEach(function(b){ b.onchange=function(){ ui.sel[b.dataset.seg]=b.checked; render(); }; });
    if($("reps")) $("reps").onchange=function(e){ ui.reps=Math.max(1,Number(e.target.value)||1); render(); };
    if($("rt")) $("rt").onchange=function(e){ ui.round=e.target.checked; render(); };
    if($("rain")) $("rain").onchange=function(e){ ui.rain=e.target.checked; render(); };
    if($("recDate")) $("recDate").onchange=function(e){
      var v=e.target.value; ui.date=(v&&v<=D.today())?v:D.today(); render(); };
    if($("eDate")) $("eDate").onchange=function(e){ ui.eDate=e.target.value||null; render(); };
    if($("eReps")) $("eReps").onchange=function(e){ ui.eReps=Math.max(1,Number(e.target.value)||1); render(); };
    if($("eRound")) $("eRound").onchange=function(e){ ui.eRound=e.target.checked; render(); };
    if($("eRain")) $("eRain").onchange=function(e){ ui.eRain=e.target.checked; render(); };
    if($("mDate")) $("mDate").onchange=function(e){ ui.mDate=e.target.value||D.today(); };
    if($("paceRange")){
      var pr=$("paceRange"), raf=0;
      /* ドラッグ中に render() すると input 自体が作り直されてドラッグが切れる。
         数値ラベルと結果ブロックだけを差し替える。 */
      var live=function(){
        raf=0;
        var lab=$("paceVal");
        if(lab) lab.innerHTML=Number(ui.pace).toLocaleString()+'<i>m / 週</i>';
        var out=$("fcOut");
        if(out){ try{ out.innerHTML=forecastOut(); }catch(e){ showError(e); } }
      };
      pr.oninput=function(e){
        ui.pace=Number(e.target.value); ui.paceBase="manual";
        if(!raf) raf=requestAnimationFrame(live);
      };
      /* 離したときだけ全体を描き直し、プリセットの選択状態を「手動」に合わせる */
      pr.onchange=function(e){ ui.pace=Number(e.target.value); ui.paceBase="manual"; render(); };
    }

    if($("w")) $("w").onchange=function(e){ S.weight=Number(e.target.value)||60; save(); render(); };
    if($("bRise")) $("bRise").onchange=function(e){ var v=num(e.target.value); if(v)S.baseRise=v/1000; save(); render(); };
    if($("bFloor")) $("bFloor").onchange=function(e){ var v=num(e.target.value); if(v)S.baseFloorH=v; save(); render(); };
    if($("thm2")) $("thm2").onchange=toggleTheme;
    if($("repBar")) $("repBar").onchange=function(e){
      S.settings.repeatBar=e.target.checked; ui.hideRepeat=false; save(); render(); };
    if($("swv")) showCacheName();

    qa(".sIn").forEach(function(i){ i.onchange=function(e){
      var o=D.ovW(S,ui.editSpot), k=i.dataset.k, v=num(e.target.value);
      if(v==null) delete o[k]; else o[k]=(k==="rise")?v/1000:v;
      D.pruneOver(S); save(); render(); toast("保存しました"); }; });
    qa(".gIn").forEach(function(i){ i.onchange=function(e){
      var so=D.segOvW(S,ui.editSpot,i.dataset.g), k=i.dataset.k, v=num(e.target.value);
      if(v==null) delete so[k]; else so[k]=(k==="rise")?v/1000:v;
      D.pruneOver(S); save(); render(); toast("保存しました"); }; });
    qa(".mIn").forEach(function(i){ i.onchange=function(e){
      var k=i.dataset.k, v=e.target.value.trim();
      D.setMeta(S,ui.editSpot,k,(k==="min")?(num(v)||null):(v||null));
      D.pruneOver(S); save(); render(); toast("保存しました"); }; });
    qa(".dIn").forEach(function(i){ i.onchange=function(e){ ui.draft[i.dataset.k]=e.target.value; render(); }; });
    qa(".aIn").forEach(function(i){ i.onchange=function(e){
      ui.segDraft=ui.segDraft||{label:"",layers:"",steps:"",rise:"",height:""};
      ui.segDraft[i.dataset.k]=e.target.value; render(); }; });
    qa(".qIn").forEach(function(i){ i.onchange=function(e){
      ui.draft.segs[Number(i.dataset.i)][i.dataset.k]=e.target.value; render(); }; });
    if($("impF")) $("impF").onchange=function(e){
      var f=e.target.files&&e.target.files[0]; if(f) importJSON(f); e.target.value=""; };
  }catch(e){ showError(e); }
}

/* 区間を追加する。高さが決まらないものは追加しない。 */
function addSegNow(){
  var sp=D.spotOf(S,ui.editSpot); if(!sp) return;
  var d=ui.segDraft||{};
  var st=num(d.steps), ri=num(d.rise), he=num(d.height), la=num(d.layers);
  var f=D.floorHFor(S,sp);
  var h=he || (st&&ri? st*ri/1000 : 0) || (la? la*f.v : 0);
  if(!(h>0)) return toast("高さが決まりません。段数と蹴上げ、高さ、層数のいずれかを入れてください。","error");
  var known=!!(he||(st&&ri));
  var g=D.addSeg(S,sp.id,{label:(d.label||"").trim(),layers:la||1,
    height:h, src:known?"confirmed":"estimate"});
  if(!known){ var o=D.ovW(S,sp.id);
    o.extraSegs[o.extraSegs.length-1].src="estimate"; }
  if(st) D.segOvW(S,sp.id,g.id).steps=st;
  if(ri) D.segOvW(S,sp.id,g.id).rise=ri/1000;
  D.pruneOver(S); save(); ui.segDraft=null; render();
  toast("「"+g.label+"」を追加しました");
}
function copyText(t){
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(t).then(function(){ toast("コピーしました"); },
        function(){ fallbackCopy(t); });
    } else fallbackCopy(t);
  }catch(e){ fallbackCopy(t); }
}
function fallbackCopy(t){
  try{
    var ta=document.createElement("textarea");
    ta.value=t; ta.style.position="fixed"; ta.style.opacity="0";
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    toast("コピーしました");
  }catch(e){ toast("コピーできませんでした。","error"); }
}
function curEntry(){
  return S.entries.filter(function(x){ return String(x.id)===String(ui.editEntry); })[0];
}
function saveEdit(){
  var e=curEntry(); if(!e) return;
  var d=ui.eDate||e.date;
  if(d>D.today()) return toast("未来の日付は記録できません。","error");
  e.date=d;
  e.reps=Number(ui.eReps||e.reps);
  e.round=(ui.eRound==null?e.round:ui.eRound);
  var rain=(ui.eRain==null?(e.cond&&e.cond.rain):ui.eRain);
  e.cond=rain?{rain:true}:undefined;
  e.meters=e.unitM*e.reps;
  var w=e.weightAtSave||S.weight;
  e.kcal=D.kcalRaw(e.meters,w,e.round);
  if(e.steps!=null&&e.unitM>0) e.steps=Math.round(e.steps/ (e.meters/e.unitM===0?1:1) );
  var sp=D.spotOf(S,e.spotId);
  if(sp){ var gs=sp.segs.filter(function(g){ return (e.segIds||[]).indexOf(g.id)>=0; });
    if(gs.length) e.steps=Math.round(D.stepsForSegs(S,sp,gs)*e.reps); }
  S.entries.sort(function(a,b){ return b.id-a.id; });
  D.recomputeSummits(S); M.ensure(S); D.syncAchievements(S); save();
  ui.screen="history"; render(); toast("更新しました");
}
function saveMeasure(){
  var d=($("mDate")&&$("mDate").value)||D.today();
  var w=num($("mW")&&$("mW").value), a=num($("mA")&&$("mA").value);
  if(w==null&&a==null) return toast("体重かウエストを入れてください。","error");
  if(w!=null&&(w<20||w>300)) return toast("体重の値を確認してください。","error");
  if(a!=null&&(a<30||a>250)) return toast("ウエストの値を確認してください。","error");
  D.addMeasure(S,d,w,a); save(); ui.mDate=null; render(); toast("記録しました");
}
function toggleTheme(){
  S.settings.theme=(S.settings.theme==="light")?"dark":"light"; save(); render();
}
function repeatLast(){
  var e=S.entries[0]; if(!e) return;
  var sp=D.spotOf(S,e.spotId); if(!sp) return toast("この地点は見つかりません。","error");
  ui.spotId=sp.id; ui.sel={}; (e.segIds||[]).forEach(function(id){ ui.sel[id]=true; });
  ui.reps=e.reps; ui.round=e.round; commit();
}
function saveSpot(){
  var d=ui.draft;
  var floors=(num(d.up)||0)+(num(d.down)||0);
  var floorH=(num(d.totalM)&&floors)? num(d.totalM)/floors : null;
  var segs=d.segs.map(function(s,i){
    var h=segHeight(s,floorH);
    return { id:"g"+(i+1), label:s.label.trim()||("区間"+(i+1)),
             layers:num(s.layers)||1, height:h>0?Math.round(h*100)/100:undefined,
             src:num(s.height)||(num(s.steps)&&num(s.rise))?"confirmed":"estimate" };
  }).filter(function(s){ return s.height>0; });
  if(!segs.length) return toast("区間の高さが決まりません。","error");
  var sp={ id:"custom_"+Date.now(), name:d.name.trim(), cat:d.cat, area:d.area.trim()||"—",
    min:num(d.min), totalM:num(d.totalM), totalSrc:num(d.totalM)?"confirmed":null,
    floorH:floorH?Math.round(floorH*100)/100:null, floorHSrc:floorH?"derived":null,
    totalSteps:null, note:"", segs:segs, isCustom:true };
  S.customSpots.push(sp); save();
  ui.draft=null; ui.editSpot=sp.id; ui.screen="spot"; window.scrollTo(0,0); render();
  toast("「"+sp.name+"」を追加しました");
}

wireOnce(); load(); render(); checkModules();
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function(){});
