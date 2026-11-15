import { useEffect, useMemo } from "react";
import { animate, AnimatePresence, motion, useMotionValue, useTransform } from "motion/react";
import { checkPermission, loadSeries, nextDrop, sky, SKY_LABEL, snapshotAt, useWeather, type Series } from "./weather";
import { Drop, Location, Refresh, Sky } from "./icons";
import { fmtTime, signed } from "./format";
import { haptic } from "./haptics";

const W = 320;
const H = 84;
const PAD = 6;

export function PressureCard() {
  const ws = useWeather();

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
  const drop = useMemo(() => (s ? nextDrop(s, now) : null), [s, Math.floor(now / 6e5)]);

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
          {cur.d3h != null && <Delta label="3時間" v={cur.d3h} warn={-1.5} testid="d3h" />}
          {cur.d24h != null && <Delta label="24時間" v={cur.d24h} warn={-5} />}
          {drop && drop.d <= -1.5 && (
            <motion.span
              className="delta ahead"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 }}
              data-testid="next-drop"
            >
              {fmtTime(drop.t)}ごろ {signed(drop.d)}
            </motion.span>
          )}
        </div>
        <Chart s={s} now={now} />
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
function Chart({ s, now }: { s: Series; now: number }) {
  const g = useMemo(() => {
    const h = s.hourly;
    const pts: { t: number; p: number }[] = [];
    h.t.forEach((t, i) => {
      const p = h.p[i];
      if (p != null && t >= now - 24 * 36e5 && t <= now + 24 * 36e5) pts.push({ t, p });
    });
    if (pts.length < 4) return null;
    const t0 = now - 24 * 36e5;
    const t1 = now + 24 * 36e5;
    const ps = pts.map((x) => x.p);
    const lo = Math.min(...ps) - 1.5;
    const hi = Math.max(...ps) + 1.5;
    const X = (t: number) => PAD + ((t - t0) / (t1 - t0)) * (W - PAD * 2);
    const Y = (p: number) => PAD + (1 - (p - lo) / (hi - lo)) * (H - PAD * 2 - 14);
    const xy = pts.map((x) => [X(x.t), Y(x.p)] as const);
    const line = smooth(xy);
    const area = `${line} L${xy[xy.length - 1][0]},${H - 14} L${xy[0][0]},${H - 14} Z`;
    const drops: string[] = [];
    for (let i = 3; i < pts.length; i++) {
      if (pts[i].p - pts[i - 3].p <= -1.5 && pts[i].t - pts[i - 3].t <= 3.5 * 36e5) {
        drops.push(smooth(xy.slice(i - 3, i + 1)));
      }
    }
    let nowP = pts[0].p;
    for (const x of pts) if (x.t <= now) nowP = x.p;
    return { line, area, drops, nx: X(now), ny: Y(nowP), lo, hi };
  }, [s, Math.floor(now / 6e5)]);

  if (!g) return null;
  return (
    <svg className="pc-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="気圧の推移">
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
      <text x={PAD} y={H - 2} className="pc-axis">
        24時間前
      </text>
      <text x={g.nx} y={H - 2} className="pc-axis" textAnchor="middle">
        今
      </text>
      <text x={W - PAD} y={H - 2} className="pc-axis" textAnchor="end">
        24時間後
      </text>
      <circle cx={g.nx} cy={g.ny} r="7" className="pc-pulse" />
      <circle cx={g.nx} cy={g.ny} r="3.6" fill="#007aff" stroke="#fff" strokeWidth="1.6" />
    </svg>
  );
}

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
