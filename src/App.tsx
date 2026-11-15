import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { actions, sync as runSync, useBootSync, useStore, type SyncState, type User } from "./store";
import { STATUSES, type Entry, type Status } from "./types";
import { EntryCard, STATUS_META, type Action } from "./EntryCard";
import { Composer } from "./Composer";
import { PressureCard } from "./PressureCard";
import { EntrySheet } from "./EntrySheet";
import { StatsSheet } from "./StatsSheet";
import { BottomSheet, Segmented, spring } from "./ui";
import { attachWeather, getGeo } from "./weather";
import { dayKey, fmtDayLong } from "./format";
import { Chart, GoogleG, Person } from "./icons";
import { haptic } from "./haptics";

type Toast = { id: number; text: string; undo?: () => void };

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
  const counts = useMemo(() => {
    const c = { pain: 0, easing: 0, gone: 0 } as Record<Status, number>;
    live.forEach((e) => c[e.status]++);
    return c;
  }, [live]);
  const visible = live.filter((e) => e.status === tab);

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
      showToast({ text: "記録しました", undo: () => actions.remove(e.id) });
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
      <Composer entries={live} loggedIn={!!s.user} onAdded={onAdded} needLogin={needLogin} toast={(text) => showToast({ text })} />
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
            <PressureCard />
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
      <AccountSheet open={sheet === "account"} onClose={() => setSheet(null)} user={s.user} sync={s.sync} googleEnabled={s.googleEnabled} />
    </MotionConfig>
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
}: {
  open: boolean;
  onClose: () => void;
  user: User | null;
  sync: SyncState;
  googleEnabled: boolean;
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
