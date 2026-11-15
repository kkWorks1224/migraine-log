import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { actions } from "./store";
import { MIDAS_QUESTIONS, midasGrade } from "./types";
import { BottomSheet, spring } from "./ui";
import { haptic } from "./haptics";

// 生活への支障度（MIDAS）：過去 3 か月で頭痛のために〇〇だった日数を 5 問
export function MidasSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [v, setV] = useState<number[]>([0, 0, 0, 0, 0]);
  useEffect(() => {
    if (open) setV([0, 0, 0, 0, 0]);
  }, [open]);
  const score = v.reduce((a, b) => a + b, 0);
  const grade = midasGrade(score);
  const clamp = (n: number) => Math.min(90, Math.max(0, n));
  // 連打しても取りこぼさないよう、直前の値から計算する
  const step = (i: number, delta: number) => {
    haptic("light");
    setV((cur) => cur.map((x, j) => (j === i ? clamp(x + delta) : x)));
  };
  const set = (i: number, n: number) => setV((cur) => cur.map((x, j) => (j === i ? clamp(n) : x)));
  return (
    <BottomSheet open={open} onClose={onClose} label="生活への支障度" tall testid="midas-sheet">
      <div className="midas">
        <h2>過去3か月で、頭痛のために…</h2>
        {MIDAS_QUESTIONS.map((q, i) => (
          <div key={i} className="mq">
            <span className="mq-text">{q}</span>
            <div className="stepper" role="group" aria-label={q}>
              <motion.button type="button" aria-label="1日減らす" onClick={() => step(i, -1)} whileTap={{ scale: 0.85 }} disabled={v[i] === 0}>
                −
              </motion.button>
              <input
                inputMode="numeric"
                aria-label={`${q}（日数）`}
                value={v[i]}
                data-testid={`midas-${i}`}
                onChange={(e) => set(i, Number(e.target.value.replace(/\D/g, "")) || 0)}
              />
              <motion.button type="button" aria-label="1日増やす" onClick={() => step(i, 1)} whileTap={{ scale: 0.85 }} data-testid={`midas-plus-${i}`}>
                ＋
              </motion.button>
            </div>
          </div>
        ))}
        <div className="midas-total">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.strong key={score} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 8, opacity: 0 }} transition={spring}>
              {score}
              <small>点</small>
            </motion.strong>
          </AnimatePresence>
          <span>
            グレード{grade.g}・{grade.label}
          </span>
        </div>
        <motion.button
          type="button"
          className="primary-btn"
          whileTap={{ scale: 0.97 }}
          data-testid="midas-save"
          onClick={() => {
            actions.addMidas(v);
            haptic("success");
            onClose();
          }}
        >
          保存する
        </motion.button>
        <p className="muted small-note">MIDAS（片頭痛による生活支障度の評価）にもとづく目安です。5点以下：ほとんどない／6〜10点：軽い／11〜20点：中くらい／21点以上：大きい</p>
      </div>
    </BottomSheet>
  );
}
