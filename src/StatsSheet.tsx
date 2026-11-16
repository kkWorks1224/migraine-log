import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { INTENSITY, kindOf, midasGrade, type Entry } from "./types";
import { aiInsight } from "./store";
import { BottomSheet, spring } from "./ui";
import { isDropW, dayKey, fmtDayLong, fmtDuration, fmtTime, INTENSITY_COLOR, WD } from "./format";
import { analysisText, useForecast } from "./useForecast";
import { MidasSheet } from "./Midas";
import { Report } from "./Report";
import { sky, SKY_LABEL } from "./weather";
import { ChevronLeft, ChevronRight, Doc, Download, Dumbbell, Pill, Sparkles } from "./icons";
import { workoutRelation, workoutText } from "./workout";
import { actions } from "./store";
import { STATUS_META } from "./EntryCard";
import { haptic } from "./haptics";

const isDrop = (e: Entry) => isDropW(e.weather);

export function StatsSheet({
  open,
  onClose,
  entries,
  loggedIn,
  needLogin,
  onOpenEntry,
}: {
  open: boolean;
  onClose: () => void;
  entries: Entry[];
  loggedIn: boolean;
  needLogin: () => void;
  onOpenEntry: (e: Entry) => void;
}) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  });
  const [dir, setDir] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const [midasOpen, setMidasOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const all = entries;
  const fc = useForecast(all);
  const headaches = useMemo(() => all.filter((e) => kindOf(e) === "headache"), [all]);
  const clearDays = useMemo(() => new Set(all.filter((e) => kindOf(e) === "clear").map((e) => dayKey(e.startedAt))), [all]);
  const workouts = useMemo(() => new Map(all.filter((e) => kindOf(e) === "workout").map((e) => [dayKey(e.startedAt), e] as const)), [all]);
  const woRel = useMemo(() => workoutRelation(all), [all]);
  const midas = useMemo(() => all.filter((e) => kindOf(e) === "midas" && e.midas).sort((a, b) => b.startedAt - a.startedAt), [all]);
  const [insight, setInsight] = useState<{ state: "idle" | "loading" | "done" | "error"; text: string }>({ state: "idle", text: "" });

  const m = new Date(month);
  const next = new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime();
  const inMonth = useMemo(() => headaches.filter((e) => e.startedAt >= month && e.startedAt < next), [headaches, month, next]);

  const stats = useMemo(() => {
    const byDay = new Map<string, Entry[]>();
    inMonth.forEach((e) => {
      const k = dayKey(e.startedAt);
      byDay.set(k, [...(byDay.get(k) ?? []), e]);
    });
    const medDays = new Set(inMonth.filter((e) => e.meds.length).map((e) => dayKey(e.startedAt))).size;
    const ints: number[] = inMonth.filter((e) => e.intensity > 0).map((e) => e.intensity);
    const durs = inMonth.filter((e) => e.status === "gone" && e.endedAt).map((e) => e.endedAt! - e.startedAt);
    const factors = new Map<string, number>();
    const bump = (k: string) => factors.set(k, (factors.get(k) ?? 0) + 1);
    inMonth.forEach((e) => {
      if (e.sleepLack) bump("寝不足");
      if (isDrop(e)) bump("気圧低下");
      e.triggers.forEach(bump);
    });
    const prodromes = new Map<string, number>();
    inMonth.forEach((e) => (e.prodromes ?? []).forEach((k) => prodromes.set(k, (prodromes.get(k) ?? 0) + 1)));
    const meds = new Map<string, { n: number; good: number; rated: number }>();
    inMonth.forEach((e) =>
      e.meds.forEach((name) => {
        const r = meds.get(name) ?? { n: 0, good: 0, rated: 0 };
        r.n++;
        if (e.medEffect) r.rated++;
        if (e.medEffect === "good") r.good++;
        meds.set(name, r);
      }),
    );
    const hours = [0, 0, 0, 0]; // 朝・昼・夜・深夜
    inMonth.forEach((e) => {
      const h = new Date(e.startedAt).getHours();
      hours[h >= 5 && h < 11 ? 0 : h >= 11 && h < 17 ? 1 : h >= 17 && h < 23 ? 2 : 3]++;
    });
    return {
      byDay,
      days: byDay.size,
      medDays,
      avg: ints.length ? ints.reduce((a, b) => a + b, 0) / ints.length : null,
      dur: durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : null,
      factors: [...factors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
      meds: [...meds.entries()].sort((a, b) => b[1].n - a[1].n),
      hours,
      prodromes: [...prodromes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    };
  }, [inMonth]);

  const go = (d: number) => {
    haptic("light");
    setDir(d);
    setSel(null);
    setMonth(new Date(m.getFullYear(), m.getMonth() + d, 1).getTime());
  };

  const firstWd = m.getDay();
  const daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const today = dayKey(Date.now());
  const isCurrent = dayKey(month).slice(0, 7) === today.slice(0, 7);
  const selEntries = sel ? (stats.byDay.get(sel) ?? []).sort((a, b) => a.startedAt - b.startedAt) : [];

  const runInsight = async () => {
    if (!loggedIn) return needLogin();
    setInsight({ state: "loading", text: "" });
    haptic("light");
    try {
      setInsight({ state: "done", text: await aiInsight() });
      haptic("success");
    } catch (e) {
      setInsight({
        state: "error",
        text: (e as Error).message === "not_enough" ? "記録が3件以上たまると使えます" : "AIが応答しませんでした",
      });
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} label="記録のまとめ" tall testid="stats-sheet">
      <div className="stats">
        <header className="month">
          <motion.button type="button" className="round-btn" aria-label="前の月" onClick={() => go(-1)} whileTap={{ scale: 0.85 }} data-testid="prev-month">
            <ChevronLeft width={18} height={18} />
          </motion.button>
          <AnimatePresence mode="popLayout" initial={false} custom={dir}>
            <motion.h2
              key={month}
              custom={dir}
              initial={{ opacity: 0, x: dir * 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -24 }}
              transition={spring}
              data-testid="month-title"
            >
              {m.getFullYear()}年{m.getMonth() + 1}月
            </motion.h2>
          </AnimatePresence>
          <motion.button
            type="button"
            className="round-btn"
            aria-label="次の月"
            onClick={() => go(1)}
            whileTap={{ scale: 0.85 }}
            disabled={isCurrent}
          >
            <ChevronRight width={18} height={18} />
          </motion.button>
        </header>

        <div className="kpis">
          <Kpi label="頭痛日数" value={stats.days} unit="日" testid="kpi-days" />
          <Kpi label="服薬日数" value={stats.medDays} unit="日" warn={stats.medDays >= 10} testid="kpi-meddays" />
          <Kpi label="平均の強さ" value={stats.avg != null ? stats.avg.toFixed(1) : "–"} unit={stats.avg != null ? "/3" : ""} />
          <Kpi label="平均持続" value={stats.dur != null ? fmtDuration(stats.dur) : "–"} unit="" small />
        </div>
        <AnimatePresence>
          {stats.medDays >= 10 && (
            <motion.p className="warn" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} data-testid="moh-warning">
              服薬が月10日以上あります。薬の使いすぎによる頭痛（薬剤の使用過多による頭痛）の可能性があるため、医師に相談してください。
            </motion.p>
          )}
        </AnimatePresence>

        <div className="cal" role="grid" aria-label="カレンダー">
          {[...WD].map((w, i) => (
            <span key={w} className={`cal-wd ${i === 0 ? "sun" : i === 6 ? "sat" : ""}`}>
              {w}
            </span>
          ))}
          <AnimatePresence mode="popLayout" initial={false} custom={dir}>
            <motion.div
              key={month}
              className="cal-days"
              custom={dir}
              initial={{ opacity: 0, x: dir * 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -40 }}
              transition={spring}
            >
              {Array.from({ length: firstWd }, (_, i) => (
                <span key={`b${i}`} />
              ))}
              {Array.from({ length: daysIn }, (_, i) => {
                const k = dayKey(new Date(m.getFullYear(), m.getMonth(), i + 1).getTime());
                const list = stats.byDay.get(k);
                const max = list ? Math.max(...list.map((e) => e.intensity)) : -1;
                const med = list?.some((e) => e.meds.length);
                return (
                  <motion.button
                    key={k}
                    type="button"
                    className={`cal-day ${k === today ? "today" : ""} ${sel === k ? "sel" : ""} ${list ? "has" : ""} ${!list && clearDays.has(k) ? "clear" : ""}`}
                    style={{ ["--c" as any]: max >= 0 ? INTENSITY_COLOR[max] : undefined }}
                    data-testid={`day-${k}`}
                    onClick={() => {
                      haptic("light");
                      setSel(sel === k ? null : k);
                    }}
                    whileTap={{ scale: 0.86 }}
                    initial={list ? { scale: 0.6, opacity: 0 } : false}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ ...spring, delay: list ? 0.1 + i * 0.008 : 0 }}
                  >
                    <span className="n">{i + 1}</span>
                    {list && <i className="cal-dot" />}
                    {med && <i className="cal-med" />}
                    {workouts.has(k) && <Dumbbell className="cal-wo" width={11} height={11} />}
                  </motion.button>
                );
              })}
            </motion.div>
          </AnimatePresence>
        </div>

        <AnimatePresence initial={false}>
          {sel && (
            <motion.div
              key={sel}
              className="day-list"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring}
            >
              {sel <= today && (
                <motion.button
                  type="button"
                  className={`wo-toggle ${workouts.has(sel) ? "on" : ""}`}
                  aria-pressed={workouts.has(sel)}
                  data-testid="workout-toggle"
                  whileTap={{ scale: 0.96 }}
                  onClick={() => {
                    const w = workouts.get(sel);
                    if (w) all.filter((e) => kindOf(e) === "workout" && dayKey(e.startedAt) === sel).forEach((e) => actions.remove(e.id));
                    else {
                      const [y, mo, d] = sel.split("-").map(Number);
                      actions.markWorkout(new Date(y, mo - 1, d).getTime());
                    }
                    haptic(w ? "light" : "success");
                  }}
                >
                  <Dumbbell width={16} height={16} />
                  {workouts.has(sel) ? "筋トレした（記録済み）" : "この日に筋トレした"}
                </motion.button>
              )}
              {selEntries.length === 0 ? (
                <p className="muted">頭痛の記録なし</p>
              ) : (
                selEntries.map((e) => (
                  <button key={e.id} type="button" className="day-item" onClick={() => onOpenEntry(e)}>
                    <i className="bar" style={{ background: INTENSITY_COLOR[e.intensity] }} />
                    <b>{fmtTime(e.startedAt)}</b>
                    <span>{INTENSITY.find((o) => o.v === e.intensity)?.label ?? STATUS_META[e.status].label}</span>
                    {e.meds.length > 0 && (
                      <span className="muted">
                        <Pill width={11} height={11} /> {e.meds.join("・")}
                      </span>
                    )}
                    {e.weather && <span className="muted">{Math.round(e.weather.pressure)}hPa · {SKY_LABEL[sky(e.weather.code)]}</span>}
                  </button>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {stats.factors.length > 0 && (
          <Block title="多かったきっかけ">
            <Bars rows={stats.factors.map(([k, n]) => ({ k, n }))} total={inMonth.length} color="var(--teal)" />
          </Block>
        )}

        {stats.prodromes.length > 0 && (
          <Block title="前ぶれ">
            <Bars rows={stats.prodromes.map(([k, n]) => ({ k, n }))} total={inMonth.length} color="var(--indigo)" />
          </Block>
        )}

        {inMonth.length > 0 && (
          <Block title="時間帯">
            <Bars rows={["朝", "昼", "夜", "深夜"].map((k, i) => ({ k, n: stats.hours[i] }))} total={inMonth.length} color="var(--blue)" />
          </Block>
        )}

        {stats.meds.length > 0 && (
          <Block title="薬">
            <div className="med-list">
              {stats.meds.map(([name, r]) => (
                <div key={name} className="med-row">
                  <Pill width={13} height={13} />
                  <span>{name}</span>
                  <b>{r.n}回</b>
                  <span className="muted">{r.rated ? `効いた ${Math.round((r.good / r.rated) * 100)}%` : ""}</span>
                </div>
              ))}
            </div>
          </Block>
        )}

        {fc && (
          <Block title="気圧との関係">
            <p className="plain" data-testid="pressure-relation">{analysisText(fc.analysis)}</p>
          </Block>
        )}

        <Block title="筋トレとの関係">
          <p className="plain" data-testid="workout-relation">
            {woRel ? workoutText(woRel) : "筋トレした日を記録すると、翌日に頭痛が出やすいかを調べます。今日の分はホームの「今日は筋トレした」、前の日はカレンダーの日付をタップして付けられます。"}
          </p>
          {woRel && woRel.after >= 3 && <small className="muted">頭痛の記録がない日は「頭痛なし」として数えています</small>}
        </Block>

        <Block title="生活への支障度">
          {midas[0] ? (
            <div className="midas-now" data-testid="midas-latest">
              <strong>
                {sum(midas[0].midas!)}
                <small>点</small>
              </strong>
              <div>
                <b>
                  グレード{midasGrade(sum(midas[0].midas!)).g}・{midasGrade(sum(midas[0].midas!)).label}
                </b>
                <span className="muted">
                  {fmtDayLong(midas[0].startedAt)}に回答
                  {midas[1] ? `（前回 ${sum(midas[1].midas!)}点）` : ""}
                </span>
              </div>
            </div>
          ) : (
            <p className="plain">過去3か月で、頭痛のために生活にどれくらい支障があったかを5つの質問で点数にします（MIDAS）。受診時の目安になります。</p>
          )}
          <motion.button type="button" className="row-btn center small" onClick={() => setMidasOpen(true)} whileTap={{ scale: 0.97 }} data-testid="midas-open">
            {midas[0] ? "もう一度回答する" : "回答する（約1分）"}
          </motion.button>
        </Block>

        <Block title="AIの見立て">
          <AnimatePresence mode="wait" initial={false}>
            {insight.state === "done" || insight.state === "error" ? (
              <motion.div key="text" className="insight" initial={{ opacity: 0 }} animate={{ opacity: 1 }} data-testid="insight">
                {insight.text.split("\n").map((l, i) => (
                  <motion.p
                    key={i}
                    initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ delay: i * 0.12, duration: 0.4 }}
                  >
                    {l}
                  </motion.p>
                ))}
                {insight.state === "done" && <small className="muted">医療上の判断は医師にご相談ください</small>}
              </motion.div>
            ) : insight.state === "loading" ? (
              <motion.div key="loading" className="insight-sk" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="sk" style={{ height: 14, width: "92%" }} />
                <div className="sk" style={{ height: 14, width: "80%" }} />
                <div className="sk" style={{ height: 14, width: "86%" }} />
              </motion.div>
            ) : null}
          </AnimatePresence>
          <motion.button type="button" className="ai-btn" onClick={runInsight} disabled={insight.state === "loading"} whileTap={{ scale: 0.96 }} data-testid="insight-btn">
            <Sparkles width={16} height={16} />
            {insight.state === "idle" ? "直近90日の傾向を見る" : "もう一度"}
          </motion.button>
        </Block>

        <motion.button type="button" className="row-btn center" onClick={() => setReportOpen(true)} whileTap={{ scale: 0.97 }} data-testid="report-open">
          <Doc width={16} height={16} />
          受診用レポート（印刷・PDF）
        </motion.button>
        <motion.button type="button" className="row-btn center" onClick={() => exportCsv(headaches)} whileTap={{ scale: 0.97 }} data-testid="export">
          <Download width={16} height={16} />
          頭痛ダイアリーを書き出す（CSV）
        </motion.button>
      </div>
      <MidasSheet open={midasOpen} onClose={() => setMidasOpen(false)} />
      <Report open={reportOpen} onClose={() => setReportOpen(false)} month={month} entries={all} analysis={fc?.analysis ?? null} />
    </BottomSheet>
  );
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

function Kpi({ label, value, unit, warn, small, testid }: { label: string; value: string | number; unit: string; warn?: boolean; small?: boolean; testid?: string }) {
  return (
    <div className={`kpi ${warn ? "warn-kpi" : ""}`}>
      <span>{label}</span>
      <motion.strong key={String(value)} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring} className={small ? "small" : ""} data-testid={testid}>
        {value}
        <small>{unit}</small>
      </motion.strong>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="block">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Bars({ rows, total, color }: { rows: { k: string; n: number }[]; total: number; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="bars">
      {rows.map((r, i) => (
        <div key={r.k} className="bar-row">
          <span>{r.k}</span>
          <div className="bar-track">
            <motion.i
              style={{ background: color }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: r.n / max }}
              transition={{ ...spring, delay: 0.05 * i }}
            />
          </div>
          <b>
            {r.n}
            <small>/{total}</small>
          </b>
        </div>
      ))}
    </div>
  );
}

function exportCsv(entries: Entry[]) {
  haptic("light");
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const d = (ms: number | null) => {
    if (!ms) return "";
    const x = new Date(ms);
    return `${dayKey(ms)} ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;
  };
  const head = ["開始", "終了", "持続(分)", "状態", "強さ", "薬", "効き目", "寝不足", "きっかけ", "症状", "前ぶれ", "気圧(hPa)", "6時間変化(日内変動除く)", "24時間変化", "気温", "湿度", "天気", "場所", "メモ"];
  const rows = [...entries]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((e) => [
      d(e.startedAt),
      d(e.endedAt),
      e.endedAt ? Math.round((e.endedAt - e.startedAt) / 6e4) : "",
      STATUS_META[e.status].label,
      INTENSITY.find((o) => o.v === e.intensity)?.label ?? "",
      e.meds.join("・"),
      e.medEffect ? { good: "効いた", some: "少し", none: "効かない" }[e.medEffect] : "",
      e.sleepLack ? "あり" : "",
      e.triggers.join("・"),
      e.symptoms.join("・"),
      (e.prodromes ?? []).join("・"),
      e.weather?.pressure ?? "",
      e.weather?.trend ?? "",
      e.weather?.d24h ?? "",
      e.weather?.temp ?? "",
      e.weather?.humidity ?? "",
      e.weather ? SKY_LABEL[sky(e.weather.code)] : "",
      e.weather?.place ?? "",
      e.memo,
    ]);
  const csv = "﻿" + [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `headache-diary-${dayKey(Date.now())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
