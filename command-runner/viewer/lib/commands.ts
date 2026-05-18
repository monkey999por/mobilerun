/**
 * commands/<group>/<id>.yaml の読み書きと argv 組み立て
 *
 * グループはディレクトリ名から導出される。
 *   commands/X/x-like-5.yaml  → group: "X", id: "x-like-5"
 *   commands/<id>.yaml         → group: "(未分類)", id: "<id>"
 *
 * id は全体で一意。ファイル名 = `<id>.yaml`。
 */

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  statSync,
  mkdirSync,
  rmdirSync,
  renameSync,
} from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../..");
const COMMAND_RUNNER_ROOT = resolve(__dirname, "../..");
const COMMANDS_DIR = resolve(COMMAND_RUNNER_ROOT, "commands");

export const UNGROUPED = "(未分類)";

export type CommandType = "run" | "macro";
export type CommandStatus = "confirmed" | "unconfirmed";

export interface CommandFile {
  id: string;
  group: string;
  name: string;
  type: CommandType;
  status: CommandStatus;
  tags: string[];
  notes?: string;
  prompt?: string;
  /** run 用 */
  steps?: number;
  vision?: boolean;
  reasoning?: boolean;
  /** macro 用 */
  macro_file?: string;
  delay?: number;
  max_steps?: number;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
// グループ (ディレクトリ名): スラッシュ・バックスラッシュ・NUL・空白を禁止。`_` は OK
const GROUP_PATTERN = /^[^\s/\\\x00]+$/;

function isValidId(id: unknown): id is string {
  return typeof id === "string" && ID_PATTERN.test(id);
}

function isValidGroup(group: unknown): group is string {
  return typeof group === "string" && GROUP_PATTERN.test(group);
}

function groupDir(group: string): string {
  if (group === UNGROUPED) return COMMANDS_DIR;
  if (!isValidGroup(group)) throw new Error(`invalid group: ${group}`);
  return resolve(COMMANDS_DIR, group);
}

function commandPath(group: string, id: string): string {
  if (!isValidId(id)) throw new Error(`invalid id: ${id}`);
  return resolve(groupDir(group), `${id}.yaml`);
}

interface FoundFile {
  path: string;
  group: string;
  id: string;
}

function walk(): FoundFile[] {
  if (!existsSync(COMMANDS_DIR)) return [];
  const out: FoundFile[] = [];
  for (const entry of readdirSync(COMMANDS_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".yaml")) {
      out.push({
        path: resolve(COMMANDS_DIR, entry.name),
        group: UNGROUPED,
        id: entry.name.replace(/\.yaml$/, ""),
      });
    } else if (entry.isDirectory()) {
      const sub = resolve(COMMANDS_DIR, entry.name);
      for (const f of readdirSync(sub, { withFileTypes: true })) {
        if (f.isFile() && f.name.endsWith(".yaml")) {
          out.push({
            path: resolve(sub, f.name),
            group: entry.name,
            id: f.name.replace(/\.yaml$/, ""),
          });
        }
      }
    }
  }
  return out;
}

function normalize(data: Record<string, unknown>, group: string): CommandFile {
  const id = String(data.id || "");
  if (!isValidId(id)) throw new Error(`invalid id: ${id}`);
  const type: CommandType = data.type === "macro" ? "macro" : "run";
  return {
    id,
    group,
    name: String(data.name || id),
    type,
    status: data.status === "confirmed" ? "confirmed" : "unconfirmed",
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    notes: data.notes != null ? String(data.notes) : undefined,
    prompt: data.prompt != null ? String(data.prompt) : undefined,
    steps: typeof data.steps === "number" ? data.steps : undefined,
    vision: typeof data.vision === "boolean" ? data.vision : undefined,
    reasoning: typeof data.reasoning === "boolean" ? data.reasoning : undefined,
    macro_file: data.macro_file != null ? String(data.macro_file) : undefined,
    delay: typeof data.delay === "number" ? data.delay : undefined,
    max_steps: typeof data.max_steps === "number" ? data.max_steps : undefined,
  };
}

function readFromPath(p: string, group: string): CommandFile {
  const raw = readFileSync(p, "utf-8");
  const data = parseYaml(raw) as Record<string, unknown>;
  if (!data || typeof data !== "object") throw new Error(`empty yaml: ${p}`);
  return normalize(data, group);
}

export function listCommands(): CommandFile[] {
  return walk()
    .map((f) => {
      try {
        return readFromPath(f.path, f.group);
      } catch {
        return null;
      }
    })
    .filter((c): c is CommandFile => c !== null)
    .sort((a, b) => {
      if (a.group !== b.group) return a.group.localeCompare(b.group);
      return a.id.localeCompare(b.id);
    });
}

/** id は全体で一意 (ファイル名は <id>.yaml)。同名なら最初に見つかったものを返す */
function findById(id: string): FoundFile | null {
  return walk().find((f) => f.id === id) ?? null;
}

export function getCommand(id: string): CommandFile | null {
  const found = findById(id);
  if (!found) return null;
  try {
    return readFromPath(found.path, found.group);
  } catch {
    return null;
  }
}

export function getCommandRaw(id: string): string | null {
  const found = findById(id);
  if (!found) return null;
  try {
    return readFileSync(found.path, "utf-8");
  } catch {
    return null;
  }
}

