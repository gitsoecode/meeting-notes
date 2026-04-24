import { useRef, useState, type ReactNode } from "react";
import { FileOutput, FileUp, PlayCircle, Search, Trash2, X } from "lucide-react";
import { api } from "../ipc-client";
import type { AppConfigDTO, RecordingStatus, RunDetail } from "../../../shared/ipc";
import type { MeetingAnalysisPromptItem } from "../../../shared/meeting-prompts";
import { LiveChannelMeters } from "../components/LiveChannelMeters";
import { MarkdownView } from "../components/MarkdownView";
import { OverviewPanel } from "../components/OverviewPanel";
import {
  PipelineStatus,
  type PromptOutputStatus,
} from "../components/PipelineStatus";
import { TranscriptView, type TranscriptViewHandle } from "../components/TranscriptView";
import { TranscriptSearchBar } from "../components/TranscriptSearchBar";
import { MarkdownFindBar } from "../components/MarkdownFindBar";
import { InlinePlyrAudio, PlaybackInlineHost } from "../components/MeetingAudioPlayer";
import type { EntryMatch } from "../../../shared/transcript-search";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Spinner } from "../components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../components/ui/accordion";
import { findModelEntry } from "../../../shared/llm-catalog";

export type DetailsTabKind =
  | "metadata"
  | "summary"
  | "analysis"
  | "transcript"
  | "recording"
  | "files";

export interface MeetingDetailsViewProps {
  detail: RunDetail;
  runFolder: string;
  config: AppConfigDTO;

  /** Shell buffers — used for the 3-line previews on Metadata. */
  prepNotes: string;
  notes: string;

  activeTabId: DetailsTabKind;
  onTabChange: (tab: DetailsTabKind) => void;
  onFlipToWorkspace: () => void;
  onRefreshDetail: () => void;

  // Loaded-document cache and its derivatives
  summaryContent: string;
  transcriptContent: string;
  promptContent: string;
  hasSummaryContent: boolean;
  hasTranscript: boolean;

  // Status flags
  isDraft: boolean;
  isLive: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  isComplete: boolean;
  isError: boolean;

  // Pipeline
  sections: PromptOutputStatus[];
  pipelineStatusContent: ReactNode;
  recording: RecordingStatus;

  // Analysis
  loadingPrompts: boolean;
  analysisSearchQuery: string;
  onAnalysisSearchChange: (value: string) => void;
  sortedAnalysisPrompts: MeetingAnalysisPromptItem[];
  filteredAnalysisPrompts: MeetingAnalysisPromptItem[];
  analysisPreloadedPrompts: MeetingAnalysisPromptItem[];
  analysisCustomPrompts: MeetingAnalysisPromptItem[];
  activePromptId: string | null;
  onActivePromptChange: (id: string | null) => void;
  activePrompt: MeetingAnalysisPromptItem | null;
  defaultModel: string | null;
  onRunPrompt: (promptId: string) => void;

  // Recording tab
  recordingFiles: RunDetail["files"];
  recordingSources: Record<string, string>;
  onRequestDeleteRecording: (fileName: string) => void;
  onDownloadRecording: (fileName: string) => void;

  // Files tab
  attachments: Array<{ name: string; size: number }>;
  attachmentsLoading: boolean;
  onAddAttachment: () => void;
  onRemoveAttachment: (name: string) => void;

  // Obsidian integration
  summaryFileName: string;

  // Click-to-seek: the combined-playback filename for this meeting, or null
  // when it's not available. Drives whether transcript timestamps render as
  // clickable buttons.
  combinedAudioFileName: string | null;
}

