import { useCallback, useEffect, useState } from "react";
import type { RunMeta } from "../types";
import { cancelRun, fetchRuns } from "../api";
import { fmtDateTime, fmtDuration } from "../utils";

interface Props {
  onOpen: (runId: string) => void;
  refreshKey: number;
}

export function RunsTab({ onOpen, refreshKey }: Props) {
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRuns(await fetchRuns());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5_000);
    return () => clearInterval(t);
  }, [load, refreshKey]);

  async function onCancel(id: string) {
    if (!confirm("実行を中断しますか？")) return;
    setCancellingId(id);
    try {
      await cancelRun(id);
      await load();
    } finally {
      setCancellingId(null);
    }
  }

  if (loading) return <div className="empty">読み込み中...</div>;
  if (runs.length === 0) return <div className="empty">実行履歴なし</div>;

  return (
    <table className="runs-table">
      <thead>
        <tr>
          <th>開始</th>
          <th>コマンド</th>
          <th>デバイス</th>
          <th>状態</th>
          <th>所要</th>
          <th>exit</th>
          <th>経路</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id} onClick={() => onOpen(r.id)}>
            <td>{fmtDateTime(r.startedAt)}</td>
            <td>{r.commandName}</td>
            <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{r.device}</td>
            <td className={`status-${r.status}`}>{r.status}</td>
            <td>{fmtDuration(r.startedAt, r.endedAt)}</td>
            <td>{r.exitCode ?? "-"}</td>
            <td style={{ color: "var(--text-dim)", fontSize: 12 }}>
              {r.scheduleEntryId ? "schedule" : "manual"}
            </td>
            <td onClick={(e) => e.stopPropagation()} style={{ textAlign: "right" }}>
              {r.status === "running" && (
                <button
                  className="danger"
                  disabled={cancellingId === r.id}
                  onClick={() => void onCancel(r.id)}
                >
                  {cancellingId === r.id ? "中断中..." : "中断"}
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
