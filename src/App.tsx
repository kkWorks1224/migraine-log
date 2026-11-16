import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { actions, getState, sync as runSync, useBootSync, useStore, type SyncState, type User } from "./store";
import { kindOf, STATUSES, type Entry, type Status } from "./types";
import { EntryCard, STATUS_META, type Action } from "./EntryCard";
import { Composer } from "./Composer";
import { PressureCard } from "./PressureCard";
import { EntrySheet } from "./EntrySheet";
import { StatsSheet } from "./StatsSheet";
import { BottomSheet, Segmented, spring } from "./ui";
import { attachWeather, getGeo, loadSeries, useWeather } from "./weather";
import { useForecast } from "./useForecast";
import { disablePush, enablePush, pushSupport, refreshPush, savedPush, testPush } from "./push";
import { dayKey, fmtDayLong } from "./format";
import { Bell, Chart, Check, ChevronRight, Dumbbell, GoogleG, Mic, Person } from "./icons";
import { haptic } from "./haptics";

type Toast = { id: number; text: string; undo?: () => void };

// 空のタブには、そのタブにカードが来る操作を出す
const EMPTY_HINT: Record<Status, string> = {
  pain: "頭が痛くなったら、上の欄に書いて記録",
  easing: "薬が効いてきたら、「痛い」のカードを右へフリック",
  gone: "痛みが消えたら、カードを右へフリックか丸ボタン",
};

