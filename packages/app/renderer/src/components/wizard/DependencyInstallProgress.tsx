import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, X } from "lucide-react";
import { api } from "../../ipc-client";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import {
  RAIL_STEPS,
  activePhaseFromLog,
  type RailPhase,
} from "./phaseMapping.mjs";
import type { InstallerProgressEvent } from "../../../../shared/ipc";

/**
 * Variation B install-progress panel for the dependencies wizard step.
 *
 * Layout: 200px step rail on the left (Parakeet auto-chain only) + a
 * fluid right pane with active-step header, current-download progress
 * bar, MB/s + ETA meta row, "View raw log" toggle, and Dismiss / Retry
 * controls. Single-phase installs (ffmpeg, Ollama, local-llm) render
 * the right-pane chrome only — no rail.
 *
 * Mount lifetime is owned by the parent (SetupWizard.tsx) per the plan:
 * mount when `installing !== null || installError !== null ||
 * installLog.length > 0`. The component itself never decides to unmount;
 * Dismiss simply clears `installError` + `installLog` in the parent.
 *
 * Honest progress labeling: `installer-progress` events only fire for
 * manifest downloads. Pip / model pull / venv build do NOT report bytes,
 * so the bar is hidden during non-download phases — the spinner +
 * step description carries the "still working" signal.
 */

type InstallTarget =
  | "ffmpeg"
  | "ollama"
  | "parakeet"
  | "local-llm"
  | "whisper-cli"
  | string;

interface Props {
  installing: InstallTarget | null;
  /**
   * The most recent install target — survives `installing` going back to
   * null on success/failure so the panel keeps rendering the right
   * variant (rail vs. collapsed) post-completion. Without it, a Parakeet
   * failure would lose the 4-step rail because `installing === null`.
   */
  lastInstallTarget: InstallTarget | null;
  installError: string | null;
  installLog: readonly string[];
  onDismiss: () => void;
  onRetry: () => void;
}

interface ProgressSample {
  /** Tool the bytes are for. Resets the EMA when this changes. */
  tool: string;
  /** Last byte counts emitted via `installer-progress`. */
  bytesDone: number;
  bytesTotal: number | null;
  /** Whether the active install is in a download phase right now. */
  inDownload: boolean;
  /** Renderer-side smoothed bytes/sec (EMA). */
  bytesPerSec: number;
  /** Wall-clock when this download started (for elapsed). */
  startedAt: number;
}

