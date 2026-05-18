import { useEffect, useState } from "react";
import type { RunMeta } from "../types";
import { fetchRuns } from "../api";
import { fmtDateTime, fmtDuration } from "../utils";

interface Props {
  onOpen: (runId: string) => void;
  refreshKey: number;
}

export function RunsTab({ onOpen, refreshKey }: Props) {
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await fetchRuns();
        if (!cancelled) setRuns(list);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const t = setInterval(load, 5_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [refreshKey]);

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
          </tr>
        ))}
      </tbody>
    </table>
  );
}
