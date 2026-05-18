import { useState } from "react";
import type { CommandFile, CommandParameter } from "../types";
import { startRun } from "../api";
import { previewCommand } from "../utils";
import { CommandEditor } from "./CommandEditor";

interface Props {
  commands: CommandFile[];
  groups: string[];
  loading: boolean;
  activeRun: { id: string; commandName: string } | null;
  onLaunched: (runId: string) => void;
  onNeedDevice: () => void;
  onCommandsChanged: () => void;
}

type EditorState = { mode: "edit"; id: string } | { mode: "new" } | null;

export function CommandsTab({ commands, groups, loading, activeRun, onLaunched, onNeedDevice, onCommandsChanged }: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [paramPrompt, setParamPrompt] = useState<CommandFile | null>(null);

  async function launch(cmd: CommandFile, parameters?: Record<string, string>) {
    setErr(null);
    setPendingId(cmd.id);
    try {
      const r = await startRun(cmd.id, parameters);
      onLaunched(r.id);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "device_required") {
        onNeedDevice();
      } else {
        setErr(err.message || String(e));
      }
    } finally {
      setPendingId(null);
    }
  }

  function run(cmd: CommandFile) {
    // parameter があれば実行モーダルでまず値を集めてから launch する。
    if (cmd.parameters && cmd.parameters.length > 0) {
      setErr(null);
      setParamPrompt(cmd);
      return;
    }
    void launch(cmd);
  }

  const byGroup = new Map<string, CommandFile[]>();
  for (const c of commands) {
    const list = byGroup.get(c.group) ?? [];
    list.push(c);
    byGroup.set(c.group, list);
  }
  const orderedGroups = groups.filter((g) => byGroup.has(g));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
          {commands.length} 件 · {orderedGroups.length} グループ ·{" "}
          <span className="cmd-card-tag atomic" style={{ marginLeft: 4 }}>
            atomic
          </span>{" "}
          tag のものは <code>.claude/skills/</code> から呼ばれる前提のパーツ
        </span>
        <button className="primary" onClick={() => setEditor({ mode: "new" })}>
          + 新規
        </button>
      </div>
      {err && <div className="notice">{err}</div>}
      {activeRun && (
        <div className="notice" style={{ fontWeight: 600 }}>
          現在「{activeRun.commandName}」が実行中のため、終了するまで別コマンドは実行できません。
        </div>
      )}
      {loading ? (
        <div className="empty">読み込み中...</div>
      ) : commands.length === 0 ? (
        <div className="empty">コマンドなし</div>
      ) : (
        <div className="cmd-groups">
          {orderedGroups.map((g) => (
            <CommandGroup
              key={g}
              groupName={g}
              commands={byGroup.get(g) ?? []}
              pendingId={pendingId}
              disabledAll={activeRun !== null}
              onRun={(c) => void run(c)}
              onEdit={(id) => setEditor({ mode: "edit", id })}
            />
          ))}
        </div>
      )}
      {editor && (
        <CommandEditor
          commandId={editor.mode === "edit" ? editor.id : null}
          existingGroups={groups}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            onCommandsChanged();
          }}
          onDeleted={() => {
            setEditor(null);
            onCommandsChanged();
          }}
        />
      )}
      {paramPrompt && (
        <ParamPromptModal
          command={paramPrompt}
          busy={pendingId === paramPrompt.id}
          onCancel={() => setParamPrompt(null)}
          onSubmit={(values) => {
            const cmd = paramPrompt;
            setParamPrompt(null);
            void launch(cmd, values);
          }}
        />
      )}
    </div>
  );
}

interface ParamPromptProps {
  command: CommandFile;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (values: Record<string, string>) => void;
}

function ParamPromptModal({ command, busy, onCancel, onSubmit }: ParamPromptProps) {
  const params: CommandParameter[] = command.parameters ?? [];
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const p of params) init[p.name] = p.default ?? "";
    return init;
  });
  const [localErr, setLocalErr] = useState<string | null>(null);

  function submit() {
    for (const p of params) {
      if (p.required && !values[p.name]?.trim()) {
        setLocalErr(`${p.name} は必須です`);
        return;
      }
    }
    setLocalErr(null);
    onSubmit(values);
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 480 }}>
        <h2>パラメータ入力: {command.name}</h2>
        <div style={{ color: "var(--text-dim)", fontSize: 12, marginBottom: 12 }}>
          prompt 内の <code>{`{{name}}`}</code> がここで入れた値で置換されてから mobilerun に渡されます。
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {params.map((p) => (
            <div key={p.name} className="form-row" style={{ marginBottom: 0 }}>
              <label>
                {p.name}
                {p.required && <span style={{ color: "var(--err)", marginLeft: 4 }}>*</span>}
                {p.description && (
                  <span style={{ color: "var(--text-dim)", fontWeight: 400, marginLeft: 6, fontSize: 11 }}>
                    {p.description}
                  </span>
                )}
              </label>
              <textarea
                value={values[p.name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                placeholder={p.default ?? ""}
                style={{ minHeight: 60, fontFamily: "var(--mono)", fontSize: 12, resize: "vertical" }}
              />
            </div>
          ))}
        </div>
        {localErr && <div className="notice" style={{ marginTop: 10 }}>{localErr}</div>}
        <div className="actions">
          <button onClick={onCancel} disabled={busy}>キャンセル</button>
          <button className="primary" onClick={submit} disabled={busy}>
            {busy ? "起動中..." : "実行"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface GroupProps {
  groupName: string;
  commands: CommandFile[];
  pendingId: string | null;
  disabledAll: boolean;
  onRun: (c: CommandFile) => void;
  onEdit: (id: string) => void;
}

function CommandGroup({ groupName, commands, pendingId, disabledAll, onRun, onEdit }: GroupProps) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className="cmd-group">
      <header className="cmd-group-header" onClick={() => setCollapsed((v) => !v)}>
        <span className="cmd-group-caret">{collapsed ? "▸" : "▾"}</span>
        <span className="cmd-group-name">{groupName}</span>
        <span className="cmd-group-count">{commands.length}</span>
      </header>
      {!collapsed && (
        <div className="cmd-list">
          {commands.map((c) => {
            const description = c.notes || c.prompt || "";
            const preview = previewCommand(c);
            return (
              <article key={c.id} className="cmd-card">
                <h3 className="cmd-card-title">
                  {c.name}
                  {c.tags.includes("atomic") && (
                    <span
                      className="cmd-card-tag atomic"
                      title="このコマンドは Claude Code の skill (.claude/skills/*/SKILL.md) から呼ばれる前提の atomic です。viewer で単体実行も可能だが、通常は skill 経由で連鎖実行されます。"
                    >
                      atomic
                    </span>
                  )}
                  {c.tags
                    .filter((t) => t !== "atomic")
                    .map((t) => (
                      <span key={t} className="cmd-card-tag">
                        {t}
                      </span>
                    ))}
                </h3>
                {description && (
                  <div className="cmd-card-desc-wrap" tabIndex={0}>
                    <p className="cmd-card-desc">{description}</p>
                  </div>
                )}
                <code className="cmd-card-preview" title={preview}>{preview}</code>
                <div className="cmd-card-actions">
                  <button
                    className="primary"
                    disabled={pendingId === c.id || disabledAll}
                    onClick={() => onRun(c)}
                  >
                    {pendingId === c.id ? "起動中..." : "実行"}
                  </button>
                  <button onClick={() => onEdit(c.id)}>編集</button>
                </div>
                {description && (
                  <div className="cmd-card-desc-tooltip" role="tooltip">
                    {description}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
