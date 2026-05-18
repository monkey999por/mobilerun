export type CommandType = "run" | "macro";
export type CommandStatus = "confirmed" | "unconfirmed";

export const UNGROUPED = "(未分類)";

export interface CommandFile {
  id: string;
  group: string;
  name: string;
  type: CommandType;
  status: CommandStatus;
  tags: string[];
  notes?: string;
  steps?: number;
  vision?: boolean;
  reasoning?: boolean;
  macro_file?: string;
  delay?: number;
  max_steps?: number;
  prompt?: string;
}

export type MdnsKind = "pairing" | "connect" | "other";

export interface MdnsService {
  name: string;
  serviceType: string;
  addr: string;
  kind: MdnsKind;
}

export interface AdbDevice {
  serial: string;
  state: string;
}

export interface AdbDiscover {
  mdns: MdnsService[];
  devices: AdbDevice[];
}

export interface AdbStatus {
  binary: string;
  serverSocket: string | null;
  version: string | null;
  devices: AdbDevice[];
  mdns: MdnsService[];
}

export interface AdbExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  argv: string[];
}

export type QrPairState =
  | "waiting_scan"
  | "pairing"
  | "pair_failed"
  | "connecting"
  | "connect_failed"
  | "success"
  | "expired"
  | "cancelled";

export interface QrPairSession {
  id: string;
  name: string;
  password: string;
  qrPayload: string;
  qrSvg: string;
  state: QrPairState;
  message?: string;
  device?: string;
  createdAt: string;
  expiresAt: string;
}

export interface DeviceState {
  device: string;
  setAt: string;
  expiresAt: string;
  ttlSeconds: number;
}

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
  exitSignal?: string | null;
  scheduleEntryId?: string;
}

export type ScheduleKind = "cron" | "once";

export interface ScheduleEntry {
  id: string;
  name: string;
  commandId: string;
  kind: ScheduleKind;
  cron?: string;
  runAt?: string;
  enabled: boolean;
  deviceOverride?: string;
  createdAt: string;
  lastFiredAt?: string;
  lastError?: string;
  consumed?: boolean;
  nextRunAt?: string;
}
