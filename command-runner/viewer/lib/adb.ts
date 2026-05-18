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

export function adbServerSocket(): string | undefined {
  return process.env.ADB_SERVER_SOCKET;
}

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  argv: string[];
}

/**
 * 任意 adb サブコマンドを実行する (デバッグ用エンドポイントから呼ぶ)。
 * argv の先頭は adb のサブコマンド (例: ["devices", "-l"])。
 */
export async function exec(argv: string[], timeoutMs = 15_000): Promise<ExecResult> {
  if (!Array.isArray(argv) || argv.length === 0) {
    return { ok: false, stdout: "", stderr: "argv is empty", exitCode: null, argv };
  }
  try {
    const { stdout, stderr } = await execFileP(ADB, argv, { timeout: timeoutMs });
    return { ok: true, stdout, stderr, exitCode: 0, argv };
  } catch (e) {
    if (e && typeof e === "object") {
      const err = e as { stdout?: string; stderr?: string; code?: number | string; message?: string };
      const code = typeof err.code === "number" ? err.code : null;
      return {
        ok: false,
        stdout: err.stdout || "",
        stderr: err.stderr || err.message || String(e),
        exitCode: code,
        argv,
      };
    }
    return { ok: false, stdout: "", stderr: String(e), exitCode: null, argv };
  }
}

export interface AdbStatus {
  binary: string;
  serverSocket: string | null;
  version: string | null;
  devices: AdbDevice[];
  mdns: MdnsService[];
}

/**
 * 指定 address が今 adb で「device」状態として接続中かを確認する。
 * - 直接 serial 一致 (USB or address 形式)
 * - mDNS の connect サービスとアドレス一致 → そのサービス名で devices をマッチ
 */
export async function isConnected(addr: string): Promise<boolean> {
  if (!addr) return false;
  const devices = await listDevices();
  if (devices.some((d) => d.state === "device" && d.serial === addr)) return true;
  const mdns = await listMdnsServices();
  const match = mdns.find((m) => m.kind === "connect" && m.addr === addr);
  if (!match) return false;
  return devices.some((d) => d.state === "device" && d.serial.startsWith(match.name));
}

/**
 * UI 表示用 address (ip:port など) を、adb が実際に持っている device serial に解決する。
 * Android 11+ の TLS 接続では serial が mDNS 名 (`adb-XXX._adb-tls-connect._tcp`) で
 * ip:port では `adb -s` で見つからないため、mobilerun 起動前にここで変換する。
 *
 * 解決できなければ null を返す (呼び出し側は元の address をそのまま使うのが安全)。
 */
export async function resolveSerial(addr: string): Promise<string | null> {
  if (!addr) return null;
  const devices = await listDevices();
  // 直接 serial 一致 (USB / 旧 wireless / 既に解決済みの mdns 名)
  const direct = devices.find((d) => d.state === "device" && d.serial === addr);
  if (direct) return direct.serial;
  // mDNS の connect サービスから lookup
  const mdns = await listMdnsServices();
  const match = mdns.find((m) => m.kind === "connect" && m.addr === addr);
  if (!match) return null;
  const dev = devices.find((d) => d.state === "device" && d.serial.startsWith(match.name));
  return dev ? dev.serial : null;
}

export async function status(): Promise<AdbStatus> {
  const [versionRes, devices, mdns] = await Promise.all([
    run(["version"]),
    listDevices(),
    listMdnsServices(),
  ]);
  return {
    binary: ADB,
    serverSocket: process.env.ADB_SERVER_SOCKET || null,
    version: versionRes.ok ? versionRes.out : null,
    devices,
    mdns,
  };
}
