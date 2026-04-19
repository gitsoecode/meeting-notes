import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    // Focus state uses an **inset** ring plus a border color swap.
    // Outer rings (box-shadow or ring-offset) get clipped when the
    // element sits inside tight overflow ancestors (TabsContent, Dialog
    // bodies, PageScaffold scroll areas). An inset ring draws inside
    // the element's own rect, so it's always fully visible and never
    // requires parent padding to render cleanly.
    className={cn(
      "flex min-h-[80px] w-full rounded-md border border-[var(--border-default)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] shadow-sm transition-[box-shadow,border-color] duration-150 placeholder:text-[var(--text-tertiary)] focus-visible:outline-none focus-visible:border-[color:var(--ring)] focus-visible:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ring)_55%,transparent)]",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
