import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CirclePlay, NotebookPen } from "lucide-react";
import { api } from "../ipc-client";
import type { AppConfigDTO, RunSummary } from "../../../shared/ipc";
import { DateTimePicker } from "../components/DateTimePicker";
import { PageScaffold } from "../components/PageScaffold";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Spinner } from "../components/ui/spinner";
import { Textarea } from "../components/ui/textarea";
import { relativeDateLabel } from "../constants";

interface RecordViewProps {
  /** Kept for symmetry with the old surface; unused now that Home never
   *  hosts a live recording (quick-start navigates to the meeting route). */
  config?: AppConfigDTO;
  onMeetingStopped?: (runFolder: string) => void;
  onOpenMeeting: (runFolder: string) => void;
  onOpenPrep: (runFolder: string) => void;
  onViewAllMeetings: () => void;
}

/**
 * Home route. Pure landing page — new-meeting card (title / description /
 * scheduled time), an import entry, and upcoming/recent timelines. Starting
 * a recording always creates a draft workspace first, then navigates to the
 * meeting route with `?view=workspace`; the old in-place live/draft sub-UIs
 * are gone.
 */
export function RecordView({
  onOpenMeeting,
  onOpenPrep,
  onViewAllMeetings,
}: RecordViewProps) {
  const [title, setTitle] = useState(() => {
    const d = new Date();
    return `Meeting - ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  });
  const [description, setDescription] = useState("");
  const [scheduledTime, setScheduledTime] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentRuns, setRecentRuns] = useState<RunSummary[]>([]);

  useEffect(() => {
    api.runs.list().then(setRecentRuns).catch(() => setRecentRuns([]));
  }, []);

  const onStart = async () => {
    setError(null);
    setStarting(true);
    try {
      const meetingTitle = title.trim() || "Untitled Meeting";
      const descr = description.trim() || null;
      // Always create a draft first (matches App.onQuickStartNow).
      const draft = await api.runs.createDraft({
        title: meetingTitle,
        description: descr,
        scheduledTime,
      });
      try {
        await api.recording.startForDraft({ runFolder: draft.run_folder });
      } catch (startErr) {
        // Land the user in the Workspace so they can retry Start recording.
        console.error("startForDraft failed after createDraft", startErr);
      }
      onOpenMeeting(draft.run_folder);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const onCreateDraft = async () => {
    setError(null);
    try {
      const result = await api.runs.createDraft({
        title: title.trim() || "Untitled Meeting",
        description: description.trim() || null,
        scheduledTime,
      });
      onOpenPrep(result.run_folder);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onImportSelected = async () => {
    setError(null);
    setImporting(true);
    try {
      const picked = await api.config.pickMediaFile();
      if (!picked) return;
      const baseName = picked.name.split(/[\\/]/).pop() ?? picked.name;
      const meetingTitle =
        baseName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Imported meeting";
      const result = await api.runs.processMedia(picked.token, meetingTitle);
      onOpenMeeting(result.run_folder);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const { upcoming, recent } = useMemo(() => {
    const now = new Date();
    const drafts = recentRuns.filter((r) => r.status === "draft");
    const upcomingDrafts = drafts
      .filter((r) => r.scheduled_time && new Date(r.scheduled_time) >= now)
      .sort(
        (a, b) => new Date(a.scheduled_time!).getTime() - new Date(b.scheduled_time!).getTime(),
      );
    const unscheduledDrafts = drafts.filter((r) => !r.scheduled_time);
    const up = [...upcomingDrafts, ...unscheduledDrafts];
    const rec = recentRuns.filter((r) => r.status !== "draft").slice(0, 3);
    return { upcoming: up, recent: rec };
  }, [recentRuns]);

  return (
    <PageScaffold
      className="gap-4 md:gap-5"
      onDragOver={(e) => {
        if (!importing) e.preventDefault();
      }}
      onDrop={(e) => {
        if (importing) return;
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) {
          setImporting(true);
          const baseName = file.name.split(/[\\/]/).pop() ?? file.name;
          const meetingTitle =
            baseName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Imported meeting";
          api.runs
            .processDroppedMedia(file, meetingTitle)
            .then((r) => onOpenMeeting(r.run_folder))
            .catch((err) => setError(err instanceof Error ? err.message : String(err)))
            .finally(() => setImporting(false));
        }
      }}
    >
      {/* New Meeting card */}
      <Card className="shrink-0 overflow-hidden p-5 md:p-6">
        <CardHeader className="mb-3">
          <CardTitle className="text-xl">New meeting</CardTitle>
          <CardDescription>
            Start recording now or prepare a meeting workspace for later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-[var(--text-secondary)]">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onFocus={(e) => e.target.select()}
              placeholder="Untitled Meeting"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-[var(--text-secondary)]">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What's this meeting about?"
            />
          </div>
          <DateTimePicker
            value={scheduledTime}
            onChange={setScheduledTime}
            dateLabel="Scheduled date"
            timeLabel="Time"
          />
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button size="lg" onClick={onStart} disabled={starting}>
              {starting ? (
                <>
                  <Spinner /> Starting…
                </>
              ) : (
                <>
                  <CirclePlay className="h-4 w-4" /> Start recording
                </>
              )}
            </Button>
            <Button size="lg" variant="secondary" onClick={onCreateDraft}>
              <NotebookPen className="h-4 w-4" /> Prepare for later
            </Button>
            <span className="text-sm text-[var(--text-tertiary)]">
              or{" "}
              <button
                type="button"
                className="underline hover:text-[var(--text-secondary)]"
                onClick={onImportSelected}
                disabled={importing}
              >
                {importing ? "importing…" : "import a recording"}
              </button>
            </span>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-[var(--error)]/20 bg-[var(--error-muted)] px-4 py-3 text-sm text-[var(--error)]">
          {error}
        </div>
      )}

      {/* Coming Up + Recent timeline */}
      <Card className="shrink-0 overflow-hidden p-5 md:p-6">
        <CardHeader className="mb-4">
          <CardTitle className="text-lg">Coming up</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {upcoming.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-[var(--text-tertiary)]">
              No upcoming meetings. Create a draft to prepare for your next one.
            </div>
          ) : (
            <div className="divide-y divide-dashed divide-[var(--border-default)]">
              {upcoming.map((run) => {
                const d = run.scheduled_time ? new Date(run.scheduled_time) : new Date(run.started);
                const dayNum = d.getDate();
                const monthLabel = d.toLocaleDateString("en-US", { month: "long" });
                const dayOfWeek = d.toLocaleDateString("en-US", { weekday: "short" });
                const isToday = new Date().toDateString() === d.toDateString();
                const timeLabel = run.scheduled_time
                  ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                  : "Not scheduled";

                return (
                  <button
                    key={run.run_id}
                    type="button"
                    className="flex w-full items-start gap-6 px-4 py-4 text-left transition-colors hover:bg-[var(--bg-secondary)]/50"
                    onClick={() => onOpenPrep(run.folder_path)}
                  >
                    <div className="w-16 shrink-0 text-center">
                      <div className="flex items-baseline justify-center gap-1">
                        <span className="text-3xl font-light text-[var(--text-primary)]">{dayNum}</span>
                        <div className="text-xs text-[var(--text-secondary)]">
                          <div>{monthLabel}</div>
                          <div>{dayOfWeek}</div>
                        </div>
                        {isToday && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-red-500" />}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1 border-l-2 border-[var(--accent)]/30 pl-4">
                      <div className="font-medium text-[var(--text-primary)]">{run.title}</div>
                      <div className="mt-0.5 text-sm text-[var(--text-secondary)]">{timeLabel}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>

        {recent.length > 0 && (
          <>
            <CardHeader className="mb-4 mt-6 border-t border-[var(--border-default)] pt-5">
              <CardTitle className="text-base text-[var(--text-secondary)]">Recent</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-dashed divide-[var(--border-default)]">
                {recent.map((run) => {
                  const d = new Date(run.started);
                  const dayNum = d.getDate();
                  const monthLabel = d.toLocaleDateString("en-US", { month: "short" });
                  const dayOfWeek = d.toLocaleDateString("en-US", { weekday: "short" });
                  const timeLabel = relativeDateLabel(run.started);

                  return (
                    <button
                      key={run.run_id}
                      type="button"
                      className="flex w-full items-start gap-6 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-secondary)]/50"
                      onClick={() => onOpenMeeting(run.folder_path)}
                    >
                      <div className="w-16 shrink-0 text-center">
                        <div className="flex items-baseline justify-center gap-1">
                          <span className="text-2xl font-light text-[var(--text-tertiary)]">{dayNum}</span>
                          <div className="text-xs text-[var(--text-tertiary)]">
                            <div>{monthLabel}</div>
                            <div>{dayOfWeek}</div>
                          </div>
                        </div>
                      </div>
                      <div className="min-w-0 flex-1 border-l border-[var(--border-default)] pl-4">
                        <div className="font-medium text-[var(--text-secondary)]">{run.title}</div>
                        <div className="mt-0.5 text-sm text-[var(--text-tertiary)]">{timeLabel}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </>
        )}

        <div className="mt-4 border-t border-[var(--border-default)] pt-3 text-center">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            onClick={onViewAllMeetings}
          >
            View all meetings <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </Card>
    </PageScaffold>
  );
}
