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
  /**
   * 子プロセスがシグナルで死亡した場合の signal 名 (SIGTERM 等)。code=null かつ
   * signal がセットされていれば、誰かに kill されたことを意味する。原因切り分け用。
   */
  exitSignal?: string | null;
  /** スケジュール経由なら entryId */
  scheduleEntryId?: string;
  /** 実行時に注入されたパラメータ (prompt 内 {{key}} の置換用) */
  parameters?: Record<string, string>;
  /** spawn 時の子 pid。viewer 再起動後の reconcile (生存確認 / 強制終了) で使う。 */
  pid?: number;
}

interface Subscriber {
  onLog: (chunk: string) => void;
  onEnd: (meta: RunMeta) => void;
}

const subscribers = new Map<string, Set<Subscriber>>();
const running = new Map<string, ChildProcessWithoutNullStreams>();
/** cancelRun が呼ばれた run の id。close ハンドラは閉じる時点でこれを見て status を判定する。 */
const cancelling = new Set<string>();
/** SIGTERM 送って 5s 待っても死ななければ SIGKILL に escalate するタイマー。 */
const escalateTimers = new Map<string, NodeJS.Timeout>();

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
  /** prompt 内 {{name}} に流し込む値。Phase 1 では string のみ。 */
  parameters?: Record<string, string>;
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

  const argv = buildArgv(cmd, resolvedDevice, input.parameters);
  const meta: RunMeta = {
    id,
    commandId: cmd.id,
    commandName: cmd.name,
    device: input.device,
    argv,
    status: "running",
    startedAt: new Date().toISOString(),
    scheduleEntryId: input.scheduleEntryId,
    parameters: input.parameters,
  };
  writeFileSync(logPath(id), `$ ${shellQuote(["mobilerun", ...argv])}\n`);
  writeMeta(meta);

  const bin = process.env.MOBILERUN_BIN || "mobilerun";
  // detached: true で子を新規 process group (setsid) の leader にし、
  // cancel 時に process.kill(-pid, ...) で mobilerun とその下の adb 等まで
  // 一括で潰せるようにする。viewer 自身の pgrp とも切り離されるので、
  // tsx watch リロード等で親 pgrp が SIGTERM を受けても子は生き残る (= #3 緩和)。
  const child = spawn(bin, argv, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, FORCE_COLOR: "0" },
    detached: true,
  });
  running.set(id, child);
  if (typeof child.pid === "number") {
    meta.pid = child.pid;
    writeMeta(meta);
  }

  child.stdout.on("data", (b) => emitLog(id, b.toString("utf-8")));
  child.stderr.on("data", (b) => emitLog(id, b.toString("utf-8")));
  child.on("error", (err) => {
    emitLog(id, `\n[spawn error] ${err.message}\n`);
  });
  child.on("close", (code, signal) => {
    running.delete(id);
    const wasCancelled = cancelling.delete(id);
    const t = escalateTimers.get(id);
    if (t) {
      clearTimeout(t);
      escalateTimers.delete(id);
    }
    meta.status = wasCancelled ? "cancelled" : code === 0 ? "success" : "failed";
    meta.exitCode = code;
    meta.exitSignal = signal;
    meta.endedAt = new Date().toISOString();
    writeMeta(meta);
    // signal が入っていれば外部からの kill。原因 (tsx watch リロード / OOM /
    // concurrently -k による兄弟プロセス連鎖死亡 / 親 PG への SIGHUP 等) を切り分ける材料。
    emitLog(id, `\n[exit ${code}${signal ? ` signal=${signal}` : ""}]\n`);
    emitEnd(meta);
  });

  return meta;
}

export function cancelRun(id: string): boolean {
  const child = running.get(id);
  if (!child) return false;
  if (cancelling.has(id)) return true; // 二度押し対策
  cancelling.add(id);
  const m = readMeta(id);
  if (m) {
    m.status = "cancelled";
    writeMeta(m);
  }
  emitLog(id, `\n[cancel requested -> SIGTERM]\n`);
  killTree(child, "SIGTERM");
  // SIGTERM を無視して生き残る場合に備えて 5s で SIGKILL に escalate
  const t = setTimeout(() => {
    if (running.has(id)) {
      emitLog(id, `[cancel still running after 5s -> SIGKILL]\n`);
      killTree(child, "SIGKILL");
    }
    escalateTimers.delete(id);
  }, 5000);
  escalateTimers.set(id, t);
  return true;
}

/**
 * detached: true で spawn したので、child.pid は新規 pgrp の leader pid と一致する。
 * 負数 pid を kill に渡すと pgrp 全体にシグナルが飛び、mobilerun の下の adb 子プロセス
 * までまとめて落とせる。fallback で child.kill も呼ぶ。
 */
function killTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (child.pid != null) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      /* fallthrough to direct kill */
    }
  }
  try {
    child.kill(signal);
  } catch {
    /* ignore */
  }
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

/**
 * viewer 起動時に呼ぶ。前回プロセスが落ちて in-memory state が消えたあと、
 * disk 上に "running" のままで残っている meta を整合させる:
 *   - pid が記録されており、まだ生存している → SIGTERM (孤児を回収) → "cancelled"
 *   - 既に死んでいる / pid なし → そのまま "failed" にフラグ付け
 * これをやらないと、UI の「実行中」表示が永久に残って #8 mutex に引っかかる。
 */
export function reconcileStartup(): { reconciled: string[] } {
  if (!existsSync(RUNS_DIR)) return { reconciled: [] };
  const reconciled: string[] = [];
  for (const id of readdirSync(RUNS_DIR)) {
    const m = readMeta(id);
    if (!m || m.status !== "running") continue;
    let note = "viewer restart detected; no live process";
    if (typeof m.pid === "number") {
      const alive = (() => {
        try {
          process.kill(m.pid!, 0); // signal 0 = 生存確認
          return true;
        } catch {
          return false;
        }
      })();
      if (alive) {
        try {
          process.kill(-m.pid, "SIGTERM");
        } catch {
          try {
            process.kill(m.pid, "SIGTERM");
          } catch {
            /* ignore */
          }
        }
        note = `viewer restart detected; orphan pid=${m.pid} SIGTERM sent`;
        m.status = "cancelled";
      } else {
        m.status = "failed";
      }
    } else {
      m.status = "failed";
    }
    m.endedAt = new Date().toISOString();
    if (m.exitCode === undefined) m.exitCode = null;
    writeMeta(m);
    try {
      appendFileSync(logPath(id), `\n[${note}]\n`);
    } catch {
      /* ignore */
    }
    reconciled.push(id);
  }
  return { reconciled };
}

/**
 * viewer プロセス自身が SIGTERM/SIGHUP/SIGINT を受けた時に、active な子プロセスの log
 * 末尾に「viewer がシグナル X を受けた」と書き込み、続けて kill する。
 * 子は detached なので何もしないと孤児化して走り続け、再起動後の viewer から
 * cancel もできなくなるため、ここで明示的に止める。
 */
export function annotateViewerSignal(signal: NodeJS.Signals): void {
  for (const [id, child] of running.entries()) {
    try {
      emitLog(id, `\n[viewer received ${signal}; killing child]\n`);
      cancelling.add(id);
      killTree(child, "SIGTERM");
    } catch {
      /* ignore */
    }
  }
}

function shellQuote(parts: string[]): string {
  return parts
    .map((p) => (/^[\w./@:=-]+$/.test(p) ? p : `'${p.replace(/'/g, "'\\''")}'`))
    .join(" ");
}

export { CommandFile };
