import type { CommandFile } from "./types";

/**
 * コマンドが実際に走らせる mobilerun コマンドラインのプレビューを返す。
 * 動的な部分はプレースホルダで表示する: device = "<device>", prompt = "{prompt}"。
 */
export function previewCommand(
  cmd: CommandFile,
  opts: { device?: string; promptPlaceholder?: string } = {}
): string {
  const deviceLabel = opts.device || "<device>";
  const promptLabel = opts.promptPlaceholder ?? '"{prompt}"';
  if (cmd.type === "run") {
    const parts = ["mobilerun", "run", "--device", deviceLabel];
    if (cmd.vision) parts.push("--vision");
    if (cmd.reasoning) parts.push("--reasoning");
    if (typeof cmd.steps === "number") parts.push("--steps", String(cmd.steps));
    parts.push(promptLabel);
    return parts.join(" ");
  }
  const parts = ["mobilerun", "macro", "replay", cmd.macro_file || "<macro_file>", "-d", deviceLabel];
  if (typeof cmd.delay === "number") parts.push("--delay", String(cmd.delay));
  if (typeof cmd.max_steps === "number") parts.push("--max-steps", String(cmd.max_steps));
  return parts.join(" ");
}

export function fmtRelative(iso: string | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  const past = diff >= 0;
  const abs = Math.abs(diff);
  const s = Math.floor(abs / 1000);
  if (s < 60) return past ? `${s}秒前` : `${s}秒後`;
  const m = Math.floor(s / 60);
  if (m < 60) return past ? `${m}分前` : `${m}分後`;
  const h = Math.floor(m / 60);
  if (h < 48) return past ? `${h}時間前` : `${h}時間後`;
  const day = Math.floor(h / 24);
  return past ? `${day}日前` : `${day}日後`;
}

export function fmtDateTime(iso: string | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDuration(startedAt: string, endedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const sec = Math.max(0, Math.floor((end - start) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m${s}s`;
}
