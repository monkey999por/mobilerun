import { useCallback, useEffect, useMemo, useState } from "react";
import type { CommandFile, DeviceState, SkillRunMeta } from "./types";
import { fetchCommands, fetchDevice, fetchRuns, fetchSkillRuns } from "./api";
import { DeviceBar } from "./components/DeviceBar";
import { DeviceModal } from "./components/DeviceModal";
import { CommandsTab } from "./components/CommandsTab";
import { RunsTab } from "./components/RunsTab";
import { ScheduleTab } from "./components/ScheduleTab";
import { RunModal } from "./components/RunModal";
import { AdbTab } from "./components/AdbTab";
import { SkillsTab } from "./components/SkillsTab";

type Tab = "commands" | "commands-atomic" | "skills" | "runs" | "schedule" | "adb";

export function App() {
  const [tab, setTab] = useState<Tab>("commands");
  const [commands, setCommands] = useState<CommandFile[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [commandsLoading, setCommandsLoading] = useState(true);
  const reloadCommands = useCallback(async () => {
    try {
      const r = await fetchCommands();
      setCommands(r.commands);
      setGroups(r.groups);
    } catch {
      /* ignore */
    } finally {
      setCommandsLoading(false);
    }
  }, []);
  const [device, setDeviceState] = useState<DeviceState | null>(null);
  const [connected, setConnected] = useState(false);
  const [defaultTtl, setDefaultTtl] = useState(8 * 60 * 60);
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [deviceModalReason, setDeviceModalReason] = useState<string | undefined>();
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [runsRefreshKey, setRunsRefreshKey] = useState(0);
  const [runningRuns, setRunningRuns] = useState<{ id: string; commandName: string }[]>([]);
  const [activeSkillRun, setActiveSkillRun] = useState<SkillRunMeta | null>(null);

  // atomic タグの有無で 2 タブに分ける。同じ CommandsTab に違うリストを渡す形なので、
  // groups は両タブ共通で全グループを渡し、CommandsTab 側で空のものは描かない。
  const { regularCommands, atomicCommands } = useMemo(() => {
    const regular: CommandFile[] = [];
    const atomic: CommandFile[] = [];
    for (const c of commands) {
      if (c.tags?.includes("atomic")) atomic.push(c);
      else regular.push(c);
    }
    return { regularCommands: regular, atomicCommands: atomic };
  }, [commands]);

  const reloadDevice = useCallback(async (opts?: { promptIfMissing?: boolean }) => {
    try {
      const r = await fetchDevice();
      setDeviceState(r.device);
      setConnected(r.connected);
      setDefaultTtl(r.defaultTtlSeconds);
      if (!r.device && opts?.promptIfMissing) {
        setDeviceModalReason("device が未設定または期限切れです。再入力してください。");
        setShowDeviceModal(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void reloadCommands();
    void reloadDevice({ promptIfMissing: true });
    // リアルタイム接続状態チェック + running 件数 (5秒間隔)
    const refreshRunning = async () => {
      try {
        const [runs, skillRuns] = await Promise.all([fetchRuns(), fetchSkillRuns()]);
        setRunningRuns(
          runs
            .filter((r) => r.status === "running")
            .map((r) => ({ id: r.id, commandName: r.commandName })),
        );
        const activeSkill = skillRuns.find((r) => r.status === "running") ?? null;
        setActiveSkillRun(activeSkill);
      } catch {
        /* ignore */
      }
    };
    void refreshRunning();
    const t = setInterval(() => {
      void reloadDevice();
      void refreshRunning();
    }, 5_000);
    return () => clearInterval(t);
  }, [reloadDevice, reloadCommands]);

  const onLaunched = useCallback((runId: string) => {
    setOpenRunId(runId);
    setRunsRefreshKey((n) => n + 1);
  }, []);

  const onNeedDevice = useCallback(() => {
    setDeviceModalReason("device の有効期限が切れているため再入力してください。");
    setShowDeviceModal(true);
  }, []);

  return (
    <div className="app">
      <div className="header">
        <h1>mobilerun command-runner</h1>
        {runningRuns.length > 0 && (
          <button
            className="running-badge"
            title="クリックで最新の実行ログを開く"
            onClick={() => {
              setOpenRunId(runningRuns[0].id);
              setTab("runs");
            }}
          >
            <span className="device-dot on" />
            実行中 {runningRuns.length}
          </button>
        )}
        <DeviceBar
          device={device}
          connected={connected}
          onChangeClick={() => {
            setDeviceModalReason(undefined);
            setShowDeviceModal(true);
          }}
        />
      </div>
      <div className="tabs">
        <button className={`tab ${tab === "commands" ? "active" : ""}`} onClick={() => setTab("commands")}>
          コマンド <span className="tab-count">{regularCommands.length}</span>
        </button>
        <button
          className={`tab ${tab === "commands-atomic" ? "active" : ""}`}
          onClick={() => setTab("commands-atomic")}
        >
          コマンド (atomic) <span className="tab-count">{atomicCommands.length}</span>
        </button>
        <button className={`tab ${tab === "skills" ? "active" : ""}`} onClick={() => setTab("skills")}>
          スキル
        </button>
        <button className={`tab ${tab === "runs" ? "active" : ""}`} onClick={() => setTab("runs")}>
          実行履歴
        </button>
        <button className={`tab ${tab === "schedule" ? "active" : ""}`} onClick={() => setTab("schedule")}>
          スケジュール
        </button>
        <button className={`tab ${tab === "adb" ? "active" : ""}`} onClick={() => setTab("adb")}>
          ADB
        </button>
      </div>
      <div className="body">
        {tab === "commands" && (
          <CommandsTab
            commands={regularCommands}
            groups={groups}
            loading={commandsLoading}
            activeRun={runningRuns[0] ?? null}
            onLaunched={onLaunched}
            onNeedDevice={onNeedDevice}
            onCommandsChanged={() => void reloadCommands()}
          />
        )}
        {tab === "commands-atomic" && (
          <CommandsTab
            commands={atomicCommands}
            groups={groups}
            loading={commandsLoading}
            activeRun={runningRuns[0] ?? null}
            onLaunched={onLaunched}
            onNeedDevice={onNeedDevice}
            onCommandsChanged={() => void reloadCommands()}
          />
        )}
        {tab === "skills" && (
          <SkillsTab
            activeSkillRun={activeSkillRun}
            onLaunched={() => {
              /* SkillsTab 内でモーダルを開くので App では特に何もしない */
            }}
          />
        )}
        {tab === "runs" && <RunsTab onOpen={(id) => setOpenRunId(id)} refreshKey={runsRefreshKey} />}
        {tab === "schedule" && <ScheduleTab commands={commands} />}
        {tab === "adb" && <AdbTab />}
      </div>
      {showDeviceModal && (
        <DeviceModal
          current={device}
          defaultTtlSeconds={defaultTtl}
          reason={deviceModalReason}
          onSaved={(d) => {
            setDeviceState(d);
            setShowDeviceModal(false);
          }}
          onCancel={() => setShowDeviceModal(false)}
        />
      )}
      {openRunId && <RunModal runId={openRunId} onClose={() => setOpenRunId(null)} />}
    </div>
  );
}
