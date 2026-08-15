/* app.js — 状態・描画・イベント。計算は domain.js に委ねる。 */
"use strict";
var KEY="ascent:v2";
var CATS=[["daily","日常"],["mall","商業・駅ビル"],["station","駅"],["boss","山・タワー"]];
var PERIODS=[[30,"30日"],[60,"60日"],[90,"90日"],[180,"180日"],[0,"全期間"]];

var S={schemaVersion:4,entries:[],weight:60,baseRise:0.18,baseFloorH:4.0,over:{},
  customSpots:[],missions:{},missionState:{},summits:{},measurements:[],recaps:{},
  settings:{fatKcalPerKg:7200,theme:"dark"}};

var ui={screen:"home",tab:"home",cat:"mall",spotId:null,sel:{},reps:1,round:true,
  editSpot:null,period:30,draft:null,summitFx:null,undo:null};

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
  S=res.data; S.over=S.over||{}; D.pruneOver(S);
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
  else if(ui.screen==="stats") body=vStats();
  else if(ui.screen==="history") body=vHistory();
  else if(ui.screen==="spots") body=vSpots();
  else if(ui.screen==="spot") body=vSpotDetail();
  else if(ui.screen==="newspot") body=vNewSpot();
  else if(ui.screen==="settings") body=vSettings();
  $("app").innerHTML=header()+body;
  $("bars").innerHTML=(ui.screen==="home"?repeatBar():"")+tabs();
  bind();
}

function header(){
  var back={record:"home",spot:"spots",newspot:"spots",settings:"home",spots:"home"}[ui.screen];
  var title={home:"VERTEX",record:"記録する",stats:"分析",history:"履歴",
    spots:"地点",spot:"地点の計測",newspot:"地点を追加",settings:"設定"}[ui.screen];
  return '<div class="hd">'
    + (back?'<button class="ico" data-go="'+back+'" aria-label="戻る">'+icon("back")+'</button>':"")
    + '<div class="brand">'+esc(title)+(ui.screen==="home"?'<small>都市を、登れ。</small>':"")+'</div>'
    + '<button class="ico" id="thm" aria-label="表示を切り替える">'+icon(S.settings.theme==="light"?"moon":"sun")+'</button>'
    + (ui.screen==="home"?'<button class="ico" data-go="spots" aria-label="地点">'+icon("map")+'</button>'
       +'<button class="ico" data-go="settings" aria-label="設定">'+icon("gear")+'</button>':"")
    + '</div>';
}
function tabs(){
  var T=[["home","ホーム","home"],["stats","分析","chart"],["history","履歴","history"]];
  return '<nav class="tabs">'+T.map(function(t){
    return '<button data-go="'+t[0]+'" class="'+(ui.screen===t[0]?"on":"")+'">'
      +icon(t[2])+'<span>'+t[1]+'</span></button>'; }).join("")+'</nav>';
}
function repeatBar(){
  var e=S.entries[0]; if(!e) return "";
  return '<div class="repeat"><button id="again">'+icon("repeat")
    +'<span class="t"><b>直前と同じ</b><span>'+esc(e.name)+' · '+fmt(e.unitM)+'m × '+e.reps+'</span></span>'
    +'<span class="v num">'+fmt(e.meters)+'m</span></button></div>';
}

