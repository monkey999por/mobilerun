import { useEffect, useState } from "react";
import type { CommandFile, CommandStatus, CommandType } from "../types";
import { createCommand, deleteCommand, fetchCommand, updateCommand } from "../api";
import { previewCommand } from "../utils";

type Mode = "structured" | "raw";

interface Props {
  /** 編集モード: 既存 id を渡す。新規モード: null */
  commandId: string | null;
  /** 既存のグループ一覧 (新規作成時のサジェスト用) */
  existingGroups: string[];
  onClose: () => void;
  onSaved: (c: CommandFile) => void;
  onDeleted: (id: string) => void;
}

const EMPTY: CommandFile = {
  id: "",
  name: "",
  group: "",
  type: "run",
  status: "unconfirmed",
  tags: [],
  steps: 25,
  vision: true,
  reasoning: true,
  prompt: "",
};

export function CommandEditor({ commandId, existingGroups, onClose, onSaved, onDeleted }: Props) {
  const isNew = commandId === null;
  const [mode, setMode] = useState<Mode>("structured");
  const [form, setForm] = useState<CommandFile>(EMPTY);
  const [raw, setRaw] = useState<string>("");
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const { command, raw } = await fetchCommand(commandId!);
        setForm({ ...command });
        setRaw(raw);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [commandId, isNew]);

  function patch<K extends keyof CommandFile>(key: K, val: CommandFile[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      if (mode === "raw") {
        if (isNew) {
          setErr("新規作成では構造化モードを使ってください");
          return;
        }
        const res = await updateCommand(commandId!, { raw });
        onSaved(res.command);
        return;
      }
      // structured
      if (!form.id || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(form.id)) {
        setErr("id は半角英数とハイフン (例: x-like-5)");
        return;
      }
      if (!form.name.trim()) {
        setErr("name は必須");
        return;
      }
      if (form.group && /[\s\\/\x00]/.test(form.group)) {
        setErr("group にスペースやスラッシュは使えません。代わりにアンダースコアで (例: TikTok_Lite)");
        return;
      }
      if (form.type === "run" && !form.prompt?.trim()) {
        setErr("run タイプは prompt が必須");
        return;
      }
      if (form.type === "macro" && !form.macro_file?.trim()) {
        setErr("macro タイプは macro_file が必須");
        return;
      }
      const payload = {
        ...form,
        group: form.group?.trim() || "(未分類)",
        tags: form.tags.filter((t) => t.trim()),
      };
      if (isNew) {
        const saved = await createCommand(payload);
        onSaved(saved);
      } else {
        const res = await updateCommand(commandId!, payload);
        onSaved(res.command);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!commandId) return;
    if (!confirm(`本当に "${commandId}" を削除しますか？`)) return;
    setBusy(true);
    try {
      await deleteCommand(commandId);
      onDeleted(commandId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="empty">読み込み中...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal log-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{isNew ? "新規コマンド作成" : `コマンド編集: ${commandId}`}</h2>

        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <button
            type="button"
            className={mode === "structured" ? "primary" : ""}
            onClick={() => setMode("structured")}
          >
            構造化フォーム
          </button>
          <button
            type="button"
            className={mode === "raw" ? "primary" : ""}
            onClick={() => setMode("raw")}
            disabled={isNew}
            title={isNew ? "新規作成では構造化モードのみ" : ""}
          >
            生 YAML
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", paddingRight: 6 }}>
          <div className="sched-preview" style={{ marginBottom: 12, borderTop: 0, paddingTop: 0 }}>
            <div className="sched-preview-label">▶ 実行されるコマンド (プレビュー)</div>
            <pre>{previewCommand(form)}</pre>
          </div>
          {mode === "structured" ? (
            <StructuredForm form={form} patch={patch} isNew={isNew} existingGroups={existingGroups} />
          ) : (
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              style={{
                width: "100%",
                minHeight: 400,
                fontFamily: "var(--mono)",
                fontSize: 12,
                background: "#000",
                color: "#d0d0d0",
                resize: "vertical",
              }}
              spellCheck={false}
            />
          )}
        </div>

        {err && <div className="notice" style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>{err}</div>}

        <div className="actions">
          {!isNew && (
            <button className="danger" onClick={() => void onDelete()} disabled={busy} style={{ marginRight: "auto" }}>
              削除
            </button>
          )}
          <button onClick={onClose} disabled={busy}>キャンセル</button>
          <button className="primary" onClick={() => void save()} disabled={busy}>
            {busy ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface SFProps {
  form: CommandFile;
  patch: <K extends keyof CommandFile>(key: K, val: CommandFile[K]) => void;
  isNew: boolean;
  existingGroups: string[];
}

function StructuredForm({ form, patch, isNew, existingGroups }: SFProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {isNew && (
        <Row label="id (半角英数 - のみ)">
          <input
            value={form.id}
            onChange={(e) => patch("id", e.target.value)}
            placeholder="x-like-5"
            style={{ fontFamily: "var(--mono)" }}
          />
        </Row>
      )}
      <Row label="name (表示名)">
        <input value={form.name} onChange={(e) => patch("name", e.target.value)} />
      </Row>
      <Row label="group (ディレクトリ名 / 空白不可, _ で代用)">
        <input
          value={form.group}
          onChange={(e) => patch("group", e.target.value)}
          placeholder="X / TikTok_Lite / にゃんこ大戦争"
          style={{ fontFamily: "var(--mono)" }}
          list="existing-groups"
        />
        <datalist id="existing-groups">
          {existingGroups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </Row>
      <Row label="type">
        <SegmentedSelect<CommandType>
          value={form.type}
          options={[
            { label: "run (エージェント)", value: "run" },
            { label: "macro (リプレイ)", value: "macro" },
          ]}
          onChange={(v) => patch("type", v)}
        />
      </Row>
      <Row label="status">
        <SegmentedSelect<CommandStatus>
          value={form.status}
          options={[
            { label: "confirmed", value: "confirmed" },
            { label: "unconfirmed", value: "unconfirmed" },
          ]}
          onChange={(v) => patch("status", v)}
        />
      </Row>
      <Row label="tags (カンマ区切り / 任意)">
        <input
          value={form.tags.join(", ")}
          onChange={(e) =>
            patch(
              "tags",
              e.target.value
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
            )
          }
          placeholder="x, like"
          style={{ fontFamily: "var(--mono)" }}
        />
      </Row>
      <Row label="notes (1行サブ説明 / 任意)">
        <input value={form.notes ?? ""} onChange={(e) => patch("notes", e.target.value || undefined)} />
      </Row>

      {form.type === "run" ? (
        <>
          <Row label="steps">
            <input
              type="number"
              value={form.steps ?? ""}
              onChange={(e) => patch("steps", e.target.value === "" ? undefined : Number(e.target.value))}
            />
          </Row>
          <Row label="vision">
            <SegmentedSelect<boolean>
              value={form.vision ?? false}
              options={[
                { label: "ON", value: true },
                { label: "OFF", value: false },
              ]}
              onChange={(v) => patch("vision", v)}
            />
          </Row>
          <Row label="reasoning">
            <SegmentedSelect<boolean>
              value={form.reasoning ?? false}
              options={[
                { label: "ON", value: true },
                { label: "OFF", value: false },
              ]}
              onChange={(v) => patch("reasoning", v)}
            />
          </Row>
          <Row label="prompt (mobilerun run の末尾引数として渡されるプロンプト)">
            <textarea
              value={form.prompt ?? ""}
              onChange={(e) => patch("prompt", e.target.value)}
              style={{ minHeight: 240, fontFamily: "var(--mono)", fontSize: 12, resize: "vertical" }}
            />
          </Row>
        </>
      ) : (
        <>
          <Row label="macro_file (command-runner/ からの相対パス)">
            <input
              value={form.macro_file ?? ""}
              onChange={(e) => patch("macro_file", e.target.value)}
              placeholder="macros/foo.json"
              style={{ fontFamily: "var(--mono)" }}
            />
          </Row>
          <Row label="delay (ms)">
            <input
              type="number"
              value={form.delay ?? ""}
              onChange={(e) => patch("delay", e.target.value === "" ? undefined : Number(e.target.value))}
            />
          </Row>
          <Row label="max_steps">
            <input
              type="number"
              value={form.max_steps ?? ""}
              onChange={(e) => patch("max_steps", e.target.value === "" ? undefined : Number(e.target.value))}
            />
          </Row>
          <Row label="prompt (メモ / 任意)">
            <textarea
              value={form.prompt ?? ""}
              onChange={(e) => patch("prompt", e.target.value)}
              style={{ minHeight: 80, fontFamily: "var(--mono)", fontSize: 12, resize: "vertical" }}
            />
          </Row>
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="form-row" style={{ marginBottom: 0 }}>
      <label>{label}</label>
      {children}
    </div>
  );
}

interface SegProps<T extends string | boolean> {
  value: T;
  options: { label: string; value: T }[];
  onChange: (v: T) => void;
}

function SegmentedSelect<T extends string | boolean>({ value, options, onChange }: SegProps<T>) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {options.map((o) => (
        <button
          key={String(o.value)}
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
