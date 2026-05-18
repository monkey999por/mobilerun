/**
 * Android 11+ の Wireless Debugging QR ペアリングをサーバ側で完結させる。
 *
 * フロー:
 *   1. ランダム service-name + password を生成
 *   2. QR payload `WIFI:T:ADB;S:<name>;P:<password>;;` を SVG レンダリング
 *   3. ユーザーが端末で QR スキャン
 *   4. 端末が `_adb-tls-pairing._tcp` で同じ service-name を mDNS 広告
 *   5. サーバはポーリング (`adb mdns services`) で検出 → `adb pair` 実行
 *   6. 続いて `_adb-tls-connect._tcp` を見つけ `adb connect` → device store 保存
 */

import QRCode from "qrcode";
import { randomBytes } from "node:crypto";
import { listMdnsServices, pair, connect } from "./adb.ts";
import { setDevice, DEFAULT_TTL_SECONDS } from "./device.ts";

export type QrPairState =
  | "waiting_scan"
  | "pairing"
  | "pair_failed"
  | "connecting"
  | "connect_failed"
  | "success"
  | "expired"
  | "cancelled";

export interface QrPairSession {
  id: string;
  name: string;
  password: string;
  qrPayload: string;
  qrSvg: string;
  state: QrPairState;
  message?: string;
  device?: string;
  createdAt: string;
  expiresAt: string;
}

interface InternalSession extends QrPairSession {
  ttlSecondsForDevice: number;
}

interface Subscriber {
  onUpdate: (session: QrPairSession) => void;
}

const SESSION_TTL_MS = 120_000; // 端末スキャン待ちのタイムアウト
const POLL_INTERVAL_MS = 1500;
const CONNECT_POLL_MS = 500;
const CONNECT_POLL_RETRIES = 20;
const GC_AFTER_MS = 5 * 60_000;

const sessions = new Map<string, InternalSession>();
const subscribers = new Map<string, Set<Subscriber>>();
const timers = new Map<string, NodeJS.Timeout>();

const TERMINAL: QrPairState[] = ["success", "expired", "pair_failed", "connect_failed", "cancelled"];
export function isTerminal(state: QrPairState): boolean {
  return TERMINAL.includes(state);
}

function genName(): string {
  return `studio-${randomBytes(4).toString("hex")}`;
}

function genPassword(): string {
  return randomBytes(8).toString("hex");
}

function emit(s: InternalSession): void {
  const subs = subscribers.get(s.id);
  if (subs) for (const sub of subs) sub.onUpdate(toPublic(s));
}

function transition(
  s: InternalSession,
  state: QrPairState,
  patch: { message?: string; device?: string } = {}
): void {
  s.state = state;
  if (patch.message !== undefined) s.message = patch.message;
  if (patch.device !== undefined) s.device = patch.device;
  emit(s);
}

function toPublic(s: InternalSession): QrPairSession {
  const { ttlSecondsForDevice: _ttl, ...rest } = s;
  return rest;
}

function stopTimer(id: string): void {
  const t = timers.get(id);
  if (t) {
    clearInterval(t);
    timers.delete(id);
  }
}

export async function startSession(
  ttlSecondsForDevice: number = DEFAULT_TTL_SECONDS
): Promise<QrPairSession> {
  const id = randomBytes(8).toString("hex");
  const name = genName();
  const password = genPassword();
  const payload = `WIFI:T:ADB;S:${name};P:${password};;`;
  const qrSvg = await QRCode.toString(payload, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
  const now = Date.now();
  const session: InternalSession = {
    id,
    name,
    password,
    qrPayload: payload,
    qrSvg,
    state: "waiting_scan",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    ttlSecondsForDevice,
  };
  sessions.set(id, session);

  // バックグラウンドポーリング開始
  const interval = setInterval(() => {
    void poll(session).catch((err) => {
      transition(session, "pair_failed", {
        message: `internal error: ${err instanceof Error ? err.message : String(err)}`,
      });
      stopTimer(session.id);
    });
  }, POLL_INTERVAL_MS);
  timers.set(id, interval);

  return toPublic(session);
}

async function poll(s: InternalSession): Promise<void> {
  if (s.state !== "waiting_scan") return; // 多重実行ガード
  if (Date.now() >= new Date(s.expiresAt).getTime()) {
    stopTimer(s.id);
    transition(s, "expired", { message: "120 秒以内に端末でスキャンされませんでした" });
    return;
  }
  const services = await listMdnsServices();
  const found = services.find((m) => m.kind === "pairing" && m.name === s.name);
  if (!found) return;

  stopTimer(s.id);
  transition(s, "pairing", { message: `端末を検出 (${found.addr})、ペアリング中...` });
  const pairRes = await pair(found.addr, s.password);
  if (!pairRes.ok) {
    transition(s, "pair_failed", { message: pairRes.out.trim() || "adb pair に失敗" });
    return;
  }

  transition(s, "connecting", { message: "ペア成功、connection service を探索中..." });
  const host = found.addr.split(":")[0];
  let connectAddr: string | null = null;
  for (let i = 0; i < CONNECT_POLL_RETRIES; i++) {
    await new Promise((r) => setTimeout(r, CONNECT_POLL_MS));
    const m2 = await listMdnsServices();
    const c = m2.find((m) => m.kind === "connect" && m.addr.startsWith(host + ":"));
    if (c) {
      connectAddr = c.addr;
      break;
    }
  }
  if (!connectAddr) {
    transition(s, "connect_failed", { message: "connection service が時間内に見つかりませんでした" });
    return;
  }
  const conn = await connect(connectAddr);
  if (!conn.ok) {
    transition(s, "connect_failed", { message: conn.out.trim() || "adb connect に失敗" });
    return;
  }
  setDevice(connectAddr, s.ttlSecondsForDevice);
  transition(s, "success", { message: "ペアリング+接続+保存 完了", device: connectAddr });
}

export function getSession(id: string): QrPairSession | null {
  const s = sessions.get(id);
  return s ? toPublic(s) : null;
}

export function cancelSession(id: string): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  stopTimer(id);
  if (!isTerminal(s.state)) {
    transition(s, "cancelled", { message: "ユーザーがキャンセルしました" });
  }
  return true;
}

export function subscribe(id: string, sub: Subscriber): () => void {
  let set = subscribers.get(id);
  if (!set) {
    set = new Set();
    subscribers.set(id, set);
  }
  set.add(sub);
  return () => {
    const s = subscribers.get(id);
    if (!s) return;
    s.delete(sub);
    if (s.size === 0) subscribers.delete(id);
  };
}

// 古いセッションを定期的に掃除
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - new Date(s.createdAt).getTime() > GC_AFTER_MS) {
      sessions.delete(id);
      stopTimer(id);
      subscribers.delete(id);
    }
  }
}, 60_000).unref?.();
