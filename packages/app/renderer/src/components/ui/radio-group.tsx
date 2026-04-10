import * as React from "react";
import { Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export const RadioGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} role="radiogroup" className={cn("grid gap-2", className)} {...props} />
));
RadioGroup.displayName = "RadioGroup";

interface RadioGroupItemProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: React.ReactNode;
  description?: React.ReactNode;
}

export const RadioGroupItem = React.forwardRef<HTMLInputElement, RadioGroupItemProps>(
  ({ className, label, description, id, checked, disabled, ...props }, ref) => (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border-default)] bg-white px-4 py-3 transition-colors",
        checked
          ? "border-[var(--accent)] bg-[var(--bg-secondary)]"
          : "hover:bg-[var(--bg-secondary)]/70",
        disabled && "cursor-not-allowed opacity-60",
        className
      )}
    >
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)]">
        {checked ? <Circle className="h-2.5 w-2.5 fill-[var(--accent)] text-[var(--accent)]" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <input
          ref={ref}
          id={id}
          type="radio"
          className="sr-only"
          checked={checked}
          disabled={disabled}
          {...props}
        />
        <span className="block text-sm font-medium text-[var(--text-primary)]">{label}</span>
        {description ? (
          <span className="mt-1 block text-sm leading-6 text-[var(--text-secondary)]">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  )
);
RadioGroupItem.displayName = "RadioGroupItem";
