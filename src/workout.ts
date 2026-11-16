import { dayKey } from "./format";
import { kindOf, type Entry } from "./types";

const DAY = 86_400_000;

// 筋トレした日の「翌日」と、それ以外の日で頭痛のあった割合を比べる（直近 92 日）
export function workoutRelation(entries: Entry[], now = Date.now()) {
  const live = entries.filter((e) => !e.deleted);
  const wo = new Set(live.filter((e) => kindOf(e) === "workout").map((e) => dayKey(e.startedAt)));
  if (!wo.size) return null;
  const pain = new Set(live.filter((e) => kindOf(e) === "headache").map((e) => dayKey(e.startedAt)));
  const first = Math.min(...live.map((e) => e.startedAt));
  const s = new Date(Math.max(first, now - 92 * DAY));
  const t = new Date(now);
  const today = dayKey(now);
  let after = 0, afterPain = 0, other = 0, otherPain = 0;
  // 記録の初日の翌日から今日まで（今日はまだ頭痛がなければ一日が終わっていないので数えない）
  for (let d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1); d <= t; d.setDate(d.getDate() + 1)) {
    const k = dayKey(d.getTime());
    const hurt = pain.has(k);
    if (k === today && !hurt) break;
    const prev = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    if (wo.has(dayKey(prev.getTime()))) {
      after++;
      if (hurt) afterPain++;
    } else {
      other++;
      if (hurt) otherPain++;
    }
  }
  return { workouts: wo.size, after, afterPain, other, otherPain };
}

export function workoutText(r: NonNullable<ReturnType<typeof workoutRelation>>) {
  if (r.after < 3)
    return `筋トレした日が${r.workouts}日あります。翌日の頭痛と比べるには、筋トレの翌日があと${3 - r.after}日分ほど必要です。`;
  const pa = Math.round((r.afterPain / r.after) * 100);
  const po = r.other ? Math.round((r.otherPain / r.other) * 100) : 0;
  let t = `筋トレの翌日に頭痛があったのは${r.after}日中${r.afterPain}日（${pa}%）。それ以外の日は${r.other}日中${r.otherPain}日（${po}%）でした。`;
  if (r.after < 5) t += "まだ日数が少ないので、参考程度に見てください。";
  else if (r.afterPain >= 2 && pa >= Math.max(po * 1.5, po + 15))
    t += "筋トレの翌日は頭痛が出やすい傾向があります。力むときに息を止めない・首をすくめない・水分をとる、を試してみてください。";
  else t += "今のところ、はっきりした差は見られません。";
  return t;
}
