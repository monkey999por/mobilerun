/**
 * Claude Code skill 実行の管理。
 *
 * runs.ts (mobilerun コマンド実行) の薄いミラー。違いは:
 *   - 子プロセスが `claude --print --dangerously-skip-permissions`
 *   - prompt は stdin に "/<skill-id>\n<extra-instruction>" を流し込む
 *   - cwd は repo root (env CLAUDE_CWD で上書き可能)。これにより claude が
 *     <repo>/.claude/skills/<id>/SKILL.md を skill として認識する
 *   - mobilerun の adb mutex とは独立 (skill 内から POST /api/runs で
 *     atomic を呼ぶケースは正常系なので、ここで mobilerun を block しない)
 *
 * state は state/skill-runs/<id>/{meta.json, log.txt} に分離して保存する。
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
  readdirSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { skillExists, PROJECT_ROOT } from "./skills.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "../state");
const SKILL_RUNS_DIR = resolve(STATE_DIR, "skill-runs");

export type SkillRunStatus = "running" | "success" | "failed" | "cancelled";

export interface SkillRunMeta {
  id: string;
  skillId: string;
  status: SkillRunStatus;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  exitSignal?: string | null;
  /** stdin で渡した完全なプロンプト (debug 用) */
  prompt: string;
  /** ユーザが追加で渡した instruction (skill 名以外の追加文) */
  extraInstruction?: string;
  /** spawn 時の子 pid。viewer 再起動後の reconcile 用。 */
  pid?: number;
}

interface Subscriber {
  onLog: (chunk: string) => void;
  onEnd: (meta: SkillRunMeta) => void;
}

const subscribers = new Map<string, Set<Subscriber>>();
const running = new Map<string, ChildProcessWithoutNullStreams>();
const cancelling = new Set<string>();
const escalateTimers = new Map<string, NodeJS.Timeout>();

function ensureDirs(): void {
  if (!existsSync(SKILL_RUNS_DIR)) mkdirSync(SKILL_RUNS_DIR, { recursive: true });
}

function runDir(id: string): string {
  return resolve(SKILL_RUNS_DIR, id);
}

function metaPath(id: string): string {
  return resolve(runDir(id), "meta.json");
}

function logPath(id: string): string {
  return resolve(runDir(id), "log.txt");
}

function writeMeta(meta: SkillRunMeta): void {
  writeFileSync(metaPath(meta.id), JSON.stringify(meta, null, 2));
}

function emitLog(id: string, chunk: string): void {
  appendFileSync(logPath(id), chunk);
  const subs = subscribers.get(id);
  if (subs) for (const s of subs) s.onLog(chunk);
}

function emitEnd(meta: SkillRunMeta): void {
  const subs = subscribers.get(meta.id);
  if (subs) for (const s of subs) s.onEnd(meta);
  subscribers.delete(meta.id);
}

export interface StartSkillRunInput {
  skillId: string;
  /** skill 名 (/x-foo) の後に追加するユーザの自由指示 */
  extraInstruction?: string;
}

export class SkillRunInProgressError extends Error {
  readonly code = "skill_run_in_progress" as const;
  readonly activeRunId: string;
  constructor(activeRunId: string) {
    super(`another skill run is already in progress (id=${activeRunId})`);
    this.name = "SkillRunInProgressError";
    this.activeRunId = activeRunId;
  }
}

