import { useEffect, useMemo, useState } from "react";
import { animate, AnimatePresence, motion, useMotionValue, useTransform } from "motion/react";
import { checkPermission, loadSeries, sky, SKY_LABEL, snapshotAt, useWeather, type Series } from "./weather";
import { ChevronRight, Drop, Location, Refresh, Sky } from "./icons";
import { signed } from "./format";
import { analysisText, useForecast, whenLabel, type Forecast } from "./useForecast";
import { findDrops, GENERAL_THRESHOLD, LEVEL_LABEL } from "./forecast";
import type { Entry } from "./types";
import { haptic } from "./haptics";

const W = 320;
const H = 100;
const PAD = 6;

export function PressureCard({ entries }: { entries: Entry[] }) {
  const ws = useWeather();
  const fc = useForecast(entries);
  const [range, setRange] = useState<"2d" | "week">("2d");

  useEffect(() => {
    checkPermission();
  }, []);
  // 許可済みなら開いた時点で取得、以降 30 分ごと・前面に戻ったときに更新
  useEffect(() => {
    if (ws.geo !== "granted") return;
    loadSeries();
    const iv = window.setInterval(() => loadSeries(), 30 * 6e4);
    const onVis = () => document.visibilityState === "visible" && loadSeries();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ws.geo]);

  const s = ws.series;
  const now = Date.now();
  const cur = useMemo(() => (s ? snapshotAt(s, now) : null), [s, Math.floor(now / 6e5)]);
  const trend = trendOf(cur?.trend ?? null, cur?.d24h ?? null);

  // 画面上部の空の色を気圧の傾向に合わせる
  useEffect(() => {
    const key = cur ? trend.key : "none";
    document.documentElement.dataset.sky = key;
    const top = { steady: "#d9e9ff", falling: "#ffe1bf", steep: "#ffc9a8", rising: "#d6f3f6", none: "#eef0f4" }[key];
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", top);
  }, [cur ? trend.key : "none"]);

  let body;
  if (s && cur) {
    const kind = sky(cur.code);
    body = (
      <motion.div key="data" className="pc-data" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
        <div className="pc-top">
          <div className="pc-now">
            <span className="pc-label">
              <Location width={11} height={11} />
              {s.place ?? "現在地"}
            </span>
            <span className="pc-value" data-testid="pressure-now">
              <Count value={cur.pressure} />
              <small>hPa</small>
            </span>
            {cur.trend != null && (
              <span className={`pc-trend ${trend.key}`} data-testid="trend">
                {trend.label}
              </span>
            )}
          </div>
          <div className="pc-side">
            <span className="pc-sky" title={SKY_LABEL[kind]}>
              <Sky kind={kind} width={26} height={26} />
              {cur.temp != null && <b>{Math.round(cur.temp)}°</b>}
            </span>
            {cur.humidity != null && (
              <span className="pc-hum">
                <Drop width={11} height={11} />
                {cur.humidity}%
              </span>
            )}
          </div>
        </div>
        <div className="pc-deltas">
          {cur.trend != null && <Delta label="6時間" v={cur.trend} warn={-2} testid="d6h" />}
          {cur.d24h != null && <Delta label="24時間" v={cur.d24h} warn={-5} />}
          {s.daily && s.daily.t.length > 2 && (
            <div className="range" role="tablist" aria-label="グラフの期間">
              {(["2d", "week"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={range === r}
                  className={range === r ? "on" : ""}
                  data-testid={`range-${r}`}
                  onClick={() => {
                    haptic("light");
                    setRange(r);
                  }}
                >
                  {range === r && <motion.span layoutId="range-pill" className="range-pill" transition={{ type: "spring", stiffness: 520, damping: 38 }} />}
                  <span>{r === "2d" ? "2日" : "1週間"}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <Chart s={s} now={now} threshold={fc?.analysis.threshold ?? GENERAL_THRESHOLD} range={range} />
        {fc && <ForecastRow fc={fc} />}
        {s.daily && s.daily.t.length > 2 && <WeekStrip s={s} threshold={fc?.analysis.threshold ?? GENERAL_THRESHOLD} />}
      </motion.div>
    );
  } else if (ws.geo === "denied" || ws.geo === "unsupported") {
    body = (
      <motion.p key="denied" className="pc-msg" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Location width={14} height={14} />
        位置情報がオフのため気圧を取得できません
      </motion.p>
    );
  } else if (ws.loading || ws.geo === "unknown" || (ws.geo === "granted" && !ws.error)) {
    body = (
      <motion.div key="sk" className="pc-sk" exit={{ opacity: 0 }} aria-busy="true" aria-label="読み込み中">
        <div className="sk" style={{ width: 90, height: 12 }} />
        <div className="sk" style={{ width: 150, height: 30, marginTop: 8 }} />
        <div className="sk" style={{ height: 64, marginTop: 14, borderRadius: 14 }} />
      </motion.div>
    );
  } else {
    body = (
      <motion.button
        key="ask"
        type="button"
        className="pc-ask"
        data-testid="weather-enable"
        onClick={() => {
          haptic("light");
          loadSeries({ force: true });
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        whileTap={{ scale: 0.97 }}
      >
        {ws.error ? <Refresh width={16} height={16} /> : <Location width={16} height={16} />}
        {ws.error ? "気圧を再取得" : "現在地の気圧を表示"}
      </motion.button>
    );
  }

  return (
    <section className="pressure glass" aria-label="気圧" data-testid="pressure-card">
      <AnimatePresence mode="wait" initial={false}>
        {body}
      </AnimatePresence>
    </section>
  );
}

// この先 48 時間の注意予報（最初の 2 件）
function ForecastRow({ fc }: { fc: Forecast }) {
  const [open, setOpen] = useState(false);
  const evs = fc.events.slice(0, 2);
  return (
    <div className="fc" data-testid="forecast">
      {evs.length === 0 ? (
        <p className="fc-none">この先48時間、頭痛に注意が必要な下がり方はありません</p>
      ) : (
        evs.map((ev, i) => (
          <motion.div
            key={ev.from}
            className={`fc-ev ${ev.level}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.06, duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            data-testid="forecast-event"
          >
            <span className="fc-level">注意 {LEVEL_LABEL[ev.level]}</span>
            <span className="fc-text">
              {ev.from <= Date.now() + 30 * 6e4 ? (
                <>
                  <b>今、下がっています</b>
                  {whenLabel(ev.to)}まで続く見込み（6時間で {signed(ev.peak)}hPa）
                </>
              ) : (
                <>
                  <b>{whenLabel(ev.from)}から</b>
                  気圧が下がります（6時間で {signed(ev.peak)}hPa）
                </>
              )}
            </span>
          </motion.div>
        ))
      )}
      <button type="button" className="fc-basis" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="forecast-basis">
        {fc.analysis.mode === "personal" ? "あなたの記録にもとづく予報" : fc.analysis.mode === "unclear" ? "大きな低下だけを表示中" : "一般的な目安による予報"}
        <ChevronRight width={12} height={12} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 200ms" }} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.p
            className="fc-why"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
          >
            {analysisText(fc.analysis)}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

type TrendKey = "steady" | "falling" | "steep" | "rising";
// 日内変動を除いた 6 時間あたりの変化で判定
function trendOf(d6: number | null, d24h: number | null): { key: TrendKey; label: string } {
  if (d6 == null) return { key: "steady", label: "" };
  if (d6 <= -3.2) return { key: "steep", label: "急に下がっています" };
  if (d6 <= -2) return { key: "falling", label: "下がっています" };
  if (d24h != null && d24h <= -5) return { key: "falling", label: "この1日で大きく下がりました" };
  if (d6 >= 2) return { key: "rising", label: "上がっています" };
  if (d24h != null && d24h >= 5) return { key: "rising", label: "この1日で大きく上がりました" };
  return { key: "steady", label: "安定しています" };
}

function Delta({ label, v, warn, testid }: { label: string; v: number; warn: number; testid?: string }) {
  const cls = v <= warn ? "down" : v >= -warn ? "up" : "";
  return (
    <span className={`delta ${cls}`} data-testid={testid}>
      {label}
      <b>{signed(v)}</b>
    </span>
  );
}

function Count({ value }: { value: number }) {
  const mv = useMotionValue(value - 8);
  const text = useTransform(mv, (v) => Math.round(v).toString());
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [value]);
  return <motion.span>{text}</motion.span>;
}

// 過去 24 時間〜24 時間後の気圧。急な低下（3 時間で 1.5hPa 以上）の区間を強調する
function Chart({ s, now, threshold, range }: { s: Series; now: number; threshold: number; range: "2d" | "week" }) {
  const g = useMemo(() => {
    const h = s.hourly;
    const t0 = now - 24 * 36e5;
    const last = h.t[h.t.length - 1] ?? now;
    const t1 = range === "week" ? Math.min(last, now + 7 * 864e5) : now + 24 * 36e5;
    const pts: { t: number; p: number }[] = [];
    h.t.forEach((t, i) => {
      const p = h.p[i];
      if (p != null && t >= t0 && t <= t1) pts.push({ t, p });
    });
    if (pts.length < 4) return null;
    const ps = pts.map((x) => x.p);
    const lo = Math.min(...ps) - 1.5;
    const hi = Math.max(...ps) + 1.5;
    const X = (t: number) => PAD + ((t - t0) / (t1 - t0)) * (W - PAD * 2);
    const Y = (p: number) => PAD + (1 - (p - lo) / (hi - lo)) * (H - PAD * 2 - 14);
    const xy = pts.map((x) => [X(x.t), Y(x.p)] as const);
    const line = smooth(xy);
    const area = `${line} L${xy[xy.length - 1][0]},${H - 14} L${xy[0][0]},${H - 14} Z`;
    // 注意が必要な低下の区間（日内変動を除いた下がり方で判定）をオレンジに
    const drops = findDrops(s.hourly, t0, t1, threshold)
      .map((ev) => xy.filter((_, i) => pts[i].t >= ev.from && pts[i].t <= ev.to))
      .filter((seg) => seg.length >= 2)
      .map((seg) => smooth(seg));
    let nowP = pts[0].p;
    for (const x of pts) if (x.t <= now) nowP = x.p;
    // 1 週間表示では日付の区切りと曜日を出す
    // 線は日付の境目、曜日は各日の正午に置く（「今」と重なるものは出さない）
    const days: { x: number; lx: number | null; label: string }[] = [];
    if (range === "week") {
      const d = new Date(now);
      for (let k = 1; k <= 7; k++) {
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + k).getTime();
        if (start > t1) break;
        const noon = start + 12 * 36e5;
        const lx = noon <= t1 && Math.abs(X(noon) - X(now)) > 14 ? X(noon) : null;
        days.push({ x: X(start), lx, label: "日月火水木金土"[new Date(start).getDay()] });
      }
    }
    return { line, area, drops, nx: X(now), ny: Y(nowP), lo, hi, days };
  }, [s, threshold, range, Math.floor(now / 6e5)]);

  if (!g) return null;
  return (
    <svg className="pc-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={range === "week" ? "気圧の推移（1週間）" : "気圧の推移"} key={range}>
      <defs>
        <linearGradient id="pcfill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#007aff" stopOpacity=".22" />
          <stop offset="1" stopColor="#007aff" stopOpacity="0" />
        </linearGradient>
        <clipPath id="pcpast">
          <rect x="0" y="0" width={g.nx} height={H} />
        </clipPath>
        <clipPath id="pcfuture">
          <rect x={g.nx} y="0" width={W - g.nx} height={H} />
        </clipPath>
      </defs>
      <motion.path
        d={g.area}
        fill="url(#pcfill)"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.3 }}
      />
      <motion.path
        d={g.line}
        fill="none"
        stroke="#007aff"
        strokeWidth="2.2"
        strokeLinecap="round"
        clipPath="url(#pcpast)"
        vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
      />
      <motion.path
        d={g.line}
        fill="none"
        stroke="#007aff"
        strokeOpacity=".45"
        strokeWidth="2"
        strokeDasharray="3 4"
        clipPath="url(#pcfuture)"
        vectorEffect="non-scaling-stroke"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.7 }}
      />
      {g.drops.map((d, i) => (
        <motion.path
          key={i}
          d={d}
          fill="none"
          stroke="#ff9500"
          strokeWidth="3"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 + i * 0.02 }}
        />
      ))}
      <line x1={g.nx} x2={g.nx} y1={PAD} y2={H - 14} stroke="rgba(60,60,67,.25)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      {g.days.map((d) => (
        <g key={d.x}>
          <line x1={d.x} x2={d.x} y1={PAD} y2={H - 14} stroke="rgba(60,60,67,.1)" vectorEffect="non-scaling-stroke" />
          {d.lx != null && (
            <text x={d.lx} y={H - 2} className="pc-axis" textAnchor="middle">
              {d.label}
            </text>
          )}
        </g>
      ))}
      {range === "2d" && (
        <text x={PAD} y={H - 2} className="pc-axis">
          24時間前
        </text>
      )}
      <text x={g.nx} y={H - 2} className="pc-axis" textAnchor="middle">
        今
      </text>
      {range === "2d" && (
        <text x={W - PAD} y={H - 2} className="pc-axis" textAnchor="end">
          24時間後
        </text>
      )}
      <circle cx={g.nx} cy={g.ny} r="7" className="pc-pulse" />
      <circle cx={g.nx} cy={g.ny} r="3.6" fill="#007aff" stroke="#fff" strokeWidth="1.6" />
    </svg>
  );
}

// 週間予報：天気・最高/最低気温・降水確率と、その日の気圧の注意
function WeekStrip({ s, threshold }: { s: Series; threshold: number }) {
  const days = useMemo(() => {
    const d = s.daily!;
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    return d.t
      .map((t, i) => ({ t, code: d.code[i], tmax: d.tmax[i], tmin: d.tmin[i], pop: d.pop[i] }))
      .filter((x) => x.t >= start - 36e5)
      .slice(0, 7)
      .map((x) => {
        const evs = findDrops(s.hourly, Math.max(x.t, Date.now()), x.t + 864e5, threshold);
        const peak = evs.length ? Math.min(...evs.map((e) => e.peak)) : null;
        const level = peak == null ? null : peak <= threshold * 1.6 ? "high" : "mid";
        return { ...x, peak, level };
      });
  }, [s, threshold]);
  const today = dayKeyLocal(Date.now());
  return (
    <div className="week" data-testid="week">
      <div className="week-scroll">
        {days.map((d, i) => {
          const dt = new Date(d.t);
          const isToday = dayKeyLocal(d.t) === today;
          return (
            <motion.div
              key={d.t}
              className={`wk ${d.level ?? ""}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 + i * 0.03, duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
              data-testid="week-day"
              title={d.peak != null ? `気圧の低下 6時間で ${signed(d.peak)}hPa` : undefined}
            >
              <span className={`wk-day ${dt.getDay() === 0 ? "sun" : dt.getDay() === 6 ? "sat" : ""}`}>{isToday ? "今日" : "日月火水木金土"[dt.getDay()]}</span>
              <Sky kind={sky(d.code)} width={26} height={26} />
              <span className="wk-t">
                <b>{d.tmax != null ? Math.round(d.tmax) : "–"}°</b>
                <small>{d.tmin != null ? Math.round(d.tmin) : "–"}°</small>
              </span>
              <span className="wk-pop">{d.pop != null ? `${d.pop}%` : ""}</span>
              <span className="wk-alert">{d.level ? (d.level === "high" ? "注意 高" : "注意") : ""}</span>
            </motion.div>
          );
        })}
      </div>
      <p className="wk-note">「注意」は気圧が頭痛に注意が必要な下がり方をする日。3日先以降は予報の精度が下がります</p>
    </div>
  );
}

const dayKeyLocal = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

// Catmull-Rom → ベジェで滑らかな線に
function smooth(pts: readonly (readonly [number, number])[]) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
