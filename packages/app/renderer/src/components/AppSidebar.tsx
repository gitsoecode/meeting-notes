import {
  AudioLines,
  ChevronDown,
  CirclePlay,
  FileUp,
  FolderOpen,
  LayoutDashboard,
  MessageSquareText,
  NotebookPen,
  PlusCircle,
  Settings2,
} from "lucide-react";
import { MeetingNotesMark } from "./MeetingNotesMark";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar";
import { Spinner } from "./ui/spinner";

interface AppSidebarProps {
  activeNav: "record" | "meetings" | "prompts" | "settings" | "activity";
  onNavigate: (route: AppSidebarProps["activeNav"]) => void;
  onStartNow: () => void;
  onCreateDraft: () => void;
  onImport: () => void;
  quickStarting?: boolean;
}

const mainItems = [
  { id: "record" as const, label: "Home", icon: LayoutDashboard },
  { id: "meetings" as const, label: "Meetings", icon: AudioLines },
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
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1.5 py-1.5">
          <MeetingNotesMark className="h-5 w-5" />
          <span className="text-base font-semibold text-[var(--text-primary)]">Meeting Notes</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <div className="space-y-3">
          <div className="pb-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  className="h-9 w-full justify-between rounded-lg border border-[rgba(45,107,63,0.18)] bg-[rgba(45,107,63,0.08)] px-3 text-[var(--text-primary)] shadow-sm hover:bg-[rgba(45,107,63,0.14)] focus-visible:ring-[var(--ring)]"
                  disabled={quickStarting}
                >
                  <span className="flex items-center gap-2">
                    {quickStarting ? <Spinner className="h-3.5 w-3.5" /> : <PlusCircle className="h-4 w-4" />}
                    Quick Create
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-50" />
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
                      >
                        <Icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </div>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {secondaryItems.map((item) => {
            const Icon = item.icon;
            return (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  isActive={activeNav === item.id}
                  onClick={() => onNavigate(item.id)}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
