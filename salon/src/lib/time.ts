const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** JST での「YYYY-MM」。AI 利用上限は暦月（日本時間）でリセットする。 */
export function monthKeyJst(now: number | Date = Date.now()): string {
  const jst = new Date((now instanceof Date ? now.getTime() : now) + JST_OFFSET_MS);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** スタッフ通知に添える「08/18 14:05」形式の時刻（JST）。 */
export function stampJst(now: number | Date = Date.now()): string {
  const jst = new Date((now instanceof Date ? now.getTime() : now) + JST_OFFSET_MS);
  const mm = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(jst.getUTCDate()).padStart(2, '0');
  const hh = String(jst.getUTCHours()).padStart(2, '0');
  const mi = String(jst.getUTCMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}
