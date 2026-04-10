import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { api } from "./ipc-client";
import type { AppConfigDTO, RecordingStatus } from "../../shared/ipc";
import { RecordView } from "./routes/RecordView";
import { MeetingsList } from "./routes/MeetingsList";
import { MeetingDetail } from "./routes/MeetingDetail";
import { PromptsEditor } from "./routes/PromptsEditor";
import { Settings } from "./routes/Settings";
import { SetupWizard } from "./routes/SetupWizard";
import { ActivityView } from "./routes/ActivityView";
import { NewMeetingModal } from "./components/NewMeetingModal";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { MeetingNotesMark } from "./components/MeetingNotesMark";
import { AppSidebar } from "./components/AppSidebar";
import { SiteHeader } from "./components/SiteHeader";
import { SidebarInset, SidebarMain, SidebarProvider } from "./components/ui/sidebar";

type Route =
  | { name: "record" }
  | { name: "meetings" }
  | { name: "meeting"; runFolder: string }
  | { name: "prompts"; promptId?: string }
  | { name: "settings" }
  | { name: "activity" };

function routeToHash(route: Route): string {
  switch (route.name) {
    case "record":
      return "#/record";
    case "meetings":
      return "#/meetings";
    case "meeting":
      return `#/meeting/${encodeURIComponent(route.runFolder)}`;
    case "prompts":
      return route.promptId
        ? `#/prompts/${encodeURIComponent(route.promptId)}`
        : "#/prompts";
    case "settings":
      return "#/settings";
    case "activity":
      return "#/activity";
  }
}

