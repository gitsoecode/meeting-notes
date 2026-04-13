import { Badge } from "./ui/badge";
import { SidebarTrigger } from "./ui/sidebar";
import { AlertCircle } from "lucide-react";

interface SiteHeaderProps {
  section: string;
  title: string;
  subtitle?: string;
  isDirty?: boolean;
}

export function SiteHeader({ section, title, subtitle, isDirty }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex h-[var(--header-height,3.75rem)] shrink-0 items-center border-b border-[var(--border-subtle)] bg-[rgba(249,250,246,0.88)] backdrop-blur">
      <div className="flex w-full items-center gap-3 px-4 md:px-6">
        <SidebarTrigger />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="shrink-0 text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
            {title}
          </h1>
          {subtitle && (
            <span className="hidden truncate text-sm font-normal text-[var(--text-tertiary)] lg:inline">
              — {subtitle}
            </span>
          )}
          {isDirty && (
            <Badge variant="warning" className="animate-pulse flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-[var(--warning-muted)] text-[var(--warning-text)] border-[var(--warning)]/30">
              <AlertCircle className="h-3.5 w-3.5" />
              Unsaved
            </Badge>
          )}
        </div>
      </div>
    </header>
  );
}
