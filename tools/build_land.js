#!/usr/bin/env node
/* build_land.js — 土地分割シミュレーターを1枚のファイルにまとめる。
 *
 *   node tools/build_land.js out.html            … そのまま開ける HTML を書く
 *   node tools/build_land.js out.html --fragment … <title>/<style>/中身/<script> だけを書く
 *                                                  （head と body を外側が用意する場所へ貼る用）
 *
 * 配布物を1枚にするためだけのもの。land/ の中身が正で、こちらは常に生成物。
 */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");

const out = process.argv[2];
const fragment = process.argv.includes("--fragment");
if (!out) { console.error("使い方: node tools/build_land.js <出力パス> [--fragment]"); process.exit(1); }

const html = read("land/index.html");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"))
  .replace(/<script src="land\.js"><\/script>/, "")
  .trim();

const css = read("tokens.css") + "\n" + read("land/land.css");
const js = read("land/land.js");
const title = "土地分割シミュレーター";

const parts = [
  "<title>" + title + "</title>",
  "<style>\n" + css + "\n</style>",
  body,
  "<script>\n" + js + "\n</script>"
].join("\n\n");

const page = fragment ? parts :
  '<!DOCTYPE html>\n<html lang="ja" data-theme="light">\n<head>\n' +
  '<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">\n' +
  '<meta name="theme-color" content="#EDF1F2">\n' +
  '<meta name="mobile-web-app-capable" content="yes">\n' +
  '<meta name="apple-mobile-web-app-capable" content="yes">\n' +
  parts.split("\n\n").slice(0, 2).join("\n") + "\n</head>\n<body>\n" +
  parts.split("\n\n").slice(2).join("\n\n") + "\n</body>\n</html>\n";

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, page);
console.log(out + " を書きました（" + Math.round(page.length / 1024) + "KB）");
