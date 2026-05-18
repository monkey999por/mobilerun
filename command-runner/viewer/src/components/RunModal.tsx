import { useEffect, useRef, useState } from "react";
import type { RunMeta } from "../types";
import { cancelRun, fetchRun } from "../api";
import { fmtDuration } from "../utils";

interface Props {
  runId: string;
  onClose: () => void;
}

export function RunModal({ runId, onClose }: Props) {
  const [meta, setMeta] = useState<RunMeta | null>(null);
  const [log, setLog] = useState("");
  const [running, setRunning] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchRun(runId);
        if (cancelled) return;
        setMeta(r.run);
        setLog(r.log);
        setRunning(r.running);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream`);
    es.addEventListener("log", (e) => {
      setLog((prev) => prev + (e as MessageEvent).data);
    });
    es.addEventListener("end", (e) => {
      try {
        const m = JSON.parse((e as MessageEvent).data) as RunMeta;
        setMeta(m);
      } catch {
        /* ignore */
      }
      setRunning(false);
      es.close();
    });
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  }, [runId]);

  useEffect(() => {
    if (autoScrollRef.current && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    autoScrollRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
  }

  async function onCancel() {
    if (!confirm("実行を中断しますか？")) return;
    await cancelRun(runId);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal log-modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          {meta?.commandName || runId}{" "}
          <span className={`status-${meta?.status || "running"}`} style={{ fontSize: 13 }}>
            ({running ? "running" : meta?.status})
            {meta?.startedAt && ` · ${fmtDuration(meta.startedAt, meta.endedAt)}`}
            {meta?.exitCode != null && ` · exit ${meta.exitCode}`}
          </span>
        </h2>
        <div ref={logRef} className="log" onScroll={onScroll}>
          {log || (running ? "ログ取得中..." : "(空)")}
        </div>
        <div className="actions">
          {running && (
            <button className="danger" onClick={onCancel}>
              中断
            </button>
          )}
          <button onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
