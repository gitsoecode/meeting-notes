import {
  AudioLines,
  FolderOpen,
  LayoutDashboard,
  MessageSquareText,
  PlusCircle,
  Settings2,
} from "lucide-react";
import { MeetingNotesMark } from "./MeetingNotesMark";
import { Button } from "./ui/button";
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

interface AppSidebarProps {
  activeNav: "record" | "meetings" | "prompts" | "settings" | "activity";
  onNavigate: (route: AppSidebarProps["activeNav"]) => void;
  onStartMeeting: () => void;
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
  onStartMeeting,
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
            <Button
              size="sm"
              className="h-9 w-full justify-start rounded-lg border border-[rgba(45,107,63,0.18)] bg-[rgba(45,107,63,0.08)] px-3 text-[var(--text-primary)] shadow-sm hover:bg-[rgba(45,107,63,0.14)] focus-visible:ring-[var(--ring)]"
              onClick={onStartMeeting}
            >
              <PlusCircle className="h-4 w-4" />
              Quick Create
            </Button>
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