function routeFromHash(hash: string): Route | null {
  const normalized = hash.replace(/^#/, "");
  if (!normalized || normalized === "/" || normalized === "") {
    return null;
  }

  const parts = normalized.replace(/^\/+/, "").split("/");
  const [head, tail] = parts;

  switch (head) {
    case "record":
      return { name: "record" };
    case "meetings":
      return { name: "meetings" };
    case "meeting":
      return tail ? { name: "meeting", runFolder: decodeURIComponent(tail) } : null;
    case "prompts":
      return tail ? { name: "prompts", promptId: decodeURIComponent(tail) } : { name: "prompts" };
    case "settings":
      return { name: "settings" };
    case "activity":
      return { name: "activity" };
    default:
      return null;
  }
}

export function App() {
  const [config, setConfig] = useState<AppConfigDTO | null | undefined>(undefined);
  const [recording, setRecording] = useState<RecordingStatus>({ active: false });
  const [route, setRoute] = useState<Route>(() => routeFromHash(window.location.hash) ?? { name: "record" });
  const [newMeetingOpen, setNewMeetingOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<Route | null>(null);
  
  const isDirtyRef = useRef(false);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  const navigate = useCallback((nextRoute: Route) => {
    if (isDirtyRef.current) {
      setPendingRoute(nextRoute);
      return;
    }
    setRoute(nextRoute);
    setIsDirty(false);
  }, []);

  useEffect(() => {
    const nextHash = routeToHash(route);
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }, [route]);

  const confirmNavigation = () => {
    if (pendingRoute) {
      setRoute(pendingRoute);
      setPendingRoute(null);
      setIsDirty(false);
    }
  };

  const cancelNavigation = () => {
    setPendingRoute(null);
  };

  useEffect(() => {
    api.config.get().then(setConfig).catch((err) => {
      console.error("config:get failed", err);
      setConfig(null);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.recording.getStatus().then((status) => {
      if (!cancelled) setRecording(status);
    });
    const unsub = api.on.recordingStatus((status) => setRecording(status));
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  useEffect(() => {
    const unsub = api.on.appAction(async (event) => {
      if (event.type === "open-new-meeting") {
        navigate({ name: "record" });
        setNewMeetingOpen(true);
        return;
      }

      const status = await api.recording.getStatus();
      if (!status.active) {
        navigate({ name: "record" });
        setNewMeetingOpen(true);
        return;
      }

      const result = await api.recording.stop();
      if (result?.run_folder) {
        navigate({ name: "meeting", runFolder: result.run_folder });
      }
    });
    return () => unsub();
  }, [navigate]);

  useEffect(() => {
    const target = window as typeof window & {
      __MEETING_NOTES_TEST?: {
        navigate?: (route: Route["name"]) => void;
        navigateRoute?: (route: Route) => void;
      };
    };
    if (!target.__MEETING_NOTES_TEST) return;
    target.__MEETING_NOTES_TEST.navigate = (name) => navigate({ name } as Route);
    target.__MEETING_NOTES_TEST.navigateRoute = (nextRoute) => navigate(nextRoute);
    return () => {
      if (target.__MEETING_NOTES_TEST) {
        delete target.__MEETING_NOTES_TEST.navigate;
        delete target.__MEETING_NOTES_TEST.navigateRoute;
      }
    };
  }, [navigate]);

  const activeNav = route.name === "meeting" ? "meetings" : route.name;
  const routeLabel = useMemo(() => {
    switch (route.name) {
      case "record":
        return "Home";
      case "meetings":
        return "Meetings";
      case "meeting":
        return "Meeting";
      case "prompts":
        return "Prompt Library";
      case "settings":
        return "Settings";
      case "activity":
        return "Activity";
    }
  }, [route.name]);

  const routeSubtitle = useMemo(() => {
    switch (route.name) {
      case "record":
        return "Capture live meetings and keep transcripts as local markdown";
      case "meetings":
        return "Browse, reopen, and bulk-run prompts across past meetings";
      case "prompts":
        return "Auto-run or manually trigger prompts against your transcripts";
      default:
        return undefined;
    }
  }, [route.name]);

  if (config === undefined) {
    return (
      <div className="loading-splash bg-[var(--bg-secondary)]">
        <div className="space-y-3 text-center">
          <MeetingNotesMark />
          <div className="text-sm text-[var(--text-secondary)]">Loading Meeting Notes…</div>
        </div>
      </div>
    );
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

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "18rem",
          "--header-height": "4.75rem",
        } as React.CSSProperties
      }
    >
      <div className="h-8 shrink-0 border-b border-[var(--border-subtle)] bg-[rgba(255,255,255,0.88)] backdrop-blur-sm [-webkit-app-region:drag]" />
      <SidebarMain>
        <AppSidebar
          activeNav={activeNav}
          onNavigate={(name) => navigate({ name } as Route)}
          onStartMeeting={() => {
            navigate({ name: "record" });
            setNewMeetingOpen(true);
          }}
        />
        <SidebarInset>
          <SiteHeader
            section={routeLabel}
            title={route.name === "meeting" ? "Meeting workspace" : routeLabel}
            subtitle={routeSubtitle}
            recordingLabel={recording.active ? `Recording${recording.title ? ` · ${recording.title}` : ""}` : null}
            isDirty={isDirty}
          />
          <main className="h-full overflow-y-auto">
            {route.name === "record" && (
              <RecordView
                recording={recording}
                config={config}
                onMeetingStopped={(runFolder) => navigate({ name: "meeting", runFolder })}
                onOpenMeeting={(runFolder) => navigate({ name: "meeting", runFolder })}
              />
            )}
            {route.name === "meetings" && (
              <MeetingsList onOpen={(runFolder) => navigate({ name: "meeting", runFolder })} />
            )}
            {route.name === "meeting" && (
              <MeetingDetail
                runFolder={route.runFolder}
                config={config}
                onBack={() => navigate({ name: "meetings" })}
                onOpenPromptLibrary={(promptId) => navigate({ name: "prompts", promptId })}
                onDirtyChange={setIsDirty}
              />
            )}
            {route.name === "prompts" && (
              <PromptsEditor
                config={config}
                initialPromptId={route.promptId}
                onDirtyChange={setIsDirty}
              />
            )}
            {route.name === "settings" && (
              <Settings
                config={config}
                onChange={(nextConfig) => setConfig(nextConfig)}
                onDirtyChange={setIsDirty}
              />
            )}
            {route.name === "activity" && <ActivityView />}
          </main>
        </SidebarInset>
      </SidebarMain>

      {newMeetingOpen && (
        <NewMeetingModal
          onClose={() => setNewMeetingOpen(false)}
          onStarted={() => navigate({ name: "record" })}
        />
      )}

      <ConfirmDialog
        open={!!pendingRoute}
        onOpenChange={(open) => {
          if (!open) cancelNavigation();
        }}
        title="Unsaved Changes"
        description="You have pending changes that haven't been saved to disk. Are you sure you want to leave?"
        cancelLabel="Stay on page"
        confirmLabel="Discard changes"
        onCancel={cancelNavigation}
        onConfirm={confirmNavigation}
      />
    </SidebarProvider>
  );
}
