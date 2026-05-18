import { useCallback, useEffect, useState } from "react";
import { adbConnect, adbDisconnect, adbDiscover, adbPair, probeTcp, saveDevice } from "../api";
import type { TcpProbeResult } from "../api";
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
  // 手動ペアリング (mDNS が届かない WSL2 / Docker 環境向け)
  const [manualPairAddr, setManualPairAddr] = useState("");
  const [manualPairPin, setManualPairPin] = useState("");
  const [manualPaired, setManualPaired] = useState(false);
  const [lastProbe, setLastProbe] = useState<TcpProbeResult | null>(null);

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
    setLastProbe(null);
    try {
      const res = await adbConnect(manualAddr.trim(), ttl);
      if (res.ok && res.device) {
        onSaved(res.device);
        return;
      }
      if (res.probe) setLastProbe(res.probe);
      // 接続失敗時は理由を表示し、保存はしない。
      // probe 結果から
      //   reachable=false → ポート/IP が違うか到達できない (画面の値が古い可能性大)
      //   reachable=true  → ポートは生きてるが TLS handshake が拒否されている (ペアリング期限切れ等)
      // を切り分けて案内する。
      const hint = res.probe
        ? res.probe.reachable
          ? "TCP は届いていますが adb 側で拒否されました。一度「(1) ペアリング」をやり直してください。"
          : `TCP 自体届きません (${res.probe.error ?? "unreachable"})。端末のワイヤレスデバッグ画面で表示されている "IPアドレスとポート" が古くなっている可能性が高いので、画面を一度閉じて開き直し最新値を入れてください。`
        : "";
      setErr(`${res.message?.trim() || "接続失敗"}\n${hint}`.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doProbe() {
    if (!manualAddr.trim()) return;
    setBusy(true);
    setLastProbe(null);
    setErr(null);
    try {
      const r = await probeTcp(manualAddr.trim());
      setLastProbe(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doManualPair() {
    if (!manualPairAddr.trim() || manualPairPin.length !== 6) {
      setErr("pair address と 6 桁 PIN を入力してください");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await adbPair(manualPairAddr.trim(), manualPairPin);
      if (!res.ok) {
        setErr(res.message?.trim() || "ペアリング失敗");
        return;
      }
      setManualPaired(true);
      // ペアリング成功直後、PIN フィールドはクリア。
      // 端末は連続して「接続用 ip:port」を表示しているはずなので、
      // ユーザーがそれを下のフィールドに入れて接続する。
      setManualPairPin("");
      setErr(`ペアリング成功: ${res.message?.trim() || ""}\n続けて下の「接続用 ip:port」を入力してください。`);
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
        <div className="notice" style={{ fontWeight: 600 }}>
          WSL2 環境では「手動入力」タブからのペアリング接続のみ可能です（mDNS / QR は使えません）。
        </div>
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
          <div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10, lineHeight: 1.5 }}>
              <strong>WSL2 / Docker bridge 環境向け</strong>: mDNS マルチキャストがコンテナまで届かないため
              「自動探索」「QR ペアリング」が動かない時に使う。
              <br />
              手順: 端末側で「開発者オプション → ワイヤレスデバッグ」を ON →
              <br />
              <code>(1) 初回のみ</code>「ペアリングコードでデバイスをペア設定」を開き、
              表示された ip:port と 6 桁 PIN を下の <strong>ペアリング</strong> 欄に入力 →
              <br />
              <code>(2) 毎回</code> ワイヤレスデバッグ画面の <em>IPアドレスとポート</em>
              (ペアリングとは別) を下の <strong>接続</strong> 欄に入れて「接続して保存」。
            </div>

            <div style={{ padding: 10, background: "var(--panel-2)", borderRadius: 6, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                (1) ペアリング {manualPaired && <span className="badge ok">完了</span>}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 8 }}>
                端末側「ペアリングコードでデバイスをペア設定」画面の値を入れる。一度成功すれば次回以降は不要。
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <input
                  value={manualPairAddr}
                  onChange={(e) => setManualPairAddr(e.target.value)}
                  placeholder="ペアリング用 ip:port (例 192.168.0.42:39521)"
                  style={{ flex: 2, fontFamily: "var(--mono)" }}
                />
                <input
                  value={manualPairPin}
                  onChange={(e) => setManualPairPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  style={{ flex: 1, fontFamily: "var(--mono)", letterSpacing: 3, textAlign: "center" }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && manualPairPin.length === 6) void doManualPair();
                  }}
                />
                <button
                  onClick={() => void doManualPair()}
                  disabled={busy || !manualPairAddr.trim() || manualPairPin.length !== 6}
                >
                  {busy ? "..." : "ペアリング"}
                </button>
              </div>
            </div>

            <div style={{ padding: 10, background: "var(--panel-2)", borderRadius: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>(2) 接続</div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 8 }}>
                端末側「ワイヤレスデバッグ」画面の <em>IPアドレスとポート</em> (上のペアリング用とは別ポート)。
                内部で <code>adb connect</code> → 成功時に device として保存。
              </div>
              <input
                value={manualAddr}
                onChange={(e) => setManualAddr(e.target.value)}
                placeholder="接続用 ip:port (例 192.168.0.42:43219)"
                style={{ width: "100%", fontFamily: "var(--mono)" }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void doManualSave();
                }}
              />
              {lastProbe && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "6px 8px",
                    background: lastProbe.reachable ? "rgba(0,128,0,0.12)" : "rgba(255,80,80,0.12)",
                    border: `1px solid ${lastProbe.reachable ? "rgba(0,180,0,0.4)" : "rgba(255,80,80,0.4)"}`,
                    borderRadius: 4,
                    fontSize: 12,
                    fontFamily: "var(--mono)",
                  }}
                >
                  TCP probe {lastProbe.host}:{lastProbe.port}: {lastProbe.reachable
                    ? `reachable (${lastProbe.latencyMs}ms)`
                    : `unreachable (${lastProbe.error ?? "?"}, ${lastProbe.latencyMs}ms)`}
                </div>
              )}
              <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", gap: 6 }}>
                <button onClick={() => void doProbe()} disabled={busy || !manualAddr.trim()}>
                  TCP 疎通確認
                </button>
                <button
                  className="primary"
                  onClick={() => void doManualSave()}
                  disabled={busy || !manualAddr.trim()}
                >
                  {busy ? "実行中..." : "接続して保存"}
                </button>
              </div>
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
