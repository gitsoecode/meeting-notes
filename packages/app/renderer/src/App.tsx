import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { api } from "./ipc-client";
import type { AppConfigDTO, RecordingStatus } from "../../shared/ipc";
import { RecordView } from "./routes/RecordView";
import { MeetingsList } from "./routes/MeetingsList";
import { MeetingShell } from "./routes/MeetingShell";
import { PromptsEditor } from "./routes/PromptsEditor";
import { Settings } from "./routes/Settings";
import { SetupWizard } from "./routes/SetupWizard";
import { ActivityView } from "./routes/ActivityView";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { MeetingNotesMark } from "./components/MeetingNotesMark";
import { AppSidebar } from "./components/AppSidebar";
import { SiteHeader } from "./components/SiteHeader";
import { SidebarInset, SidebarMain, SidebarProvider } from "./components/ui/sidebar";

export type MeetingView = "workspace" | "details";

type Route =
  | { name: "record" }
  | { name: "meetings" }
  | { name: "meeting"; runFolder: string; view?: MeetingView }
  | { name: "prompts"; promptId?: string }
  | { name: "settings" }
  | { name: "activity" };

function routeToHash(route: Route): string {
  switch (route.name) {
    case "record":
      return "#/record";
    case "meetings":
      return "#/meetings";
    case "meeting": {
      const base = `#/meeting/${encodeURIComponent(route.runFolder)}`;
      return route.view ? `${base}/${route.view}` : base;
    }
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

function parseMeetingView(segment: string | undefined): MeetingView | undefined {
  if (segment === "workspace" || segment === "details") return segment;
  return undefined;
}

function routeFromHash(hash: string): Route | null {
  const normalized = hash.replace(/^#/, "");
  if (!normalized || normalized === "/" || normalized === "") {
    return null;
  }

  const parts = normalized.replace(/^\/+/, "").split("/");
  const [head, tail, extra] = parts;

  switch (head) {
    case "record":
      return { name: "record" };
    case "meetings":
      return { name: "meetings" };
    case "meeting":
      return tail
        ? { name: "meeting", runFolder: decodeURIComponent(tail), view: parseMeetingView(extra) }
        : null;
    case "prep":
      // Backward compat: #/prep/:runFolder[/view] maps to the unified meeting route
      return tail
        ? { name: "meeting", runFolder: decodeURIComponent(tail), view: parseMeetingView(extra) }
        : null;
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
  const [isDirty, setIsDirty] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<Route | null>(null);
  const [quickStarting, setQuickStarting] = useState(false);

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
        return;
      }

      const status = await api.recording.getStatus();
      if (!status.active) {
        navigate({ name: "record" });
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

  const onQuickStartNow = async () => {
    setQuickStarting(true);
    try {
      const d = new Date();
      const title = `Meeting - ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
      // Always create a draft workspace first, then start recording against
      // that draft. This eliminates the split-brain where Home could host a
      // live meeting without a folder.
      const draft = await api.runs.createDraft({ title });
      try {
        await api.recording.startForDraft({ runFolder: draft.run_folder });
      } catch (startErr) {
        // Leave the draft intact (user's title survives) and land in the
        // Workspace view so they can retry via Start recording.
        console.error("startForDraft failed after createDraft", startErr);
      }
      navigate({ name: "meeting", runFolder: draft.run_folder, view: "workspace" });
    } catch (err) {
      console.error("Quick start failed", err);
    } finally {
      setQuickStarting(false);
    }
  };

  const onQuickCreateDraft = async () => {
    try {
      const d = new Date();
      const title = `Meeting - ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
      const result = await api.runs.createDraft({ title });
      navigate({ name: "meeting", runFolder: result.run_folder });
    } catch (err) {
      console.error("Draft creation failed", err);
    }
  };

  const onQuickImport = async () => {
    try {
      const picked = await api.config.pickMediaFile();
      if (!picked) return;
      const baseName = picked.name.split(/[\\/]/).pop() ?? picked.name;
      const title = baseName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Imported meeting";
      const result = await api.runs.processMedia(picked.token, title);
      navigate({ name: "meeting", runFolder: result.run_folder });
    } catch (err) {
      console.error("Import failed", err);
    }
  };

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
          onStartNow={onQuickStartNow}
          onCreateDraft={onQuickCreateDraft}
          onImport={onQuickImport}
          quickStarting={quickStarting}
        />
        <SidebarInset>
          <SiteHeader
            section={routeLabel}
            title={route.name === "meeting" ? "Meeting" : routeLabel}
            subtitle={routeSubtitle}
            isDirty={isDirty}
          />
          <main className="flex min-h-0 flex-1 flex-col">
            {route.name === "record" && (
              <RecordView
                config={config}
                // Recent-meeting clicks and post-quick-start navigation: let
                // the shell's default-view resolver pick Workspace for
                // drafts/live and Details for completed/error meetings.
                onOpenMeeting={(runFolder) => navigate({ name: "meeting", runFolder })}
                // Prep flow explicitly targets the editing surface.
                onOpenPrep={(runFolder) => navigate({ name: "meeting", runFolder, view: "workspace" })}
                onViewAllMeetings={() => navigate({ name: "meetings" })}
              />
            )}
            {route.name === "meetings" && (
              <MeetingsList
                onOpen={(runFolder) => navigate({ name: "meeting", runFolder })}
                onOpenPrep={(runFolder) => navigate({ name: "meeting", runFolder })}
              />
            )}
            {route.name === "meeting" && (
              <MeetingShell
                runFolder={route.runFolder}
                initialView={route.view}
                recording={recording}
                config={config}
                onBack={() => navigate({ name: "meetings" })}
                onOpenMeeting={(runFolder) => navigate({ name: "meeting", runFolder })}
                onOpenPromptLibrary={(promptId) => navigate({ name: "prompts", promptId })}
                onViewChange={(view) => navigate({ name: "meeting", runFolder: route.runFolder, view })}
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
