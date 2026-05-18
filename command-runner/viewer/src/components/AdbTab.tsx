import { useCallback, useEffect, useState } from "react";
import { adbExec, fetchAdbStatus } from "../api";
import type { AdbExecResult, AdbStatus } from "../types";

const QUICK_ACTIONS: { label: string; argv: string[] }[] = [
  { label: "devices", argv: ["devices"] },
  { label: "devices -l", argv: ["devices", "-l"] },
  { label: "mdns services", argv: ["mdns", "services"] },
  { label: "mdns check", argv: ["mdns", "check"] },
  { label: "get-state", argv: ["get-state"] },
  { label: "version", argv: ["version"] },
];

export function AdbTab() {
  const [status, setStatus] = useState<AdbStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusErr, setStatusErr] = useState<string | null>(null);

  const [input, setInput] = useState("devices -l");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<AdbExecResult[]>([]);

  const reloadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusErr(null);
    try {
      setStatus(await fetchAdbStatus());
    } catch (e) {
      setStatusErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadStatus();
    const t = setInterval(reloadStatus, 15_000);
    return () => clearInterval(t);
  }, [reloadStatus]);

  async function exec(argv: string[]) {
    setRunning(true);
    try {
      const res = await adbExec(argv);
      setHistory((h) => [res, ...h].slice(0, 30));
    } finally {
      setRunning(false);
    }
  }

  function parseInput(s: string): string[] {
    return s
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  return (
    <div className="adb-layout">
      <section className="sched-panel">
        <div className="sched-panel-header">
          <h3 className="sched-panel-title" style={{ margin: 0 }}>ADB ステータス</h3>
          <button onClick={() => void reloadStatus()} disabled={statusLoading}>
            {statusLoading ? "更新中..." : "更新"}
          </button>
        </div>
        {statusErr && <div className="notice">{statusErr}</div>}
        {status && (
          <div className="adb-status">
            <StatusLine label="binary">
              <code>{status.binary}</code>
            </StatusLine>
            <StatusLine label="server (ADB_SERVER_SOCKET)">
              <code>{status.serverSocket ?? "(default 127.0.0.1:5037)"}</code>
            </StatusLine>
            <StatusSection cmd="adb version">
              <pre style={{ margin: 0, fontFamily: "var(--mono)", fontSize: 12, whiteSpace: "pre-wrap" }}>
                {status.version ?? "(取得失敗)"}
              </pre>
            </StatusSection>
            <StatusSection cmd="adb devices" badge={`${status.devices.length} 件`}>
              {status.devices.length === 0 ? (
                <span style={{ color: "var(--text-dim)" }}>なし</span>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {status.devices.map((d) => (
                    <li key={d.serial} style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                      {d.serial} · <span style={{ color: "var(--text-dim)" }}>{d.state}</span>
                    </li>
                  ))}
                </ul>
              )}
            </StatusSection>
            <StatusSection cmd="adb mdns services" badge={`${status.mdns.length} 件`}>
              {status.mdns.length === 0 ? (
                <span style={{ color: "var(--text-dim)" }}>なし</span>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {status.mdns.map((m) => (
                    <li key={m.name} style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                      <span style={{ color: m.kind === "connect" ? "var(--ok)" : "var(--warn)" }}>
                        {m.kind === "connect" ? "● paired" : "○ pairing"}
                      </span>{" "}
                      {m.addr} <span style={{ color: "var(--text-dim)" }}>({m.name})</span>
                    </li>
                  ))}
                </ul>
              )}
            </StatusSection>
          </div>
        )}
      </section>

      <section className="sched-panel">
        <div className="sched-panel-header">
          <h3 className="sched-panel-title" style={{ margin: 0 }}>ADB コマンド実行</h3>
          <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
            実行は <code>{status?.binary ?? "adb"}</code> 経由
          </span>
        </div>

        <div className="adb-quick">
          {QUICK_ACTIONS.map((a) => (
            <button key={a.label} disabled={running} onClick={() => void exec(a.argv)}>
              {a.label}
            </button>
          ))}
        </div>

        <div className="sched-field">
          <label>任意 adb サブコマンド (例: <code>shell getprop ro.build.version.release</code>)</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="devices -l"
              style={{ flex: 1, fontFamily: "var(--mono)" }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !running) {
                  const argv = parseInput(input);
                  if (argv.length) void exec(argv);
                }
              }}
            />
            <button
              className="primary"
              disabled={running || !input.trim()}
              onClick={() => {
                const argv = parseInput(input);
                if (argv.length) void exec(argv);
              }}
            >
              {running ? "実行中..." : "実行"}
            </button>
          </div>
          <span className="hint">
            空白で分割して adb に渡す。<code>&quot;</code> 内のスペースを保ちたい場合は今は非対応。
          </span>
        </div>

        <div className="adb-history">
          {history.length === 0 ? (
            <div className="empty" style={{ padding: 20 }}>履歴なし</div>
          ) : (
            history.map((r, i) => (
              <div key={i} className="adb-result">
                <div className="adb-result-head">
                  <code>$ adb {r.argv.join(" ")}</code>
                  <span className={r.ok ? "status-success" : "status-failed"}>
                    {r.ok ? "OK" : `exit ${r.exitCode ?? "?"}`}
                  </span>
                </div>
                {r.stdout && <pre className="adb-result-out">{r.stdout}</pre>}
                {r.stderr && <pre className="adb-result-err">{r.stderr}</pre>}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function StatusLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="adb-status-line">
      <div className="adb-status-label">{label}</div>
      <div className="adb-status-value">{children}</div>
    </div>
  );
}

function StatusSection({
  cmd,
  badge,
  children,
}: {
  cmd: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="adb-status-line">
      <div className="adb-status-cmd">
        <span className="adb-status-cmd-prompt">$</span>
        <code>{cmd}</code>
        {badge && <span className="adb-status-cmd-badge">{badge}</span>}
      </div>
      <div className="adb-status-value">{children}</div>
    </div>
  );
}
