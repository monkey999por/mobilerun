import type {
  AdbDiscover,
  AdbExecResult,
  AdbStatus,
  CommandFile,
  DeviceState,
  QrPairSession,
  RunMeta,
  ScheduleEntry,
  SkillInfo,
  SkillRunMeta,
} from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = (body as { error?: string }).error || res.statusText;
    const err = new Error(message) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = (body as { code?: string }).code;
    throw err;
  }
  return (await res.json()) as T;
}

export async function fetchCommands(): Promise<{ commands: CommandFile[]; groups: string[] }> {
  const r = await fetch("/api/commands");
  return await json<{ commands: CommandFile[]; groups: string[] }>(r);
}

export async function fetchGroups(): Promise<string[]> {
  const r = await fetch("/api/command-groups");
  const data = await json<{ groups: string[] }>(r);
  return data.groups;
}

export async function fetchCommand(id: string): Promise<{ command: CommandFile; raw: string }> {
  const r = await fetch(`/api/commands/${encodeURIComponent(id)}`);
  return await json<{ command: CommandFile; raw: string }>(r);
}

export async function createCommand(input: CommandFile): Promise<CommandFile> {
  const r = await fetch("/api/commands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await json<{ command: CommandFile }>(r);
  return data.command;
}

export async function updateCommand(
  id: string,
  body: { raw?: string } & Partial<CommandFile>
): Promise<{ command: CommandFile; raw: string }> {
  const r = await fetch(`/api/commands/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await json<{ command: CommandFile; raw: string }>(r);
}

export async function deleteCommand(id: string): Promise<void> {
  await fetch(`/api/commands/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchDevice(): Promise<{
  device: DeviceState | null;
  connected: boolean;
  defaultTtlSeconds: number;
}> {
  const r = await fetch("/api/device");
  return await json<{ device: DeviceState | null; connected: boolean; defaultTtlSeconds: number }>(r);
}

export async function saveDevice(device: string, ttlSeconds?: number): Promise<DeviceState> {
  const r = await fetch("/api/device", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device, ttlSeconds }),
  });
  const data = await json<{ device: DeviceState }>(r);
  return data.device;
}

export async function clearDevice(): Promise<void> {
  await fetch("/api/device", { method: "DELETE" });
}

export async function startRun(
  commandId: string,
  parameters?: Record<string, string>,
): Promise<RunMeta> {
  const r = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commandId, parameters }),
  });
  const data = await json<{ run: RunMeta }>(r);
  return data.run;
}

export async function fetchRuns(): Promise<RunMeta[]> {
  const r = await fetch("/api/runs");
  const data = await json<{ runs: RunMeta[] }>(r);
  return data.runs;
}

export async function fetchRun(id: string): Promise<{ run: RunMeta; log: string; running: boolean }> {
  const r = await fetch(`/api/runs/${encodeURIComponent(id)}`);
  return await json<{ run: RunMeta; log: string; running: boolean }>(r);
}

export async function cancelRun(id: string): Promise<void> {
  await fetch(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

export async function adbDiscover(): Promise<AdbDiscover> {
  const r = await fetch("/api/adb/discover");
  return await json<AdbDiscover>(r);
}

export interface TcpProbeResult {
  host: string;
  port: number;
  reachable: boolean;
  latencyMs: number;
  error?: string;
}

export async function adbConnect(
  target: string,
  ttlSeconds?: number
): Promise<{ ok: boolean; message: string; device: DeviceState | null; probe?: TcpProbeResult }> {
  const r = await fetch("/api/adb/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target, ttlSeconds }),
  });
  return await json<{ ok: boolean; message: string; device: DeviceState | null; probe?: TcpProbeResult }>(r);
}

export async function probeTcp(target: string): Promise<TcpProbeResult> {
  const r = await fetch("/api/adb/probe-tcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  return await json<TcpProbeResult>(r);
}

export async function adbPair(addr: string, code: string): Promise<{ ok: boolean; message: string }> {
  const r = await fetch("/api/adb/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addr, code }),
  });
  return await json<{ ok: boolean; message: string }>(r);
}

export async function adbDisconnect(target: string): Promise<{ ok: boolean; message: string }> {
  const r = await fetch("/api/adb/disconnect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  return await json<{ ok: boolean; message: string }>(r);
}

export async function fetchAdbStatus(): Promise<AdbStatus> {
  const r = await fetch("/api/adb/status");
  return await json<AdbStatus>(r);
}

export async function adbExec(argv: string[]): Promise<AdbExecResult> {
  const r = await fetch("/api/adb/exec", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ argv }),
  });
  return await json<AdbExecResult>(r);
}

export async function startQrPair(ttlSeconds?: number): Promise<QrPairSession> {
  const r = await fetch("/api/adb/qr-pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ttlSeconds }),
  });
  const data = await json<{ session: QrPairSession }>(r);
  return data.session;
}

export async function cancelQrPair(id: string): Promise<void> {
  await fetch(`/api/adb/qr-pair/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchSchedule(): Promise<ScheduleEntry[]> {
  const r = await fetch("/api/schedule");
  const data = await json<{ entries: ScheduleEntry[] }>(r);
  return data.entries;
}

export async function addSchedule(input: {
  name: string;
  commandId: string;
  kind: "cron" | "once";
  cron?: string;
  runAt?: string;
  deviceOverride?: string;
}): Promise<ScheduleEntry> {
  const r = await fetch("/api/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await json<{ entry: ScheduleEntry }>(r);
  return data.entry;
}

export async function updateSchedule(id: string, patch: Partial<ScheduleEntry>): Promise<ScheduleEntry> {
  const r = await fetch(`/api/schedule/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await json<{ entry: ScheduleEntry }>(r);
  return data.entry;
}

export async function deleteSchedule(id: string): Promise<void> {
  await fetch(`/api/schedule/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function runScheduleNow(id: string): Promise<void> {
  await fetch(`/api/schedule/${encodeURIComponent(id)}/run`, { method: "POST" });
}

export async function fetchSkills(): Promise<SkillInfo[]> {
  const r = await fetch("/api/skills");
  const data = await json<{ skills: SkillInfo[] }>(r);
  return data.skills;
}

export async function startSkillRun(
  skillId: string,
  extraInstruction?: string,
): Promise<SkillRunMeta> {
  const r = await fetch("/api/skill-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skillId, extraInstruction }),
  });
  const data = await json<{ run: SkillRunMeta }>(r);
  return data.run;
}

export async function fetchSkillRuns(): Promise<SkillRunMeta[]> {
  const r = await fetch("/api/skill-runs");
  const data = await json<{ runs: SkillRunMeta[] }>(r);
  return data.runs;
}

export async function fetchSkillRun(
  id: string,
): Promise<{ run: SkillRunMeta; log: string; running: boolean }> {
  const r = await fetch(`/api/skill-runs/${encodeURIComponent(id)}`);
  return await json<{ run: SkillRunMeta; log: string; running: boolean }>(r);
}

export async function cancelSkillRun(id: string): Promise<void> {
  await fetch(`/api/skill-runs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}
