/* view.mountain.js — 山のヒーロー。
   キット同梱の6枚のSVGの稜線データをそのまま使い、色だけテーマ変数に逃がしてある
   （元ファイルは6枚とも id="g" が重複していてインラインすると混色するため、ここで再構成する）。 */
(function (root) {
"use strict";
var M = {
  harukas:{d:"M0 390 L0 300 L100 275 L180 300 L260 220 L340 285 L430 205 L500 285 L600 250 L700 305 L790 225 L860 285 L950 245 L1040 300 L1200 260 L1200 500 L0 500 Z", hi:"#31516A", lo:"#182A3A"},
  takao:{d:"M0 410 L130 335 L240 350 L355 255 L455 315 L560 205 L650 300 L760 245 L860 325 L970 270 L1080 340 L1200 300 L1200 500 L0 500 Z", hi:"#3A5870", lo:"#172C3B"},
  fuji5:{d:"M0 420 L180 360 L310 375 L600 125 L880 375 L1010 350 L1200 410 L1200 500 L0 500 Z", hi:"#496781", lo:"#172B43"},
  fuji:{d:"M0 430 L180 365 L340 390 L600 80 L860 390 L1015 350 L1200 420 L1200 500 L0 500 Z", hi:"#607D98", lo:"#142A43"},
  kilimanjaro:{d:"M0 425 L190 355 L360 375 L520 215 L600 180 L690 220 L850 365 L1010 345 L1200 410 L1200 500 L0 500 Z", hi:"#536C82", lo:"#142437"},
  everest:{d:"M0 430 L160 360 L310 390 L480 240 L600 110 L720 245 L900 370 L1040 340 L1200 410 L1200 500 L0 500 Z", hi:"#6E8296", lo:"#101E30"}
};
var CONTOUR = ["M40 440 Q260 350 430 415 T790 390 T1160 420",
               "M100 405 Q270 335 430 390 T790 365 T1110 400",
               "M185 370 Q310 325 430 360 T790 340 T1030 375"];

/* 稜線の「登り側」だけを取り出し、進捗率の位置を返す */
function pts(d){
  var out=[], re=/([ML])\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g, m;
  while((m=re.exec(d))) out.push({x:+m[2],y:+m[3]});
  return out;
}
function flagAt(d,p){
  var P=pts(d), peak=0;
  for(var i=1;i<P.length;i++) if(P[i].y<P[peak].y) peak=i;
  var seg=P.slice(0,peak+1);
  if(seg.length<2) return {x:600,y:200};
  var L=[],tot=0;
  for(var j=1;j<seg.length;j++){
    var dx=seg[j].x-seg[j-1].x, dy=seg[j].y-seg[j-1].y;
    var l=Math.sqrt(dx*dx+dy*dy); L.push(l); tot+=l;
  }
  var want=Math.max(0,Math.min(1,p))*tot, acc=0;
  for(var k=0;k<L.length;k++){
    if(acc+L[k]>=want){
      var t=L[k]===0?0:(want-acc)/L[k];
      return { x:seg[k].x+(seg[k+1].x-seg[k].x)*t, y:seg[k].y+(seg[k+1].y-seg[k].y)*t };
    }
    acc+=L[k];
  }
  return seg[seg.length-1];
}

/* tierId, 区間内進捗(0-1), 演出フラグ */
function render(tierId,p,opts){
  opts=opts||{};
  var m=M[tierId]||M.harukas, f=flagAt(m.d,p), gid="mg_"+tierId;
  var ripple = opts.summit
    ? '<g class="ripple" style="transform-origin:'+f.x+'px '+f.y+'px">'
      + '<ellipse cx="'+f.x+'" cy="'+f.y+'" rx="150" ry="62" fill="none" stroke="var(--orange)" stroke-width="3"/>'
      + '<ellipse cx="'+f.x+'" cy="'+f.y+'" rx="90" ry="38" fill="none" stroke="var(--orange)" stroke-width="2"/></g>'
    : '';
  return '<svg class="mt" viewBox="0 0 1200 500" role="img" aria-label="現在の山 '+(opts.label||"")+'">'
    + '<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1">'
    + '<stop stop-color="'+m.hi+'"/><stop offset="1" stop-color="'+m.lo+'"/></linearGradient></defs>'
    + '<rect width="1200" height="500" fill="var(--sky)"/>'
    + '<path d="'+m.d+'" fill="url(#'+gid+')"/>'
    + '<g fill="none" stroke="var(--contour)" opacity="var(--contour-op)" stroke-width="2">'
    + CONTOUR.map(function(c){return '<path d="'+c+'"/>';}).join("")
    + '</g>' + ripple
    + '<g class="flag'+(opts.snap?" snap":"")+'" transform="translate('+(f.x-3)+' '+(f.y-86)+')">'
    + '<path d="M0 0v86" stroke="var(--text)" stroke-width="5"/>'
    + '<path d="M3 3h58l-17 17 17 17H3z" fill="var(--orange)"/></g>'
    + '</svg>';
}
root.Mountain = { render:render, flagAt:flagAt, list:M };
})(typeof window!=="undefined"?window:globalThis);

/* 全行程の断面図。
   x軸は獲得標高(m)そのもの＝「この先どれだけあるか」が距離で伝わる。
   y軸は平方根で圧縮している。実比だと序盤が完全に平らになり、何も読めなくなるため。 */
