/**
 * croner ベースのスケジューラ
 *
 * エントリは cron 式 (kind: "cron") または 1回限りの ISO datetime (kind: "once") を持つ。
 * device は実行時に最新の保存済みデバイスを使う。期限切れ/未設定なら failed として記録。
 */

import { Cron } from "croner";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { getCommand } from "./lib/commands.ts";
import { getDevice } from "./lib/device.ts";
import { startRun } from "./lib/runs.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "state");
const STATE_FILE = resolve(STATE_DIR, "schedule.json");

export type ScheduleKind = "cron" | "once";

export interface ScheduleEntry {
  id: string;
  name: string;
  commandId: string;
  kind: ScheduleKind;
  /** kind=cron */
  cron?: string;
  /** kind=once (ISO datetime) */
  runAt?: string;
  enabled: boolean;
  /** 任意: 実行時にデバイスを上書き */
  deviceOverride?: string;
  createdAt: string;
  lastFiredAt?: string;
  lastError?: string;
  /** kind=once で実行完了済み */
  consumed?: boolean;
}

interface State {
  entries: ScheduleEntry[];
}

const jobs = new Map<string, Cron>();
let state: State = { entries: [] };

function ensureDir(): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

function persist(): void {
  ensureDir();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function load(): void {
  if (!existsSync(STATE_FILE)) return;
  try {
    state = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as State;
  } catch {
    state = { entries: [] };
  }
}

function fire(entry: ScheduleEntry): void {
  const cmd = getCommand(entry.commandId);
  if (!cmd) {
    entry.lastError = `unknown command: ${entry.commandId}`;
    persist();
    return;
  }
  const device = entry.deviceOverride || getDevice()?.device;
  if (!device) {
    entry.lastError = "device not set or expired";
    entry.lastFiredAt = new Date().toISOString();
    persist();
    return;
  }
  try {
    startRun({ commandId: entry.commandId, device, scheduleEntryId: entry.id });
    entry.lastFiredAt = new Date().toISOString();
    entry.lastError = undefined;
    if (entry.kind === "once") {
      entry.consumed = true;
      entry.enabled = false;
      stopJob(entry.id);
    }
    persist();
  } catch (err) {
    entry.lastError = err instanceof Error ? err.message : String(err);
    entry.lastFiredAt = new Date().toISOString();
    persist();
  }
}

function startJob(entry: ScheduleEntry): void {
  stopJob(entry.id);
  if (!entry.enabled || entry.consumed) return;
  try {
    if (entry.kind === "cron") {
      if (!entry.cron) return;
      const job = new Cron(entry.cron, () => fire(entry));
      jobs.set(entry.id, job);
    } else {
      if (!entry.runAt) return;
      const at = new Date(entry.runAt);
      if (Number.isNaN(at.getTime())) return;
      if (at.getTime() <= Date.now()) {
        // 過去日時 → consumed 扱い
        entry.consumed = true;
        entry.enabled = false;
        persist();
        return;
      }
      const job = new Cron(at, () => fire(entry));
      jobs.set(entry.id, job);
    }
  } catch (err) {
    entry.lastError = err instanceof Error ? err.message : String(err);
    persist();
  }
}

function stopJob(id: string): void {
  const j = jobs.get(id);
  if (j) {
    j.stop();
    jobs.delete(id);
  }
}

export function init(): void {
  load();
  for (const e of state.entries) startJob(e);
}

export function listEntries(): ScheduleEntry[] {
  return state.entries.map((e) => ({
    ...e,
    // 次回実行時刻を計算 (job がある場合)
    ...((): { nextRunAt?: string } => {
      const j = jobs.get(e.id);
      if (!j) return {};
      const next = j.nextRun();
      return next ? { nextRunAt: next.toISOString() } : {};
    })(),
  }));
}

export function addEntry(input: {
  name: string;
  commandId: string;
  kind: ScheduleKind;
  cron?: string;
  runAt?: string;
  deviceOverride?: string;
  enabled?: boolean;
}): ScheduleEntry {
  if (input.kind === "cron" && !input.cron) throw new Error("cron required");
  if (input.kind === "once" && !input.runAt) throw new Error("runAt required");
  if (!getCommand(input.commandId)) throw new Error(`unknown command: ${input.commandId}`);
  // バリデーション: cron式が有効か
  if (input.kind === "cron" && input.cron) {
    try {
      const probe = new Cron(input.cron, { paused: true }, () => {});
      probe.stop();
    } catch (err) {
      throw new Error(`invalid cron: ${err instanceof Error ? err.message : err}`);
    }
  }
  const entry: ScheduleEntry = {
    id: randomUUID(),
    name: input.name,
    commandId: input.commandId,
    kind: input.kind,
    cron: input.cron,
    runAt: input.runAt,
    deviceOverride: input.deviceOverride,
    enabled: input.enabled !== false,
    createdAt: new Date().toISOString(),
  };
  state.entries.push(entry);
  persist();
  startJob(entry);
  return entry;
}

export function updateEntry(id: string, patch: Partial<ScheduleEntry>): ScheduleEntry | null {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return null;
  Object.assign(e, patch);
  persist();
  startJob(e);
  return e;
}

export function deleteEntry(id: string): boolean {
  const idx = state.entries.findIndex((x) => x.id === id);
  if (idx === -1) return false;
  stopJob(id);
  state.entries.splice(idx, 1);
  persist();
  return true;
}

export function runEntryNow(id: string): ScheduleEntry | null {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return null;
  fire(e);
  return e;
}
