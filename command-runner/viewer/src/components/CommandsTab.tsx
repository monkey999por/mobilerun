import { useState } from "react";
import type { CommandFile } from "../types";
import { startRun } from "../api";
import { previewCommand } from "../utils";
import { CommandEditor } from "./CommandEditor";

interface Props {
  commands: CommandFile[];
  groups: string[];
  loading: boolean;
  onLaunched: (runId: string) => void;
  onNeedDevice: () => void;
  onCommandsChanged: () => void;
}

type EditorState = { mode: "edit"; id: string } | { mode: "new" } | null;

export function CommandsTab({ commands, groups, loading, onLaunched, onNeedDevice, onCommandsChanged }: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);

  async function run(cmd: CommandFile) {
    setErr(null);
    setPendingId(cmd.id);
    try {
      const r = await startRun(cmd.id);
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
          {commands.length} 件 · {orderedGroups.length} グループ
        </span>
        <button className="primary" onClick={() => setEditor({ mode: "new" })}>
          + 新規
        </button>
      </div>
      {err && <div className="notice">{err}</div>}
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
    </div>
  );
}

interface GroupProps {
  groupName: string;
  commands: CommandFile[];
  pendingId: string | null;
  onRun: (c: CommandFile) => void;
  onEdit: (id: string) => void;
}

function CommandGroup({ groupName, commands, pendingId, onRun, onEdit }: GroupProps) {
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
                <h3 className="cmd-card-title">{c.name}</h3>
                {description && (
                  <div className="cmd-card-desc-wrap" tabIndex={0}>
                    <p className="cmd-card-desc">{description}</p>
                  </div>
                )}
                <code className="cmd-card-preview" title={preview}>{preview}</code>
                <div className="cmd-card-actions">
                  <button
                    className="primary"
                    disabled={pendingId === c.id}
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