export function App() {
  useBootSync();
  const s = useStore();
  const [tab, setTab] = useState<Status>("pain");
  const [dir, setDir] = useState(1);
  const [toast, setToast] = useState<Toast | null>(null);
  const [sheet, setSheet] = useState<"account" | "stats" | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const iv = window.setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    document.body.classList.toggle("ready", s.ready);
  }, [s.ready]);

  const showToast = useCallback((t: Omit<Toast, "id">) => setToast({ ...t, id: Date.now() }), []);
  useEffect(() => {
    if (new URLSearchParams(location.search).get("auth") === "error") {
      history.replaceState(null, "", "/");
      showToast({ text: "ログインできませんでした" });
    }
  }, [showToast]);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), toast.undo ? 6000 : 3200);
    return () => clearTimeout(id);
  }, [toast]);

  const live = useMemo(
    () => Object.values(s.entries).filter((e) => !e.deleted).sort((a, b) => b.startedAt - a.startedAt),
    [s.entries],
  );
  // 一覧・件数は頭痛の記録だけ（頭痛なしの日・支障度の回答は含めない）
  const headaches = useMemo(() => live.filter((e) => kindOf(e) === "headache"), [live]);
  const counts = useMemo(() => {
    const c = { pain: 0, easing: 0, gone: 0 } as Record<Status, number>;
    headaches.forEach((e) => c[e.status]++);
    return c;
  }, [headaches]);
  const visible = headaches.filter((e) => e.status === tab);
  const fc = useForecast(live);
  const ws = useWeather();
  // 通知の基準・場所を最新の分析に合わせる
  useEffect(() => {
    if (fc && ws.series) refreshPush(ws.series.lat, ws.series.lon, fc.analysis.threshold);
  }, [fc?.analysis.threshold, ws.series?.lat, ws.series?.lon]);
  const todayKey = dayKey(now);
  const todayClear = live.find((e) => kindOf(e) === "clear" && dayKey(e.startedAt) === todayKey);
  const todayPain = headaches.some((e) => dayKey(e.startedAt) === todayKey);
  const todayWorkout = live.find((e) => kindOf(e) === "workout" && dayKey(e.startedAt) === todayKey);

  // 治まった一覧は日付ごとに見出しを入れる
  const rows = useMemo(() => {
    const out: ({ kind: "head"; key: string; label: string } | { kind: "entry"; key: string; e: Entry })[] = [];
    let last = "";
    visible.forEach((e) => {
      const k = dayKey(e.startedAt);
      if (tab === "gone" && k !== last) out.push({ kind: "head", key: `h-${k}`, label: fmtDayLong(e.startedAt) });
      last = k;
      out.push({ kind: "entry", key: e.id, e });
    });
    return out;
  }, [visible, tab]);

  const changeTab = (next: Status) => {
    if (next === tab) return;
    setDir(STATUSES.indexOf(next) > STATUSES.indexOf(tab) ? 1 : -1);
    setTab(next);
  };

  const onDelete = useCallback(
    (e: Entry) => {
      const snap = { ...e };
      actions.remove(e.id);
      haptic("medium");
      showToast({ text: "削除しました", undo: () => actions.restore(snap) });
    },
    [showToast],
  );

  const onAction = useCallback(
    (e: Entry, a: Action) => {
      if (a === "delete") return onDelete(e);
      const prev = { status: e.status, endedAt: e.endedAt };
      actions.setStatus(e.id, a);
      showToast({
        text: `${STATUS_META[a].label}へ移動`,
        undo: () => actions.patch(e.id, prev),
      });
    },
    [showToast, onDelete],
  );

  const onAdded = useCallback(
    (e: Entry) => {
      if (tab !== e.status) changeTab(e.status);
      // 同じ日に「頭痛なし」が付いていたら外す
      Object.values(getState().entries)
        .filter((x) => !x.deleted && kindOf(x) === "clear" && dayKey(x.startedAt) === dayKey(e.startedAt))
        .forEach((x) => actions.remove(x.id));
      // 薬を記録したら、今月の服薬日数をその場で知らせる（使いすぎの目安は月10日）
      let text = "記録しました";
      if (e.meds.length) {
        const n = medDaysThisMonth(Object.values(getState().entries));
        text = n > 10 ? `今月の服薬 ${n}日目・使いすぎの目安を超えています` : n === 10 ? `今月の服薬 ${n}日目・使いすぎの目安に達しました` : n >= 8 ? `今月の服薬 ${n}日目・目安の10日に近づいています` : `記録しました・今月の服薬 ${n}日目`;
      }
      showToast({ text, undo: () => actions.remove(e.id) });
      // 記録した時点の現在地の気圧・天気を添える（初回はここで位置情報の許可を求める）
      const g = getGeo();
      if (g !== "denied" && g !== "unsupported") attachWeather(e.id);
    },
    [tab, showToast],
  );

  const needLogin = useCallback(() => {
    setSheet("account");
    showToast({ text: "AIを使うにはログインしてください" });
  }, [showToast]);

  return (
    <MotionConfig reducedMotion="user">
      <Composer entries={headaches} loggedIn={!!s.user} onAdded={onAdded} needLogin={needLogin} toast={(text) => showToast({ text })} />
      <HeaderButtons user={s.user} sync={s.sync} ready={s.ready} onAccount={() => setSheet("account")} onStats={() => setSheet("stats")} />

      <AnimatePresence mode="wait">
        {!s.ready ? (
          <motion.div key="sk" exit={{ opacity: 0, filter: "blur(8px)", transition: { duration: 0.22 } }}>
            <Skeleton />
          </motion.div>
        ) : (
          <motion.div
            key="main"
            initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <PressureCard entries={live} />
            <Segmented
              id="tab"
              options={STATUSES}
              value={tab}
              onChange={changeTab}
              render={(t) => (
                <>
                  <i className={`dot ${t}`} />
                  {STATUS_META[t].label}
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.b
                      key={counts[t]}
                      className="count"
                      initial={{ y: -10, opacity: 0, scale: 0.6 }}
                      animate={{ y: 0, opacity: 1, scale: 1 }}
                      exit={{ y: 10, opacity: 0, scale: 0.6 }}
                      transition={spring}
                    >
                      {counts[t]}
                    </motion.b>
                  </AnimatePresence>
                </>
              )}
            />
            <div className="list-wrap">
              <AnimatePresence mode="popLayout" initial={false} custom={dir}>
                <motion.ul
                  key={tab}
                  className="list"
                  custom={dir}
                  variants={{
                    enter: (d: number) => ({ x: d * 40, opacity: 0 }),
                    center: { x: 0, opacity: 1 },
                    exit: (d: number) => ({ x: d * -40, opacity: 0 }),
                  }}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ type: "spring", stiffness: 420, damping: 38 }}
                >
                  <AnimatePresence mode="popLayout" initial={false}>
                    {rows.map((r, i) =>
                      r.kind === "head" ? (
                        <motion.li
                          key={r.key}
                          layout
                          className="day-head"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0, height: 0 }}
                        >
                          {r.label}
                        </motion.li>
                      ) : (
                        <EntryCard
                          key={r.key}
                          entry={r.e}
                          index={i}
                          now={now}
                          showDate={tab !== "gone" && dayKey(r.e.startedAt) !== dayKey(now)}
                          onAction={onAction}
                          onOpen={(e) => setEditing(e.id)}
                        />
                      ),
                    )}
                  </AnimatePresence>
                  {visible.length === 0 && (
                    <motion.li
                      key="empty"
                      className="empty"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1, transition: { delay: 0.15 } }}
                    >
                      <span className={`empty-dot ${tab}`} />
                      <p>{EMPTY_HINT[tab]}</p>
                    </motion.li>
                  )}
                  {tab === "pain" && (
                    <motion.li key="marks" layout className="day-marks-row" transition={spring}>
                        <div className="day-marks" role="group" aria-label="今日の記録">
                          <span className="day-marks-label">今日は</span>
                          {!todayPain && (
                            <ClearDayButton
                              done={!!todayClear}
                              onMark={() => {
                                const e = actions.markClear(now);
                                haptic("success");
                                showToast({ text: "今日は頭痛なしと記録しました", undo: () => actions.remove(e.id) });
                              }}
                              onUnmark={() => todayClear && actions.remove(todayClear.id)}
                            />
                          )}
                          <WorkoutButton
                            done={!!todayWorkout}
                            onMark={() => {
                              const e = actions.markWorkout(now);
                              haptic("success");
                              showToast({ text: "今日の筋トレを記録しました", undo: () => actions.remove(e.id) });
                            }}
                            onUnmark={() => live.filter((e) => kindOf(e) === "workout" && dayKey(e.startedAt) === todayKey).forEach((e) => actions.remove(e.id))}
                          />
                        </div>
                    </motion.li>
                  )}
                </motion.ul>
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ToastView toast={toast} onClose={() => setToast(null)} />
      <EntrySheet id={editing} onClose={() => setEditing(null)} onDelete={onDelete} />
      <StatsSheet
        open={sheet === "stats"}
        onClose={() => setSheet(null)}
        entries={live}
        loggedIn={!!s.user}
        needLogin={needLogin}
        onOpenEntry={(e) => setEditing(e.id)}
      />
      <AccountSheet
        open={sheet === "account"}
        onClose={() => setSheet(null)}
        user={s.user}
        sync={s.sync}
        googleEnabled={s.googleEnabled}
        threshold={fc?.analysis.threshold ?? null}
        toast={(text) => showToast({ text })}
      />
    </MotionConfig>
  );
}