function emptyProgress(): ProgressSample {
  return {
    tool: "",
    bytesDone: 0,
    bytesTotal: null,
    inDownload: false,
    bytesPerSec: 0,
    startedAt: 0,
  };
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function humanRate(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return "—";
  return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
}

function humanEta(bytesRemaining: number, bytesPerSec: number): string {
  if (bytesPerSec <= 0 || bytesRemaining <= 0) return "—";
  const seconds = Math.round(bytesRemaining / bytesPerSec);
  if (seconds < 60) return `~${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `~${m}m ${s.toString().padStart(2, "0")}s`;
}

function humanElapsed(startedAt: number): string {
  if (!startedAt) return "—";
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Filter the raw log to "interesting" lines for the activity stream.
 * Includes phase boundaries (`→`), substep success (`✓`), substep
 * failure (`✘`), and the most recent ~3 raw lines preceding any
 * failure marker so the user sees diagnostic context inline.
 */
function activityStream(log: readonly string[], cap = 6): readonly string[] {
  const indices = new Set<number>();
  for (let i = 0; i < log.length; i++) {
    const line = log[i];
    if (!line) continue;
    const trimmed = line.trimStart();
    if (
      trimmed.startsWith("→") ||
      trimmed.startsWith("✓") ||
      trimmed.startsWith("✘")
    ) {
      indices.add(i);
      if (trimmed.startsWith("✘")) {
        // Pull in up to 3 preceding raw lines for failure context.
        for (let j = Math.max(0, i - 3); j < i; j++) indices.add(j);
      }
    }
  }
  const ordered = Array.from(indices).sort((a, b) => a - b).map((i) => log[i]);
  return ordered.slice(-cap);
}

export function DependencyInstallProgress(props: Props) {
  const { installing, lastInstallTarget, installError, installLog, onDismiss, onRetry } = props;

  const lifecycle: "active" | "complete" | "failed" = installing
    ? "active"
    : installError
      ? "failed"
      : "complete";

  // Rail visibility is driven by the *active or most-recent* install
  // target so Parakeet's 4-step rail stays visible post-failure (when
  // `installing === null`). The user expects the same chrome they were
  // staring at when the install blew up — losing the rail makes the
  // failure feel like a different surface entirely.
  const targetForVariant = installing ?? lastInstallTarget;
  const showRail = targetForVariant === "parakeet";
  const activePhase = useMemo<RailPhase | null>(
    () => activePhaseFromLog(installLog),
    [installLog]
  );

  // Subscribe to `installer-progress` and maintain a per-tool sample
  // with an EMA of bytes/sec. Reset on tool change so the bar doesn't
  // stick at 100% from the previous download.
  const [progress, setProgress] = useState<ProgressSample>(emptyProgress);
  const lastSampleRef = useRef<{ at: number; bytesDone: number } | null>(null);
  useEffect(() => {
    const unsub = api.on.installerProgress((event: InstallerProgressEvent) => {
      const isDownload = event.phase === "download";
      setProgress((prev) => {
        if (event.tool && event.tool !== prev.tool) {
          // New tool — start fresh.
          lastSampleRef.current = null;
          return {
            tool: event.tool,
            bytesDone: event.bytesDone ?? 0,
            bytesTotal: event.bytesTotal ?? null,
            inDownload: isDownload,
            bytesPerSec: 0,
            startedAt: Date.now(),
          };
        }
        if (!isDownload) {
          // Phase changed away from download — keep the tool but stop
          // showing the bar / meta row.
          return { ...prev, inDownload: false };
        }
        // Same tool, in download. Update bytes + EMA.
        const now = Date.now();
        const last = lastSampleRef.current;
        let bytesPerSec = prev.bytesPerSec;
        const newBytesDone = event.bytesDone ?? prev.bytesDone;
        if (last && now > last.at && newBytesDone >= last.bytesDone) {
          const dtSec = (now - last.at) / 1000;
          const inst = (newBytesDone - last.bytesDone) / dtSec;
          // Standard EMA, alpha=0.3 — heavy smoothing avoids jitter.
          bytesPerSec = prev.bytesPerSec
            ? prev.bytesPerSec * 0.7 + inst * 0.3
            : inst;
        }
        lastSampleRef.current = { at: now, bytesDone: newBytesDone };
        return {
          tool: prev.tool || event.tool,
          bytesDone: newBytesDone,
          bytesTotal: event.bytesTotal ?? prev.bytesTotal,
          inDownload: true,
          bytesPerSec,
          startedAt: prev.startedAt || Date.now(),
        };
      });
    });
    return unsub;
  }, []);

  // Reset the progress sample when an install starts/finishes so a
  // stale 100% bar from a previous run doesn't bleed into the next.
  useEffect(() => {
    if (installing === null) {
      setProgress(emptyProgress());
      lastSampleRef.current = null;
    }
  }, [installing]);

  const [showRawLog, setShowRawLog] = useState(false);
  const rawLogRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (showRawLog && rawLogRef.current) {
      rawLogRef.current.scrollTop = rawLogRef.current.scrollHeight;
    }
  }, [showRawLog, installLog]);

  const stream = useMemo(() => activityStream(installLog), [installLog]);

  const headerTitle =
    lifecycle === "active"
      ? installing === "parakeet"
        ? "Installing Parakeet"
        : `Installing ${installing}`
      : lifecycle === "failed"
        ? targetForVariant === "parakeet"
          ? "Parakeet install failed"
          : "Install failed"
        : "Install complete";

  const headerCopy =
    lifecycle === "active"
      ? installing === "parakeet"
        ? "About a minute or two left. You can leave this running — it'll keep going if you switch tabs."
        : "Downloading and verifying. Cancellable any time."
      : lifecycle === "failed"
        ? "Details below — Retry to try again, or Dismiss to close this panel."
        : "Ready.";

  const pct =
    progress.bytesTotal && progress.bytesTotal > 0
      ? Math.round((progress.bytesDone / progress.bytesTotal) * 100)
      : null;

  return (
    <section
      data-testid="dep-install-progress"
      className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)]"
    >
      <header className="px-4 pt-4 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {headerTitle}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              {headerCopy}
            </p>
          </div>
          {lifecycle !== "active" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onDismiss}
              className="h-7 gap-1 text-xs text-[var(--text-secondary)]"
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" />
              Dismiss
            </Button>
          )}
        </div>
      </header>

      <div
        className={
          showRail
            ? "grid grid-cols-[200px_1fr] border-t border-[var(--border-subtle)]"
            : "border-t border-[var(--border-subtle)]"
        }
      >
        {showRail && (
          <aside className="bg-[var(--bg-secondary)] p-4">
            <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
              Parakeet auto-chain
            </div>
            <ol className="space-y-2">
              {RAIL_STEPS.map((step) => {
                const status: "done" | "active" | "pending" = activePhase
                  ? RAIL_STEPS.findIndex((s) => s.phase === step.phase) <
                    RAIL_STEPS.findIndex((s) => s.phase === activePhase)
                    ? "done"
                    : step.phase === activePhase
                      ? "active"
                      : "pending"
                  : "pending";
                return (
                  <li
                    key={step.phase}
                    className="flex items-start gap-2"
                    data-rail-phase={step.phase}
                    data-rail-status={status}
                  >
                    <span
                      className={
                        status === "done"
                          ? "mt-1 inline-flex h-3 w-3 items-center justify-center rounded-full bg-[var(--accent)] text-white"
                          : status === "active"
                            ? "mt-1 inline-flex h-3 w-3 items-center justify-center rounded-full border-[1.5px] border-[var(--accent)]"
                            : "mt-1 inline-flex h-3 w-3 items-center justify-center rounded-full border-[1.5px] border-[var(--border-strong)]"
                      }
                    >
                      {status === "done" ? (
                        <CheckCircle2 className="h-2.5 w-2.5" />
                      ) : status === "active" ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                      ) : null}
                    </span>
                    <div className="flex-1">
                      <div
                        className={
                          status === "active"
                            ? "text-xs font-semibold text-[var(--text-primary)]"
                            : status === "pending"
                              ? "text-xs text-[var(--text-tertiary)]"
                              : "text-xs text-[var(--text-primary)]"
                        }
                      >
                        {step.label}
                      </div>
                      <div className="font-mono text-[10px] text-[var(--text-tertiary)]">
                        {step.sub}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </aside>
        )}

        <section className="p-4 space-y-4">
          {/* Active step header / progress bar / meta */}
          {lifecycle === "active" && (
            <>
              {progress.inDownload && pct !== null ? (
                <div className="space-y-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
                    <div
                      className="h-full bg-[var(--accent)] transition-[width] duration-200"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between font-mono text-[11px] text-[var(--text-tertiary)]">
                    <span>
                      Current download: {humanBytes(progress.bytesDone)} /{" "}
                      {progress.bytesTotal
                        ? humanBytes(progress.bytesTotal)
                        : "?"}{" "}
                      · {humanRate(progress.bytesPerSec)}
                    </span>
                    <span>
                      {humanEta(
                        (progress.bytesTotal ?? 0) - progress.bytesDone,
                        progress.bytesPerSec
                      )}{" "}
                      left
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <Spinner className="h-3.5 w-3.5" />
                  {progress.tool
                    ? `Working on ${progress.tool}…`
                    : "Working…"}
                </div>
              )}

              {showRail && (
                <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--border-subtle)]">
                  {[
                    { label: "Elapsed", value: humanElapsed(progress.startedAt) },
                    {
                      label: "Current step",
                      value:
                        RAIL_STEPS.find((s) => s.phase === activePhase)?.label ??
                        "—",
                    },
                    { label: "Total install", value: "~1.0 GB" },
                  ].map((cell) => (
                    <div key={cell.label} className="bg-[var(--bg-primary)] px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
                        {cell.label}
                      </div>
                      <div className="font-mono text-xs text-[var(--text-primary)]">
                        {cell.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {lifecycle === "complete" && (
            <div className="flex items-center gap-2 text-sm text-[var(--success,#15803d)]">
              <CheckCircle2 className="h-4 w-4" />
              Install completed successfully.
            </div>
          )}

          {lifecycle === "failed" && (
            <div className="space-y-2">
              <p className="text-sm text-[var(--error)]">{installError}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="default" onClick={onRetry}>
                  Retry
                </Button>
              </div>
            </div>
          )}

          {/* Activity / raw log */}
          {(stream.length > 0 || installLog.length > 0) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
                  Activity
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 text-[11px] text-[var(--text-secondary)]"
                  onClick={() => setShowRawLog((v) => !v)}
                  data-testid="toggle-raw-log"
                >
                  {showRawLog ? "Hide raw log" : "View raw log"}
                </Button>
              </div>
              {showRawLog ? (
                <pre
                  ref={rawLogRef}
                  className="max-h-52 overflow-auto rounded-md border border-[var(--border-default)] bg-[var(--text-primary)] px-3 py-2 font-mono text-[11px] leading-5 text-[rgba(255,255,255,0.88)]"
                  data-testid="raw-log"
                >
                  {installLog.join("\n")}
                </pre>
              ) : (
                <ul className="space-y-1">
                  {stream.map((line, i) => (
                    <li
                      key={i}
                      className="font-mono text-[11px] text-[var(--text-secondary)]"
                    >
                      {line.trim()}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
