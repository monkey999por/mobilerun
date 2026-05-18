import { useCallback, useEffect, useState } from "react";
import { adbConnect, adbDisconnect, adbDiscover, adbPair, saveDevice } from "../api";
import type { AdbDiscover, DeviceState, MdnsService } from "../types";
import { QrPairPanel } from "./QrPairPanel";

interface Props {
  current: DeviceState | null;
  defaultTtlSeconds: number;
  reason?: string;
  onSaved: (d: DeviceState) => void;
  onCancel: () => void;
}

const TTL_PRESETS: { label: string; sec: number }[] = [
  { label: "1時間", sec: 60 * 60 },
  { label: "4時間", sec: 4 * 60 * 60 },
  { label: "8時間", sec: 8 * 60 * 60 },
  { label: "24時間", sec: 24 * 60 * 60 },
];

type Mode = "auto" | "qr" | "manual";

export function DeviceModal({ current, defaultTtlSeconds, reason, onSaved, onCancel }: Props) {
  const [mode, setMode] = useState<Mode>("auto");
  const [ttl, setTtl] = useState(defaultTtlSeconds);
  const [discover, setDiscover] = useState<AdbDiscover | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pairTarget, setPairTarget] = useState<MdnsService | null>(null);
  const [pin, setPin] = useState("");
  const [manualAddr, setManualAddr] = useState(current?.device || "");

  const refresh = useCallback(async () => {
    setDiscovering(true);
    setErr(null);
    try {
      setDiscover(await adbDiscover());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDiscovering(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function doConnect(target: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await adbConnect(target, ttl);
      if (res.ok && res.device) {
        onSaved(res.device);
        return;
      }
      setErr(res.message || "接続に失敗しました");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doPair() {
    if (!pairTarget || !pin.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await adbPair(pairTarget.addr, pin.trim());
      if (!res.ok) {
        setErr(res.message || "ペアリング失敗");
        return;
      }
      // ペアリング成功後は connection service が別ポートで現れるので再探索
      const next = await adbDiscover();
      setDiscover(next);
      setPairTarget(null);
      setPin("");
      // 同じ host の paired サービスを自動接続
      const host = pairTarget.addr.split(":")[0];
      const connectSvc = next.mdns.find((m) => m.kind === "connect" && m.addr.startsWith(host));
      if (connectSvc) {
        await doConnect(connectSvc.addr);
      } else {
        setErr("ペアリングは成功しましたが connection service が見つかりません。「再探索」してください。");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doManualSave() {
    if (!manualAddr.trim()) {
      setErr("address を入力してください");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const d = await saveDevice(manualAddr.trim(), ttl);
      onSaved(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doDisconnect(target: string) {
    await adbDisconnect(target);
    await refresh();
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 520 }}>
        <h2>デバイス選択</h2>
        {reason && <div className="notice">{reason}</div>}

        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <button
            type="button"
            className={mode === "auto" ? "primary" : ""}
            onClick={() => setMode("auto")}
          >
            自動探索 (mDNS)
          </button>
          <button
            type="button"
            className={mode === "qr" ? "primary" : ""}
            onClick={() => setMode("qr")}
          >
            QR でペアリング
          </button>
          <button
            type="button"
            className={mode === "manual" ? "primary" : ""}
            onClick={() => setMode("manual")}
          >
            手動入力
          </button>
        </div>

        <div className="form-row">
          <label>有効期限</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {TTL_PRESETS.map((p) => (
              <button
                key={p.sec}
                type="button"
                className={ttl === p.sec ? "primary" : ""}
                onClick={() => setTtl(p.sec)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {mode === "qr" && (
          <QrPairPanel
            ttlSeconds={ttl}
            onSuccess={(d) => onSaved(d)}
            onCancel={onCancel}
          />
        )}

        {mode === "auto" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
                端末側で「ワイヤレスデバッグ」を ON にしてください
              </span>
              <button onClick={() => void refresh()} disabled={discovering || busy}>
                {discovering ? "探索中..." : "再探索"}
              </button>
            </div>

            <DiscoverList
              discover={discover}
              discovering={discovering}
              busy={busy}
              onConnect={(t) => void doConnect(t)}
              onPair={(svc) => {
                setPairTarget(svc);
                setPin("");
                setErr(null);
              }}
              onDisconnect={(t) => void doDisconnect(t)}
            />

            {pairTarget && (
              <div style={{ marginTop: 12, padding: 10, background: "var(--panel-2)", borderRadius: 6 }}>
                <div style={{ fontSize: 13, marginBottom: 6 }}>
                  <strong>ペアリング</strong> <span style={{ fontFamily: "var(--mono)" }}>{pairTarget.addr}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8 }}>
                  端末の「ペアリングコードでデバイスをペア設定」に表示された 6 桁の PIN を入力。
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    autoFocus
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 18, letterSpacing: 4, textAlign: "center" }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && pin.length === 6) void doPair();
                    }}
                  />
                  <button onClick={() => setPairTarget(null)} disabled={busy}>
                    キャンセル
                  </button>
                  <button className="primary" onClick={() => void doPair()} disabled={busy || pin.length < 6}>
                    {busy ? "実行中..." : "ペアリング実行"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {mode === "manual" && (
          <div className="form-row">
            <label>device address (例: 100.64.1.47:33515)</label>
            <input
              value={manualAddr}
              onChange={(e) => setManualAddr(e.target.value)}
              placeholder="100.64.1.47:33515"
              onKeyDown={(e) => {
                if (e.key === "Enter") void doManualSave();
              }}
            />
            <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
              <button className="primary" onClick={() => void doManualSave()} disabled={busy}>
                {busy ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        )}

        {err && <div className="notice" style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>{err}</div>}

        <div className="actions">
          <button onClick={onCancel} disabled={busy}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

interface ListProps {
  discover: AdbDiscover | null;
  discovering: boolean;
  busy: boolean;
  onConnect: (target: string) => void;
  onPair: (svc: MdnsService) => void;
  onDisconnect: (target: string) => void;
}

function DiscoverList({ discover, discovering, busy, onConnect, onPair, onDisconnect }: ListProps) {
  if (!discover) {
    return <div className="empty" style={{ padding: 20 }}>探索を待機中...</div>;
  }
  const { mdns, devices } = discover;
  const connectedSerials = new Set(devices.filter((d) => d.state === "device").map((d) => d.serial));
  const pairing = mdns.filter((m) => m.kind === "pairing");
  const ready = mdns.filter((m) => m.kind === "connect");

  if (mdns.length === 0 && devices.length === 0) {
    return (
      <div className="empty" style={{ padding: 16, fontSize: 13 }}>
        探索結果なし。
        <br />
        端末側で「開発者オプション → ワイヤレスデバッグ」を ON にしてから再探索してください。
        <br />
        Mac と端末が同じ Wi-Fi にあるか / VPN を切るかも確認。
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {ready.length > 0 && (
        <Section title="接続可能 (ペアリング済み)">
          {ready.map((svc) => {
            const isConnected = connectedSerials.has(svc.addr);
            return (
              <Row
                key={svc.name}
                addr={svc.addr}
                rightBadge={isConnected ? <span className="badge ok">接続済み</span> : null}
                actions={
                  <>
                    <button
                      className="primary"
                      onClick={() => onConnect(svc.addr)}
                      disabled={busy || discovering}
                    >
                      {isConnected ? "選択して保存" : "接続"}
                    </button>
                    {isConnected && (
                      <button onClick={() => onDisconnect(svc.addr)} disabled={busy || discovering}>
                        切断
                      </button>
                    )}
                  </>
                }
              />
            );
          })}
        </Section>
      )}

      {pairing.length > 0 && (
        <Section title="ペアリング待機中 (PIN 入力が必要)">
          {pairing.map((svc) => (
            <Row
              key={svc.name}
              addr={svc.addr}
              rightBadge={<span className="badge warn">unpaired</span>}
              actions={
                <button onClick={() => onPair(svc)} disabled={busy || discovering}>
                  ペアリング
                </button>
              }
            />
          ))}
        </Section>
      )}

      {devices.length > 0 && (
        <Section title="adb devices (USB / 既接続)">
          {devices.map((d) => (
            <Row
              key={d.serial}
              addr={d.serial}
              rightBadge={<span className="badge">{d.state}</span>}
              actions={
                d.state === "device" ? (
                  <button className="primary" onClick={() => onConnect(d.serial)} disabled={busy}>
                    選択して保存
                  </button>
                ) : null
              }
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{children}</div>
    </div>
  );
}

function Row({
  addr,
  rightBadge,
  actions,
}: {
  addr: string;
  rightBadge: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        background: "var(--panel-2)",
        borderRadius: 6,
        border: "1px solid var(--border)",
      }}
    >
      <span style={{ fontFamily: "var(--mono)", fontSize: 13, flex: 1 }}>{addr}</span>
      {rightBadge}
      <div style={{ display: "flex", gap: 4 }}>{actions}</div>
    </div>
  );
}
