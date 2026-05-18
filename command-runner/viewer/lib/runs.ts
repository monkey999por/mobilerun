/**
 * 実行履歴とライブストリーミング
 *
 * 各 run は state/runs/<id>/ に
 *   - meta.json
 *   - log.txt (stdout+stderr 結合)
 * を持つ。
 * メモリ上の subscriber に対して append 時にイベント emit する。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { getCommand, buildArgv, PROJECT_ROOT, type CommandFile } from "./commands.ts";
import { resolveSerial } from "./adb.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "../state");
const RUNS_DIR = resolve(STATE_DIR, "runs");

export type RunStatus = "running" | "success" | "failed" | "cancelled";

export interface RunMeta {
  id: string;
  commandId: string;
  commandName: string;
  device: string;
  argv: string[];
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  /** スケジュール経由なら entryId */
  scheduleEntryId?: string;
}

interface Subscriber {
  onLog: (chunk: string) => void;
  onEnd: (meta: RunMeta) => void;
}

const subscribers = new Map<string, Set<Subscriber>>();
const running = new Map<string, ChildProcessWithoutNullStreams>();

function ensureDirs(): void {
  if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true });
}

function runDir(id: string): string {
  return resolve(RUNS_DIR, id);
}

function metaPath(id: string): string {
  return resolve(runDir(id), "meta.json");
}

function logPath(id: string): string {
  return resolve(runDir(id), "log.txt");
}

function writeMeta(meta: RunMeta): void {
  writeFileSync(metaPath(meta.id), JSON.stringify(meta, null, 2));
}

function emitLog(id: string, chunk: string): void {
  appendFileSync(logPath(id), chunk);
  const subs = subscribers.get(id);
  if (subs) for (const s of subs) s.onLog(chunk);
}

function emitEnd(meta: RunMeta): void {
  const subs = subscribers.get(meta.id);
  if (subs) for (const s of subs) s.onEnd(meta);
  subscribers.delete(meta.id);
}

export interface StartRunInput {
  commandId: string;
  device: string;
  scheduleEntryId?: string;
}

/** 同時実行中の run があった場合に startRun が投げる error。 */
export class RunInProgressError extends Error {
  readonly code = "run_in_progress" as const;
  readonly activeRunId: string;
  constructor(activeRunId: string) {
    super(`another run is already in progress (id=${activeRunId})`);
    this.name = "RunInProgressError";
    this.activeRunId = activeRunId;
  }
}

export async function startRun(input: StartRunInput): Promise<RunMeta> {
  const cmd = getCommand(input.commandId);
  if (!cmd) throw new Error(`unknown command: ${input.commandId}`);
  if (!input.device) throw new Error("device is required");
  // 1 viewer = 1 mobilerun プロセス。adb と端末は単一なので並列化しても干渉して
  // 双方とも壊れるだけなので、別 run が動いている間は新規実行を拒否する。
  const activeId = listRunningIds()[0];
  if (activeId) throw new RunInProgressError(activeId);
  ensureDirs();

  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID().slice(0, 8)}`;
  const dir = runDir(id);
  mkdirSync(dir, { recursive: true });

  // Android 11+ の TLS 接続では adb の serial が mDNS 名で、ip:port では引けない。
  // device.json は表示用に ip:port を保持しつつ、ここで実 serial に変換して mobilerun に渡す
  let resolvedDevice = input.device;
  try {
    const serial = await resolveSerial(input.device);
    if (serial) resolvedDevice = serial;
  } catch {
    /* fallback to original */
  }

  const argv = buildArgv(cmd, resolvedDevice);
  const meta: RunMeta = {
    id,
    commandId: cmd.id,
    commandName: cmd.name,
    device: input.device,
    argv,
    status: "running",
    startedAt: new Date().toISOString(),
    scheduleEntryId: input.scheduleEntryId,
  };
  writeFileSync(logPath(id), `$ ${shellQuote(["mobilerun", ...argv])}\n`);
  writeMeta(meta);

  const bin = process.env.MOBILERUN_BIN || "mobilerun";
  const child = spawn(bin, argv, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  running.set(id, child);

  child.stdout.on("data", (b) => emitLog(id, b.toString("utf-8")));
  child.stderr.on("data", (b) => emitLog(id, b.toString("utf-8")));
  child.on("error", (err) => {
    emitLog(id, `\n[spawn error] ${err.message}\n`);
  });
  child.on("close", (code) => {
    running.delete(id);
    meta.status = code === 0 ? "success" : meta.status === "cancelled" ? "cancelled" : "failed";
    meta.exitCode = code;
    meta.endedAt = new Date().toISOString();
    writeMeta(meta);
    emitLog(id, `\n[exit ${code}]\n`);
    emitEnd(meta);
  });

  return meta;
}

export function cancelRun(id: string): boolean {
  const child = running.get(id);
  if (!child) return false;
  const m = readMeta(id);
  if (m) {
    m.status = "cancelled";
    writeMeta(m);
  }
  child.kill("SIGTERM");
  return true;
}

export function readMeta(id: string): RunMeta | null {
  if (!existsSync(metaPath(id))) return null;
  try {
    return JSON.parse(readFileSync(metaPath(id), "utf-8")) as RunMeta;
  } catch {
    return null;
  }
}

export function readLog(id: string): string {
  if (!existsSync(logPath(id))) return "";
  return readFileSync(logPath(id), "utf-8");
}

export function listRuns(): RunMeta[] {
  if (!existsSync(RUNS_DIR)) return [];
  const ids = readdirSync(RUNS_DIR);
  return ids
    .map((id) => readMeta(id))
    .filter((m): m is RunMeta => m !== null)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
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
    if (s) {
      s.delete(sub);
      if (s.size === 0) subscribers.delete(id);
    }
  };
}

export function isRunning(id: string): boolean {
  return running.has(id);
}

export function listRunningIds(): string[] {
  return [...running.keys()];
}

function shellQuote(parts: string[]): string {
  return parts
    .map((p) => (/^[\w./@:=-]+$/.test(p) ? p : `'${p.replace(/'/g, "'\\''")}'`))
    .join(" ");
}

export { CommandFile };
