import { useEffect, useMemo, useState } from "react";
import type { CommandFile, ScheduleEntry } from "../types";
import {
  fetchSchedule,
  addSchedule,
  deleteSchedule,
  updateSchedule,
  runScheduleNow,
} from "../api";
import { fmtDateTime, fmtRelative, previewCommand } from "../utils";

interface Props {
  commands: CommandFile[];
}

type Kind = "cron" | "once";

function defaultRunAtLocalString(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduleTab({ commands }: Props) {
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // フォーム state
  const [editId, setEditId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formCommandId, setFormCommandId] = useState(commands[0]?.id ?? "");
  const [formKind, setFormKind] = useState<Kind>("cron");
  const [formCron, setFormCron] = useState("0 9 * * *");
  const [formRunAt, setFormRunAt] = useState(defaultRunAtLocalString);
  const [formDeviceOverride, setFormDeviceOverride] = useState("");
  const [formStatus, setFormStatus] = useState("");

  const selectedCommand = useMemo(
    () => commands.find((c) => c.id === formCommandId),
    [commands, formCommandId]
  );
  const preview = selectedCommand
    ? previewCommand(selectedCommand, {
        device: formDeviceOverride.trim() || "<device>",
      })
    : "(コマンドを選択してください)";

  async function reload() {
    try {
      setEntries(await fetchSchedule());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    const t = setInterval(reload, 10_000);
    return () => clearInterval(t);
  }, []);

  // commands が後から読み込まれた時の初期化
  useEffect(() => {
    if (!formCommandId && commands[0]) setFormCommandId(commands[0].id);
  }, [commands, formCommandId]);

  function resetForm() {
    setEditId(null);
    setFormName("");
    setFormKind("cron");
    setFormCron("0 9 * * *");
    setFormRunAt(defaultRunAtLocalString());
    setFormDeviceOverride("");
    setFormStatus("");
  }

  function loadIntoForm(e: ScheduleEntry) {
    setEditId(e.id);
    setFormName(e.name);
    setFormCommandId(e.commandId);
    setFormKind(e.kind);
    if (e.cron) setFormCron(e.cron);
    if (e.runAt) {
      const d = new Date(e.runAt);
      if (!Number.isNaN(d.getTime())) {
        const pad = (n: number) => String(n).padStart(2, "0");
        setFormRunAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
      }
    }
    setFormDeviceOverride(e.deviceOverride || "");
    setFormStatus("");
  }

  async function handleSubmit() {
    if (!formCommandId) {
      setFormStatus("コマンドを選択してください");
      return;
    }
    const body = {
      name: formName.trim() || selectedCommand?.name || formCommandId,
      commandId: formCommandId,
      kind: formKind,
      cron: formKind === "cron" ? formCron : undefined,
      runAt: formKind === "once" ? new Date(formRunAt).toISOString() : undefined,
      deviceOverride: formDeviceOverride.trim() || undefined,
    };
    try {
      if (editId) {
        await updateSchedule(editId, body);
        setFormStatus("更新しました");
      } else {
        await addSchedule(body);
        setFormStatus("登録しました");
      }
      resetForm();
      setTimeout(() => setFormStatus(""), 1500);
      await reload();
    } catch (e) {
      setFormStatus(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("削除しますか？")) return;
    await deleteSchedule(id);
    if (editId === id) resetForm();
    await reload();
  }

  async function onToggle(e: ScheduleEntry) {
    await updateSchedule(e.id, { enabled: !e.enabled });
    await reload();
  }

  async function onRunNow(id: string) {
    if (!confirm("今すぐ実行しますか？")) return;
    await runScheduleNow(id);
    await reload();
  }

  return (
    <div className="sched-layout">
      {/* 左: フォーム */}
      <section className="sched-panel">
        <h3 className="sched-panel-title">{editId ? "編集" : "新規登録"}</h3>
        <div className="sched-form">
          <Field label="コマンド">
            <select
              value={formCommandId}
              onChange={(e) => setFormCommandId(e.target.value)}
              style={{ width: "100%" }}
            >
              {commands.map((c) => (
                <option key={c.id} value={c.id}>
                  [{c.group}] {c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="種類">
            <BtnGroup
              value={formKind}
              options={[
                { value: "cron", label: "cron (繰り返し)" },
                { value: "once", label: "1回限り" },
              ]}
              onChange={(v) => setFormKind(v as Kind)}
            />
          </Field>

          {formKind === "cron" ? (
            <Field label="cron 式" hint="例: 0 9 * * * = 毎朝9時 / */15 * * * * = 15分おき">
              <input
                type="text"
                value={formCron}
                onChange={(e) => setFormCron(e.target.value)}
                placeholder="0 9 * * *"
                style={{ width: "100%", fontFamily: "var(--mono)" }}
              />
            </Field>
          ) : (
            <Field label="実行日時 (ローカルタイム)">
              <input
                type="datetime-local"
                value={formRunAt}
                onChange={(e) => setFormRunAt(e.target.value)}
                style={{ width: "100%" }}
              />
            </Field>
          )}

          <Field label="名前" hint="(任意) 省略時はコマンド名を使う">
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder={selectedCommand?.name ?? ""}
              style={{ width: "100%" }}
            />
          </Field>

          <Field label="device 上書き" hint="(任意) 空ならその時点で保存されている device を使う">
            <input
              type="text"
              value={formDeviceOverride}
              onChange={(e) => setFormDeviceOverride(e.target.value)}
              placeholder="100.64.1.47:33515"
              style={{ width: "100%", fontFamily: "var(--mono)" }}
            />
          </Field>

          <div className="sched-preview">
            <div className="sched-preview-label">▶ 実行されるコマンド (プレビュー)</div>
            <pre>{preview}</pre>
          </div>
        </div>
        <div className="sched-form-actions">
          <button className="primary" onClick={() => void handleSubmit()}>
            {editId ? "更新" : "登録"}
          </button>
          {editId && <button onClick={resetForm}>キャンセル</button>}
          {formStatus && <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{formStatus}</span>}
        </div>
      </section>

      {/* 右: 登録済みエントリ */}
      <section className="sched-panel">
        <div className="sched-panel-header">
          <h3 className="sched-panel-title" style={{ margin: 0 }}>登録済みエントリ</h3>
          <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
            {entries.length} 件
          </span>
        </div>
        {loading ? (
          <div className="empty">読み込み中...</div>
        ) : entries.length === 0 ? (
          <div className="empty" style={{ padding: "30px 0" }}>スケジュールなし</div>
        ) : (
          <div className="sched-list">
            {entries.map((e) => {
              const cmd = commands.find((c) => c.id === e.commandId);
              return (
                <div
                  key={e.id}
                  className={`sched-card${editId === e.id ? " editing" : ""}`}
                  onClick={() => loadIntoForm(e)}
                >
                  <div className="sched-card-head">
                    <strong>{e.name}</strong>
                    <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
                      → {cmd ? `[${cmd.group}] ${cmd.name}` : e.commandId}
                    </span>
                  </div>
                  <div className="sched-card-meta">
                    {e.kind === "cron" ? (
                      <code>cron: {e.cron}</code>
                    ) : (
                      <code>runAt: {fmtDateTime(e.runAt)}</code>
                    )}
                    {" · "}
                    {e.enabled ? (e.consumed ? "consumed" : "enabled") : "disabled"}
                    {e.nextRunAt && (
                      <>
                        {" · "}次回: {fmtDateTime(e.nextRunAt)} ({fmtRelative(e.nextRunAt)})
                      </>
                    )}
                    {e.lastFiredAt && (
                      <>
                        {" · "}前回: {fmtRelative(e.lastFiredAt)}
                      </>
                    )}
                    {e.deviceOverride && (
                      <>
                        {" · "}device: {e.deviceOverride}
                      </>
                    )}
                  </div>
                  {e.lastError && (
                    <div className="notice" style={{ marginTop: 6, fontSize: 12 }}>
                      last error: {e.lastError}
                    </div>
                  )}
                  <div
                    className="sched-card-actions"
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    <button onClick={() => void onToggle(e)}>
                      {e.enabled ? "停止" : "有効化"}
                    </button>
                    <button onClick={() => void onRunNow(e.id)}>今すぐ</button>
                    <button className="danger" onClick={() => void onDelete(e.id)}>
                      削除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="sched-field">
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function BtnGroup<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={value === o.value ? "primary" : ""}
          onClick={() => onChange(o.value)}
          style={{ flex: 1 }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
