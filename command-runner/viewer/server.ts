/**
 * mobilerun command-runner viewer
 *
 * - Hono + Node.js
 * - dev: PORT=3101 (Vite が 3102 から /api をプロキシ)
 * - prod: PORT=3102 で dist を静的配信
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import { stream } from "hono/streaming";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import {
  listCommands,
  getCommand,
  getCommandRaw,
  saveCommand,
  saveCommandRaw,
  deleteCommand,
  commandExists,
  listGroups,
  type CommandFile,
} from "./lib/commands.ts";
import { getDevice, setDevice, clearDevice, DEFAULT_TTL_SECONDS } from "./lib/device.ts";
import {
  startRun,
  listRuns,
  readMeta,
  readLog,
  subscribe,
  cancelRun,
  isRunning,
  listRunningIds,
  annotateViewerSignal,
  RunInProgressError,
} from "./lib/runs.ts";
import * as adb from "./lib/adb.ts";
import * as qrPair from "./lib/qr-pair.ts";
import * as scheduler from "./scheduler.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || (process.env.NODE_ENV === "production" ? 3102 : 3101));
const SERVE_STATIC = process.env.SERVE_STATIC !== "0";
const DIST_DIR = resolve(__dirname, "dist");

scheduler.init();

const app = new Hono();
app.use("/api/*", cors());

// --- コマンド ---

app.get("/api/commands", (c) => {
  return c.json({ commands: listCommands(), groups: listGroups() });
});

app.get("/api/command-groups", (c) => {
  return c.json({ groups: listGroups() });
});

app.get("/api/commands/:id", (c) => {
  const id = c.req.param("id");
  const cmd = getCommand(id);
  if (!cmd) return c.json({ error: "not found" }, 404);
  const raw = getCommandRaw(id) ?? "";
  return c.json({ command: cmd, raw });
});

app.post("/api/commands", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Partial<CommandFile>;
  if (!body.id) return c.json({ error: "id required" }, 400);
  if (commandExists(body.id)) return c.json({ error: "id already exists" }, 409);
  try {
    const saved = saveCommand(body as CommandFile);
    return c.json({ command: saved });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.put("/api/commands/:id", async (c) => {
  const id = c.req.param("id");
  if (!commandExists(id)) return c.json({ error: "not found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { raw?: string; group?: string } & Partial<CommandFile>;
  try {
    if (typeof body.raw === "string") {
      const saved = saveCommandRaw(id, body.raw, body.group);
      return c.json({ command: saved, raw: getCommandRaw(id) ?? "" });
    }
    const saved = saveCommand({ ...(body as CommandFile), id });
    return c.json({ command: saved, raw: getCommandRaw(id) ?? "" });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.delete("/api/commands/:id", (c) => {
  const id = c.req.param("id");
  const ok = deleteCommand(id);
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// --- デバイス ---

app.get("/api/device", async (c) => {
  const d = getDevice();
  const connected = d ? await adb.isConnected(d.device).catch(() => false) : false;
  return c.json({ device: d, connected, defaultTtlSeconds: DEFAULT_TTL_SECONDS });
});

app.post("/api/device", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { device?: string; ttlSeconds?: number };
  if (!body.device || !body.device.trim()) return c.json({ error: "device required" }, 400);
  const d = setDevice(body.device, body.ttlSeconds);
  return c.json({ device: d });
});

app.delete("/api/device", (c) => {
  clearDevice();
  return c.json({ ok: true });
});

// --- 実行 ---

app.post("/api/runs", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    commandId?: string;
    parameters?: unknown;
  };
  if (!body.commandId) return c.json({ error: "commandId required" }, 400);
  // 文字列値のみ受け付ける。それ以外は無視 (skill 経由で number/bool が来ても文字列化する設計)。
  let parameters: Record<string, string> | undefined;
  if (body.parameters && typeof body.parameters === "object") {
    parameters = {};
    for (const [k, v] of Object.entries(body.parameters as Record<string, unknown>)) {
      if (typeof v === "string") parameters[k] = v;
      else if (v != null) parameters[k] = String(v);
    }
  }
  const d = getDevice();
  if (!d) return c.json({ error: "device not set or expired", code: "device_required" }, 409);
  try {
    const meta = await startRun({ commandId: body.commandId, device: d.device, parameters });
    return c.json({ run: meta });
  } catch (err) {
    if (err instanceof RunInProgressError) {
      return c.json(
        { error: err.message, code: err.code, activeRunId: err.activeRunId },
        409,
      );
    }
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.get("/api/runs", (c) => {
  return c.json({ runs: listRuns(), activeRunIds: listRunningIds() });
});

app.get("/api/runs/:id", (c) => {
  const id = c.req.param("id");
  const meta = readMeta(id);
  if (!meta) return c.json({ error: "not found" }, 404);
  return c.json({ run: meta, log: readLog(id), running: isRunning(id) });
});

app.post("/api/runs/:id/cancel", (c) => {
  const ok = cancelRun(c.req.param("id"));
  return c.json({ ok });
});

app.get("/api/runs/:id/stream", (c) => {
  const id = c.req.param("id");
  const meta = readMeta(id);
  if (!meta) return c.json({ error: "not found" }, 404);
  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");
  c.header("X-Accel-Buffering", "no");
  return stream(c, async (s) => {
    // 既存ログをまずまとめて流す
    const existing = readLog(id);
    if (existing) await s.write(sseEvent("log", existing));

    if (!isRunning(id)) {
      // 終了済み
      await s.write(sseEvent("end", JSON.stringify(meta)));
      return;
    }

    await new Promise<void>((done) => {
      const unsub = subscribe(id, {
        onLog: (chunk) => {
          s.write(sseEvent("log", chunk)).catch(() => {
            unsub();
            done();
          });
        },
        onEnd: (m) => {
          s.write(sseEvent("end", JSON.stringify(m)))
            .catch(() => {})
            .finally(() => {
              unsub();
              done();
            });
        },
      });
      s.onAbort(() => {
        unsub();
        done();
      });
    });
  });
});

function sseEvent(event: string, data: string): string {
  const payload = data
    .split("\n")
    .map((l) => `data: ${l}`)
    .join("\n");
  return `event: ${event}\n${payload}\n\n`;
}

// --- adb ---

app.get("/api/adb/discover", async (c) => {
  const [mdns, devices] = await Promise.all([adb.listMdnsServices(), adb.listDevices()]);
  return c.json({ mdns, devices });
});

app.post("/api/adb/connect", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { target?: string; saveAsDevice?: boolean; ttlSeconds?: number };
  if (!body.target) return c.json({ error: "target required" }, 400);
  const res = await adb.connect(body.target);
  if (res.ok && body.saveAsDevice !== false) {
    setDevice(body.target, body.ttlSeconds);
  }
  // 失敗時はネットワーク到達性をチェックして UI 側で原因切り分けできるようにする。
  // (adb のメッセージは "failed to connect to ..." とだけ言ってポート不達/TLS拒否/タイムアウトの区別がつかない)
  let probe: adb.TcpProbeResult | undefined;
  if (!res.ok) {
    const hp = adb.parseHostPort(body.target);
    if (hp) probe = await adb.probeTcp(hp.host, hp.port);
  }
  return c.json({ ok: res.ok, message: res.out, device: getDevice(), probe });
});

app.post("/api/adb/probe-tcp", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { target?: string };
  if (!body.target) return c.json({ error: "target required" }, 400);
  const hp = adb.parseHostPort(body.target);
  if (!hp) return c.json({ error: "target must be ip:port" }, 400);
  const result = await adb.probeTcp(hp.host, hp.port);
  return c.json(result);
});

app.post("/api/adb/pair", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { addr?: string; code?: string };
  if (!body.addr || !body.code) return c.json({ error: "addr and code required" }, 400);
  const res = await adb.pair(body.addr, body.code);
  return c.json({ ok: res.ok, message: res.out });
});

app.post("/api/adb/disconnect", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { target?: string };
  if (!body.target) return c.json({ error: "target required" }, 400);
  const res = await adb.disconnect(body.target);
  return c.json({ ok: res.ok, message: res.out });
});

app.get("/api/adb/status", async (c) => {
  return c.json(await adb.status());
});

app.post("/api/adb/exec", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { argv?: unknown };
  if (!Array.isArray(body.argv) || !body.argv.every((s) => typeof s === "string")) {
    return c.json({ error: "argv: string[] required" }, 400);
  }
  const result = await adb.exec(body.argv as string[]);
  return c.json(result);
});

// --- adb QR ペアリング ---

app.post("/api/adb/qr-pair", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ttlSeconds?: number };
  try {
    const session = await qrPair.startSession(body.ttlSeconds);
    return c.json({ session });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.get("/api/adb/qr-pair/:id", (c) => {
  const s = qrPair.getSession(c.req.param("id"));
  if (!s) return c.json({ error: "not found" }, 404);
  return c.json({ session: s });
});

app.get("/api/adb/qr-pair/:id/stream", (c) => {
  const id = c.req.param("id");
  const session = qrPair.getSession(id);
  if (!session) return c.json({ error: "not found" }, 404);
  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");
  c.header("X-Accel-Buffering", "no");
  return stream(c, async (s) => {
    await s.write(sseEvent("update", JSON.stringify(session)));
    if (qrPair.isTerminal(session.state)) return;
    await new Promise<void>((done) => {
      const unsub = qrPair.subscribe(id, {
        onUpdate: (sess) => {
          s.write(sseEvent("update", JSON.stringify(sess)))
            .catch(() => {
              unsub();
              done();
            })
            .then(() => {
              if (qrPair.isTerminal(sess.state)) {
                unsub();
                done();
              }
            });
        },
      });
      s.onAbort(() => {
        unsub();
        done();
      });
    });
  });
});

app.delete("/api/adb/qr-pair/:id", (c) => {
  const ok = qrPair.cancelSession(c.req.param("id"));
  return c.json({ ok });
});

// --- スケジュール ---

app.get("/api/schedule", (c) => {
  return c.json({ entries: scheduler.listEntries() });
});

app.post("/api/schedule", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    const entry = scheduler.addEntry(body);
    return c.json({ entry });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.patch("/api/schedule/:id", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const entry = scheduler.updateEntry(c.req.param("id"), body);
  if (!entry) return c.json({ error: "not found" }, 404);
  return c.json({ entry });
});

app.delete("/api/schedule/:id", (c) => {
  const ok = scheduler.deleteEntry(c.req.param("id"));
  return c.json({ ok });
});

app.post("/api/schedule/:id/run", (c) => {
  const entry = scheduler.runEntryNow(c.req.param("id"));
  if (!entry) return c.json({ error: "not found" }, 404);
  return c.json({ entry });
});

// --- 静的配信 / dev モード案内 ---

if (SERVE_STATIC && existsSync(DIST_DIR)) {
  app.use("/*", serveStatic({ root: "./viewer/dist" }));
  // SPA fallback
  app.get("*", (c) => {
    const html = readFileSync(resolve(DIST_DIR, "index.html"), "utf-8");
    return c.html(html);
  });
} else {
  // dev モード: UI は Vite (3102) 側にあるので、API ポート直接アクセスにはヒントを返す
  app.get("/", (c) =>
    c.html(`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>command-runner API</title>
<style>body{font-family:-apple-system,sans-serif;background:#0f1115;color:#e6e9ef;padding:40px;line-height:1.6}
a{color:#7aa2f7}code{background:#1c2230;padding:2px 6px;border-radius:4px;font-family:ui-monospace,Menlo,monospace}</style>
</head><body>
<h2>mobilerun command-runner — API server</h2>
<p>このポート (<code>${PORT}</code>) は Hono の API 専用です。UI はこちら:</p>
<p><a href="http://localhost:3102/">→ http://localhost:3102/</a></p>
<p>API は <code>/api/*</code> 配下 (例: <a href="/api/commands">/api/commands</a>)。</p>
</body></html>`)
  );
}

serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`[command-runner] listening on http://localhost:${info.port}`);
});

// 子 (= mobilerun) が "exit null" で死ぬ問題 (#3) の原因切り分け用。viewer が何らかの
// シグナルで終了する直前に、各 run の log にどの signal だったかを書き込む。
// (例: tsx watch のリロード → SIGTERM、concurrently -k での連鎖 → SIGTERM、
//  ターミナル切断 → SIGHUP、docker stop → SIGTERM→SIGKILL、Ctrl-C → SIGINT)
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.on(sig, () => {
    console.log(`[command-runner] received ${sig}, recording into active runs`);
    annotateViewerSignal(sig);
    // 自前ハンドラを解除して default 動作 (= process 終了) に戻す。
    process.removeAllListeners(sig);
    process.kill(process.pid, sig);
  });
}
