import {
  AudioLines,
  ChevronDown,
  CirclePlay,
  FileUp,
  FolderOpen,
  LayoutDashboard,
  MessageCircle,
  MessageSquareText,
  NotebookPen,
  PlusCircle,
  Settings2,
} from "lucide-react";
import { GistlistMark } from "./GistlistMark";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Sidebar,
  SidebarCollapseTrigger,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "./ui/sidebar";
import { Spinner } from "./ui/spinner";

interface AppSidebarProps {
  activeNav: "record" | "meetings" | "chat" | "prompts" | "settings" | "activity";
  onNavigate: (route: AppSidebarProps["activeNav"]) => void;
  onStartNow: () => void;
  onCreateDraft: () => void;
  onImport: () => void;
  quickStarting?: boolean;
}

const mainItems = [
  { id: "record" as const, label: "Home", icon: LayoutDashboard },
  { id: "meetings" as const, label: "Meetings", icon: AudioLines },
  { id: "chat" as const, label: "Chat", icon: MessageCircle },
  { id: "prompts" as const, label: "Prompt Library", icon: MessageSquareText },
];

const secondaryItems = [
  { id: "activity" as const, label: "Activity", icon: FolderOpen },
  { id: "settings" as const, label: "Settings", icon: Settings2 },
];

export function AppSidebar({
  activeNav,
  onNavigate,
  onStartNow,
  onCreateDraft,
  onImport,
  quickStarting,
}: AppSidebarProps) {
  const { collapsed, isMobile } = useSidebar();
  const isRail = collapsed && !isMobile;

  return (
    <Sidebar>
      {/* Header doubles as the window-drag region so traffic lights sit inside the sidebar.
          pt-12 (48px) clears the ~28px-tall macOS traffic lights with comfortable breathing room. */}
      <SidebarHeader className={`pt-12 [-webkit-app-region:drag] ${isRail ? "px-2" : ""}`}>
        <div className={`flex items-center gap-2 ${isRail ? "justify-center" : "justify-between px-1.5"}`}>
          {!isRail && (
            <div className="flex min-w-0 items-center gap-2">
              <GistlistMark className="h-5 w-5 shrink-0" />
              <span className="truncate text-base font-semibold text-[var(--text-primary)]">
                Gistlist
              </span>
            </div>
          )}
          <SidebarCollapseTrigger />
        </div>
      </SidebarHeader>

      <SidebarContent className={isRail ? "px-2" : undefined}>
        <div className="space-y-3">
          <div className="pb-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  className={`h-9 ${isRail ? "w-full justify-center px-0" : "w-full justify-between px-3"} rounded-lg border border-[rgba(45,107,63,0.18)] bg-[rgba(45,107,63,0.08)] text-[var(--text-primary)] shadow-sm hover:bg-[rgba(45,107,63,0.14)] focus-visible:ring-[var(--ring)]`}
                  disabled={quickStarting}
                  aria-label={isRail ? "Quick Create" : undefined}
                  title={isRail ? "Quick Create" : undefined}
                >
                  <span className="flex items-center gap-2">
                    {quickStarting ? <Spinner className="h-4 w-4" /> : <PlusCircle className="h-4 w-4" />}
                    <span className={isRail ? "sr-only" : undefined}>Quick Create</span>
                  </span>
                  {!isRail && <ChevronDown className="h-3.5 w-3.5 opacity-50" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={4} className="w-56">
                <DropdownMenuItem onClick={onStartNow}>
                  <CirclePlay className="h-4 w-4" />
                  Start meeting now
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onCreateDraft}>
                  <NotebookPen className="h-4 w-4" />
                  Create draft meeting
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onImport}>
                  <FileUp className="h-4 w-4" />
                  Import recording
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {mainItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={activeNav === item.id}
                        onClick={() => onNavigate(item.id)}
                        title={isRail ? item.label : undefined}
                        aria-label={isRail ? item.label : undefined}
                        className={isRail ? "justify-center px-0" : undefined}
                      >
                        <Icon className="h-4 w-4" />
                        <span className={isRail ? "sr-only" : undefined}>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </div>
      </SidebarContent>

      <SidebarFooter className={isRail ? "px-2" : undefined}>
        <SidebarMenu>
          {secondaryItems.map((item) => {
            const Icon = item.icon;
            return (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  isActive={activeNav === item.id}
                  onClick={() => onNavigate(item.id)}
                  title={isRail ? item.label : undefined}
                  aria-label={isRail ? item.label : undefined}
                  className={isRail ? "justify-center px-0" : undefined}
                >
                  <Icon className="h-4 w-4" />
                  {isRail ? <span className="sr-only">{item.label}</span> : <span>{item.label}</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
