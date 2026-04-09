import { useEffect, useState } from "react";
import { api } from "./ipc-client";
import type { AppConfigDTO, RecordingStatus } from "../../shared/ipc";
import { RecordView } from "./routes/RecordView";
import { MeetingsList } from "./routes/MeetingsList";
import { MeetingDetail } from "./routes/MeetingDetail";
import { PromptsEditor } from "./routes/PromptsEditor";
import { Settings } from "./routes/Settings";
import { SetupWizard } from "./routes/SetupWizard";
import { LogsView } from "./routes/LogsView";
import { NewMeetingModal } from "./components/NewMeetingModal";

type Route =
  | { name: "record" }
  | { name: "meetings" }
  | { name: "meeting"; runFolder: string }
  | { name: "prompts" }
  | { name: "settings" }
  | { name: "logs" };

export function App() {
  const [config, setConfig] = useState<AppConfigDTO | null | undefined>(undefined);
  const [recording, setRecording] = useState<RecordingStatus>({ active: false });
  const [route, setRoute] = useState<Route>({ name: "record" });
  const [newMeetingOpen, setNewMeetingOpen] = useState(false);

  // Load config on mount (null means needs setup wizard).
  useEffect(() => {
    api.config.get().then(setConfig).catch((err) => {
      console.error("config:get failed", err);
      setConfig(null);
    });
  }, []);

  // Subscribe to recording status updates.
  useEffect(() => {
    let cancelled = false;
    api.recording.getStatus().then((s) => {
      if (!cancelled) setRecording(s);
    });
    const unsub = api.on.recordingStatus((s) => setRecording(s));
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // Global shortcut: stop a recording, or open the New Meeting modal.
  useEffect(() => {
    const unsub = api.on.shortcutTriggered(async () => {
      const status = await api.recording.getStatus();
      if (status.active) {
        const result = await api.recording.stop();
        if (result?.run_folder) {
          setRoute({ name: "meeting", runFolder: result.run_folder });
        }
      } else {
        setNewMeetingOpen(true);
      }
    });
    return () => unsub();
  }, []);

  if (config === undefined) {
    return <div className="loading-splash">Loading…</div>;
  }

  if (config === null) {
    return (
      <SetupWizard
        onComplete={async () => {
          const fresh = await api.config.get();
          setConfig(fresh);
        }}
      />
    );
  }

  // Note: the SetupWizard owns its own .wizard-shell + .wizard-titlebar
  // wrapper so it can draw the drag region itself.

  return (
    <div className="app">
      <div className="app-titlebar">
        <button
          type="button"
          className="titlebar-button"
          onClick={() => setNewMeetingOpen(true)}
        >
          + New meeting
        </button>
      </div>
      <aside className="sidebar">
        <div className="sidebar-header">
          {recording.active ? <span className="sidebar-rec-dot" /> : null}
          Meeting Notes
        </div>
        <button
          className={`nav-item ${route.name === "record" ? "active" : ""}`}
          onClick={() => setRoute({ name: "record" })}
        >
          Home
        </button>
        <button
          className={`nav-item ${route.name === "meetings" || route.name === "meeting" ? "active" : ""}`}
          onClick={() => setRoute({ name: "meetings" })}
        >
          Meetings
        </button>
        <button
          className={`nav-item ${route.name === "prompts" ? "active" : ""}`}
          onClick={() => setRoute({ name: "prompts" })}
        >
          Prompts
        </button>
        <button
          className={`nav-item ${route.name === "settings" ? "active" : ""}`}
          onClick={() => setRoute({ name: "settings" })}
        >
          Settings
        </button>
        <button
          className={`nav-item ${route.name === "logs" ? "active" : ""}`}
          onClick={() => setRoute({ name: "logs" })}
        >
          Logs
        </button>
      </aside>
      <main className="main">
        {route.name === "record" && (
          <RecordView
            recording={recording}
            config={config}
            onMeetingStopped={(runFolder) => setRoute({ name: "meeting", runFolder })}
            onOpenMeeting={(runFolder) => setRoute({ name: "meeting", runFolder })}
          />
        )}
        {route.name === "meetings" && (
          <MeetingsList
            onOpen={(runFolder) => setRoute({ name: "meeting", runFolder })}
          />
        )}
        {route.name === "meeting" && (
          <MeetingDetail
            runFolder={route.runFolder}
            config={config}
            onBack={() => setRoute({ name: "meetings" })}
          />
        )}
        {route.name === "prompts" && <PromptsEditor />}
        {route.name === "settings" && (
          <Settings
            config={config}
            onChange={(c) => setConfig(c)}
          />
        )}
        {route.name === "logs" && <LogsView />}
      </main>
      {newMeetingOpen && (
        <NewMeetingModal
          onClose={() => setNewMeetingOpen(false)}
          onStarted={() => setRoute({ name: "record" })}
        />
      )}
    </div>
  );
}
