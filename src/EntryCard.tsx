import { forwardRef, useRef, useState, type ReactElement } from "react";
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform, type PanInfo } from "motion/react";
import type { Entry, Status } from "./types";
import { INTENSITY } from "./types";
import { Bolt, Check, Moon, Pill, Signal, Trash, Undo, Wave } from "./icons";
import { fmtDay, fmtDuration, fmtTime, INTENSITY_COLOR, isDropW, signed } from "./format";
import { haptic } from "./haptics";

export type Action = Status | "delete";

export const STATUS_META: Record<Action, { label: string; color: string; icon: (p: any) => ReactElement }> = {
  pain: { label: "痛い", color: "var(--red)", icon: Undo },
  easing: { label: "和らいだ", color: "var(--orange)", icon: Wave },
  gone: { label: "治まった", color: "var(--green)", icon: Check },
  delete: { label: "削除", color: "var(--gray-dark)", icon: Trash },
};

// 右フリック = 良くなった方へ / 左フリック = 戻す（端は削除）
export const FLICK: Record<Status, { right: Action; left: Action }> = {
  pain: { right: "easing", left: "delete" },
  easing: { right: "gone", left: "pain" },
  gone: { right: "delete", left: "easing" },
};

const THRESHOLD = 88;
const spring = { type: "spring", stiffness: 520, damping: 38 } as const;

type Props = {
  entry: Entry;
  index: number;
  now: number;
  showDate: boolean;
  onAction: (e: Entry, a: Action) => void;
  onOpen: (e: Entry) => void;
};