function EmptyTabContent({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-sm text-[var(--text-tertiary)]">{message}</div>
    </div>
  );
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getRecordingExtension(fileName: string): string {
  const baseName = fileName.split("/").pop() ?? fileName;
  const match = baseName.match(/\.([^.]+)$/);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function isAudioRecording(fileName: string): boolean {
  return [".mp3", ".m4a", ".wav", ".aiff", ".flac", ".ogg"].includes(getRecordingExtension(fileName));
}

function isVideoRecording(fileName: string): boolean {
  return [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"].includes(getRecordingExtension(fileName));
}

function getRecordingTypeLabel(fileName: string): string {
  if (isAudioRecording(fileName)) return "Audio recording";
  if (isVideoRecording(fileName)) return "Video recording";
  return "Recording";
}

function formatAnalysisPromptMeta(prompt: MeetingAnalysisPromptItem, defaultModel: string | null): string {
  const parts = [prompt.prompt.auto ? "Auto-run prompt" : "Manual prompt"];
  if (prompt.status === "running") parts.push("Running");
  else if (prompt.status === "failed") parts.push("Last run failed");
  else if (prompt.status === "queued") parts.push("Queued");
  else if (prompt.hasOutput) parts.push("Output ready");
  else parts.push("No output yet");

  const effectiveModel = prompt.prompt.model ?? defaultModel;
  if (effectiveModel) {
    const entry = findModelEntry(effectiveModel);
    parts.push(entry?.label ?? effectiveModel);
  }

  return parts.join(" • ");
}

function AnalysisSidebarItem({
  prompt,
  active,
  onSelect,
  defaultModel,
}: {
  prompt: MeetingAnalysisPromptItem;
  active: boolean;
  onSelect: () => void;
  defaultModel: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition-all ${
        active
          ? "bg-white font-semibold text-[var(--text-primary)] shadow-sm ring-1 ring-black/5"
          : "text-[var(--text-secondary)] hover:bg-white/60 hover:text-[var(--text-primary)]"
      }`}
    >
      <div className="min-w-0">
        <span className="truncate text-xs">{prompt.label}</span>
        <div className="mt-0.5 truncate text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
          {formatAnalysisPromptMeta(prompt, defaultModel)}
        </div>
      </div>
      {active && <div className="absolute left-0 top-2 h-4 w-0.5 rounded-full bg-[var(--accent)]" />}
    </button>
  );
}

/**
 * Renders a short (visually-clamped) preview of prep or notes markdown with
 * a soft fade-out and an "Edit in Workspace →" link. Hidden when the source
 * is empty so Metadata stays compact on meetings that never had prep/notes.
 */
function PrepOrNotesPreview({
  label,
  source,
  onEdit,
}: {
  label: "Prep notes" | "Live notes";
  source: string;
  onEdit: () => void;
}) {
  if (!source.trim()) return null;
  const wordCount = source.trim().split(/\s+/).length;
  
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-[var(--text-primary)]">{label}</span>
      <div className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">{wordCount > 999 ? "1k+" : wordCount}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-[var(--text-primary)]">{wordCount === 1 ? "1 word" : `${wordCount} words`}</span>
            <span className="text-xs text-[var(--text-secondary)]">Saved in workspace</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] shadow-sm transition-colors hover:bg-[var(--border-subtle)]"
        >
          Edit in Workspace
        </button>
      </div>
    </div>
  );
}

export function MeetingDetailsView(props: MeetingDetailsViewProps) {
  const {
    detail,
    runFolder,
    config,
    prepNotes,
    notes,
    activeTabId,
    onTabChange,
    onFlipToWorkspace,
    onRefreshDetail,
    summaryContent,
    transcriptContent,
    promptContent,
    hasSummaryContent,
    hasTranscript,
    isDraft,
    isLive,
    isRecording,
    isProcessing,
    sections,
    pipelineStatusContent,
    recording,
    loadingPrompts,
    analysisSearchQuery,
    onAnalysisSearchChange,
    sortedAnalysisPrompts,
    filteredAnalysisPrompts,
    analysisPreloadedPrompts,
    analysisCustomPrompts,
    activePromptId,
    onActivePromptChange,
    activePrompt,
    defaultModel,
    onRunPrompt,
    recordingFiles,
    recordingSources,
    onRequestDeleteRecording,
    onDownloadRecording,
    attachments,
    attachmentsLoading,
    onAddAttachment,
    onRemoveAttachment,
    summaryFileName,
    combinedAudioFileName,
  } = props;

  // Transcript search state lives inside the details view because the bar
  // and the transcript render under the same tab. Parent doesn't need it.
  const [searchQuery, setSearchQuery] = useState("");
  const [matches, setMatches] = useState<EntryMatch[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState<number | null>(null);
  const transcriptViewRef = useRef<TranscriptViewHandle | null>(null);
  const summaryMarkdownRef = useRef<HTMLDivElement | null>(null);
  const analysisMarkdownRef = useRef<HTMLDivElement | null>(null);

  const combinedAudioAvailable = combinedAudioFileName != null;

  const obsidianTarget =
    activeTabId === "summary"
      ? summaryFileName
      : activeTabId === "transcript"
      ? "transcript.md"
      : activeTabId === "analysis" && activePrompt
      ? activePrompt.fileName
      : null;

  return (
    <>
      <Tabs
        value={activeTabId}
        onValueChange={(value) => onTabChange(value as DetailsTabKind)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="min-w-0">
          <TabsList className="min-w-0 w-full overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsTrigger value="metadata">Metadata</TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="analysis">Analysis</TabsTrigger>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="recording">Recording</TabsTrigger>
            <TabsTrigger value="files">Files{attachments.length > 0 ? ` (${attachments.length})` : ""}</TabsTrigger>
          </TabsList>
        </div>

        {/* ---- METADATA TAB ---- */}
        <TabsContent value="metadata">
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-white p-5 shadow-sm md:p-6">
              <OverviewPanel detail={detail} runFolder={runFolder} onUpdated={onRefreshDetail} />
            </div>
            {(prepNotes.trim() || notes.trim()) && (
              <div className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/40 p-4">
                <PrepOrNotesPreview label="Prep notes" source={prepNotes} onEdit={onFlipToWorkspace} />
                <PrepOrNotesPreview label="Live notes" source={notes} onEdit={onFlipToWorkspace} />
              </div>
            )}
          </div>
        </TabsContent>

        {/* ---- SUMMARY TAB ---- */}
        <TabsContent value="summary">
          {isDraft || isLive ? (
            <EmptyTabContent message="Summary will be generated after recording." />
          ) : isProcessing ? (
            <div className="space-y-4">{pipelineStatusContent}<EmptyTabContent message="Summary is being generated…" /></div>
          ) : hasSummaryContent ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              {pipelineStatusContent}
              <MarkdownFindBar
                contentRef={summaryMarkdownRef}
                contentKey={summaryContent}
                shortcutActive={activeTabId === "summary"}
              />
              <div className="relative flex min-h-0 flex-1 flex-col rounded-md border border-[var(--border-default)] bg-white">
                <div className="flex-1 min-h-0 overflow-y-auto p-5 md:p-6">
                  {summaryContent ? (
                    <MarkdownView
                      ref={summaryMarkdownRef}
                      source={summaryContent}
                      className="markdown-view"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-[var(--text-tertiary)]">
                      <Spinner className="h-3.5 w-3.5" /> Loading summary…
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {pipelineStatusContent}
              <EmptyTabContent message="No summary has been generated yet." />
            </div>
          )}
        </TabsContent>

        {/* ---- ANALYSIS TAB ---- */}
        <TabsContent value="analysis">
          {isDraft || isLive ? (
            <EmptyTabContent message="Analysis will be available after processing." />
          ) : (
            <div className="flex h-full min-h-[24rem] flex-1 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-white shadow-sm">
              <div className="flex w-52 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-secondary)]/30 lg:w-64">
                <div className="space-y-4 p-4">
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">Library</h2>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                    <Input
                      placeholder="Filter..."
                      className="h-8 bg-white/60 pl-8 text-xs focus:bg-white"
                      value={analysisSearchQuery}
                      onChange={(e) => onAnalysisSearchChange(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-2 pb-4">
                  {loadingPrompts ? (
                    <div className="px-4 py-3 text-sm text-[var(--text-secondary)]"><Spinner className="h-3.5 w-3.5" /> Loading…</div>
                  ) : sortedAnalysisPrompts.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-[var(--text-secondary)]">No analysis prompts yet.</div>
                  ) : filteredAnalysisPrompts.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-[var(--text-secondary)]">No prompts match this filter.</div>
                  ) : (
                    <div className="space-y-4">
                      {analysisPreloadedPrompts.length > 0 && (
                        <div className="space-y-1 px-2">
                          <div className="px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--text-tertiary)]/70">Pre-loaded</div>
                          <div className="space-y-0.5">
                            {analysisPreloadedPrompts.map((prompt) => (
                              <AnalysisSidebarItem
                                key={prompt.id}
                                prompt={prompt}
                                active={activePromptId === prompt.id}
                                onSelect={() => onActivePromptChange(prompt.id)}
                                defaultModel={defaultModel}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="space-y-1 px-2">
                        <div className="px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--text-tertiary)]/70">Custom</div>
                        <div className="space-y-0.5 px-0.5">
                          {analysisCustomPrompts.length === 0 ? (
                            <div className="px-3 py-2 text-[11px] italic text-[var(--text-tertiary)]">No custom prompts yet</div>
                          ) : (
                            analysisCustomPrompts.map((prompt) => (
                              <AnalysisSidebarItem
                                key={prompt.id}
                                prompt={prompt}
                                active={activePromptId === prompt.id}
                                onSelect={() => onActivePromptChange(prompt.id)}
                                defaultModel={defaultModel}
                              />
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="min-w-0 flex-1 overflow-y-auto">
                {activePrompt ? (
                  <div className="space-y-6 p-5 md:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-subtle)] pb-5">
                      <div className="min-w-0 space-y-2">
                        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">{activePrompt.label}</h2>
                        <p className="max-w-3xl text-sm text-[var(--text-secondary)]">
                          {activePrompt.description?.trim() || "No description yet."}
                        </p>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[var(--text-tertiary)]">
                          {formatAnalysisPromptMeta(activePrompt, defaultModel)}
                        </p>
                      </div>
                      <Button size="sm" onClick={() => onRunPrompt(activePrompt.id)}>
                        <PlayCircle className="h-3.5 w-3.5" /> Run prompt
                      </Button>
                    </div>
                    {pipelineStatusContent}
                    {activePrompt.hasOutput ? (
                      <div className="flex flex-col gap-3">
                        <MarkdownFindBar
                          key={activePrompt.id}
                          contentRef={analysisMarkdownRef}
                          contentKey={`${activePrompt.id}:${promptContent}`}
                          shortcutActive={activeTabId === "analysis"}
                        />
                        <div className="rounded-xl border border-[var(--border-subtle)] bg-white p-5 md:p-6">
                          <MarkdownView
                            ref={analysisMarkdownRef}
                            source={promptContent}
                            className="markdown-view"
                          />
                        </div>
                      </div>
                    ) : (
                      <EmptyTabContent message="This prompt has not produced output for this meeting yet." />
                    )}
                  </div>
                ) : (
                  <div className="p-5 md:p-6">
                    {pipelineStatusContent}
                    <EmptyTabContent message="Select an analysis prompt to view its output." />
                  </div>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ---- TRANSCRIPT TAB ---- */}
        <TabsContent value="transcript">
          {isDraft || isLive ? (
            <EmptyTabContent message="Transcript will be generated after recording." />
          ) : isProcessing ? (
            <div className="space-y-4">{pipelineStatusContent}<EmptyTabContent message="Transcript is being generated…" /></div>
          ) : hasTranscript ? (
            <div className="flex flex-col gap-4">
              <TranscriptSearchBar
                onQueryChange={setSearchQuery}
                matches={matches}
                currentMatchIndex={currentMatchIndex}
                onCurrentMatchChange={setCurrentMatchIndex}
                onNavigateToMatch={(m) => transcriptViewRef.current?.scrollToMatch(m)}
                shortcutActive={activeTabId === "transcript"}
              />
              {!combinedAudioAvailable ? (
                <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/60 px-3 py-2 text-xs text-[var(--text-secondary)]">
                  Click-to-play is unavailable for this meeting (no combined audio file).
                </div>
              ) : null}
              <TranscriptView
                ref={transcriptViewRef}
                source={transcriptContent}
                combinedAudioAvailable={combinedAudioAvailable}
                searchQuery={searchQuery}
                onMatchesChange={setMatches}
                currentMatchIndex={currentMatchIndex}
              />
            </div>
          ) : (
            <EmptyTabContent message="No transcript available for this meeting." />
          )}
        </TabsContent>

        {/* ---- RECORDING TAB ---- */}
        <TabsContent value="recording">
          {isLive ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-sm text-[var(--text-secondary)]">
                <LiveChannelMeters isRecording={isRecording} systemCapturing={recording.system_captured === true} />
                <span className={recording.system_captured ? "" : "text-[var(--warning-text)]"}>
                  {recording.system_captured ? "System audio capturing" : "System audio not available"}
                </span>
              </div>
              {recording.system_audio_warning && (
                <div className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-muted)] px-4 py-3 text-sm text-[var(--warning-text)]">
                  {recording.system_audio_warning}
                </div>
              )}
              {sections.length > 0 && <PipelineStatus sections={sections} title="Live processing" />}
            </div>
          ) : recordingFiles.length === 0 ? (
            <EmptyTabContent message="No recording yet." />
          ) : (() => {
            const combinedFile = combinedAudioFileName
              ? recordingFiles.find((f) => f.name === combinedAudioFileName)
              : recordingFiles.find((f) => f.name.endsWith("combined.wav"));
            const sourceFiles = recordingFiles.filter((f) => f !== combinedFile);
            const renderFileCard = (file: RunDetail["files"][number]) => {
              const source = recordingSources[file.name];
              const audioPreview = isAudioRecording(file.name) && source;
              const videoRecording = isVideoRecording(file.name);
              const isCombined = file === combinedFile;
              return (
                <div key={file.name} className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--text-primary)] break-all">{file.name}</div>
                      <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{getRecordingTypeLabel(file.name)} · {formatFileSize(file.size)}</div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant="secondary" size="sm" onClick={() => onDownloadRecording(file.name)}>
                        <FileOutput className="h-3.5 w-3.5" /> Download
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => onRequestDeleteRecording(file.name)}>
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </Button>
                    </div>
                  </div>
                  {audioPreview ? (
                    isCombined ? (
                      <PlaybackInlineHost className="w-full" />
                    ) : (
                      <InlinePlyrAudio src={source} className="w-full" />
                    )
                  ) : videoRecording ? (
                    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-4 text-sm text-[var(--text-secondary)]">
                      Video preview isn&apos;t available in-app yet. Download to view.
                    </div>
                  ) : (
                    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-4 text-sm text-[var(--text-secondary)]">
                      Preview is not available. Download the file to inspect it.
                    </div>
                  )}
                </div>
              );
            };
            return (
              <div className="space-y-4">
                {combinedFile && renderFileCard(combinedFile)}
                {sourceFiles.length > 0 && (
                  <Accordion type="single" collapsible>
                    <AccordionItem value="source-files" className="px-4">
                      <AccordionTrigger>
                        Source files ({sourceFiles.length})
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-4">
                          {sourceFiles.map(renderFileCard)}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}
              </div>
            );
          })()}
        </TabsContent>

        {/* ---- FILES TAB ---- */}
        <TabsContent value="files">
          {attachmentsLoading ? (
            <div className="py-8 text-center text-sm text-[var(--text-secondary)]">Loading…</div>
          ) : (
            <div className="space-y-4">
              {attachments.length > 0 && (
                <div className="text-sm font-medium text-[var(--text-primary)]">
                  Attached files ({attachments.length})
                </div>
              )}
              {attachments.length > 0 && (
                <div className="space-y-1.5">
                  {attachments.map((a) => (
                    <div key={a.name} className="flex items-center justify-between rounded-lg border border-[var(--border-default)] bg-white px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[var(--text-primary)]">{a.name}</div>
                        <div className="text-xs text-[var(--text-tertiary)]">{formatFileSize(a.size)}</div>
                      </div>
                      {!isProcessing && (
                        <Button variant="ghost" size="sm" onClick={() => onRemoveAttachment(a.name)} className="ml-2 text-[var(--text-tertiary)] hover:text-[var(--error)]">
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {!isProcessing && (
                <div
                  className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--border-default)] bg-[var(--bg-secondary)]/30 px-6 py-10 text-center transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--bg-secondary)]/50"
                  onClick={onAddAttachment}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void onAddAttachment();
                  }}
                >
                  <FileUp className="h-6 w-6 text-[var(--text-tertiary)]" />
                  <div className="text-sm text-[var(--text-secondary)]">Drop files here or click to browse</div>
                  <div className="text-xs text-[var(--text-tertiary)]">Reference documents, slides, or other materials</div>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {config.obsidian_integration.enabled && obsidianTarget ? (
        <Button variant="secondary" onClick={() => void api.runs.openInObsidian(runFolder, obsidianTarget)}>
          Open in Obsidian
        </Button>
      ) : null}
    </>
  );
}