/* ===== S1 ホーム ===== */
function vHome(){
  var t=D.lifetime(S), k=D.tierOf(t);
  var fx=ui.summitFx; ui.summitFx=null;
  var ex=D.exploration(S);
  var freq={}; S.entries.slice(0,60).forEach(function(e){ if(e.spotId) freq[e.spotId]=(freq[e.spotId]||0)+1; });
  var top=Object.keys(freq).sort(function(a,b){return freq[b]-freq[a];}).slice(0,4)
    .map(function(id){return D.spotOf(S,id);}).filter(Boolean);
  var cards=top.length?top:ex.next;

  return '<div class="hero">'
    + Mountain.render(k.tier.id,k.inTier,{label:k.tier.name,snap:!!fx,summit:!!fx})
    + '<div class="cap"><div class="tier">'+(k.done?"ALL CLEAR":esc(k.tier.name))+'</div>'
    + '<div class="big num">'+fmt(t)+'<i>m</i></div>'
    + '<div class="sub">'+(k.remain>0
        ? '次の <b>'+esc(k.tier.name)+'</b> まで あと '+fmt(k.remain)+'m'
        : '全6座を制覇。ここから先は自分で目標を置く領域です。')+'</div></div></div>'
    + '<div class="ladder">'+D.RANKS.map(function(r,i){
        var done=t>=r.m, prev=D.BOUNDS[i], w=done?100:Math.max(0,Math.min(100,(t-prev)/(r.m-prev)*100));
        return '<div class="sg '+(done?"done":"")+'"><i style="width:'+w+'%"></i></div>'; }).join("")
    + '</div><div class="ladderL"><span>制覇 '+k.cleared+'/6</span><span>探索 '+ex.done+'/'+ex.total+'</span></div>'

    + '<div class="card"><h3>よく行く場所</h3><div class="grid">'
    + cards.map(function(s){ return spotCard(s,ex.visited); }).join("")
    + '</div><button class="ghost" data-go="spots">＋ 別の場所を選ぶ</button></div>'

    + (ex.next.length?'<div class="card"><h3>まだ登っていない近場</h3>'
      + ex.next.map(function(s){ return '<button class="row" data-pick="'+s.id+'">'
        + '<span class="mk"></span><span class="bd"><span class="nm">'+esc(s.name)+'</span>'
        + '<span class="sb">'+area(s)+(s.min?(area(s)?" · ":"")+"徒歩/電車 "+s.min+"分":"")+'</span></span>'
        + '<span class="vl num">'+fmt(D.spotTotal(S,s))+'<i>m</i></span></button>'; }).join("")
      + '</div>':"");
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

  return '<div class="card"><h3>'+esc(sp.area)+(sp.min?' · '+sp.min+'分':'')+'</h3>'
    + '<div style="font-size:var(--f-lg);font-weight:700">'+esc(sp.name)+'</div>'
    + (sp.note?'<div class="note">'+esc(sp.note)+'</div>':'')+'</div>'
    + '<div class="card"><h3>登った区間</h3>'
    + '<div class="mini"><button id="selAll">全区間</button><button id="selFree">改札外のみ</button>'
    + '<button id="selNone">クリア</button></div>'
    + (sp.segs.length? sp.segs.map(function(g){
        var r=D.resolve(S,sp,g), on=!!ui.sel[g.id];
        return '<label class="seg '+(on?"on":"")+'"><input type="checkbox" data-seg="'+g.id+'" '+(on?"checked":"")+'>'
          + '<span class="l">'+esc(g.label)+(g.paid?'<span class="paid">入場券</span>':'')+'</span>'
          + '<span class="cf '+r.cls+'">'+r.conf+'</span><span class="m num">'+fmt(r.m)+'m</span></label>';
      }).join("") : '<div class="empty">区間が未登録です。</div>')
    + '<div class="fr" style="margin-top:var(--s4)"><label>本数</label>'
    + '<span class="stepper"><button id="minus">−</button>'
    + '<input id="reps" type="number" inputmode="numeric" value="'+ui.reps+'"><button id="plus">＋</button></span></div>'
    + '<div class="fr"><label>下りも歩いた（＋30%）</label>'
    + '<input type="checkbox" id="rt" '+(ui.round?"checked":"")+' style="width:20px;height:20px;accent-color:var(--orange)"></div>'
    + '</div>'
    + '<div class="card" style="text-align:center">'
    + '<div class="big num" style="font-size:var(--f-hero);font-weight:700">'+fmt(add)+'<i style="font-style:normal;font-size:var(--f-lg);color:var(--muted)">m</i></div>'
    + '<div class="note" style="border:none;justify-content:center;padding:0;margin-top:6px">約 '+kc.toLocaleString()+' kcal ・ 約 '+st.toLocaleString()+' 段</div>'
    + '<button class="primary" id="commit" '+(add>0?"":"disabled")+'>記録する</button></div>';
}

/* ===== S3 分析 ===== */
function vStats(){
  var p=ui.period? D.periodStats(S,ui.period) : D.allTimeStats(S);
  var t=D.lifetime(S), k=D.tierOf(t);
  var hm=D.heatmap(S,18), wd=D.weekday(S), mx=Math.max.apply(null,wd)||1;
  var ar=D.areaProgress(S), ac=D.achievements(S), got=ac.filter(function(a){return a.got;}).length;
  var st=D.streak(S);
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

    + '<div class="card"><h3>現在の山</h3>'
    + '<div style="font-size:var(--f-lg);font-weight:700">'+esc(k.tier.name)+'</div>'
    + '<div class="note" style="border:none;padding:0">'+fmt(t)+' / '+k.tier.m.toLocaleString()+' m'
    + (k.remain>0?' — あと '+fmt(k.remain)+'m':' — 制覇')+'</div>'
    + '<div class="pb" style="margin-top:var(--s2)"><i style="width:'+Math.round(k.inTier*100)+'%"></i></div></div>'

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

    + '<div class="card"><h3>エリア制覇</h3>'
    + ar.map(function(a){ return '<div class="bl"><span class="nm">'+esc(a.area)+'</span>'
        + '<span class="pb"><i style="width:'+(a.done/a.total*100)+'%"></i></span>'
        + '<span class="ct num">'+a.done+'/'+a.total+'</span></div>'; }).join("")+'</div>'

    + '<div class="card"><h3>実績 '+got+'/14</h3><div class="ach">'
    + ac.map(function(a){ return '<div class="'+(a.got?"got":"")+'"><b>'+esc(a.name)+'</b><span>'+esc(a.desc)+'</span></div>'; }).join("")
    + '</div></div>';
}

