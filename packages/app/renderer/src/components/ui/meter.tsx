import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * A compact level meter. Renders a horizontal bar whose fill width reflects
 * `value` (0–100). An optional `peak` draws a thin tick at that percent,
 * useful for peak-hold displays on audio meters.
 *
 * The default fill is a green→amber→red gradient calibrated for the app's
 * dB scale: at low RMS the bar looks green; as it fills past ~70% (≈ −18 dB)
 * it shifts through amber; above ~92% (≈ −6 dB) it is red. Callers can
 * override the fill with `fillColor` for non-audio use.
 *
 * When `active={false}`, the bar dims to signal a paused/idle state without
 * disappearing. Empty-state captions (e.g., "Listening…") should be rendered
 * as children — they are centered absolutely on top of the bar.
 */
const meterVariants = cva(
  "relative w-full overflow-hidden rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]",
  {
    variants: {
      size: {
        xs: "h-1",
        sm: "h-1.5",
        default: "h-3",
        lg: "h-4",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
);

const DEFAULT_FILL_GRADIENT =
  "linear-gradient(to right, var(--success, #10b981), var(--warning, #f59e0b) 70%, var(--danger, #ef4444) 92%)";

export interface MeterProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children">,
    VariantProps<typeof meterVariants> {
  /** Bar fill percent, 0–100. Clamped. */
  value: number;
  /** Optional peak percent overlay, 0–100. Clamped. */
  peak?: number;
  /** When false, the bar dims to a muted idle state. */
  active?: boolean;
  /** Override the fill background (solid color or gradient string). */
  fillColor?: string;
  /** Overlay content (captions like "Listening…"). Centered absolutely. */
  children?: React.ReactNode;
}

export const Meter = React.forwardRef<HTMLDivElement, MeterProps>(
  ({ className, value, peak, active = true, size, fillColor, children, ...props }, ref) => {
    const clamp = (n: number) => Math.min(100, Math.max(0, n));
    const fillPct = clamp(value);
    const peakPct = peak == null ? null : clamp(peak);

    return (
      <div
        ref={ref}
        className={cn(
          meterVariants({ size, className }),
          !active && "opacity-60"
        )}
        {...props}
      >
        <div
          className="absolute inset-y-0 left-0 transition-[width] duration-75 ease-out"
          style={{
            width: `${fillPct}%`,
            background: active ? (fillColor ?? DEFAULT_FILL_GRADIENT) : "var(--border-subtle)",
          }}
        />
        {peakPct != null && peakPct > 0 && active ? (
          <div
            className="absolute inset-y-0 w-[1.5px] bg-[var(--text-primary)]/60 transition-[left] duration-75 ease-out"
            style={{ left: `calc(${peakPct}% - 1px)` }}
          />
        ) : null}
        {children ? (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {children}
          </div>
        ) : null}
      </div>
    );
  }
);
Meter.displayName = "Meter";
