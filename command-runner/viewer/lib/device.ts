/**
 * デバイス選択の永続化 (TTL 付き)
 *
 * - 値とセット日時、有効期限秒数を保存
 * - 期限切れ or 未保存の場合は null を返す → UI 側で再入力モーダル
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "../state");
const FILE = resolve(STATE_DIR, "device.json");

export const DEFAULT_TTL_SECONDS = 8 * 60 * 60; // 8 時間

interface DeviceRecord {
  device: string;
  setAt: string;
  ttlSeconds: number;
}

export interface DeviceState {
  device: string;
  setAt: string;
  expiresAt: string;
  ttlSeconds: number;
}

function ensureDir(): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

function read(): DeviceRecord | null {
  if (!existsSync(FILE)) return null;
  try {
    return JSON.parse(readFileSync(FILE, "utf-8")) as DeviceRecord;
  } catch {
    return null;
  }
}

function isExpired(rec: DeviceRecord): boolean {
  const setAtMs = new Date(rec.setAt).getTime();
  if (Number.isNaN(setAtMs)) return true;
  return Date.now() > setAtMs + rec.ttlSeconds * 1000;
}

export function getDevice(): DeviceState | null {
  const rec = read();
  if (!rec) return null;
  if (isExpired(rec)) return null;
  return {
    device: rec.device,
    setAt: rec.setAt,
    expiresAt: new Date(new Date(rec.setAt).getTime() + rec.ttlSeconds * 1000).toISOString(),
    ttlSeconds: rec.ttlSeconds,
  };
}

export function setDevice(device: string, ttlSeconds = DEFAULT_TTL_SECONDS): DeviceState {
  ensureDir();
  const rec: DeviceRecord = {
    device: device.trim(),
    setAt: new Date().toISOString(),
    ttlSeconds,
  };
  writeFileSync(FILE, JSON.stringify(rec, null, 2));
  return {
    device: rec.device,
    setAt: rec.setAt,
    expiresAt: new Date(new Date(rec.setAt).getTime() + rec.ttlSeconds * 1000).toISOString(),
    ttlSeconds: rec.ttlSeconds,
  };
}

export function clearDevice(): void {
  if (existsSync(FILE)) writeFileSync(FILE, "");
}
