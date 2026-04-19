import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      // Inset ring + border color swap (see ui/textarea.tsx for the
      // rationale — outer rings clip in tight overflow ancestors).
      className={cn(
        "flex h-9 w-full rounded-md border border-[var(--border-default)] bg-white px-3 py-1.5 text-sm text-[var(--text-primary)] shadow-sm transition-[box-shadow,border-color] duration-150 placeholder:text-[var(--text-tertiary)] focus-visible:outline-none focus-visible:border-[color:var(--ring)] focus-visible:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ring)_55%,transparent)]",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
