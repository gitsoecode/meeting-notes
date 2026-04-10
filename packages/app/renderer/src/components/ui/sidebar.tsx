import * as React from "react";
import { PanelLeft } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

type SidebarContextValue = {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isMobile: boolean;
};

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) throw new Error("Sidebar components must be used within SidebarProvider");
  return context;
}

export function SidebarProvider({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(() => window.innerWidth < 768);

  React.useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  React.useEffect(() => {
    if (!isMobile) setOpen(false);
  }, [isMobile]);

  return (
    <SidebarContext.Provider value={{ open, setOpen, isMobile }}>
      <div
        style={style}
        className="group/sidebar-wrapper flex h-screen w-full flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]"
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({
  className,
  children,
}: React.HTMLAttributes<HTMLDivElement>) {
  const { open, setOpen, isMobile } = useSidebar();
  return (
    <>
      {isMobile && open ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-[rgba(30,51,34,0.24)] backdrop-blur-sm md:hidden"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        className={cn(
          "fixed inset-y-8 left-0 z-40 flex min-h-0 w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden border-r border-[var(--border-subtle)] bg-[#f7f8f2] shadow-[0_18px_44px_rgba(31,45,28,0.12)] transition-transform md:static md:inset-auto md:w-[var(--sidebar-width,18rem)] md:translate-x-0 md:shadow-none",
          open ? "translate-x-0" : "-translate-x-[calc(100%+1rem)]",
          className
        )}
      >
        {children}
      </aside>
    </>
  );
}

export function SidebarInset({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(45,107,63,0.10),transparent_30%),linear-gradient(180deg,#f9faf6_0%,#f4f5ef_100%)]",
        className
      )}
      {...props}
    />
  );
}

export function SidebarMain({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex min-h-0 flex-1 md:flex-row", className)}
      {...props}
    />
  );
}

export function SidebarTrigger({ className, ...props }: React.ComponentProps<typeof Button>) {
  const { setOpen } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("md:hidden", className)}
      onClick={() => setOpen(true)}
      {...props}
    >
      <PanelLeft className="h-4 w-4" />
      <span className="sr-only">Open sidebar</span>
    </Button>
  );
}

export function SidebarHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-4", className)} {...props} />;
}

export function SidebarContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4", className)} {...props} />;
}

export function SidebarFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mt-auto shrink-0 border-t border-[var(--border-subtle)] px-4 py-4",
        className
      )}
      {...props}
    />
  );
}

export function SidebarGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-1", className)} {...props} />;
}

export function SidebarGroupLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("px-0 pb-1 text-xs font-medium text-[var(--text-secondary)]", className)}
      {...props}
    />
  );
}

export function SidebarGroupContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-0.5", className)} {...props} />;
}

export function SidebarMenu({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-1", className)} {...props} />;
}

export function SidebarMenuItem({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("relative", className)} {...props} />;
}

export function SidebarMenuBadge({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]",
        className
      )}
      {...props}
    />
  );
}

export function SidebarMenuButton({
  className,
  isActive,
  asChild,
  ...props
}: React.ComponentProps<typeof Button> & { isActive?: boolean }) {
  return (
    <Button
      variant="ghost"
      asChild={asChild}
      className={cn(
        "h-9 w-full justify-start rounded-lg px-2.5 py-2 text-left text-sm font-medium text-[var(--text-secondary)] shadow-none hover:bg-white/80 hover:text-[var(--text-primary)] [&_svg]:shrink-0",
        isActive && "bg-white text-[var(--text-primary)] shadow-sm",
        className
      )}
      {...props}
    />
  );
}