export const EntryCard = forwardRef<HTMLLIElement, Props>(function EntryCard(
  { entry: e, index, now, showDate, onAction, onOpen },
  ref,
) {
  const x = useMotionValue(0);
  const [armed, setArmed] = useState<"left" | "right" | null>(null);
  const committed = useRef(false);
  const dragged = useRef(false);
  const map = FLICK[e.status];
  const right = STATUS_META[map.right];
  const left = STATUS_META[map.left];

  useMotionValueEvent(x, "change", (v) => {
    if (Math.abs(v) > 4) dragged.current = true;
    if (committed.current) return;
    const next = v > THRESHOLD ? "right" : v < -THRESHOLD ? "left" : null;
    if (next !== armed) {
      setArmed(next);
      if (next) haptic("light");
    }
  });

  const rightOpacity = useTransform(x, [0, 24, THRESHOLD], [0, 0.6, 1]);
  const leftOpacity = useTransform(x, [-THRESHOLD, -24, 0], [1, 0.6, 0]);
  const iconScaleR = useTransform(x, [0, THRESHOLD, THRESHOLD * 1.6], [0.5, 1, 1.15]);
  const iconScaleL = useTransform(x, [-THRESHOLD * 1.6, -THRESHOLD, 0], [1.15, 1, 0.5]);
  const tilt = useTransform(x, [-240, 0, 240], [-2.2, 0, 2.2]);

  const commit = (dir: "left" | "right", velocity = 0) => {
    committed.current = true;
    const action = dir === "right" ? map.right : map.left;
    haptic(action === "gone" ? "success" : "medium");
    const w = window.innerWidth * (dir === "right" ? 1.1 : -1.1);
    animate(x, w, { type: "spring", stiffness: 260, damping: 32, velocity }).then(() => onAction(e, action));
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const { offset, velocity } = info;
    if (offset.x > THRESHOLD || (velocity.x > 600 && offset.x > 24)) commit("right", velocity.x);
    else if (offset.x < -THRESHOLD || (velocity.x < -600 && offset.x < -24)) commit("left", velocity.x);
    else animate(x, 0, spring);
    window.setTimeout(() => (dragged.current = false), 60);
  };

  const resolve = () => {
    committed.current = true;
    const action: Action = e.status === "gone" ? "pain" : "gone";
    haptic(action === "gone" ? "success" : "light");
    window.setTimeout(() => onAction(e, action), 280);
  };

  const int = INTENSITY.find((o) => o.v === e.intensity);
  const w = e.weather;
  const elapsed = (e.endedAt ?? now) - e.startedAt;

  return (
    <motion.li
      ref={ref}
      layout
      className="row"
      data-testid="entry"
      data-status={e.status}
      initial={{ opacity: 0, y: -14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { ...spring, delay: Math.min(index, 8) * 0.035 } }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, transition: { duration: 0.26, ease: [0.32, 0.72, 0, 1] } }}
    >
      <motion.div className="underlay right" style={{ opacity: rightOpacity, background: right.color }}>
        <motion.span style={{ scale: iconScaleR }} className={armed === "right" ? "pulse" : ""}>
          <right.icon width={20} height={20} />
          {right.label}
        </motion.span>
      </motion.div>
      <motion.div className="underlay left" style={{ opacity: leftOpacity, background: left.color }}>
        <motion.span style={{ scale: iconScaleL }} className={armed === "left" ? "pulse" : ""}>
          {left.label}
          <left.icon width={20} height={20} />
        </motion.span>
      </motion.div>

      <motion.div
        className="card glass"
        drag="x"
        dragDirectionLock
        dragMomentum={false}
        style={{ x, rotate: tilt, touchAction: "pan-y", ["--c" as any]: INTENSITY_COLOR[e.intensity] }}
        onDragEnd={onDragEnd}
        whileTap={{ scale: 0.985 }}
        onClick={() => !dragged.current && !committed.current && onOpen(e)}
      >
        <ResolveButton status={e.status} intensity={e.intensity} onTap={resolve} />
        <div className="card-main">
          <div className="card-head">
            <span className="when">
              {showDate && <span className="when-day">{fmtDay(e.startedAt, now)}</span>}
              {fmtTime(e.startedAt)}
            </span>
            <span className="elapsed">
              {e.status === "gone" ? fmtDuration(elapsed) : `${fmtDuration(Math.max(elapsed, 6e4))}経過`}
            </span>
            {int && (
              <span className="int-tag">
                <span className="mini-bars">
                  {[1, 2, 3].map((b) => (
                    <i key={b} className={b <= e.intensity ? "f" : ""} />
                  ))}
                </span>
                {int.label}
              </span>
            )}
          </div>
          {e.memo && <p className="memo">{e.memo}</p>}
          <div className="tags">
            {e.meds.map((m) => (
              <span key={m} className="tag purple">
                <Pill width={12} height={12} />
                {m}
              </span>
            ))}
            {e.sleepLack && (
              <span className="tag indigo">
                <Moon width={11} height={11} />
                寝不足
              </span>
            )}
            {e.triggers.map((t) => (
              <span key={t} className="tag teal">
                <Bolt width={11} height={11} />
                {t}
              </span>
            ))}
            {e.symptoms.map((t) => (
              <span key={t} className="tag pink">
                {t}
              </span>
            ))}
            {(e.prodromes ?? []).map((t) => (
              <span key={`p-${t}`} className="tag indigo">
                <Signal width={11} height={11} />
                {t}
              </span>
            ))}
            {w && (
              <span className={`tag hpa ${isDropW(w) ? "drop" : ""}`} data-testid="entry-weather">
                {Math.round(w.pressure)}hPa
                {w.trend != null ? <b>{signed(w.trend)}</b> : w.d24h != null && <b>{signed(w.d24h)}</b>}
              </span>
            )}
          </div>
        </div>
      </motion.div>
    </motion.li>
  );
});

function ResolveButton({ status, intensity, onTap }: { status: Status; intensity: number; onTap: () => void }) {
  const [on, setOn] = useState(status === "gone");
  return (
    <motion.button
      type="button"
      className={`check ${status}`}
      style={{ ["--c" as any]: INTENSITY_COLOR[intensity] }}
      aria-label={status === "gone" ? "痛いに戻す" : "治まった"}
      data-testid="resolve"
      onPointerDownCapture={(ev) => ev.stopPropagation()}
      onClick={(ev) => {
        ev.stopPropagation();
        setOn(!on);
        onTap();
      }}
      whileTap={{ scale: 0.8 }}
    >
      {status === "pain" && !on && <span className="pain-ring" />}
      <motion.span
        className="check-fill"
        initial={false}
        animate={{ scale: on ? 1 : 0, opacity: on ? 1 : 0 }}
        transition={{ type: "spring", stiffness: 600, damping: 26 }}
      />
      <svg viewBox="0 0 24 24" width="16" height="16" className="check-mark" aria-hidden>
        <motion.path
          d="m5 12.5 4.5 4.5L19 7.5"
          fill="none"
          stroke="#fff"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: on ? 1 : 0 }}
          transition={{ duration: 0.28, delay: on ? 0.06 : 0 }}
        />
      </svg>
      {status === "easing" && !on && <span className="easing-dot" />}
    </motion.button>
  );
}
