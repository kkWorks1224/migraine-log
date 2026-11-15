import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { actions, aiParse, blankDraft, fromLocalInput, toLocalInput, type Draft } from "./store";
import { INTENSITY, SYMPTOMS, TRIGGERS, type Entry } from "./types";
import { fmtWhen, INTENSITY_COLOR, medSuggestions } from "./format";
import { AddChip, ChipSet, IntensityPicker, spring } from "./ui";
import { ArrowUp, Bolt, Clock, Moon, Pill, Sparkles, Wave } from "./icons";
import { haptic } from "./haptics";
import { STATUS_META } from "./EntryCard";

type Panel = "intensity" | "meds" | "triggers" | "symptoms" | null;

const DRAFT_KEY = "ml.draft";
const DETAIL_KEY = "ml.draft.detail";

function loadDetail(): { d: Draft; custom: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(DETAIL_KEY) || "null");
    if (v?.d) return v;
  } catch {}
  return { d: blankDraft(), custom: false };
}

export function Composer({
  entries,
  loggedIn,
  onAdded,
  needLogin,
  toast,
}: {
  entries: Entry[];
  loggedIn: boolean;
  onAdded: (e: Entry) => void;
  needLogin: () => void;
  toast: (text: string) => void;
}) {
  // 入力欄は index.html に静的に置いてあり（JS 読み込み前から書ける）、ここでは振る舞いを付与する
  const el = useMemo(() => document.getElementById("memo") as HTMLTextAreaElement, []);
  const form = useMemo(() => document.getElementById("composer") as HTMLFormElement, []);
  const actionsHost = useMemo(() => document.getElementById("composer-actions")!, []);
  const toolsHost = useMemo(() => document.getElementById("composer-tools")!, []);

  const [hasText, setHasText] = useState(() => el.value.trim().length > 0);
  const [focused, setFocused] = useState(() => document.activeElement === el);
  const [{ d, custom }, setDetail] = useState(loadDetail);
  const [panel, setPanel] = useState<Panel>(null);
  const [thinking, setThinking] = useState(false);
  const [filled, setFilled] = useState(0); // AI が埋めた直後の強調用
  const timeRef = useRef<HTMLInputElement>(null);

  const dirty =
    d.intensity > 0 || d.meds.length > 0 || d.sleepLack || d.triggers.length > 0 || d.symptoms.length > 0 || custom || d.status !== "pain";
  const open = hasText || dirty || focused || panel !== null;
  const canSend = hasText || dirty;

  const update = (p: Partial<Draft>, c = custom) =>
    setDetail((prev) => {
      const next = { d: { ...prev.d, ...p }, custom: c };
      try {
        localStorage.setItem(DETAIL_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

  const reset = () => {
    el.value = "";
    setHasText(false);
    setPanel(null);
    const next = { d: blankDraft(), custom: false };
    setDetail(next);
    try {
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(DETAIL_KEY);
    } catch {}
  };

  const latest = useRef({ d, custom, onAdded });
  latest.current = { d, custom, onAdded };

  const submit = useCallback(() => {
    const memo = el.value.trim();
    const { d, custom, onAdded } = latest.current;
    const isDirty =
      d.intensity > 0 || d.meds.length > 0 || d.sleepLack || d.triggers.length > 0 || d.symptoms.length > 0 || custom;
    if (!memo && !isDirty) return;
    const e = actions.add({ ...d, memo, startedAt: custom ? d.startedAt : Date.now() });
    reset();
    haptic("success");
    form.animate(
      [{ transform: "scale(1)" }, { transform: "scale(0.98)" }, { transform: "scale(1)" }],
      { duration: 300, easing: "cubic-bezier(.3,.7,.2,1)" },
    );
    onAdded(e);
    el.blur();
  }, [el, form]);

  useEffect(() => {
    const onInput = () => setHasText(el.value.trim().length > 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        submit();
      }
    };
    let t: number | undefined;
    const onIn = () => {
      clearTimeout(t);
      setFocused(true);
    };
    // ツールのタップでいったんフォーカスが外れても閉じないよう少し待つ
    const onOut = () => {
      t = window.setTimeout(() => setFocused(form.contains(document.activeElement)), 180);
    };
    const onDown = () => clearTimeout(t);
    el.addEventListener("input", onInput);
    el.addEventListener("keydown", onKey);
    form.addEventListener("focusin", onIn);
    form.addEventListener("focusout", onOut);
    form.addEventListener("pointerdown", onDown);
    form.addEventListener("submit", (e) => e.preventDefault());
    onInput();
    if (document.activeElement !== el && !/iP(hone|ad|od)|Android/.test(navigator.userAgent)) el.focus({ preventScroll: true });
    // ウィンドウが非アクティブだと focus イベントが来ないため、実際のフォーカス状態を直接反映する
    setFocused(form.contains(document.activeElement));
    const recheck = window.setTimeout(() => setFocused(form.contains(document.activeElement)), 400);
    return () => {
      clearTimeout(recheck);
      el.removeEventListener("input", onInput);
      el.removeEventListener("keydown", onKey);
      form.removeEventListener("focusin", onIn);
      form.removeEventListener("focusout", onOut);
      form.removeEventListener("pointerdown", onDown);
    };
  }, [el, form, submit]);

  useEffect(() => {
    form.classList.toggle("thinking", thinking);
    form.classList.toggle("open", open);
    el.readOnly = thinking;
  }, [thinking, open, form, el]);

  const runAI = async () => {
    const v = el.value.trim();
    if (!v || thinking) return;
    if (!loggedIn) return needLogin();
    setThinking(true);
    haptic("light");
    try {
      const p = await aiParse(v);
      el.value = p.memo;
      try {
        localStorage.setItem(DRAFT_KEY, p.memo);
      } catch {}
      setHasText(true);
      const t = p.time ? fromLocalInput(p.time) : null;
      const useTime = t !== null && t <= Date.now() + 10 * 6e4 && t > Date.now() - 7 * 864e5;
      const prev = latest.current.d;
      update(
        {
          intensity: p.intensity || prev.intensity,
          meds: [...new Set([...prev.meds, ...p.meds])],
          medEffect: p.medEffect ?? prev.medEffect,
          sleepLack: prev.sleepLack || p.sleepLack,
          triggers: [...new Set([...prev.triggers, ...p.triggers])],
          symptoms: [...new Set([...prev.symptoms, ...p.symptoms])],
          status: p.status,
          ...(useTime ? { startedAt: t! } : {}),
        },
        useTime || latest.current.custom,
      );
      setFilled(Date.now());
      haptic("success");
    } catch {
      toast("AIが応答しませんでした");
    } finally {
      setThinking(false);
    }
  };

  const meds = medSuggestions(entries, d.meds);
  const togglePanel = (p: Panel) => {
    haptic("light");
    setPanel((cur) => (cur === p ? null : p));
  };
  const int = INTENSITY.find((o) => o.v === d.intensity);

  const tools = (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="tools"
          className="tools"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 40 }}
        >
          <div className="toolbar" key={filled}>
            <Tool
              on={custom}
              onClick={() => {
                const input = timeRef.current!;
                input.value = toLocalInput(custom ? d.startedAt : Date.now());
                try {
                  input.showPicker();
                } catch {
                  input.focus();
                }
              }}
              testid="tool-time"
              i={0}
              flash={!!filled}
            >
              <Clock width={16} height={16} />
              {custom ? fmtWhen(d.startedAt) : "今"}
              <input
                ref={timeRef}
                type="datetime-local"
                className="time-input"
                tabIndex={-1}
                aria-label="始まった時刻"
                data-testid="time-input"
                max={toLocalInput(Date.now() + 6e4)}
                onChange={(e) => {
                  const t = fromLocalInput(e.target.value);
                  if (t) update({ startedAt: Math.min(t, Date.now()) }, true);
                }}
              />
            </Tool>
            <Tool on={d.intensity > 0} active={panel === "intensity"} onClick={() => togglePanel("intensity")} testid="tool-intensity" i={1} flash={!!filled}>
              <span className="mini-bars" style={{ ["--c" as any]: INTENSITY_COLOR[d.intensity] }}>
                {[1, 2, 3].map((b) => (
                  <i key={b} className={b <= d.intensity ? "f" : ""} />
                ))}
              </span>
              {int ? int.label : "強さ"}
            </Tool>
            <Tool on={d.meds.length > 0} active={panel === "meds"} onClick={() => togglePanel("meds")} testid="tool-meds" i={2} flash={!!filled}>
              <Pill width={16} height={16} />
              {d.meds.length ? d.meds.join("・") : "薬"}
            </Tool>
            <Tool
              on={d.sleepLack}
              onClick={() => {
                haptic("light");
                update({ sleepLack: !d.sleepLack });
              }}
              testid="tool-sleep"
              i={3}
              flash={!!filled}
            >
              <Moon width={15} height={15} />
              寝不足
            </Tool>
            <Tool on={d.triggers.length > 0} active={panel === "triggers"} onClick={() => togglePanel("triggers")} testid="tool-triggers" i={4} flash={!!filled}>
              <Bolt width={15} height={15} />
              {d.triggers.length ? (d.triggers.length === 1 ? d.triggers[0] : `きっかけ ${d.triggers.length}`) : "きっかけ"}
            </Tool>
            <Tool on={d.symptoms.length > 0} active={panel === "symptoms"} onClick={() => togglePanel("symptoms")} testid="tool-symptoms" i={5} flash={!!filled}>
              <Wave width={16} height={16} />
              {d.symptoms.length ? (d.symptoms.length === 1 ? d.symptoms[0] : `症状 ${d.symptoms.length}`) : "症状"}
            </Tool>
            {d.status !== "pain" && (
              <Tool on onClick={() => update({ status: "pain" })} testid="tool-status" i={6}>
                <i className={`dot ${d.status}`} />
                {STATUS_META[d.status].label}
              </Tool>
            )}
          </div>
          <AnimatePresence initial={false} mode="popLayout">
            {panel && (
              <motion.div
                key={panel}
                className="panel"
                initial={{ opacity: 0, y: -6, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -4, filter: "blur(4px)", transition: { duration: 0.12 } }}
                transition={spring}
                data-testid={`panel-${panel}`}
              >
                {panel === "intensity" && (
                  <IntensityPicker
                    value={d.intensity}
                    onChange={(v) => {
                      update({ intensity: v });
                      if (v) window.setTimeout(() => setPanel((p) => (p === "intensity" ? null : p)), 260);
                    }}
                  />
                )}
                {panel === "meds" && (
                  <div className="chips">
                    <ChipSet options={meds} value={d.meds} onChange={(v) => update({ meds: v })} tone="purple" testid="med" />
                    <AddChip label="薬の名前" onAdd={(v) => update({ meds: [...new Set([...d.meds, v])] })} />
                  </div>
                )}
                {panel === "triggers" && (
                  <div className="chips">
                    <ChipSet options={TRIGGERS} value={d.triggers} onChange={(v) => update({ triggers: v })} tone="teal" testid="trigger" />
                  </div>
                )}
                {panel === "symptoms" && (
                  <div className="chips">
                    <ChipSet options={SYMPTOMS} value={d.symptoms} onChange={(v) => update({ symptoms: v })} tone="pink" testid="symptom" />
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );

  const buttons = (
    <AnimatePresence>
      {canSend && (
        <motion.div
          className="composer-actions"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
        >
          {hasText && (
            <motion.button
              type="button"
              className="icon-btn ai"
              aria-label="AIで整理"
              data-testid="ai"
              onClick={runAI}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1, rotate: thinking ? 360 : 0 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={thinking ? { rotate: { repeat: Infinity, duration: 1.4, ease: "linear" }, default: spring } : spring}
              whileTap={{ scale: 0.85 }}
            >
              <Sparkles width={20} height={20} />
            </motion.button>
          )}
          <motion.button
            type="button"
            className={`icon-btn send ${filled ? "nudge" : ""}`}
            aria-label="記録する"
            data-testid="send"
            key={`send-${filled}`}
            onClick={submit}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ ...spring, delay: 0.04 }}
            whileTap={{ scale: 0.85 }}
          >
            <ArrowUp width={18} height={18} />
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      {createPortal(buttons, actionsHost)}
      {createPortal(tools, toolsHost)}
    </>
  );
}

function Tool({
  on,
  active,
  onClick,
  children,
  testid,
  i,
  flash,
}: {
  on: boolean;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testid: string;
  i: number;
  flash?: boolean;
}) {
  return (
    <motion.button
      type="button"
      className={`tool ${on ? "on" : ""} ${active ? "active" : ""} ${flash && on ? "flash" : ""}`}
      data-testid={testid}
      aria-expanded={active}
      onClick={onClick}
      initial={{ opacity: 0, y: 8, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...spring, delay: i * 0.035 }}
      whileTap={{ scale: 0.92 }}
      layout="position"
    >
      {children}
    </motion.button>
  );
}
