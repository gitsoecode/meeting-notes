import { Badge } from "./ui/badge";
import { SidebarTrigger } from "./ui/sidebar";
import { AlertCircle, ArrowLeft, ArrowRight } from "lucide-react";
import type { RecordingStatus } from "../../../shared/ipc";
import { useElapsedLabel } from "../hooks/useElapsedLabel";

interface SiteHeaderProps {
  section: string;
  title: string;
  subtitle?: string;
  isDirty?: boolean;
  recording?: RecordingStatus;
  onJumpToRecording?: (runFolder: string) => void;
  onGoBack?: () => void;
  onGoForward?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
}

export function SiteHeader({
  title,
  subtitle,
  isDirty,
  recording,
  onJumpToRecording,
  onGoBack,
  onGoForward,
  canGoBack = false,
  canGoForward = false,
}: SiteHeaderProps) {
  const isRecordingActive = !!recording?.active && !recording?.paused;
  const elapsedLabel = useElapsedLabel(recording ?? { active: false }, isRecordingActive);
  const runFolder = recording?.run_folder;

  return (
    <header className="sticky top-0 z-20 flex h-[var(--header-height,3rem)] shrink-0 items-center border-b border-[var(--border-subtle)] bg-[rgba(249,250,246,0.88)] backdrop-blur [-webkit-app-region:drag]">
      <div className="flex w-full items-center gap-3 px-4 md:px-6">
        <SidebarTrigger />
        <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
          <button
            type="button"
            onClick={onGoBack}
            className="rounded-md p-1 text-[var(--text-secondary)] transition-colors hover:bg-black/5 hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--text-secondary)]"
            aria-label="Go back"
            disabled={!canGoBack}
          >
            <ArrowLeft className="h-[1.125rem] w-[1.125rem]" />
          </button>
          <button
            type="button"
            onClick={onGoForward}
            className="rounded-md p-1 text-[var(--text-secondary)] transition-colors hover:bg-black/5 hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--text-secondary)]"
            aria-label="Go forward"
            disabled={!canGoForward}
          >
            <ArrowRight className="h-[1.125rem] w-[1.125rem]" />
          </button>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="shrink-0 text-base font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
            {title}
          </h1>
          {subtitle && (
            <span className="hidden truncate text-sm font-normal text-[var(--text-tertiary)] lg:inline">
              — {subtitle}
            </span>
          )}
          {isDirty && (
            <Badge variant="warning" className="flex animate-pulse items-center gap-1 border-[var(--warning)]/30 bg-[var(--warning-muted)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--warning-text)]">
              <AlertCircle className="h-3.5 w-3.5" />
              Unsaved
            </Badge>
          )}
        </div>

        {recording?.active && runFolder && (
          <button
            type="button"
            onClick={() => onJumpToRecording?.(runFolder)}
            className="flex shrink-0 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-white px-3 py-1.5 text-xs font-medium shadow-sm transition-colors hover:bg-gray-50 [-webkit-app-region:no-drag]"
            aria-label="Jump to recording in progress"
          >
            {recording.paused ? (
              <>
                <span className="inline-flex h-2 w-2 rounded-full bg-[var(--warning)]" />
                <span>Paused · {elapsedLabel || "—"}</span>
              </>
            ) : (
              <>
                <span className="relative inline-flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
                <span>Recording · {elapsedLabel}</span>
              </>
            )}
          </button>
        )}
      </div>
    </header>
  );
}
