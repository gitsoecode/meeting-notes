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
import { ChatView, type ChatSubview } from "./routes/ChatView";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { GistlistMark } from "./components/GistlistMark";
import { AppSidebar } from "./components/AppSidebar";
import { SiteHeader } from "./components/SiteHeader";
import { SidebarInset, SidebarMain, SidebarProvider } from "./components/ui/sidebar";

export type MeetingView = "workspace" | "details";

type DetailsTabKind =
  | "metadata"
  | "summary"
  | "analysis"
  | "transcript"
  | "recording"
  | "files";

type Route =
  | { name: "record" }
  | { name: "meetings" }
  | {
      name: "meeting";
      runFolder: string;
      view?: MeetingView;
      initialSeekMs?: number;
      /** Pre-selected inner tab (Details view) when opening via a chat citation. */
      initialTabId?: DetailsTabKind;
    }
  | { name: "prompts"; promptId?: string }
  | { name: "settings" }
  | { name: "activity" }
  | { name: "chat"; subview?: ChatSubview };

function routeToHash(route: Route): string {
  switch (route.name) {
    case "record":
      return "#/record";
    case "meetings":
      return "#/meetings";
    case "meeting": {
      const base = `#/meeting/${encodeURIComponent(route.runFolder)}`;
      const withView = route.view ? `${base}/${route.view}` : base;
      const params = new URLSearchParams();
      if (route.initialSeekMs != null) params.set("t", String(route.initialSeekMs));
      if (route.initialTabId) params.set("tab", route.initialTabId);
      const query = params.toString();
      return query ? `${withView}?${query}` : withView;
    }
    case "prompts":
      return route.promptId
        ? `#/prompts/${encodeURIComponent(route.promptId)}`
        : "#/prompts";
    case "settings":
      return "#/settings";
    case "activity":
      return "#/activity";
    case "chat": {
      if (!route.subview || route.subview.kind === "empty") return "#/chat";
      if (route.subview.kind === "all-threads") return "#/chat/all";
      return `#/chat/t/${encodeURIComponent(route.subview.threadId)}`;
    }
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

  // Strip (and capture) a `?t=...&tab=...` query suffix.
  const queryIndex = normalized.indexOf("?");
  const pathPart = queryIndex === -1 ? normalized : normalized.slice(0, queryIndex);
  const queryStr = queryIndex === -1 ? "" : normalized.slice(queryIndex + 1);
  const query = new URLSearchParams(queryStr);
  const tParam = query.get("t");
  const initialSeekMs =
    tParam != null && Number.isFinite(Number(tParam)) ? Number(tParam) : undefined;
  const tabParam = query.get("tab");
  const VALID_TABS = new Set<DetailsTabKind>([
    "metadata",
    "summary",
    "analysis",
    "transcript",
    "recording",
    "files",
  ]);
  const initialTabId =
    tabParam && VALID_TABS.has(tabParam as DetailsTabKind)
      ? (tabParam as DetailsTabKind)
      : undefined;

  const parts = pathPart.replace(/^\/+/, "").split("/");
  const [head, tail, extra] = parts;

  switch (head) {
    case "record":
      return { name: "record" };
    case "meetings":
      return { name: "meetings" };
    case "meeting":
      return tail
        ? {
            name: "meeting",
            runFolder: decodeURIComponent(tail),
            view: parseMeetingView(extra),
            initialSeekMs,
            initialTabId,
          }
        : null;
    case "prep":
      // Backward compat: #/prep/:runFolder[/view] maps to the unified meeting route
      return tail
        ? {
            name: "meeting",
            runFolder: decodeURIComponent(tail),
            view: parseMeetingView(extra),
            initialSeekMs,
            initialTabId,
          }
        : null;
    case "prompts":
      return tail ? { name: "prompts", promptId: decodeURIComponent(tail) } : { name: "prompts" };
    case "settings":
      return { name: "settings" };
    case "activity":
      return { name: "activity" };
    case "chat": {
      if (!tail) return { name: "chat", subview: { kind: "empty" } };
      if (tail === "all") return { name: "chat", subview: { kind: "all-threads" } };
      if (tail === "t" && extra)
        return {
          name: "chat",
          subview: { kind: "thread", threadId: decodeURIComponent(extra) },
        };
      return { name: "chat", subview: { kind: "empty" } };
    }
    default:
      return null;
  }
}

type NavState = {
  stack: Route[];
  cursor: number;
};

type PendingNav = { state: NavState } | null;

export function App() {
  const [config, setConfig] = useState<AppConfigDTO | null | undefined>(undefined);
  const [recording, setRecording] = useState<RecordingStatus>({ active: false });
  const [nav, setNav] = useState<NavState>(() => {
    const initial = routeFromHash(window.location.hash) ?? { name: "record" };
    return { stack: [initial], cursor: 0 };
  });
  const route = nav.stack[nav.cursor];
  const canGoBack = nav.cursor > 0;
  const canGoForward = nav.cursor < nav.stack.length - 1;
  const [isDirty, setIsDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState<PendingNav>(null);
  const [quickStarting, setQuickStarting] = useState(false);

  const isDirtyRef = useRef(false);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  const applyNav = useCallback((next: NavState) => {
    setNav(next);
    setIsDirty(false);
  }, []);

  const requestNav = useCallback(
    (next: NavState) => {
      if (isDirtyRef.current) {
        setPendingNav({ state: next });
        return;
      }
      applyNav(next);
    },
    [applyNav],
  );

  const navigate = useCallback(
    (nextRoute: Route, opts?: { replace?: boolean }) => {
      setNav((current) => {
        const currentRoute = current.stack[current.cursor];
        if (routeToHash(currentRoute) === routeToHash(nextRoute)) {
          // No-op: same route, skip stack push.
          return current;
        }
        const nextStack = opts?.replace
          ? [...current.stack.slice(0, current.cursor), nextRoute, ...current.stack.slice(current.cursor + 1)]
          : [...current.stack.slice(0, current.cursor + 1), nextRoute];
        const nextCursor = opts?.replace ? current.cursor : nextStack.length - 1;
        const nextState: NavState = { stack: nextStack, cursor: nextCursor };
        if (isDirtyRef.current) {
          setPendingNav({ state: nextState });
          return current;
        }
        setIsDirty(false);
        return nextState;
      });
    },
    [],
  );

  const goBack = useCallback(() => {
    if (nav.cursor === 0) return;
    requestNav({ stack: nav.stack, cursor: nav.cursor - 1 });
  }, [nav, requestNav]);

  const goForward = useCallback(() => {
    if (nav.cursor >= nav.stack.length - 1) return;
    requestNav({ stack: nav.stack, cursor: nav.cursor + 1 });
  }, [nav, requestNav]);

  useEffect(() => {
    const nextHash = routeToHash(route);
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }, [route]);

  const confirmNavigation = () => {
    if (pendingNav) {
      applyNav(pendingNav.state);
      setPendingNav(null);
    }
  };

  const cancelNavigation = () => {
    setPendingNav(null);
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
    // Install the test hook unconditionally. Previously we only filled an
    // existing stub (created by the mocked-e2e harness), but live Electron
    // tests don't preload a stub — they still need a reliable way to
    // drive the renderer router without racing hashchange listeners.
    // Exposing navigate() + navigateRoute() to window is safe: production
    // never calls them.
    if (!target.__MEETING_NOTES_TEST) target.__MEETING_NOTES_TEST = {};
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
      case "chat":
        return "Chat";
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

  const handleOpenMeetingFromChat = useCallback(
    async (
      runId: string,
      startMs: number | null,
      source?: "transcript" | "summary" | "prep" | "notes",
    ) => {
      try {
        const all = await api.runs.list();
        const row = all.find((r) => r.run_id === runId);
        if (!row) return;
        // Map the citation source to the right meeting view + tab.
        //   - transcript / summary: Details view, corresponding tab.
        //   - prep / notes: Workspace view, where those surfaces live.
        //   - a seek-ms always wins and forces Details → Transcript
        //     (seek-on-mount logic in MeetingShell handles the audio).
        let view: MeetingView = "details";
        let initialTabId: DetailsTabKind | undefined;
        if (startMs != null) {
          view = "details";
          initialTabId = "transcript";
        } else if (source === "prep" || source === "notes") {
          view = "workspace";
          initialTabId = undefined;
        } else if (source === "summary") {
          view = "details";
          initialTabId = "summary";
        } else if (source === "transcript") {
          view = "details";
          initialTabId = "transcript";
        } else {
          view = "details";
          initialTabId = "metadata";
        }
        navigate({
          name: "meeting",
          runFolder: row.folder_path,
          view,
          initialSeekMs: startMs ?? undefined,
          initialTabId,
        });
      } catch (err) {
        console.error("Open meeting from chat failed", err);
      }
    },
    [navigate],
  );

  if (config === undefined) {
    return (
      <div className="loading-splash bg-[var(--bg-secondary)]">
        <div className="space-y-3 text-center">
          <GistlistMark />
          <div className="text-sm text-[var(--text-secondary)]">Loading Gistlist…</div>
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
          "--sidebar-width": "224px",
          "--header-height": "3rem",
        } as React.CSSProperties
      }
    >
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
            recording={recording}
            onJumpToRecording={(runFolder) =>
              navigate({ name: "meeting", runFolder, view: "workspace" })
            }
            onGoBack={goBack}
            onGoForward={goForward}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
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
                initialSeekMs={route.initialSeekMs}
                initialTabId={route.initialTabId}
                recording={recording}
                config={config}
                onBack={() => navigate({ name: "meetings" })}
                onOpenMeeting={(runFolder) => navigate({ name: "meeting", runFolder })}
                onOpenPromptLibrary={(promptId) => navigate({ name: "prompts", promptId })}
                onViewChange={(view, opts) => navigate({ name: "meeting", runFolder: route.runFolder, view }, opts)}
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
            {route.name === "chat" && (
              <ChatView
                subview={route.subview ?? { kind: "empty" }}
                onSubviewChange={(sv) =>
                  navigate({ name: "chat", subview: sv }, { replace: true })
                }
                onOpenMeetingAt={handleOpenMeetingFromChat}
              />
            )}
          </main>
        </SidebarInset>
      </SidebarMain>

      <ConfirmDialog
        open={!!pendingNav}
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
