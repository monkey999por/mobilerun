/**
 * Claude Code skill 一覧の読み込み。
 *
 * `<repo>/.claude/skills/<id>/SKILL.md` の frontmatter を拾って表示用情報を返す。
 * skill 自体は Claude Code CLI が直接読みに行くので、ここでは「viewer の UI から
 * 起動可能な skill 候補をユーザに見せる」ためだけのリスト機能。
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * PROJECT_ROOT は実行環境で意味が変わる:
 *   - host で直接実行: <repo>/command-runner/viewer/lib/../../.. = <repo>
 *   - docker container: /app/viewer/lib/../../.. = /  (compose の bind mount は
 *     /app と /opt/mobilerun-src に分離されているので、相対 path では repo root に届かない)
 *
 * 解決順:
 *   1. env MOBILERUN_REPO_ROOT / CLAUDE_CWD で明示指定があればそれ
 *   2. compose の慣例 /opt/mobilerun-src/.claude/skills が実在すればそれ
 *   3. 相対計算のフォールバック (host 実行向け)
 */
function resolveProjectRoot(): string {
  if (process.env.MOBILERUN_REPO_ROOT) return process.env.MOBILERUN_REPO_ROOT;
  if (process.env.CLAUDE_CWD) return process.env.CLAUDE_CWD;
  if (existsSync("/opt/mobilerun-src/.claude/skills")) return "/opt/mobilerun-src";
  return resolve(__dirname, "../../..");
}

const PROJECT_ROOT = resolveProjectRoot();
const SKILLS_DIR = resolve(PROJECT_ROOT, ".claude", "skills");

export interface SkillInfo {
  id: string;
  name: string;
  description?: string;
  whenToUse?: string;
}

/**
 * frontmatter (---...--- ブロック) から `key: value` 行だけ拾う簡易パーサ。
 * 値が複数行 (>- や > スタイル) の場合は最初の行のみ採用。skill カードに出す説明文程度の用途なので
 * gray-matter を依存に足す価値はないと判断。
 */
function parseFrontmatter(text: string): Record<string, string> {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    // 引用符を剥がす
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[kv[1]] = val;
  }
  return out;
}

export function listSkills(): SkillInfo[] {
  if (!existsSync(SKILLS_DIR)) return [];
  const entries: SkillInfo[] = [];
  for (const d of readdirSync(SKILLS_DIR)) {
    const dirPath = resolve(SKILLS_DIR, d);
    try {
      if (!statSync(dirPath).isDirectory()) continue;
    } catch {
      continue;
    }
    const skillMd = resolve(dirPath, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    let frontmatter: Record<string, string> = {};
    try {
      frontmatter = parseFrontmatter(readFileSync(skillMd, "utf-8"));
    } catch {
      /* ignore */
    }
    entries.push({
      id: d,
      name: frontmatter.name || d,
      description: frontmatter.description,
      whenToUse: frontmatter["when_to_use"] || frontmatter["when-to-use"],
    });
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
}

export function skillExists(id: string): boolean {
  if (!id || id.includes("/") || id.includes("..")) return false;
  return existsSync(resolve(SKILLS_DIR, id, "SKILL.md"));
}

export { SKILLS_DIR, PROJECT_ROOT };
