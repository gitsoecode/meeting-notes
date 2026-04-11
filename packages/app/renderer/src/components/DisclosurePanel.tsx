import { useState } from "react";
import { ChevronRight } from "lucide-react";

interface DisclosurePanelProps {
  label: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function DisclosurePanel({
  label,
  icon,
  defaultOpen = false,
  actions,
  children,
}: DisclosurePanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-[var(--border-default)]">
      <div className="flex w-full items-center">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex flex-1 items-center gap-2 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          />
          {icon && <span className="shrink-0 text-[var(--accent)]">{icon}</span>}
          {label}
        </button>
        {actions && (
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        )}
      </div>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="pb-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
