import { useEffect, useState } from "react";
import type { DeviceState } from "../types";
import { fmtRelative } from "../utils";

interface Props {
  device: DeviceState | null;
  onChangeClick: () => void;
}

export function DeviceBar({ device, onChangeClick }: Props) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!device) {
    return (
      <div className="device-bar">
        <span className="pill missing">device: 未設定</span>
        <button onClick={onChangeClick}>設定</button>
      </div>
    );
  }
  return (
    <div className="device-bar">
      <span className="pill ok">device: {device.device}</span>
      <span style={{ color: "var(--text-dim)" }}>
        失効: {fmtRelative(device.expiresAt)}
      </span>
      <button onClick={onChangeClick}>変更</button>
    </div>
  );
}
