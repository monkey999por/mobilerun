import { useEffect, useRef, useState } from "react";
import { cancelQrPair, startQrPair } from "../api";
import type { DeviceState, QrPairSession, QrPairState } from "../types";

interface Props {
  ttlSeconds: number;
  onSuccess: (device: DeviceState) => void;
  onCancel: () => void;
}

const STATE_LABEL: Record<QrPairState, string> = {
  waiting_scan: "端末でスキャン待ち...",
  pairing: "ペアリング中...",
  pair_failed: "ペアリング失敗",
  connecting: "接続中...",
  connect_failed: "接続失敗",
  success: "完了",
  expired: "タイムアウト",
  cancelled: "キャンセル",
};

const TERMINAL: QrPairState[] = ["success", "expired", "pair_failed", "connect_failed", "cancelled"];

export function QrPairPanel({ ttlSeconds, onSuccess, onCancel }: Props) {
  const [session, setSession] = useState<QrPairSession | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  useEffect(() => {
    let abort = false;
    let es: EventSource | null = null;
    let sessionIdForCleanup: string | null = null;
    (async () => {
      try {
        const s = await startQrPair(ttlSeconds);
        if (abort) {
          void cancelQrPair(s.id);
          return;
        }
        setSession(s);
        sessionIdForCleanup = s.id;
        es = new EventSource(`/api/adb/qr-pair/${encodeURIComponent(s.id)}/stream`);
        es.addEventListener("update", (e) => {
          try {
            const next = JSON.parse((e as MessageEvent).data) as QrPairSession;
            setSession(next);
            if (next.state === "success" && next.device) {
              // device は server 側で既に setDevice() 済み。改めて取得不要だが、
              // UI 反映のため /api/device を呼ぶ
              fetch("/api/device")
                .then((r) => r.json())
                .then((d) => {
                  if (d.device) onSuccessRef.current(d.device as DeviceState);
                })
                .catch(() => {
                  /* ignore */
                });
            }
            if (TERMINAL.includes(next.state)) es?.close();
          } catch {
            /* ignore */
          }
        });
        es.onerror = () => {
          es?.close();
        };
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      abort = true;
      es?.close();
      // サーバ側のセッションも掃除
      if (sessionIdForCleanup) {
        void cancelQrPair(sessionIdForCleanup);
      }
    };
  }, [ttlSeconds]);

  const state = session?.state ?? "waiting_scan";
  const showRetry = TERMINAL.includes(state) && state !== "success";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        className="qr-pair-svg"
        dangerouslySetInnerHTML={{
          __html: session?.qrSvg ?? '<div style="padding:40px;text-align:center;color:#666">QR 準備中...</div>',
        }}
      />
      <div style={{ fontSize: 12, color: "var(--text-dim)", textAlign: "center", lineHeight: 1.6 }}>
        端末で <strong>開発者オプション → ワイヤレスデバッグ → QR コードでデバイスをペア設定</strong>{" "}
        を開き、上の QR をスキャンしてください。
      </div>
      <div
        className={`qr-status state-${state}`}
        style={{
          padding: "10px 14px",
          background: "var(--panel-2)",
          borderRadius: 8,
          border: "1px solid var(--border)",
          fontSize: 13,
          textAlign: "center",
        }}
      >
        <div style={{ fontWeight: 600 }}>{STATE_LABEL[state]}</div>
        {session?.message && (
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4, whiteSpace: "pre-wrap" }}>
            {session.message}
          </div>
        )}
      </div>
      {err && <div className="notice">{err}</div>}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        {showRetry && (
          <button
            className="primary"
            onClick={() => {
              setSession(null);
              setErr(null);
              // useEffect 依存変化のため key を変える方法もあるが、簡易リスタート: cancel & re-mount
              onCancel();
            }}
          >
            閉じる
          </button>
        )}
        {!showRetry && (
          <button onClick={onCancel}>キャンセル</button>
        )}
      </div>
    </div>
  );
}