export function medDaysThisMonth(all: Entry[], now = Date.now()) {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return new Set(
    all.filter((e) => !e.deleted && kindOf(e) === "headache" && e.meds.length && e.startedAt >= start && e.startedAt <= now).map((e) => dayKey(e.startedAt)),
  ).size;
}

// 頭痛のなかった日を 1 タップで残す（気圧との関係を正しく比べるため）
function ClearDayButton({ done, onMark, onUnmark }: { done: boolean; onMark: () => void; onUnmark: () => void }) {
  return (
    <motion.button
      type="button"
      className={`clear-btn ${done ? "done" : ""}`}
      data-testid="clear-day"
      aria-pressed={done}
      onClick={() => (done ? onUnmark() : onMark())}
      whileTap={{ scale: 0.96 }}
      layout
      transition={spring}
    >
      <motion.span className="clear-check" initial={false} animate={{ scale: done ? 1 : 0.8, opacity: done ? 1 : 0.5 }} transition={spring}>
        <Check width={14} height={14} />
      </motion.span>
      頭痛なし
    </motion.button>
  );
}

// 筋トレした日（前日以前は「まとめ」のカレンダーから付けられる）
function WorkoutButton({ done, onMark, onUnmark }: { done: boolean; onMark: () => void; onUnmark: () => void }) {
  return (
    <motion.button
      type="button"
      className={`clear-btn wo ${done ? "done" : ""}`}
      data-testid="workout-today"
      aria-pressed={done}
      onClick={() => (done ? onUnmark() : onMark())}
      whileTap={{ scale: 0.96 }}
      layout
      transition={spring}
    >
      <motion.span className="clear-check" initial={false} animate={{ scale: done ? 1 : 0.8, opacity: done ? 1 : 0.5 }} transition={spring}>
        <Dumbbell width={15} height={15} />
      </motion.span>
      筋トレした
    </motion.button>
  );
}