export function commandExists(id: string): boolean {
  if (!isValidId(id)) return false;
  return findById(id) !== null;
}

export function listGroups(): string[] {
  const set = new Set<string>();
  for (const f of walk()) set.add(f.group);
  return Array.from(set).sort((a, b) => {
    if (a === UNGROUPED) return 1;
    if (b === UNGROUPED) return -1;
    return a.localeCompare(b);
  });
}

function ensureGroupDir(group: string): void {
  const dir = groupDir(group);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function dataForSave(cmd: CommandFile): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  data.id = cmd.id;
  data.name = cmd.name;
  data.type = cmd.type;
  data.status = cmd.status;
  if (cmd.tags.length) data.tags = cmd.tags;
  if (cmd.notes) data.notes = cmd.notes;
  if (cmd.type === "run") {
    if (cmd.steps != null) data.steps = cmd.steps;
    if (cmd.vision != null) data.vision = cmd.vision;
    if (cmd.reasoning != null) data.reasoning = cmd.reasoning;
  } else {
    if (cmd.macro_file) data.macro_file = cmd.macro_file;
    if (cmd.delay != null) data.delay = cmd.delay;
    if (cmd.max_steps != null) data.max_steps = cmd.max_steps;
  }
  if (cmd.prompt) data.prompt = cmd.prompt;
  return data;
}

function yamlString(data: Record<string, unknown>): string {
  return stringifyYaml(data, {
    blockQuote: "literal",
    lineWidth: 0,
    minContentWidth: 0,
  });
}

/**
 * 構造化された CommandFile を YAML として保存する。
 * 既存があればグループ移動も対応。
 */
export function saveCommand(input: CommandFile): CommandFile {
  if (!isValidId(input.id)) throw new Error(`invalid id: ${input.id}`);
  const group = input.group || UNGROUPED;
  if (group !== UNGROUPED && !isValidGroup(group)) throw new Error(`invalid group: ${group}`);
  ensureGroupDir(group);
  const cmd = normalize(dataForSave({ ...input, group }), group);

  const existing = findById(cmd.id);
  if (existing && existing.group !== group) {
    // 同 id の既存ファイルを別ディレクトリから移動
    unlinkSync(existing.path);
    cleanupEmptyGroupDir(existing.group);
  }

  const target = commandPath(group, cmd.id);
  writeFileSync(target, yamlString(dataForSave(cmd)));
  return cmd;
}

/**
 * 生 YAML 文字列で保存 (group は呼び出し側が確定させて渡す)。
 */
export function saveCommandRaw(id: string, raw: string, group?: string): CommandFile {
  if (!isValidId(id)) throw new Error(`invalid id: ${id}`);
  const data = parseYaml(raw) as Record<string, unknown>;
  if (!data || typeof data !== "object") throw new Error("invalid yaml");
  if (data.id && data.id !== id) {
    throw new Error(`id mismatch: yaml.id=${String(data.id)} != ${id}`);
  }
  data.id = id;

  const existing = findById(id);
  const targetGroup = group ?? existing?.group ?? UNGROUPED;
  if (targetGroup !== UNGROUPED && !isValidGroup(targetGroup)) {
    throw new Error(`invalid group: ${targetGroup}`);
  }
  ensureGroupDir(targetGroup);
  const cmd = normalize(data, targetGroup);

  if (existing && existing.group !== targetGroup) {
    unlinkSync(existing.path);
    cleanupEmptyGroupDir(existing.group);
  }
  writeFileSync(commandPath(targetGroup, id), raw);
  return cmd;
}

export function deleteCommand(id: string): boolean {
  const found = findById(id);
  if (!found) return false;
  unlinkSync(found.path);
  cleanupEmptyGroupDir(found.group);
  return true;
}

function cleanupEmptyGroupDir(group: string): void {
  if (group === UNGROUPED) return;
  const dir = groupDir(group);
  try {
    if (existsSync(dir) && readdirSync(dir).length === 0) {
      rmdirSync(dir);
    }
  } catch {
    /* ignore */
  }
}

/**
 * mobilerun に渡す argv を返す。最初の要素はバイナリ名 (mobilerun)。
 */
export function buildArgv(cmd: CommandFile, device: string): string[] {
  if (!device) throw new Error("device is required");
  if (cmd.type === "run") {
    if (!cmd.prompt) throw new Error(`command ${cmd.id}: prompt required for run type`);
    const args = ["run", "--device", device];
    if (cmd.vision) args.push("--vision");
    if (cmd.reasoning) args.push("--reasoning");
    if (typeof cmd.steps === "number") args.push("--steps", String(cmd.steps));
    args.push(cmd.prompt);
    return args;
  }
  if (!cmd.macro_file) throw new Error(`command ${cmd.id}: macro_file required for macro type`);
  const macroPath = resolve(COMMAND_RUNNER_ROOT, cmd.macro_file);
  const args = ["macro", "replay", macroPath, "-d", device];
  if (typeof cmd.delay === "number") args.push("--delay", String(cmd.delay));
  if (typeof cmd.max_steps === "number") args.push("--max-steps", String(cmd.max_steps));
  return args;
}

export { PROJECT_ROOT, COMMAND_RUNNER_ROOT, COMMANDS_DIR };
