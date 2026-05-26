import { useEffect, useState, useCallback } from "react";
import type { SkillInfo, SkillRunMeta } from "../types";
import { fetchSkills, fetchSkillRuns, startSkillRun as apiStartSkillRun } from "../api";
import { SkillRunModal } from "./SkillRunModal";
import { fmtDuration } from "../utils";

interface Props {
  /** 現在 active な skill run があれば表示用に渡す */
  activeSkillRun: SkillRunMeta | null;
  onLaunched: (runId: string) => void;
}

type LaunchPrompt = { skill: SkillInfo; extra: string } | null;

export function SkillsTab({ activeSkillRun, onLaunched }: Props) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [recentRuns, setRecentRuns] = useState<SkillRunMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [launchPrompt, setLaunchPrompt] = useState<LaunchPrompt>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([fetchSkills(), fetchSkillRuns()]);
      setSkills(s);
      setRecentRuns(r.slice(0, 10));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 5_000);
    return () => clearInterval(t);
  }, [reload]);

  async function launch(skill: SkillInfo, extra: string) {
    setErr(null);
    setPendingId(skill.id);
    try {
      const run = await apiStartSkillRun(skill.id, extra.trim() || undefined);
      onLaunched(run.id);
      setOpenRunId(run.id);
      void reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingId(null);
    }
  }

  const blocked = activeSkillRun !== null;

  return (
    <div>
      <div style={{ marginBottom: 12, color: "var(--text-dim)", fontSize: 12 }}>
        {skills.length} 件 · <code>.claude/skills/&lt;id&gt;/SKILL.md</code> を読み込み ·
        コンテナ内の <code>claude --print --dangerously-skip-permissions</code> で実行されます
      </div>
      {err && <div className="notice">{err}</div>}
      {blocked && (
        <div className="notice" style={{ fontWeight: 600 }}>
          現在「/{activeSkillRun!.skillId}」を実行中のため、別 skill は起動できません。
        </div>
      )}
      {loading ? (
        <div className="empty">読み込み中...</div>
      ) : skills.length === 0 ? (
        <div className="empty">
          skill が見つかりません (<code>.claude/skills/</code> が空)
        </div>
      ) : (
        <div className="cmd-list" style={{ marginBottom: 24 }}>
          {skills.map((s) => (
            <article key={s.id} className="cmd-card runnable">
              <h3 className="cmd-card-title">
                /{s.id}
                <span className="cmd-card-tag" style={{ background: "#c8acff", color: "#1a1a2e" }}>
                  skill
                </span>
              </h3>
              {s.description && (
                <div className="cmd-card-desc-wrap" tabIndex={0}>
                  <p className="cmd-card-desc">{s.description}</p>
                </div>
              )}
              {s.whenToUse && (
                <code className="cmd-card-preview" title={s.whenToUse}>
                  {s.whenToUse}
                </code>
              )}
              <div className="cmd-card-actions">
                <button
                  className="primary"
                  disabled={pendingId === s.id || blocked}
                  onClick={() => setLaunchPrompt({ skill: s, extra: "" })}
                >
                  {pendingId === s.id ? "起動中..." : "実行"}
                </button>
              </div>
              {s.description && (
                <div className="cmd-card-desc-tooltip" role="tooltip">
                  {s.description}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {recentRuns.length > 0 && (
        <div>
          <h3 style={{ margin: "16px 0 8px", fontSize: 14, color: "var(--text-dim)" }}>
            最近の実行
          </h3>
          <table className="runs-table">
            <thead>
              <tr>
                <th>skill</th>
                <th>開始</th>
                <th>長さ</th>
                <th>status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((r) => (
                <tr key={r.id}>
                  <td>/{r.skillId}</td>
                  <td>{new Date(r.startedAt).toLocaleString()}</td>
                  <td>{fmtDuration(r.startedAt, r.endedAt)}</td>
                  <td className={`status-${r.status}`}>{r.status}</td>
                  <td>
                    <button onClick={() => setOpenRunId(r.id)}>ログ</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {launchPrompt && (
        <LaunchPromptModal
          skill={launchPrompt.skill}
          busy={pendingId === launchPrompt.skill.id}
          onCancel={() => setLaunchPrompt(null)}
          onSubmit={(extra) => {
            const s = launchPrompt.skill;
            setLaunchPrompt(null);
            void launch(s, extra);
          }}
        />
      )}
      {openRunId && <SkillRunModal runId={openRunId} onClose={() => setOpenRunId(null)} />}
    </div>
  );
}

interface LaunchPromptProps {
  skill: SkillInfo;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (extra: string) => void;
}

function LaunchPromptModal({ skill, busy, onCancel, onSubmit }: LaunchPromptProps) {
  const [extra, setExtra] = useState("");
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 480 }}>
        <h2>/{skill.id} を実行</h2>
        <div style={{ color: "var(--text-dim)", fontSize: 12, marginBottom: 12 }}>
          stdin に <code>/{skill.id}</code> を送ります。追加の指示があれば下に入力してください
          (空でも OK)。
        </div>
        {skill.description && (
          <div style={{ color: "var(--text-dim)", fontSize: 12, marginBottom: 12 }}>
            {skill.description}
          </div>
        )}
        <div className="form-row">
          <label>追加指示 (optional)</label>
          <textarea
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="例: 5 件目までで止めて"
            style={{ minHeight: 80, fontFamily: "var(--mono)", fontSize: 12, resize: "vertical" }}
          />
        </div>
        <div className="actions">
          <button onClick={onCancel} disabled={busy}>
            キャンセル
          </button>
          <button className="primary" onClick={() => onSubmit(extra)} disabled={busy}>
            {busy ? "起動中..." : "実行"}
          </button>
        </div>
      </div>
    </div>
  );
}