/* ===== S4 履歴 ===== */
function vHistory(){
  if(!S.entries.length) return '<div class="empty">まだ記録がありません。<br>いちばん近い階段から始められます。</div>';
  var byDay={};
  S.entries.forEach(function(e){ (byDay[e.date]=byDay[e.date]||[]).push(e); });
  return Object.keys(byDay).sort().reverse().map(function(dt){
    var list=byDay[dt], sum=list.reduce(function(a,e){return a+e.meters;},0);
    return '<div class="card"><h3>'+dt.slice(5).replace("-","/")+' — '+fmt(sum)+'m</h3>'
      + list.map(function(e){
        return '<div class="row"><span class="mk '+(e.cat==="boss"?"boss":"")+'"></span>'
          + '<span class="bd"><span class="nm">'+esc(e.name)+'</span>'
          + '<span class="sb num">'+fmt(e.unitM)+'m × '+e.reps+(e.round?" · 往復":"")
          + ' · '+D.kcalOf(S,e)+'kcal · '+D.stepsOf(S,e)+'段</span></span>'
          + '<span class="vl num">'+fmt(e.meters)+'<i>m</i></span>'
          + '<button class="x" data-del="'+e.id+'" aria-label="削除">×</button></div>'; }).join("")
      + '</div>'; }).join("");
}

