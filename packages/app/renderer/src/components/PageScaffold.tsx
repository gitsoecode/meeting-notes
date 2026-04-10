import * as React from "react";
import { Badge } from "./ui/badge";
import { cn } from "@/lib/utils";

export function PageScaffold({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("@container/main flex min-h-0 flex-1 flex-col gap-6 p-4 md:p-6", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function PageIntro({
  badge,
  title,
  description,
  actions,
  compact = false,
}: {
  badge?: string;
  title?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  compact?: boolean;
}) {
  const hasContent = badge || title || description;

  if (!hasContent && !actions) return null;

  if (!hasContent) {
    return (
      <div className={cn("flex flex-wrap", compact ? "items-start gap-2" : "gap-3")}>
        {actions}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-4 lg:flex-row lg:justify-between",
        compact ? "lg:items-start" : "lg:items-end",
      )}
    >
      <div className={cn(compact ? "space-y-1.5" : "space-y-2")}>
        {badge ? (
          <Badge variant="accent" className="w-fit">
            {badge}
          </Badge>
        ) : null}
        {title ? (
          <h2
            className={cn(
              "font-semibold tracking-[-0.04em] text-[var(--text-primary)]",
              compact ? "text-2xl leading-tight" : "text-3xl",
            )}
          >
            {title}
          </h2>
        ) : null}
        {description ? (
          <div
            className={cn(
              "max-w-3xl text-sm text-[var(--text-secondary)]",
              compact ? "leading-5" : "leading-6",
            )}
          >
            {description}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className={cn("flex flex-wrap", compact ? "items-start gap-2" : "gap-3")}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}