function Skeleton() {
  return (
    <div className="boot" aria-busy="true" aria-label="読み込み中">
      <div className="sk sk-pressure" />
      <div className="sk sk-seg" />
      {[1, 0.85, 0.7, 0.55, 0.4, 0.25].map((o, i) => (
        <div key={i} className="sk sk-card" style={{ opacity: o }} />
      ))}
    </div>
  );
}

function HeaderButtons({
  user,
  sync,
  ready,
  onAccount,
  onStats,
}: {
  user: User | null;
  sync: SyncState;
  ready: boolean;
  onAccount: () => void;
  onStats: () => void;
}) {
  const host = useMemo(() => document.getElementById("header-slot")!, []);
  if (!ready) return null;
  return createPortal(
    <>
      <motion.button
        className="avatar glass"
        aria-label="まとめ"
        data-testid="stats"
        onClick={() => {
          haptic("light");
          onStats();
        }}
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={spring}
        whileTap={{ scale: 0.88 }}
      >
        <Chart width={19} height={19} />
      </motion.button>
      <motion.button
        className="avatar glass"
        aria-label="アカウント"
        data-testid="account"
        onClick={() => {
          haptic("light");
          onAccount();
        }}
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ ...spring, delay: 0.05 }}
        whileTap={{ scale: 0.88 }}
      >
        {user?.picture ? (
          <img src={user.picture} alt="" referrerPolicy="no-referrer" />
        ) : user ? (
          <span className="initial">{(user.name || user.email || "?").slice(0, 1).toUpperCase()}</span>
        ) : (
          <Person width={20} height={20} />
        )}
        {user && <i className={`sync-dot ${sync}`} />}
      </motion.button>
    </>,
    host,
  );
}

const SYNC_LABEL: Record<SyncState, string> = { idle: "同期済み", syncing: "同期中", offline: "オフライン", error: "同期エラー" };

function AccountSheet({
  open,
  onClose,
  user,
  sync,
  googleEnabled,
  threshold,
  toast,
}: {
  open: boolean;
  onClose: () => void;
  user: User | null;
  sync: SyncState;
  googleEnabled: boolean;
  threshold: number | null;
  toast: (t: string) => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} label="アカウント" testid="account-sheet">
      {user ? (
        <div className="account">
          <div className="who">
            {user.picture ? (
              <img src={user.picture} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="initial big">{(user.name || user.email).slice(0, 1).toUpperCase()}</span>
            )}
            <div>
              <strong>{user.name || user.email}</strong>
              <small>{user.email}</small>
            </div>
          </div>
          <button className="row-btn" onClick={() => runSync()} data-testid="sync-status">
            <i className={`sync-dot inline ${sync}`} />
            {SYNC_LABEL[sync]}
          </button>
          <button
            className="row-btn danger"
            data-testid="logout"
            onClick={async () => {
              await actions.logout();
              onClose();
            }}
          >
            ログアウト
          </button>
        </div>
      ) : (
        <div className="account">
          <a
            className={`google-btn ${googleEnabled ? "" : "disabled"}`}
            href={googleEnabled ? "/auth/login" : undefined}
            data-testid="google-login"
            aria-disabled={!googleEnabled}
          >
            <GoogleG />
            Google でログイン
          </a>
          <p className="fine">ログインすると端末間で同期され、AI 機能が使えます。</p>
        </div>
      )}
      <NotifySection loggedIn={!!user} threshold={threshold} toast={toast} />
      <ShortcutSection />
      <dl className="legend">
        <div>
          <dt>右へフリック</dt>
          <dd>痛い → 和らいだ → 治まった</dd>
        </div>
        <div>
          <dt>左へフリック</dt>
          <dd>前に戻す・削除</dd>
        </div>
        <div>
          <dt>丸ボタン</dt>
          <dd>すぐに「治まった」へ</dd>
        </div>
        <div>
          <dt>タップ</dt>
          <dd>詳細を編集</dd>
        </div>
      </dl>
    </BottomSheet>
  );
}

