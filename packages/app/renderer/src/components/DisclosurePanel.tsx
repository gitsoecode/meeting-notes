import { useState } from "react";
import { ChevronRight } from "lucide-react";

interface DisclosurePanelProps {
  label: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function DisclosurePanel({
  label,
  icon,
  defaultOpen = false,
  children,
}: DisclosurePanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-[var(--border-default)]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
        {icon && <span className="shrink-0 text-[var(--accent)]">{icon}</span>}
        {label}
      </button>
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
