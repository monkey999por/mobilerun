import { useEffect, useState } from "react";
import type { DeviceState } from "../types";
import { fmtRelative } from "../utils";

interface Props {
  device: DeviceState | null;
  connected: boolean;
  onChangeClick: () => void;
}

export function DeviceBar({ device, connected, onChangeClick }: Props) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!device) {
    return (
      <div className="device-bar">
        <span className="device-dot off" />
        <span className="pill missing">device: 未設定</span>
        <button onClick={onChangeClick}>設定</button>
      </div>
    );
  }
  return (
    <div className="device-bar">
      <span
        className={`device-dot ${connected ? "on" : "missing"}`}
        title={connected ? "接続中" : "未接続 (adb で見つからない)"}
      />
      <span className={`pill ${connected ? "ok" : "stale"}`}>
        device: {device.device}
      </span>
      <span style={{ color: "var(--text-dim)" }}>
        {connected ? "接続中" : "未接続"} · 失効 {fmtRelative(device.expiresAt)}
      </span>
      <button onClick={onChangeClick}>変更</button>
    </div>
  );
}
