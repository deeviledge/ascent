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