export function startSkillRun(input: StartSkillRunInput): SkillRunMeta {
  if (!skillExists(input.skillId)) {
    throw new Error(`unknown skill: ${input.skillId}`);
  }
  const activeId = listRunningSkillIds()[0];
  if (activeId) throw new SkillRunInProgressError(activeId);
  ensureDirs();

  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID().slice(0, 8)}`;
  const dir = runDir(id);
  mkdirSync(dir, { recursive: true });

  // skill 起動用 prompt。Claude Code は CLI 引数ではなく stdin / -p 経由でも
  // /<skill-name> 構文を skill 呼び出しとして解釈する。
  const extra = (input.extraInstruction ?? "").trim();
  const prompt = extra ? `/${input.skillId}\n\n${extra}\n` : `/${input.skillId}\n`;

  const meta: SkillRunMeta = {
    id,
    skillId: input.skillId,
    status: "running",
    startedAt: new Date().toISOString(),
    prompt,
    extraInstruction: extra || undefined,
  };
  const bin = process.env.CLAUDE_BIN || "claude";
  const cwd = process.env.CLAUDE_CWD || PROJECT_ROOT;
  // --print: 非対話モード (stdin から prompt を読み、stdout に応答を吐いて終了)
  // --dangerously-skip-permissions: 各 tool 呼び出しで都度確認しない (ローカル運用前提)
  // --output-format stream-json + --verbose: tool use / 応答を逐次 JSON で吐く。
  //   viewer 側は受け取った行をそのまま log.txt に流す (UI 側で view 整形)。
  const args = [
    "--print",
    "--dangerously-skip-permissions",
    "--output-format",
    "stream-json",
    "--verbose",
  ];

  writeFileSync(logPath(id), `$ ${bin} ${args.join(" ")}  (cwd=${cwd})\n# stdin: ${JSON.stringify(prompt)}\n`);
  writeMeta(meta);

  // detached: true で新規 process group の leader にし、cancel 時に
  // process.kill(-pid, ...) で claude 配下のサブプロセスごと潰せるようにする
  const child = spawn(bin, args, {
    cwd,
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
    emitLog(id, `\n[exit ${code}${signal ? ` signal=${signal}` : ""}]\n`);
    emitEnd(meta);
  });

  try {
    child.stdin.write(prompt);
    child.stdin.end();
  } catch (err) {
    emitLog(id, `\n[stdin write error] ${(err as Error).message}\n`);
  }

  return meta;
}

export function cancelSkillRun(id: string): boolean {
  const child = running.get(id);
  if (!child) return false;
  if (cancelling.has(id)) return true;
  cancelling.add(id);
  const m = readSkillMeta(id);
  if (m) {
    m.status = "cancelled";
    writeMeta(m);
  }
  emitLog(id, `\n[cancel requested -> SIGTERM]\n`);
  killTree(child, "SIGTERM");
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

function killTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (child.pid != null) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      /* fallthrough */
    }
  }
  try {
    child.kill(signal);
  } catch {
    /* ignore */
  }
}

export function readSkillMeta(id: string): SkillRunMeta | null {
  if (!existsSync(metaPath(id))) return null;
  try {
    return JSON.parse(readFileSync(metaPath(id), "utf-8")) as SkillRunMeta;
  } catch {
    return null;
  }
}

export function readSkillLog(id: string): string {
  if (!existsSync(logPath(id))) return "";
  return readFileSync(logPath(id), "utf-8");
}

export function listSkillRuns(): SkillRunMeta[] {
  if (!existsSync(SKILL_RUNS_DIR)) return [];
  const ids = readdirSync(SKILL_RUNS_DIR);
  return ids
    .map((id) => readSkillMeta(id))
    .filter((m): m is SkillRunMeta => m !== null)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

export function subscribeSkillRun(id: string, sub: Subscriber): () => void {
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

export function isSkillRunning(id: string): boolean {
  return running.has(id);
}

export function listRunningSkillIds(): string[] {
  return [...running.keys()];
}

/**
 * viewer 起動時の reconcile。runs.ts の reconcileStartup と同じ思想で、
 * 前回プロセスが落ちて in-memory state が消えたあと disk 上に "running"
 * のまま残った skill run の整合性を取る。
 */
export function reconcileSkillStartup(): { reconciled: string[] } {
  if (!existsSync(SKILL_RUNS_DIR)) return { reconciled: [] };
  const reconciled: string[] = [];
  for (const id of readdirSync(SKILL_RUNS_DIR)) {
    const m = readSkillMeta(id);
    if (!m || m.status !== "running") continue;
    let note = "viewer restart detected; no live process";
    if (typeof m.pid === "number") {
      const alive = (() => {
        try {
          process.kill(m.pid!, 0);
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

export function annotateViewerSignalSkills(signal: NodeJS.Signals): void {
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
