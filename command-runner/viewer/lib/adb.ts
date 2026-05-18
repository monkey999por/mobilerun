/**
 * adb ラッパー
 *
 * mDNS 探索 + ペアリング + 接続を CLI 経由で。
 * Android 11+ の Wireless Debugging を前提とする。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const ADB = process.env.ADB_BIN || "adb";

export type MdnsKind = "pairing" | "connect" | "other";

export interface MdnsService {
  name: string;
  serviceType: string;
  addr: string; // "ip:port"
  kind: MdnsKind;
}

export interface AdbDevice {
  serial: string;
  state: string;
}

export interface AdbCmdResult {
  ok: boolean;
  out: string;
}

async function run(args: string[]): Promise<AdbCmdResult> {
  try {
    const { stdout, stderr } = await execFileP(ADB, args, { timeout: 30_000 });
    const out = (stdout + stderr).trim();
    return { ok: true, out };
  } catch (e) {
    if (e && typeof e === "object" && "stdout" in e) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      return { ok: false, out: (err.stdout || "") + (err.stderr || "") || err.message || String(e) };
    }
    return { ok: false, out: e instanceof Error ? e.message : String(e) };
  }
}

export async function listMdnsServices(): Promise<MdnsService[]> {
  const res = await run(["mdns", "services"]);
  if (!res.ok) return [];
  const services: MdnsService[] = [];
  for (const raw of res.out.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("List of") || line.startsWith("mdns daemon")) continue;
    // 形式: <name>\t<serviceType>\t<ip:port>
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    const name = parts[0];
    const serviceType = parts[1];
    const addr = parts.slice(2).join(" "); // 念のため
    const kind: MdnsKind = serviceType.includes("_adb-tls-pairing")
      ? "pairing"
      : serviceType.includes("_adb-tls-connect")
      ? "connect"
      : "other";
    services.push({ name, serviceType, addr, kind });
  }
  return services;
}

export async function listDevices(): Promise<AdbDevice[]> {
  const res = await run(["devices"]);
  if (!res.ok) return [];
  const out: AdbDevice[] = [];
  const lines = res.out.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("List of devices")) continue;
    // adb サーバー起動時の情報メッセージ ("* daemon not running; starting now" 等) は無視
    if (line.startsWith("*")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    out.push({ serial: parts[0], state: parts[1] });
  }
  return out;
}

export async function pair(addr: string, code: string): Promise<AdbCmdResult> {
  const res = await run(["pair", addr, code]);
  // adb pair の成功判定: "Successfully paired" を含む
  const ok = res.ok && /successfully paired/i.test(res.out);
  return { ok, out: res.out };
}

export async function connect(target: string): Promise<AdbCmdResult> {
  const res = await run(["connect", target]);
  const out = res.out;
  // 成功は "connected to" または "already connected to" の行頭出現で判定 (正の検出)
  const ok = res.ok && /^(connected to|already connected to)/im.test(out);
  return { ok, out };
}

export async function disconnect(target: string): Promise<AdbCmdResult> {
  return await run(["disconnect", target]);
}

export function adbBin(): string {
  return ADB;
}
