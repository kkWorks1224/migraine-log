import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { INTENSITY, kindOf, midasGrade, type Entry } from "./types";
import { dayKey, fmtDuration, fmtTime, WD } from "./format";
import { analysisText } from "./useForecast";
import type { Analysis } from "./forecast";
import { Close, Doc } from "./icons";

const EFFECT = { good: "効いた", some: "少し", none: "効かない" } as const;

function monthStats(list: Entry[]) {
  const ints = list.filter((e) => e.intensity > 0).map((e) => e.intensity as number);
  const durs = list.filter((e) => e.status === "gone" && e.endedAt).map((e) => e.endedAt! - e.startedAt);
  return {
    days: new Set(list.map((e) => dayKey(e.startedAt))).size,
    medDays: new Set(list.filter((e) => e.meds.length).map((e) => dayKey(e.startedAt))).size,
    avg: ints.length ? (ints.reduce((a, b) => a + b, 0) / ints.length).toFixed(1) : "–",
    dur: durs.length ? fmtDuration(durs.reduce((a, b) => a + b, 0) / durs.length) : "–",
  };
}

// 受診時に医師へ渡す 1 枚のレポート（印刷・PDF 保存）
export function Report({
  open,
  onClose,
  month,
  entries,
  analysis,
}: {
  open: boolean;
  onClose: () => void;
  month: number;
  entries: Entry[];
  analysis: Analysis | null;
}) {
  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add("printing-report");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.classList.remove("printing-report");
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const m = new Date(month);
  const headaches = entries.filter((e) => !e.deleted && kindOf(e) === "headache");
  const months = [2, 1, 0].map((back) => {
    const s = new Date(m.getFullYear(), m.getMonth() - back, 1);
    const e = new Date(m.getFullYear(), m.getMonth() - back + 1, 1).getTime();
    return { label: `${s.getFullYear()}年${s.getMonth() + 1}月`, ...monthStats(headaches.filter((x) => x.startedAt >= s.getTime() && x.startedAt < e)) };
  });
  const end = new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime();
  const list = headaches.filter((e) => e.startedAt >= month && e.startedAt < end).sort((a, b) => a.startedAt - b.startedAt);
  const trig = new Map<string, number>();
  list.forEach((e) => {
    e.triggers.forEach((t) => trig.set(t, (trig.get(t) ?? 0) + 1));
    if (e.sleepLack) trig.set("寝不足", (trig.get("寝不足") ?? 0) + 1);
  });
  const topTrig = [...trig.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const midas = entries.filter((e) => !e.deleted && kindOf(e) === "midas" && e.midas).sort((a, b) => b.startedAt - a.startedAt)[0];
  const midasScore = midas ? midas.midas!.reduce((a, b) => a + b, 0) : null;
  const medWarn = months[2].medDays >= 10;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="report-root"
          role="dialog"
          aria-modal="true"
          aria-label="受診用レポート"
          data-testid="report"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24, transition: { duration: 0.18 } }}
          transition={{ type: "spring", stiffness: 380, damping: 36 }}
        >
          <div className="report-bar no-print">
            <button type="button" className="round-btn" aria-label="閉じる" onClick={onClose} data-testid="report-close">
              <Close width={18} height={18} />
            </button>
            <button type="button" className="primary-btn compact" onClick={() => window.print()} data-testid="report-print">
              <Doc width={16} height={16} />
              印刷・PDFに保存
            </button>
          </div>
          <article className="report">
            <header>
              <h1>頭痛ダイアリー {m.getFullYear()}年{m.getMonth() + 1}月</h1>
              <p>
                作成日 {dayKey(Date.now()).replace(/-/g, "/")}・頭痛ログ
              </p>
            </header>

            <section>
              <h2>直近3か月</h2>
              <table>
                <thead>
                  <tr>
                    <th>月</th>
                    <th>頭痛日数</th>
                    <th>服薬日数</th>
                    <th>平均の強さ（3段階）</th>
                    <th>平均持続</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((r) => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td>{r.days}日</td>
                      <td className={r.medDays >= 10 ? "warn-cell" : ""}>{r.medDays}日</td>
                      <td>{r.avg}</td>
                      <td>{r.dur}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {medWarn && <p className="report-warn">今月の服薬が10日以上です（薬剤の使用過多による頭痛の目安）。</p>}
            </section>

            <section className="report-grid">
              <div>
                <h2>生活への支障度（MIDAS）</h2>
                <p>
                  {midasScore != null
                    ? `${midasScore}点・グレード${midasGrade(midasScore).g}（${midasGrade(midasScore).label}）・${dayKey(midas!.startedAt).replace(/-/g, "/")}回答`
                    : "未回答"}
                </p>
              </div>
              <div>
                <h2>多かったきっかけ</h2>
                <p>{topTrig.length ? topTrig.map(([k, n]) => `${k} ${n}回`).join("、") : "記録なし"}</p>
              </div>
            </section>

            {analysis && (
              <section>
                <h2>気圧との関係</h2>
                <p>{analysisText(analysis)}</p>
              </section>
            )}

            <section>
              <h2>今月の記録（{list.length}件）</h2>
              {list.length === 0 ? (
                <p>記録なし</p>
              ) : (
                <table className="report-list">
                  <thead>
                    <tr>
                      <th>開始</th>
                      <th>持続</th>
                      <th>強さ</th>
                      <th>薬（効き目）</th>
                      <th>症状・前ぶれ</th>
                      <th>気圧変化(6h)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((e) => {
                      const d = new Date(e.startedAt);
                      return (
                        <tr key={e.id}>
                          <td>
                            {d.getMonth() + 1}/{d.getDate()}({WD[d.getDay()]}) {fmtTime(e.startedAt)}
                          </td>
                          <td>{e.endedAt ? fmtDuration(e.endedAt - e.startedAt) : "継続中"}</td>
                          <td>{INTENSITY.find((o) => o.v === e.intensity)?.label ?? "–"}</td>
                          <td>
                            {e.meds.join("・") || "–"}
                            {e.medEffect ? `（${EFFECT[e.medEffect]}）` : ""}
                          </td>
                          <td>{[...e.symptoms, ...(e.prodromes ?? []).map((p) => `前ぶれ:${p}`)].join("、") || "–"}</td>
                          <td>{e.weather?.trend != null ? `${e.weather.trend > 0 ? "+" : ""}${e.weather.trend.toFixed(1)}hPa` : "–"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
            <footer>本人の記録をまとめたものです。診断や治療の判断は医師にご相談ください。</footer>
          </article>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
