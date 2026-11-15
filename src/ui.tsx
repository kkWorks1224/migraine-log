import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useDragControls } from "motion/react";
import { INTENSITY } from "./types";
import { INTENSITY_COLOR } from "./format";
import { haptic } from "./haptics";
import { Plus } from "./icons";

export const spring = { type: "spring", stiffness: 520, damping: 34 } as const;
export const softSpring = { type: "spring", stiffness: 380, damping: 34 } as const;

export function Chip({
  on,
  onClick,
  children,
  tone = "blue",
  testid,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  tone?: "blue" | "purple" | "indigo" | "teal" | "pink";
  testid?: string;
}) {
  return (
    <motion.button
      type="button"
      layout="position"
      className={`chip ${tone} ${on ? "on" : ""}`}
      aria-pressed={on}
      data-testid={testid}
      onClick={() => {
        haptic("light");
        onClick();
      }}
      whileTap={{ scale: 0.9 }}
      transition={spring}
    >
      <AnimatePresence initial={false}>
        {on && (
          <motion.span
            className="chip-glow"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={spring}
          />
        )}
      </AnimatePresence>
      <span className="chip-label">{children}</span>
    </motion.button>
  );
}

export function ChipSet({
  options,
  value,
  onChange,
  tone,
  testid,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  tone?: "blue" | "purple" | "indigo" | "teal" | "pink";
  testid?: string;
}) {
  const extra = value.filter((v) => !options.includes(v));
  return (
    <>
      {[...options, ...extra].map((o) => (
        <Chip
          key={o}
          tone={tone}
          testid={testid ? `${testid}-${o}` : undefined}
          on={value.includes(o)}
          onClick={() => onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o])}
        >
          {o}
        </Chip>
      ))}
    </>
  );
}

// 自由入力で選択肢を追加（薬の名前など）
export function AddChip({ onAdd, label }: { onAdd: (v: string) => void; label: string }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  const commit = () => {
    const v = ref.current?.value.trim();
    if (v) onAdd(v.slice(0, 40));
    setEditing(false);
  };
  return (
    <motion.div layout="position" className={`chip add ${editing ? "editing" : ""}`} transition={spring}>
      {editing ? (
        <input
          ref={ref}
          aria-label={label}
          placeholder={label}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <button type="button" aria-label={label} onClick={() => setEditing(true)} data-testid="add-chip">
          <Plus width={16} height={16} />
        </button>
      )}
    </motion.div>
  );
}

export function IntensityPicker({ value, onChange }: { value: number; onChange: (v: 0 | 1 | 2 | 3) => void }) {
  const uid = useId();
  return (
    <div className="intensity" role="radiogroup" aria-label="強さ">
      {INTENSITY.map((o) => {
        const on = value === o.v;
        return (
          <motion.button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={on}
            data-testid={`intensity-${o.v}`}
            className={`int-btn ${on ? "on" : ""}`}
            style={{ ["--c" as any]: INTENSITY_COLOR[o.v] }}
            onClick={() => {
              haptic(o.v === 3 ? "medium" : "light");
              onChange(on ? 0 : o.v);
            }}
            whileTap={{ scale: 0.92 }}
          >
            {on && <motion.span layoutId={`int-pill-${uid}`} className="int-pill" transition={spring} />}
            <span className="int-bars" aria-hidden>
              {[1, 2, 3].map((b) => (
                <motion.i
                  key={b}
                  animate={{ scaleY: b <= o.v ? 1 : 0.45, opacity: b <= o.v ? 1 : 0.3 }}
                  transition={{ ...spring, delay: on ? b * 0.04 : 0 }}
                />
              ))}
            </span>
            <span className="int-label">{o.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  id,
  render,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  id: string;
  render: (v: T, on: boolean) => ReactNode;
}) {
  return (
    <div className="seg glass" role="tablist" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={value === t}
          className={`seg-item ${value === t ? "on" : ""}`}
          onClick={() => {
            if (t !== value) haptic("light");
            onChange(t);
          }}
          data-testid={`${id}-${t}`}
        >
          {value === t && <motion.span layoutId={`seg-pill-${id}`} className="seg-pill" transition={spring} />}
          <span className="seg-label">{render(t, value === t)}</span>
        </button>
      ))}
    </div>
  );
}

// iOS のシート：下から出てきて、つまみを下へ引くと閉じる
export function BottomSheet({
  open,
  onClose,
  label,
  children,
  tall,
  testid,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  tall?: boolean;
  testid?: string;
}) {
  const controls = useDragControls();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.documentElement.classList.add("locked");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("locked");
    };
  }, [open, onClose]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            className="scrim"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            key="sheet"
            className={`sheet glass ${tall ? "tall" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            data-testid={testid}
            initial={{ y: "105%" }}
            animate={{ y: 0 }}
            exit={{ y: "105%" }}
            transition={{ type: "spring", stiffness: 360, damping: 36 }}
            drag="y"
            dragListener={false}
            dragControls={controls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.9 }}
            onDragEnd={(_, i) => (i.offset.y > 100 || i.velocity.y > 500) && onClose()}
          >
            <div className="grab-zone" onPointerDown={(e) => controls.start(e)}>
              <div className="grabber" />
            </div>
            <div className="sheet-body">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
