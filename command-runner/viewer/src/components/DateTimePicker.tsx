import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  value: Date | null;
  onChange: (v: Date | null) => void;
}

interface YM {
  year: number;
  month: number;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function DateTimePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [ym, setYm] = useState<YM>(() => {
    const base = value || new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });
  const [draft, setDraft] = useState<Date | null>(value);
  const [hText, setHText] = useState<string>("");
  const [mText, setMText] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(value);
    if (value) setYm({ year: value.getFullYear(), month: value.getMonth() });
  }, [value]);

  useEffect(() => {
    setHText(String(draft?.getHours() ?? 12).padStart(2, "0"));
    setMText(String(draft?.getMinutes() ?? 0).padStart(2, "0"));
  }, [draft]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        popoverRef.current?.contains(e.target as Node) ||
        triggerRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open]);

  const today = new Date();
  const shours = draft?.getHours() ?? 12;
  const smins = draft?.getMinutes() ?? 0;

  function shiftMonth(delta: number): void {
    let { year, month } = ym;
    month += delta;
    if (month < 0) {
      year--;
      month = 11;
    }
    if (month > 11) {
      year++;
      month = 0;
    }
    setYm({ year, month });
  }

  function setFromShortcut(offsetDays: number): void {
    const base = new Date();
    base.setDate(base.getDate() + offsetDays);
    if (draft) base.setHours(draft.getHours(), draft.getMinutes(), 0, 0);
    else base.setHours(12, 0, 0, 0);
    setDraft(base);
    setYm({ year: base.getFullYear(), month: base.getMonth() });
  }

  function updateTimeUnit(unit: "h" | "m", newValue: number): void {
    const base =
      draft ||
      (() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
      })();
    const h = unit === "h" ? newValue : base.getHours();
    const m = unit === "m" ? newValue : base.getMinutes();
    setDraft(new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m, 0, 0));
  }

  const daysInMonth = new Date(ym.year, ym.month + 1, 0).getDate();
  const firstDay = new Date(ym.year, ym.month, 1).getDay();

  const triggerLabel = draft
    ? (() => {
        const weekday = WEEKDAYS[draft.getDay()];
        const d = `${draft.getFullYear()}/${String(draft.getMonth() + 1).padStart(2, "0")}/${String(draft.getDate()).padStart(2, "0")}(${weekday})`;
        const t = `${String(draft.getHours()).padStart(2, "0")}:${String(draft.getMinutes()).padStart(2, "0")}`;
        return { date: d, time: t };
      })()
    : null;

  // 親要素の stacking context に干渉されないよう position: fixed + portal で
  // document.body 直下に描画する。座標はビューポート相対 (scrollY/X は加算しない)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: rect.left });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`dtp-trigger ${open ? "open" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        <span className="dtp-icon">◉</span>
        {triggerLabel ? (
          <>
            <span className="dtp-value-date">{triggerLabel.date}</span>
            <span className="dtp-value-time">{triggerLabel.time}</span>
          </>
        ) : (
          <span className="dtp-placeholder">日時を選択...</span>
        )}
      </button>
      {open && createPortal(
        <div ref={popoverRef} className="dtp-popover open" style={{ position: "fixed", top: pos.top, left: pos.left }}>
          <div className="dtp-shortcuts">
            {[
              { label: "今日", off: 0 },
              { label: "明日", off: 1 },
              { label: "明後日", off: 2 },
              { label: "来週", off: 7 },
              { label: "来月", off: 30 },
            ].map((s) => (
              <div key={s.label} className="dtp-shortcut" onClick={() => setFromShortcut(s.off)}>
                {s.label}
              </div>
            ))}
          </div>

          <div className="dtp-calendar">
            <div className="dtp-calendar-header">
              <button type="button" className="calendar-nav-btn" onClick={() => shiftMonth(-1)}>‹</button>
              <div className="dtp-calendar-title">
                {ym.year}年 {ym.month + 1}月
              </div>
              <button type="button" className="calendar-nav-btn" onClick={() => shiftMonth(1)}>›</button>
            </div>
            <div className="dtp-calendar-grid">
              {WEEKDAYS.map((w) => (
                <div key={w} className="dtp-weekday">{w}</div>
              ))}
              {Array.from({ length: firstDay }, (_, i) => (
                <div key={`e${i}`} className="dtp-day empty" />
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1;
                const isToday =
                  today.getFullYear() === ym.year &&
                  today.getMonth() === ym.month &&
                  today.getDate() === day;
                const isSelected =
                  draft?.getFullYear() === ym.year &&
                  draft?.getMonth() === ym.month &&
                  draft?.getDate() === day;
                return (
                  <div
                    key={day}
                    className={`dtp-day ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}`}
                    onClick={() => {
                      setDraft(new Date(ym.year, ym.month, day, shours, smins, 0, 0));
                    }}
                  >
                    {day}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="dtp-time-section">
            <div className="dtp-time-row">
              <div className="dtp-time-unit">
                <button type="button" className="dtp-time-btn" onClick={() => updateTimeUnit("h", (shours + 1) % 24)}>▲</button>
                <input
                  type="text"
                  inputMode="numeric"
                  className="dtp-time-val"
                  maxLength={2}
                  value={hText}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setHText(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
                  onBlur={() => {
                    const n = Number(hText);
                    const v = Number.isFinite(n) ? Math.max(0, Math.min(23, n)) : shours;
                    updateTimeUnit("h", v);
                    setHText(String(v).padStart(2, "0"));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                  }}
                />
                <button type="button" className="dtp-time-btn" onClick={() => updateTimeUnit("h", (shours + 23) % 24)}>▼</button>
              </div>
              <div className="dtp-time-colon">:</div>
              <div className="dtp-time-unit">
                <button type="button" className="dtp-time-btn" onClick={() => updateTimeUnit("m", (smins + 5) % 60)}>▲</button>
                <input
                  type="text"
                  inputMode="numeric"
                  className="dtp-time-val"
                  maxLength={2}
                  value={mText}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setMText(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
                  onBlur={() => {
                    const n = Number(mText);
                    const v = Number.isFinite(n) ? Math.max(0, Math.min(59, n)) : smins;
                    updateTimeUnit("m", v);
                    setMText(String(v).padStart(2, "0"));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                  }}
                />
                <button type="button" className="dtp-time-btn" onClick={() => updateTimeUnit("m", (smins + 55) % 60)}>▼</button>
              </div>
            </div>
          </div>

          <div className="dtp-actions">
            <button
              type="button"
              className="dtp-btn-secondary"
              onClick={() => {
                setDraft(null);
                onChange(null);
                setOpen(false);
              }}
            >
              クリア
            </button>
            <button
              type="button"
              className="dtp-btn-primary"
              onClick={() => {
                const final =
                  draft ||
                  (() => {
                    const d = new Date();
                    d.setHours(shours, smins, 0, 0);
                    return d;
                  })();
                onChange(final);
                setOpen(false);
              }}
            >
              OK
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
