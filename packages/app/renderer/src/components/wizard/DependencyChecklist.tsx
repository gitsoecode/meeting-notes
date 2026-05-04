import { CheckCircle2, Circle, XCircle, MinusCircle } from "lucide-react";
import { Spinner } from "../ui/spinner";
import { Button } from "../ui/button";
import type {
  DepId,
  ProgressSnapshot,
  RequiredInstall,
  RowState,
} from "./installChain.types";

interface Props {
  plan: readonly RequiredInstall[];
  rows: Record<DepId, RowState>;
  /**
   * Active install id (matches `useInstallChain.currentId`). Used only
   * to surface a per-row Cancel affordance for the cancellable dep
   * (Parakeet today). The chain itself owns the chain-level cancel
   * button in the wizard footer.
   */
  currentId: DepId | null;
  /** Per-row Retry handler. Triggered when the user clicks Retry on a failed row. */
  onRetry: () => void;
}

export function DependencyChecklist({ plan, rows, onRetry }: Props) {
  return (
    <ul
      data-testid="dependency-checklist"
      className="flex flex-col divide-y divide-[var(--border-subtle)] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]"
    >
      {plan.map((item) => (
        <DependencyRow
          key={item.id}
          item={item}
          state={rows[item.id] ?? { kind: "pending" }}
          onRetry={onRetry}
        />
      ))}
    </ul>
  );
}

function DependencyRow({
  item,
  state,
  onRetry,
}: {
  item: RequiredInstall;
  state: RowState;
  onRetry: () => void;
}) {
  return (
    <li
      data-testid={`dep-row-${item.id}`}
      data-state={state.kind}
      className="flex flex-col gap-2 px-4 py-3"
    >
      <div className="flex items-center gap-3">
        <StateIcon state={state} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[var(--text-primary)]">
            {item.name}
          </div>
          <RowSubtitle item={item} state={state} />
        </div>
        <RowAction state={state} onRetry={onRetry} />
      </div>
      {state.kind === "running" && state.progress ? (
        <ProgressBar progress={state.progress} />
      ) : null}
      {state.kind === "failed" ? (
        <p
          className="text-xs leading-5 text-[var(--error)]"
          data-testid={`dep-row-${item.id}-error`}
        >
          {state.error}
        </p>
      ) : null}
    </li>
  );
}

function StateIcon({ state }: { state: RowState }) {
  // Icon glyphs match the row state:
  //   ready/done → green check
  //   pending    → muted empty circle
  //   running    → spinner
  //   failed     → red X
  //   cancelled  → muted minus
  //
  // Color comes from the icon's wrapping class; the lucide glyph itself
  // is a stroke-only outline so the color override applies.
  const className = "h-4 w-4 shrink-0";
  switch (state.kind) {
    case "ready":
    case "done":
      return (
        <CheckCircle2
          className={`${className} text-[var(--success)]`}
          aria-label="Ready"
        />
      );
    case "running":
      return <Spinner className={className} aria-label="Installing" />;
    case "failed":
      return (
        <XCircle
          className={`${className} text-[var(--error)]`}
          aria-label="Failed"
        />
      );
    case "cancelled":
      return (
        <MinusCircle
          className={`${className} text-[var(--text-tertiary)]`}
          aria-label="Cancelled"
        />
      );
    case "pending":
    default:
      return (
        <Circle
          className={`${className} text-[var(--text-tertiary)]`}
          aria-label="Pending"
        />
      );
  }
}

function RowSubtitle({
  item,
  state,
}: {
  item: RequiredInstall;
  state: RowState;
}) {
  const className = "text-xs text-[var(--text-secondary)]";
  switch (state.kind) {
    case "ready":
      return <span className={className}>Already installed</span>;
    case "done":
      return <span className={className}>Installed</span>;
    case "pending":
      return (
        <span className={className}>
          Pending · {humanBytes(item.estimatedBytes)}
        </span>
      );
    case "running":
      return (
        <span className={className}>
          {state.progress?.label ??
            state.progress?.phase ??
            `Installing… (${humanBytes(item.estimatedBytes)})`}
        </span>
      );
    case "failed":
      return <span className={className}>Failed</span>;
    case "cancelled":
      return <span className={className}>Cancelled</span>;
    default:
      return null;
  }
}

function RowAction({
  state,
  onRetry,
}: {
  state: RowState;
  onRetry: () => void;
}) {
  if (state.kind !== "failed") return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onRetry}
      data-testid="dep-row-retry"
    >
      Retry
    </Button>
  );
}

function ProgressBar({ progress }: { progress: ProgressSnapshot }) {
  // Three rendering modes, picked by which fields the snapshot has:
  //   1. bytes.total known    → byte progress bar + done/total · speed · eta
  //   2. percent only          → percent bar + XX%
  //   3. neither               → indeterminate (no bar; the spinner above
  //                              + phase label carry the "still working" signal)
  if (progress.bytes && progress.bytes.total) {
    const pct = Math.min(
      100,
      Math.max(0, Math.round((progress.bytes.done / progress.bytes.total) * 100))
    );
    return (
      <div className="ml-7 space-y-1">
        <Bar pct={pct} />
        <div className="flex items-center justify-between text-[11px] text-[var(--text-tertiary)]">
          <span>
            {humanBytes(progress.bytes.done)} / {humanBytes(progress.bytes.total)}
            {progress.speed ? ` · ${humanRate(progress.speed)}` : ""}
          </span>
          {progress.eta ? <span>{humanEta(progress.eta)}</span> : null}
        </div>
      </div>
    );
  }
  if (typeof progress.percent === "number") {
    const pct = Math.min(100, Math.max(0, Math.round(progress.percent)));
    return (
      <div className="ml-7 space-y-1">
        <Bar pct={pct} />
        <div className="text-[11px] text-[var(--text-tertiary)]">{pct}%</div>
      </div>
    );
  }
  return null;
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded bg-[var(--bg-tertiary)]">
      <div
        className="h-full bg-[var(--accent)] transition-[width] duration-200"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function humanBytes(n: number): string {
  if (n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function humanRate(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return "—";
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
}

function humanEta(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 60) return `~${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `~${m}m ${s.toString().padStart(2, "0")}s`;
}
