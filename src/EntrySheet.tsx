import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { actions, fromLocalInput, toLocalInput, useStore } from "./store";
import { PRODROMES, STATUSES, SYMPTOMS, TRIGGERS, type Entry, type MedEffect } from "./types";
import { AddChip, BottomSheet, ChipSet, IntensityPicker, Segmented } from "./ui";
import { STATUS_META } from "./EntryCard";
import { fmtDuration, fmtWhen, medSuggestions, signed } from "./format";
import { attachWeather, sky, SKY_LABEL, useWeather } from "./weather";
import { Drop, Location, Moon, Refresh, Sky, Trash } from "./icons";
import { haptic } from "./haptics";

const EFFECTS: { v: MedEffect; label: string }[] = [
  { v: "good", label: "効いた" },
  { v: "some", label: "少し" },
  { v: "none", label: "効かない" },
];

export function EntrySheet({ id, onClose, onDelete }: { id: string | null; onClose: () => void; onDelete: (e: Entry) => void }) {
  const s = useStore();
  const ws = useWeather();
  const [shown, setShown] = useState<string | null>(id);
  useEffect(() => {
    if (id) setShown(id);
  }, [id]);
  const e = shown ? s.entries[shown] : null;
  const [fetching, setFetching] = useState(false);
  const all = Object.values(s.entries);

  const p = (patch: Partial<Entry>) => e && actions.patch(e.id, patch);

  return (
    <BottomSheet open={!!id && !!e} onClose={onClose} label="記録の詳細" tall testid="entry-sheet">
      {e && (
        <div className="detail">
          <Segmented
            id="dstatus"
            options={STATUSES}
            value={e.status}
            onChange={(v) => actions.setStatus(e.id, v)}
            render={(v) => (
              <>
                <i className={`dot ${v}`} />
                {STATUS_META[v].label}
              </>
            )}
          />

          <div className="field-row">
            <label className="field">
              <span>始まり</span>
              <input
                type="datetime-local"
                data-testid="detail-start"
                value={toLocalInput(e.startedAt)}
                max={toLocalInput(Date.now() + 6e4)}
                onChange={(ev) => {
                  const t = fromLocalInput(ev.target.value);
                  if (t) p({ startedAt: Math.min(t, Date.now()), weather: null });
                }}
              />
            </label>
            {e.status === "gone" && (
              <motion.label className="field" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
                <span>治まった</span>
                <input
                  type="datetime-local"
                  value={toLocalInput(e.endedAt ?? Date.now())}
                  min={toLocalInput(e.startedAt)}
                  onChange={(ev) => {
                    const t = fromLocalInput(ev.target.value);
                    if (t) p({ endedAt: Math.max(t, e.startedAt) });
                  }}
                />
              </motion.label>
            )}
          </div>
          {e.status === "gone" && e.endedAt && <p className="duration">持続 {fmtDuration(e.endedAt - e.startedAt)}</p>}

          <Section title="強さ">
            <IntensityPicker value={e.intensity} onChange={(v) => p({ intensity: v })} />
          </Section>

          <Section title="メモ">
            <textarea
              className="detail-memo"
              defaultValue={e.memo}
              key={e.id}
              rows={2}
              aria-label="メモ"
              data-testid="detail-memo"
              onBlur={(ev) => ev.target.value !== e.memo && p({ memo: ev.target.value.trim() })}
            />
          </Section>

          <Section title="薬">
            <div className="chips wrap">
              <ChipSet options={medSuggestions(all, e.meds)} value={e.meds} onChange={(v) => p({ meds: v, medEffect: v.length ? e.medEffect : null })} tone="purple" />
              <AddChip label="薬の名前" onAdd={(v) => p({ meds: [...new Set([...e.meds, v])] })} />
            </div>
            {e.meds.length > 0 && (
              <motion.div className="effect" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
                <span>効き目</span>
                <div className="effect-btns">
                  {EFFECTS.map((o) => (
                    <motion.button
                      key={o.v}
                      type="button"
                      className={`eff ${o.v} ${e.medEffect === o.v ? "on" : ""}`}
                      data-testid={`effect-${o.v}`}
                      onClick={() => {
                        haptic("light");
                        p({ medEffect: e.medEffect === o.v ? null : o.v });
                      }}
                      whileTap={{ scale: 0.92 }}
                    >
                      {o.label}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </Section>

          <button
            type="button"
            className={`switch-row ${e.sleepLack ? "on" : ""}`}
            role="switch"
            aria-checked={e.sleepLack}
            data-testid="detail-sleep"
            onClick={() => {
              haptic("light");
              p({ sleepLack: !e.sleepLack });
            }}
          >
            <Moon width={16} height={16} />
            寝不足
            <span className="switch">
              <motion.i layout transition={{ type: "spring", stiffness: 700, damping: 35 }} />
            </span>
          </button>

          <Section title="きっかけ">
            <div className="chips wrap">
              <ChipSet options={TRIGGERS} value={e.triggers} onChange={(v) => p({ triggers: v })} tone="teal" />
            </div>
          </Section>

          <Section title="症状">
            <div className="chips wrap">
              <ChipSet options={SYMPTOMS} value={e.symptoms} onChange={(v) => p({ symptoms: v })} tone="pink" />
            </div>
          </Section>

          <Section title="前ぶれ">
            <div className="chips wrap">
              <ChipSet options={PRODROMES} value={e.prodromes ?? []} onChange={(v) => p({ prodromes: v })} tone="indigo" />
            </div>
          </Section>

          <Section title="天気">
            {e.weather ? (
              <div className="wx" data-testid="detail-weather">
                <Sky kind={sky(e.weather.code)} width={30} height={30} />
                <div className="wx-main">
                  <strong>
                    {e.weather.pressure.toFixed(1)}
                    <small>hPa</small>
                  </strong>
                  <span>
                    {SKY_LABEL[sky(e.weather.code)]}
                    {e.weather.temp != null && ` · ${Math.round(e.weather.temp)}°C`}
                    {e.weather.humidity != null && (
                      <>
                        {" · "}
                        <Drop width={10} height={10} />
                        {e.weather.humidity}%
                      </>
                    )}
                  </span>
                  <span className="wx-sub">
                    {e.weather.place && (
                      <>
                        <Location width={10} height={10} /> {e.weather.place} ·{" "}
                      </>
                    )}
                    {fmtWhen(e.weather.at)}
                  </span>
                </div>
                <div className="wx-deltas">
                  {e.weather.trend != null && (
                    <span className={e.weather.trend <= -2 ? "down" : ""}>
                      6h <b>{signed(e.weather.trend)}</b>
                    </span>
                  )}
                  {e.weather.d24h != null && (
                    <span className={e.weather.d24h <= -5 ? "down" : ""}>
                      24h <b>{signed(e.weather.d24h)}</b>
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="wx-none">{ws.geo === "denied" ? "位置情報がオフです" : "未取得"}</p>
            )}
            {ws.geo !== "denied" && ws.geo !== "unsupported" && Date.now() - e.startedAt < 92 * 864e5 && (
              <motion.button
                type="button"
                className="row-btn small"
                data-testid="refetch-weather"
                disabled={fetching}
                whileTap={{ scale: 0.97 }}
                onClick={async () => {
                  setFetching(true);
                  await attachWeather(e.id, { force: true });
                  setFetching(false);
                }}
              >
                <motion.span animate={{ rotate: fetching ? 360 : 0 }} transition={fetching ? { repeat: Infinity, duration: 0.9, ease: "linear" } : {}}>
                  <Refresh width={15} height={15} />
                </motion.span>
                現在地で{e.weather ? "再取得" : "取得"}
              </motion.button>
            )}
          </Section>

          <button
            type="button"
            className="row-btn danger center"
            data-testid="detail-delete"
            onClick={() => {
              onDelete(e);
              onClose();
            }}
          >
            <Trash width={16} height={16} />
            この記録を削除
          </button>
        </div>
      )}
    </BottomSheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="dsec">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
