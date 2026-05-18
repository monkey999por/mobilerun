import { useCallback, useEffect, useState } from "react";
import type { CommandFile, DeviceState } from "./types";
import { fetchCommands, fetchDevice } from "./api";
import { DeviceBar } from "./components/DeviceBar";
import { DeviceModal } from "./components/DeviceModal";
import { CommandsTab } from "./components/CommandsTab";
import { RunsTab } from "./components/RunsTab";
import { ScheduleTab } from "./components/ScheduleTab";
import { RunModal } from "./components/RunModal";

type Tab = "commands" | "runs" | "schedule";

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
  const [defaultTtl, setDefaultTtl] = useState(8 * 60 * 60);
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [deviceModalReason, setDeviceModalReason] = useState<string | undefined>();
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [runsRefreshKey, setRunsRefreshKey] = useState(0);

  const reloadDevice = useCallback(async () => {
    try {
      const r = await fetchDevice();
      setDeviceState(r.device);
      setDefaultTtl(r.defaultTtlSeconds);
      // 未設定 or 期限切れ なら自動でプロンプト
      if (!r.device) {
        setDeviceModalReason("device が未設定または期限切れです。再入力してください。");
        setShowDeviceModal(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void reloadCommands();
    void reloadDevice();
    // 1分ごとに期限チェック
    const t = setInterval(() => {
      void reloadDevice();
    }, 60_000);
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
        <DeviceBar
          device={device}
          onChangeClick={() => {
            setDeviceModalReason(undefined);
            setShowDeviceModal(true);
          }}
        />
      </div>
      <div className="tabs">
        <button className={`tab ${tab === "commands" ? "active" : ""}`} onClick={() => setTab("commands")}>
          コマンド
        </button>
        <button className={`tab ${tab === "runs" ? "active" : ""}`} onClick={() => setTab("runs")}>
          実行履歴
        </button>
        <button className={`tab ${tab === "schedule" ? "active" : ""}`} onClick={() => setTab("schedule")}>
          スケジュール
        </button>
      </div>
      <div className="body">
        {tab === "commands" && (
          <CommandsTab
            commands={commands}
            groups={groups}
            loading={commandsLoading}
            onLaunched={onLaunched}
            onNeedDevice={onNeedDevice}
            onCommandsChanged={() => void reloadCommands()}
          />
        )}
        {tab === "runs" && <RunsTab onOpen={(id) => setOpenRunId(id)} refreshKey={runsRefreshKey} />}
        {tab === "schedule" && <ScheduleTab commands={commands} />}
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