(function (root) {
"use strict";
var R=[{m:300,name:"あべのハルカス"},{m:599,name:"高尾山"},{m:1450,name:"富士山 五合目→山頂"},
       {m:3776,name:"富士山 標高ぜんぶ"},{m:5895,name:"キリマンジャロ"},{m:8848,name:"エベレスト"}];
var PX=0.30, PAD=64, H=212, BASE=170, TOP=44;

function X(m){ return PAD+m*PX; }
/* 実比だと序盤が完全に平らになるので、下限を持たせた平方根で圧縮する。 */
function peakY(m){ return BASE-(0.22+0.78*Math.sqrt(m/8848))*(BASE-TOP); }

/* 峰と峰のあいだに前衛峰を置く。一直線だと「ただの坂」に見えて距離感が出ない。 */
var WOBBLE=[0.34,0.20,0.46,0.26,0.38,0.22,0.44,0.30,0.36,0.24,0.42,0.28,0.40,0.32,0.26];
function line(){
  var p=[{x:X(0),y:BASE}], w=0;
  for(var i=0;i<R.length;i++){
    var from=(i===0?0:R[i-1].m), to=R[i].m, span=to-from;
    var n=(i<2?2:4);
    for(var k=1;k<=n;k++){
      var f=k/(n+1), m=from+span*f;
      var lo=(i===0?BASE:peakY(from)), hi=peakY(to);
      var base=lo+(hi-lo)*f;
      var amp=(BASE-hi)*WOBBLE[(w++)%WOBBLE.length];
      p.push({x:X(m), y:Math.min(BASE-4, base+amp*(k%2?0.55:1.0))});
    }
    p.push({x:X(to), y:peakY(to)});
  }
  return p;
}
function yAt(p,x){
  if(x<=p[0].x) return p[0].y;
  for(var i=1;i<p.length;i++){
    if(x<=p[i].x){ var t=(x-p[i-1].x)/(p[i].x-p[i-1].x||1);
      return p[i-1].y+(p[i].y-p[i-1].y)*t; }
  }
  return p[p.length-1].y;
}
function profile(t,fmtM){
  fmtM=fmtM||function(v){return Math.round(v).toLocaleString();};
  var p=line(), W=X(8848)+PAD, fx=X(Math.min(t,8848)), fy=yAt(p,fx);
  var d="M"+p.map(function(q){return q.x.toFixed(1)+" "+q.y.toFixed(1);}).join(" L");
  var area=d+" L"+W+" "+BASE+" L"+PAD+" "+BASE+" Z";
  var grid="";
  for(var i=500;i<8848;i+=500){
    if(i%1000){ grid+='<line x1="'+X(i)+'" y1="'+(BASE-8)+'" x2="'+X(i)+'" y2="'+BASE+'" stroke="var(--hairline)" stroke-width="1"/>'; continue; }
    grid+='<line x1="'+X(i)+'" y1="'+TOP+'" x2="'+X(i)+'" y2="'+BASE+'" stroke="var(--hairline)" stroke-width="1"/>'
       +  '<text x="'+X(i)+'" y="'+(BASE+17)+'" fill="var(--muted)" font-size="10.5" text-anchor="middle">'+(i/1000)+',000m</text>';
  }
  var peaks=R.map(function(r){
    var x=X(r.m), y=peakY(r.m), done=t>=r.m;
    return '<g><circle cx="'+x+'" cy="'+y+'" r="4.5" fill="'+(done?"var(--green)":"var(--muted)")+'"/>'
      + '<text x="'+x+'" y="'+(y-25)+'" fill="'+(done?"var(--green)":"var(--text-2)")+'" font-size="12.5" font-weight="700" text-anchor="middle">'+r.name+'</text>'
      + '<text x="'+x+'" y="'+(y-11)+'" fill="var(--muted)" font-size="11" text-anchor="middle">'+r.m.toLocaleString()+' m'+(done?" 登頂":"")+'</text></g>';
  }).join("");
  return '<svg class="prof" width="'+W+'" height="'+(H+22)+'" viewBox="0 0 '+W+' '+(H+22)+'">'
    + '<defs><clipPath id="pdone"><rect x="0" y="0" width="'+fx+'" height="'+H+'"/></clipPath>'
    + '<linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">'
    + '<stop stop-color="var(--orange)" stop-opacity=".42"/><stop offset="1" stop-color="var(--orange)" stop-opacity="0"/></linearGradient></defs>'
    + grid
    + '<path d="'+area+'" fill="var(--surface-2)"/>'
    + '<path d="'+area+'" fill="url(#pg)" clip-path="url(#pdone)"/>'
    + '<path d="'+d+'" fill="none" stroke="var(--hairline-2)" stroke-width="2.5"/>'
    + '<path d="'+d+'" fill="none" stroke="var(--orange)" stroke-width="3.5" clip-path="url(#pdone)"/>'
    + '<line x1="'+PAD+'" y1="'+BASE+'" x2="'+(W-8)+'" y2="'+BASE+'" stroke="var(--hairline-2)" stroke-width="1"/>'
    + peaks
    + '<g transform="translate('+fx+' '+fy+')">'
    + '<line x1="0" y1="0" x2="0" y2="'+(BASE-fy)+'" stroke="var(--orange)" stroke-width="1" stroke-dasharray="3 3"/>'
    + '<path d="M0 0v-38" stroke="var(--text)" stroke-width="3"/>'
    + '<path d="M1 -38h27l-8 8 8 8H1z" fill="var(--orange)"/>'
    + '<circle cx="0" cy="0" r="5" fill="var(--orange)" stroke="var(--ink-0)" stroke-width="2"/>'
    + '</g>'
    + '<text x="'+fx+'" y="'+(BASE+34)+'" fill="var(--orange)" font-size="11.5" font-weight="700" text-anchor="middle">現在地 '+fmtM(t)+' m</text>'
    + '</svg>';
}
function flagX(t){ return X(Math.min(t,8848)); }
root.Mountain.profile=profile;
root.Mountain.flagX=flagX;
})(typeof window!=="undefined"?window:globalThis);
