// STAIR CLIMB DATABASE v2.0 → 地点シード
// src: "confirmed"=公表値/実測値, "derived"=確定値からの導出, null=未取得
// seg.height が入っていれば最優先。無ければ 段数×蹴上げ、次に 層数×階高。
window.SEED = [

/* ── 商業・駅ビル ───────────────────────────── */
{id:"b1", name:"JR横浜タワー", cat:"mall", area:"横浜", min:17,
 totalM:132.253, totalSrc:"confirmed", floorH:4.5, floorHSrc:"derived",
 note:"1〜4F吹抜18.0mが公表値。B3〜10F開放、12F以上オフィス。段数を数えれば蹴上げが逆算できる。",
 segs:[{id:"a",label:"B3→1F",layers:3},
       {id:"b",label:"1F→5F",layers:4,height:18.0,src:"confirmed"},
       {id:"c",label:"5F→10F",layers:5},
       {id:"d",label:"10F→12F うみそらデッキ",layers:2}]},

{id:"b2", name:"アトレ川崎", cat:"mall", area:"川崎", min:18,
 totalM:null, floorH:null,
 note:"高さ非公表。B1〜8Fが全層商業で使用率100%。実測価値が高い。",
 segs:[{id:"a",label:"B1→8F 通し",layers:9}]},

{id:"b3", name:"キュービックプラザ新横浜", cat:"mall", area:"新横浜", min:13,
 totalM:75.0, totalSrc:"confirmed", floorH:3.95, floorHSrc:"derived",
 note:"19階建75m。1F〜10F開放、11F以上ホテル・オフィス。5:30-23:00。",
 segs:[{id:"a",label:"1F→10F",layers:9}]},

{id:"b4", name:"渋谷スクランブルスクエア 東棟", cat:"mall", area:"渋谷", min:22,
 totalM:229.697, totalSrc:"confirmed", floorH:4.89, floorHSrc:"derived",
 note:"圏内最大規模。B2〜15F開放。混雑は覚悟。",
 segs:[{id:"a",label:"B2→1F",layers:2},
       {id:"b",label:"1F→14F 商業",layers:13},
       {id:"c",label:"14F→15F QWS",layers:1}]},

{id:"b5", name:"渋谷ヒカリエ", cat:"mall", area:"渋谷", min:22,
 totalM:null, floorH:null,
 note:"高さ未取得。B3〜11F開放。縦動線はエスカレーターが主役で階段の有無は未確認。",
 segs:[{id:"a",label:"B3→1F",layers:3},
       {id:"b",label:"1F→5F ShinQs",layers:4},
       {id:"c",label:"5F→11F",layers:6}]},

{id:"b6", name:"渋谷ストリーム", cat:"mall", area:"渋谷", min:22,
 totalM:179.95, totalSrc:"confirmed", floorH:5.14, floorHSrc:"derived",
 note:"商業は3層のみ。段数効率は最低クラス。",
 segs:[{id:"a",label:"1F→4F",layers:3}]},

{id:"b7", name:"渋谷サクラステージ SHIBUYAタワー", cat:"mall", area:"渋谷", min:22,
 totalM:179, totalSrc:"confirmed", floorH:4.59, floorHSrc:"derived",
 note:"2F歩道橋デッキ・3F北自由通路は公共動線。24h使える常用階段の可能性。",
 segs:[{id:"a",label:"B2→1F",layers:2},
       {id:"b",label:"1F→3F 公共デッキ",layers:2},
       {id:"c",label:"3F→5F",layers:2}]},

{id:"b8", name:"セルリアンタワー", cat:"mall", area:"渋谷", min:22,
 totalM:184.0, totalSrc:"confirmed", floorH:null,
 note:"ホテル。運動目的の利用には不適。B2能楽堂まで。",
 segs:[{id:"a",label:"B2→3F",layers:5}]},

{id:"b9", name:"渋谷マークシティ", cat:"mall", area:"渋谷", min:22,
 totalM:95.55, totalSrc:"confirmed", floorH:null,
 note:"井の頭線と一体。4F道玄坂方面連絡通路あり。商業範囲は未取得。",
 segs:[{id:"a",label:"1F→4F 連絡通路",layers:3}]},

{id:"b10", name:"渋谷フクラス", cat:"mall", area:"渋谷", min:22,
 totalM:103.96, totalSrc:"confirmed", floorH:null,
 note:"18階建104m。開放範囲が未取得のため区間は空。現地で確認して追加。",
 segs:[]},

{id:"b13", name:"MIYASHITA PARK", cat:"mall", area:"渋谷", min:22,
 totalM:null, floorH:null,
 note:"立体都市公園。屋上が公園なので屋外階段の可能性が高い＝許可不要。",
 segs:[{id:"a",label:"1F→3F 商業",layers:2},
       {id:"b",label:"3F→屋上公園",layers:1}]},

{id:"b14", name:"横浜ランドマークプラザ", cat:"mall", area:"みなとみらい", min:27,
 totalM:296.33, totalSrc:"confirmed", floorH:null,
 note:"ドックヤードガーデンに屋外階段あり（外から地下2階へ）。改札も許可も不要。石造ドックの深さは公表なしで実測しか手段がない。",
 segs:[{id:"a",label:"ドックヤード屋外階段",layers:2},
       {id:"b",label:"B2→1F",layers:2},
       {id:"c",label:"1F→5F ガレリア",layers:4}]},

{id:"b15", name:"グランツリー武蔵小杉", cat:"mall", area:"武蔵小杉", min:5,
 totalM:null, floorH:null,
 note:"最有力。徒歩5分・屋内完結・雨天可。B1/B2が駐車場なので常用階段の可能性が高い。",
 segs:[{id:"a",label:"B2→1F 駐車場",layers:2},
       {id:"b",label:"1F→4F",layers:3},
       {id:"c",label:"4F→屋上庭園",layers:1}]},

{id:"b16", name:"武蔵小杉東急スクエア", cat:"mall", area:"武蔵小杉", min:2,
 totalM:null, floorH:null,
 note:"圏内最短。1F〜4F、4Fに綱島街道口。東口連絡口は10:00-22:00。",
 segs:[{id:"a",label:"1F→4F",layers:3}]},

{id:"b17", name:"クイーンズスクエア横浜", cat:"mall", area:"みなとみらい", min:27,
 totalM:null, floorH:null,
 note:"市内最長エスカレーターの高低差17.7mが公表値。階段が併設されているかは要確認。2026年6月〜2027年2月はESC改修工事。",
 segs:[{id:"a",label:"B4→1F",layers:4},
       {id:"b",label:"1F→5F",layers:4},
       {id:"c",label:"最長ESC区間（階段の有無を要確認）",layers:1,height:17.7,src:"confirmed"}]},

{id:"b18", name:"鶴屋町立体駐車場", cat:"mall", area:"横浜", min:17,
 totalM:40.0, totalSrc:"confirmed", floorH:4.44, floorHSrc:"derived",
 note:"9階建40m。駐車場棟なので常用階段の可能性が高い。横浜駅から北へ330m。",
 segs:[{id:"a",label:"1F→9F",layers:8}]},

{id:"b19", name:"ラゾーナ川崎プラザ", cat:"mall", area:"川崎", min:18,
 totalM:null, floorH:null,
 note:"階層・高さとも未取得。駐車場2000台の棟に階段がある可能性。",
 segs:[{id:"a",label:"1F→3F",layers:2}]},

/* ── 駅（地下深度） ───────────────────────────── */
{id:"s1", name:"新綱島駅", cat:"station", area:"新綱島", min:8,
 totalM:34.9, totalSrc:"confirmed", floorH:8.725, floorHSrc:"derived",
 note:"圏内最深34.9m。地下4層、改札はB1の1か所。鶴見川を川底で下越しするための深度。",
 segs:[{id:"a",label:"地上→B1 改札",layers:1},
       {id:"b",label:"B1→B2",layers:1,paid:true},
       {id:"c",label:"B2→B3",layers:1,paid:true},
       {id:"d",label:"B3→B4 ホーム",layers:1,paid:true}]},

{id:"s2", name:"新横浜駅（東急）", cat:"station", area:"新横浜", min:13,
 totalM:33.0, totalSrc:"confirmed", floorH:8.25, floorHSrc:"derived",
 note:"横浜市広報は33m、施工資料は35mでソース間に差異。改札はB1に2か所。",
 segs:[{id:"a",label:"地上→B1 改札",layers:1},
       {id:"b",label:"B1→B2",layers:1,paid:true},
       {id:"c",label:"B2→B3",layers:1,paid:true},
       {id:"d",label:"B3→B4 ホーム",layers:1,paid:true}]},

{id:"s3", name:"新高島駅", cat:"station", area:"みなとみらい", min:25,
 totalM:null, floorH:null, totalSteps:199,
 note:"★最優先。ホーム→3番出口が199段（実測・2016年）。ここで蹴上げを測ればメートル値が確定し、その値が全地点の基準になる。混雑も低い。",
 segs:[{id:"a",label:"地上→B1",layers:1},
       {id:"b",label:"B1→B2 改札",layers:1},
       {id:"c",label:"B2→B3",layers:1,paid:true},
       {id:"d",label:"B3→B4",layers:1,paid:true},
       {id:"e",label:"B4→B5 ホーム",layers:1,paid:true}]},

{id:"s4", name:"元町・中華街駅", cat:"station", area:"元町", min:30,
 totalM:null, floorH:null,
 note:"117段の単一階段はみなとみらい線最長。混雑は高い。",
 segs:[{id:"a",label:"地上→B1",layers:1},
       {id:"b",label:"B1→B4 ホーム（117段の階段を含む）",layers:3,paid:true}]},

{id:"s5", name:"馬車道駅", cat:"station", area:"みなとみらい", min:26,
 totalM:null, floorH:null,
 note:"改札がB2なので、地上→B2の2層分を入場券なしで稼げる。改札外比率が最も高い。",
 segs:[{id:"a",label:"地上→B1",layers:1},
       {id:"b",label:"B1→B2 改札",layers:1},
       {id:"c",label:"B2→B3 ホーム",layers:1,paid:true}]},

{id:"s6", name:"日本大通り駅", cat:"station", area:"関内", min:28,
 totalM:null, floorH:null, note:"ホームB3・改札B1。深度は未取得。",
 segs:[{id:"a",label:"地上→B1 改札",layers:1},
       {id:"b",label:"B1→B3 ホーム",layers:2,paid:true}]},

{id:"s7", name:"みなとみらい駅", cat:"station", area:"みなとみらい", min:24,
 totalM:23.0, totalSrc:"confirmed", floorH:5.75, floorHSrc:"derived",
 note:"深さ23m（横浜高速鉄道公式）。改札B3で改札外が3層分。混雑は高い。",
 segs:[{id:"a",label:"地上→B1",layers:1},
       {id:"b",label:"B1→B2",layers:1},
       {id:"c",label:"B2→B3 改札",layers:1},
       {id:"d",label:"B3→B4 ホーム",layers:1,paid:true}]},

{id:"s8", name:"横浜駅（東横線）", cat:"station", area:"横浜", min:17,
 totalM:22.0, totalSrc:"confirmed", floorH:4.4, floorHSrc:"derived",
 note:"深さ22mの地下四層構造（東急社史）。混雑は極めて高い。JR横浜タワーと同一駅なので合わせ技が可能。",
 segs:[{id:"a",label:"地上→B1",layers:1},
       {id:"b",label:"B1→B2",layers:1},
       {id:"c",label:"B2→B3 改札",layers:1},
       {id:"d",label:"B3→B5 ホーム",layers:2,paid:true}]},

{id:"s9", name:"反町駅", cat:"station", area:"反町", min:19,
 totalM:25.0, totalSrc:"confirmed", floorH:6.25, floorHSrc:"derived",
 note:"穴場。深さ25mの四層構造で、乗降者数は東横線最少（約13,500人/日）。人目を気にせず往復できる。",
 segs:[{id:"a",label:"地上→B1 改札",layers:1},
       {id:"b",label:"B1→B2",layers:1,paid:true},
       {id:"c",label:"B2→B3",layers:1,paid:true},
       {id:"d",label:"B3→B4 ホーム",layers:1,paid:true}]},

{id:"s10", name:"渋谷駅（東横線）", cat:"station", area:"渋谷", min:22,
 totalM:null, floorH:null, note:"ホームB5・改札B2/B3。深度未取得。混雑は極めて高い。",
 segs:[{id:"a",label:"地上→B2 改札",layers:2},
       {id:"b",label:"B2→B5 ホーム",layers:3,paid:true}]},

{id:"s11", name:"武蔵小山駅", cat:"station", area:"武蔵小山", min:24,
 totalM:null, floorH:null, note:"2006年地下化。深度未取得。目黒線で唯一調査価値がある駅。",
 segs:[{id:"a",label:"地上→改札",layers:1},
       {id:"b",label:"改札→ホーム",layers:1,paid:true}]},

/* ── 山・タワー（ボス戦） ───────────────────────── */
{id:"n1", name:"高尾山", cat:"boss", area:"高尾", min:75,
 totalM:400, totalSrc:"derived", floorH:null,
 note:"麓から山頂まで約400m。合法・景色つき・1日で完結。ボス戦の第一候補。",
 segs:[{id:"a",label:"麓→山頂",layers:1,height:400,src:"derived"}]},

{id:"n2", name:"東京タワー 外階段", cat:"boss", area:"東京", min:60,
 totalM:150, totalSrc:"confirmed", floorH:null,
 note:"約600段・150m。土日祝を中心に開放。オープンエアなので夏は消耗する。",
 segs:[{id:"a",label:"1F→メインデッキ",layers:1,height:150,src:"confirmed"}]},

{id:"n3", name:"あべのハルカス", cat:"boss", area:"大阪", min:null,
 totalM:300, totalSrc:"confirmed", floorH:null,
 note:"日本一高いビル300m。階段開放は年数回のイベント時のみ。",
 segs:[{id:"a",label:"1F→展望台",layers:1,height:300,src:"confirmed"}]},

/* ── 日常 ───────────────────────────────── */
{id:"p1", name:"日吉の丘公園", cat:"daily", area:"日吉", min:20,
 totalM:30, totalSrc:"estimate", floorH:null,
 note:"地形からの推定で高低差25〜30m。スマホの気圧高度計で麓と頂上の差を測れば確定する。",
 segs:[{id:"a",label:"麓→丘の上",layers:1,height:30,src:"estimate"}]},

{id:"p2", name:"駅の階段（日常）", cat:"daily", area:"—", min:0,
 totalM:null, floorH:null, note:"通勤で使う階段。実測して高さを入れると精度が上がる。",
 segs:[{id:"a",label:"1往復ぶん",layers:1}]},

{id:"p3", name:"職場・自宅の階段", cat:"daily", area:"—", min:0,
 totalM:null, floorH:null, note:"最も回数を稼げる場所。段数と蹴上げを一度測る価値が高い。",
 segs:[{id:"a",label:"1往復ぶん",layers:1}]}
];