/* ===== S5 地点一覧 ===== */
function vSpots(){
  var ex=D.exploration(S);
  var list=D.allSpots(S).filter(function(s){return s.cat===ui.cat;});
  return '<div class="card"><h3>探索 '+ex.done+' / '+ex.total+'</h3>'
    + '<div class="pb"><i style="width:'+(ex.done/ex.total*100)+'%"></i></div>'
    + '<button class="ghost" data-go="newspot">＋ 新しい地点を追加</button></div>'
    + '<div class="chips" style="margin-top:var(--s3)">'
    + CATS.map(function(c){ return '<button class="chip '+(ui.cat===c[0]?"on":"")+'" data-cat="'+c[0]+'">'+c[1]+'</button>'; }).join("")
    + '</div><div style="margin-top:var(--s3)">'
    + list.map(function(s){
        return '<button class="row" data-spot="'+s.id+'"><span class="mk '+(ex.visited.has(s.id)?"":"boss")+'"></span>'
          + '<span class="bd"><span class="nm">'+esc(s.name)+(s.isCustom?' <span class="cf c-meas">自分で追加</span>':'')+'</span>'
          + '<span class="sb">'+esc(s.area)+' · '+s.segs.length+'区間'+(s.totalM?' · 公表 '+s.totalM+'m':'')+'</span></span>'
          + '<span class="vl num">'+fmt(D.spotTotal(S,s))+'<i>m</i></span></button>'; }).join("")
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
    + '<button class="primary" data-pick="'+sp.id+'" style="background:var(--surface-2);color:var(--text)">この地点で記録する</button></div>'

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
          + '<div style="display:flex;align-items:center;gap:8px"><span style="flex:1;font-size:var(--f-sm);font-weight:600">'+esc(g.label)+'</span>'
          + '<span class="cf '+r.cls+'">'+r.conf+'</span><span class="num" style="font-weight:700">'+fmt(r.m)+'m</span></div>'
          + '<div class="tri"><div><span>段数</span><input class="gIn" data-g="'+g.id+'" data-k="steps" type="number" inputmode="numeric" value="'+(so.steps||"")+'" placeholder="—"></div>'
          + '<div><span>蹴上げ mm</span><input class="gIn" data-g="'+g.id+'" data-k="rise" type="number" inputmode="decimal" value="'+(so.rise?Math.round(so.rise*1000):"")+'" placeholder="—"></div>'
          + '<div><span>高さ m</span><input class="gIn" data-g="'+g.id+'" data-k="height" type="number" inputmode="decimal" value="'+(so.height||"")+'" placeholder="—"></div></div>'
          + (br?'<div class="hint">逆算 → 蹴上げ '+Math.round(br*1000)+'mm'
            + '<button data-base="'+Math.round(br*1000)+'">これを基準値にする</button></div>':'')
          + '</div>'; }).join("")
    + '<button class="ghost" data-clear="'+sp.id+'">この施設の設定をすべて消す</button>'
    + (sp.isCustom?'<button class="ghost" data-delspot="'+sp.id+'" style="border-color:var(--danger);color:var(--danger)">この地点を削除</button>':'')
    + '</div>';
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
    + '<button class="ghost" id="addSeg">＋ 区間を追加</button>'

    + '<div class="card"><div class="fr"><label>区間の合計</label><span class="num" style="font-weight:700">'+fmt(segSum)+' m</span></div>'
    + (num(d.totalM)?'<div class="note">公表 '+d.totalM+'m との差 '+fmt(Math.abs(segSum-num(d.totalM)))+'m</div>':'')
    + '<button class="primary" id="saveSpot" '+(d.name.trim()&&segSum>0?"":"disabled")+'>この地点を追加</button></div>';
}
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
          + '<div class="pick"><button data-fix="'+i+'" data-h="'+x.a.height+'">'+esc(x.a.label)+'</button>'
          + '<button data-fix="'+i+'" data-h="'+x.b.height+'">'+esc(x.b.label)+'</button></div></div>';
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
    + '<div class="note">ヘッダーのアイコンからも切り替えられます。</div></div>'

    + '<div class="card"><h3>バックアップ</h3>'
    + '<div class="note">記録はこの端末の中にしかありません。ブラウザのデータを消すと戻せないので、ときどき書き出してファイルを残してください。現在 '+S.entries.length+'件。</div>'
    + '<div class="mini"><button id="expJ">書き出す</button><button id="impJ">読み込む</button></div>'
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
  var before=D.lifetime(S), now=Date.now(), segs={}, best=null;
  picked.forEach(function(g){ var c=D.resolve(S,sp,g).conf; segs[g.id]=c;
    if(best===null||D.CONF_RANK[c]>D.CONF_RANK[best]) best=c; });
  var e={id:now,date:D.today(),createdAt:new Date(now).toISOString(),
    spotId:sp.id,name:sp.name,segIds:picked.map(function(g){return g.id;}),
    unitM:unit,reps:reps,meters:meters,round:ui.round,cat:sp.cat,
    steps:Math.round(D.stepsForSegs(S,sp,picked)*reps),
    weightAtSave:S.weight,kcal:D.kcalRaw(meters,S.weight,ui.round),
    confidence:best?{max:best,segs:segs}:null};
  S.entries.unshift(e); save();
  var after=before+meters;
  var hit=D.RANKS.filter(function(r){ return before<r.m&&after>=r.m; });
  if(hit.length){ var top=hit[hit.length-1];
    S.summits[top.id]={reachedAt:e.createdAt,atElevationM:after}; save(); ui.summitFx=top.id; }
  ui.reps=1; ui.screen="home"; render();
  if(hit.length) toast(hit[hit.length-1].name+" 登頂","summit");
  else toast(fmt(meters)+"m 記録しました",null,{label:"取り消す",fn:function(){
    S.entries=S.entries.filter(function(x){return x.id!==e.id;}); save(); render();
    toast("取り消しました"); }});
}

