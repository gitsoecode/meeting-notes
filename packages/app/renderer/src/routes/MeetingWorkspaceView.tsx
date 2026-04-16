import { useEffect, useRef, useState } from "react";
import { PanelLeft, PanelLeftClose } from "lucide-react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import type { RecordingStatus } from "../../../shared/ipc";
import { LiveChannelMeters } from "../components/LiveChannelMeters";
import { MarkdownEditor } from "../components/MarkdownEditor";
import {
  PipelineStatus,
  type PromptOutputStatus,
} from "../components/PipelineStatus";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../components/ui/resizable";
import { Button } from "../components/ui/button";

export interface MeetingWorkspaceViewProps {
  /** Shell-owned prep buffer and its debounced setter. */
  prepNotes: string;
  onPrepChange: (value: string) => void;
  /** Shell-owned notes buffer and its debounced setter. */
  notes: string;
  onNotesChange: (value: string) => void;
  /** Sync-on-blur callback so closing Crepe immediately persists. */
  onNotesBlur: () => void;

  /** Lifecycle flags — drive the live-capture strip and Notes header label. */
  isLive: boolean;
  isRecording: boolean;
  recording: RecordingStatus;
  sections: PromptOutputStatus[];
}

const PREP_SIZE_KEY = "meeting-workspace.prep-size";
const PREP_MIN_PCT = 25;
const PREP_MAX_PCT = 75;
const DEFAULT_PREP_PCT = 40;

function readInitialPrepSize(): number {
  if (typeof window === "undefined") return DEFAULT_PREP_PCT;
  try {
    const raw = window.localStorage.getItem(PREP_SIZE_KEY);
    if (raw == null) return DEFAULT_PREP_PCT;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_PREP_PCT;
    return Math.min(PREP_MAX_PCT, Math.max(PREP_MIN_PCT, parsed));
  } catch {
    return DEFAULT_PREP_PCT;
  }
}

/**
 * Workspace view — always-visible Prep + Notes split pane. Prep is unlocked
 * by default. When `isLive` is true, renders the capture-health strip and
 * pipeline-progress below the panes.
 *
 * Prep panel collapse/expand uses the imperative `ImperativePanelHandle`
 * API from `react-resizable-panels`. Conditional rendering would unmount
 * Notes (sibling child-count change) and drop its cursor/undo state. We keep
 * Prep mounted and toggle size instead. The last dragged size is persisted
 * to localStorage so it survives reload.
 */
export function MeetingWorkspaceView({
  prepNotes,
  onPrepChange,
  notes,
  onNotesChange,
  onNotesBlur,
  isLive,
  isRecording,
  recording,
  sections,
}: MeetingWorkspaceViewProps) {
  const [showPrep, setShowPrep] = useState(true);
  const [prepSizePct] = useState<number>(readInitialPrepSize);
  const prepPanelRef = useRef<ImperativePanelHandle>(null);
  // Suppress onResize writes during imperative collapse/expand — those fire
  // 0 and prepSizePct which would otherwise overwrite the user's dragged
  // size. A ref is cleared in a microtask after the imperative call.
  const suppressResizeWriteRef = useRef(false);

  // Imperative toggle. Expand uses the stored size; collapse goes to 0 without
  // unmounting. Writes are suppressed for both since they're programmatic.
  useEffect(() => {
    const panel = prepPanelRef.current;
    if (!panel) return;
    suppressResizeWriteRef.current = true;
    if (showPrep) {
      panel.expand();
      // Defensively resize to the stored pct so first expand after a reload
      // restores the user's previous split.
      panel.resize(prepSizePct);
    } else {
      panel.collapse();
    }
    // Release on next tick so legitimate drag-resizes (which fire after the
    // synchronous imperative call finishes) are persisted.
    const id = window.setTimeout(() => {
      suppressResizeWriteRef.current = false;
    }, 0);
    return () => window.clearTimeout(id);
  }, [showPrep, prepSizePct]);

  const handlePrepResize = (size: number) => {
    if (suppressResizeWriteRef.current) return;
    if (!showPrep) return;
    const clamped = Math.min(PREP_MAX_PCT, Math.max(PREP_MIN_PCT, size));
    try {
      window.localStorage.setItem(PREP_SIZE_KEY, String(clamped));
    } catch {
      // localStorage can be unavailable (private mode, quota, etc.) — OK to skip.
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <ResizablePanelGroup
        direction="horizontal"
        className="flex-1 min-h-0 rounded-lg border border-[var(--border-subtle)] bg-white"
      >
        <ResizablePanel
          ref={prepPanelRef}
          id="prep-panel"
          order={1}
          defaultSize={prepSizePct}
          minSize={PREP_MIN_PCT}
          collapsible
          collapsedSize={0}
          onResize={handlePrepResize}
        >
          <div className="flex h-full flex-col">
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">Prep</span>
            </div>
            <div className="flex-1 min-h-0">
              <MarkdownEditor value={prepNotes} onChange={onPrepChange} />
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel id="notes-panel" order={2} defaultSize={100 - prepSizePct} minSize={PREP_MIN_PCT}>
          <div className="flex h-full flex-col">
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {isLive ? "Live notes" : "Notes"}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 p-0"
                aria-label={showPrep ? "Hide prep pane" : "Show prep pane"}
                title={showPrep ? "Hide prep pane" : "Show prep pane"}
                onClick={() => setShowPrep((v) => !v)}
              >
                {showPrep ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeft className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <div className="flex-1 min-h-0">
              <MarkdownEditor
                value={notes}
                onChange={onNotesChange}
                onBlur={onNotesBlur}
              />
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {isLive && (
        <div className="shrink-0 space-y-2">
          <div className="flex items-center gap-4 text-sm text-[var(--text-secondary)]">
            <LiveChannelMeters isRecording={isRecording} systemCapturing={recording.system_captured === true} />
            <span className={recording.system_captured ? "" : "text-[var(--warning-text)]"}>
              {recording.system_captured ? "System audio capturing" : "System audio not available"}
            </span>
          </div>
          {recording.system_audio_warning && (
            <div className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-muted)] px-4 py-3 text-sm text-[var(--warning-text)]">
              {recording.system_audio_warning}
            </div>
          )}
          {sections.length > 0 && <PipelineStatus sections={sections} title="Live processing" />}
        </div>
      )}
    </div>
  );
}