// 気圧の注意をプッシュ通知で受け取る
function NotifySection({ loggedIn, threshold, toast }: { loggedIn: boolean; threshold: number | null; toast: (t: string) => void }) {
  const ws = useWeather();
  const [on, setOn] = useState(() => !!savedPush());
  const [busy, setBusy] = useState(false);
  const support = pushSupport();
  const toggle = async () => {
    if (busy) return;
    haptic("light");
    setBusy(true);
    try {
      if (on) {
        await disablePush();
        setOn(false);
        toast("通知をオフにしました");
      } else {
        const s = ws.series ?? (await loadSeries());
        if (!s) throw new Error("no_location");
        await enablePush(s.lat, s.lon, threshold ?? -2);
        setOn(true);
        haptic("success");
        toast("気圧が下がりそうなときにお知らせします");
      }
    } catch (e) {
      const m = (e as Error).message;
      toast(m === "denied" ? "通知が許可されていません（設定から許可してください）" : m === "no_location" ? "位置情報をオンにしてください" : "通知を設定できませんでした");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="acc-sec" data-testid="notify-section">
      <h3>
        <Bell width={15} height={15} />
        気圧の注意を通知
      </h3>
      {support === "ios-home" ? (
        <p className="fine left">iPhoneでは、Safariの共有ボタンから「ホーム画面に追加」したアプリで使えます（iOS 16.4以降）。</p>
      ) : support === "unsupported" ? (
        <p className="fine left">このブラウザは通知に対応していません。</p>
      ) : !loggedIn ? (
        <p className="fine left">ログインすると使えます。</p>
      ) : (
        <>
          <button type="button" className={`switch-row ${on ? "on" : ""}`} role="switch" aria-checked={on} onClick={toggle} disabled={busy} data-testid="notify-toggle">
            気圧の低下をお知らせ
            <span className="switch">
              <motion.i layout transition={{ type: "spring", stiffness: 700, damping: 35 }} />
            </span>
          </button>
          <p className="fine left">この先12時間に下がりそうなとき、7時〜22時に届きます。通知のため、現在地をおおよそ10km単位で保存します。</p>
          {on && (
            <button
              type="button"
              className="row-btn small"
              onClick={async () => {
                try {
                  const n = await testPush();
                  toast(n ? "テスト通知を送りました" : "送れる端末がありません");
                } catch {
                  toast("テスト通知を送れませんでした");
                }
              }}
              data-testid="notify-test"
            >
              テスト通知を送る
            </button>
          )}
        </>
      )}
    </section>
  );
}

// Siri・ショートカットから音声で記録
function ShortcutSection() {
  const [open, setOpen] = useState(false);
  const url = `${location.origin}/#memo=`;
  return (
    <section className="acc-sec" data-testid="shortcut-section">
      <button type="button" className="acc-head" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="shortcut-open">
        <Mic width={15} height={15} />
        Siriで音声記録
        <ChevronRight width={14} height={14} style={{ marginLeft: "auto", transform: open ? "rotate(90deg)" : "none", transition: "transform 200ms" }} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="steps" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22 }}>
            <ol>
              <li>「ショートカット」アプリで新規ショートカットを作る</li>
              <li>「テキストを音声入力」を追加</li>
              <li>「URLエンコード」を追加（入力は音声入力のテキスト）</li>
              <li>「URL」を追加し、下のアドレスの後ろにエンコード結果を入れる</li>
              <li>「URLを開く」を追加</li>
              <li>名前を「頭上注意」にする →「Hey Siri、頭上注意」で話すだけで記録</li>
            </ol>
            <button
              type="button"
              className="row-btn small"
              onClick={() => navigator.clipboard?.writeText(url)}
              data-testid="shortcut-copy"
            >
              アドレスをコピー：{url}
            </button>
            <p className="fine left">ログイン中はAIで整理してから記録します。Safariとホーム画面のアプリで記録を共有するにはログインしてください。</p>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function ToastView({ toast, onClose }: { toast: Toast | null; onClose: () => void }) {
  return (
    <div className="toast-host">
      <AnimatePresence mode="popLayout">
        {toast && (
          <motion.div
            key={toast.id}
            className="toast glass"
            role="status"
            data-testid="toast"
            initial={{ y: 40, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.92, transition: { duration: 0.18 } }}
            transition={{ type: "spring", stiffness: 520, damping: 32 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.6}
            onDragEnd={(_, i) => i.offset.y > 30 && onClose()}
          >
            <span>{toast.text}</span>
            {toast.undo && (
              <button
                className="toast-undo"
                data-testid="undo"
                onClick={() => {
                  toast.undo!();
                  haptic("light");
                  onClose();
                }}
              >
                取り消す
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