/* ===== イベント ===== */
function bind(){
  qa("[data-go]").forEach(function(b){ b.onclick=function(){
    ui.screen=b.dataset.go; if(ui.screen==="newspot") ui.draft=blankDraft(); window.scrollTo(0,0); render(); }; });
  if($("thm")) $("thm").onclick=toggleTheme;
  if($("thm2")) $("thm2").onchange=toggleTheme;
  if($("again")) $("again").onclick=repeatLast;

  qa("[data-pick]").forEach(function(b){ b.onclick=function(){
    var sp=D.spotOf(S,b.dataset.pick); if(!sp) return;
    ui.spotId=sp.id; ui.sel={}; sp.segs.forEach(function(g){ ui.sel[g.id]=true; });
    ui.reps=1; ui.screen="record"; window.scrollTo(0,0); render(); }; });
  qa("[data-spot]").forEach(function(b){ b.onclick=function(){
    ui.editSpot=b.dataset.spot; ui.screen="spot"; window.scrollTo(0,0); render(); }; });
  qa("[data-cat]").forEach(function(b){ b.onclick=function(){ ui.cat=b.dataset.cat; render(); }; });
  qa("[data-per]").forEach(function(b){ b.onclick=function(){ ui.period=Number(b.dataset.per); render(); }; });
  qa("[data-del]").forEach(function(b){ b.onclick=function(){
    S.entries=S.entries.filter(function(x){ return String(x.id)!==b.dataset.del; }); save(); render(); }; });

  qa("[data-seg]").forEach(function(b){ b.onchange=function(){ ui.sel[b.dataset.seg]=b.checked; render(); }; });
  if($("selAll"))  $("selAll").onclick=function(){ D.spotOf(S,ui.spotId).segs.forEach(function(g){ui.sel[g.id]=true;}); render(); };
  if($("selFree")) $("selFree").onclick=function(){ D.spotOf(S,ui.spotId).segs.forEach(function(g){ui.sel[g.id]=!g.paid;}); render(); };
  if($("selNone")) $("selNone").onclick=function(){ ui.sel={}; render(); };
  if($("minus")) $("minus").onclick=function(){ ui.reps=Math.max(1,Number(ui.reps)-1); render(); };
  if($("plus"))  $("plus").onclick=function(){ ui.reps=Number(ui.reps)+1; render(); };
  if($("reps"))  $("reps").onchange=function(e){ ui.reps=Math.max(1,Number(e.target.value)||1); render(); };
  if($("rt"))    $("rt").onchange=function(e){ ui.round=e.target.checked; render(); };
  if($("commit")) $("commit").onclick=commit;

  if($("w"))      $("w").onchange=function(e){ S.weight=Number(e.target.value)||60; save(); render(); };
  if($("bRise"))  $("bRise").onchange=function(e){ var v=num(e.target.value); if(v)S.baseRise=v/1000; save(); render(); };
  if($("bFloor")) $("bFloor").onchange=function(e){ var v=num(e.target.value); if(v)S.baseFloorH=v; save(); render(); };

  qa(".sIn").forEach(function(i){ i.onchange=function(e){
    var o=D.ovW(S,ui.editSpot), k=i.dataset.k, v=num(e.target.value);
    if(v==null) delete o[k]; else o[k]=(k==="rise")?v/1000:v;
    D.pruneOver(S); save(); render(); toast("保存しました"); }; });
  qa(".gIn").forEach(function(i){ i.onchange=function(e){
    var so=D.segOvW(S,ui.editSpot,i.dataset.g), k=i.dataset.k, v=num(e.target.value);
    if(v==null) delete so[k]; else so[k]=(k==="rise")?v/1000:v;
    D.pruneOver(S); save(); render(); toast("保存しました"); }; });
  qa("[data-base]").forEach(function(b){ b.onclick=function(){
    S.baseRise=Number(b.dataset.base)/1000; save(); render();
    toast("基準の蹴上げを "+b.dataset.base+"mm にしました"); }; });
  qa("[data-clear]").forEach(function(b){ b.onclick=function(){
    delete S.over[b.dataset.clear]; save(); render(); toast("設定を消しました"); }; });
  qa("[data-delspot]").forEach(function(b){ b.onclick=function(){
    if(!confirm("この地点を削除します。記録は残ります。")) return;
    S.customSpots=S.customSpots.filter(function(s){ return s.id!==b.dataset.delspot; });
    save(); ui.screen="spots"; render(); }; });

  /* 地点追加 */
  qa(".dIn").forEach(function(i){ i.onchange=function(e){ ui.draft[i.dataset.k]=e.target.value; render(); }; });
  qa("[data-dcat]").forEach(function(b){ b.onclick=function(){ ui.draft.cat=b.dataset.dcat; render(); }; });
  qa(".qIn").forEach(function(i){ i.onchange=function(e){
    ui.draft.segs[Number(i.dataset.i)][i.dataset.k]=e.target.value; render(); }; });
  qa("[data-fix]").forEach(function(b){ b.onclick=function(){
    var s=ui.draft.segs[Number(b.dataset.fix)];
    s.height=b.dataset.h; s.note="採用しなかった値も残しています"; render(); }; });
  qa("[data-rmseg]").forEach(function(b){ b.onclick=function(){
    ui.draft.segs.splice(Number(b.dataset.rmseg),1); render(); }; });
  if($("addSeg")) $("addSeg").onclick=function(){
    ui.draft.segs.push({label:"",layers:"",steps:"",rise:"",height:""}); render(); };
  if($("saveSpot")) $("saveSpot").onclick=saveSpot;

  if($("expJ")) $("expJ").onclick=exportJSON;
  if($("impJ")) $("impJ").onclick=function(){ $("impF").click(); };
  if($("impF")) $("impF").onchange=function(e){
    var f=e.target.files&&e.target.files[0]; if(f) importJSON(f); e.target.value=""; };
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

load(); render();
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function(){});
