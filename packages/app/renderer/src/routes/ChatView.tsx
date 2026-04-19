import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Cpu, MoreHorizontal, Plus, Trash2, Pencil } from "lucide-react";
import { api } from "../ipc-client";
import { LLM_MODELS } from "../constants";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import type {
  ChatBackfillProgressDTO,
  ChatMessageDTO,
  ChatSendFilters,
  ChatStreamEvent,
  ChatThreadDTO,
} from "../../../shared/ipc";
import { PageIntro, PageScaffold } from "../components/PageScaffold";
import { Button } from "../components/ui/button";
import { ChatComposer } from "../components/ChatComposer";
import { ChatMessage } from "../components/ChatMessage";
import { ThinkingIndicator } from "../components/ThinkingIndicator";
import { Spinner } from "../components/ui/spinner";
import { cn } from "../lib/utils";

export type ChatSubview =
  | { kind: "empty" }
  | { kind: "all-threads" }
  | { kind: "thread"; threadId: string };

interface ChatViewProps {
  subview: ChatSubview;
  onSubviewChange: (sv: ChatSubview) => void;
  /**
   * Fired when the user clicks a TimestampPill or SourceChip. The host
   * maps (startMs, source) to the appropriate meeting view + tab and
   * navigates.
   *   - startMs != null → Details view, Transcript tab, audio seek
   *   - source="summary"     → Details view, Summary tab
   *   - source="notes"       → Workspace view (notes editor)
   *   - source="prep"        → Workspace view (prep editor)
   *   - source="transcript" + startMs==null → Details view, Transcript tab
   */
  onOpenMeetingAt: (
    runId: string,
    startMs: number | null,
    source?: import("../../../shared/ipc").ChatCitationSource,
  ) => void;
}

export function ChatView({ subview, onSubviewChange, onOpenMeetingAt }: ChatViewProps) {
  const [threads, setThreads] = useState<ChatThreadDTO[]>([]);
  const [backfill, setBackfill] = useState<ChatBackfillProgressDTO | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  const refreshThreads = useCallback(async () => {
    const list = await api.chat.listThreads().catch(() => [] as ChatThreadDTO[]);
    setThreads(list);
  }, []);

  useEffect(() => {
    refreshThreads();
  }, [refreshThreads]);

  useEffect(() => {
    api.chat.backfillStatus().then(setBackfill).catch(() => {});
    api.chat.backfillCountPending().then(setPendingCount).catch(() => {});
    const unsub = api.on.chatBackfillProgress((progress) => {
      setBackfill(progress);
      if (progress.state === "complete") {
        setPendingCount(0);
      }
    });
    return unsub;
  }, []);

  // Thread view owns its own scaffolding (full-height chat column, no
  // PageIntro above it). The empty and all-threads views share the normal
  // PageScaffold + PageIntro header treatment.
  if (subview.kind === "thread") {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ThreadView
          threadId={subview.threadId}
          onBack={() => onSubviewChange({ kind: "empty" })}
          onChanged={refreshThreads}
          onOpenMeetingAt={onOpenMeetingAt}
        />
      </div>
    );
  }

  return (
    <PageScaffold>
      <PageIntro title="Ask about your meetings." />
      {subview.kind === "empty" ? (
        <EmptyState
          threads={threads}
          backfill={backfill}
          pendingCount={pendingCount}
          onStartBackfill={async () => {
            try {
              const p = await api.chat.backfillStart();
              setBackfill(p);
            } catch {
              /* noop */
            }
          }}
          onShowAll={() => onSubviewChange({ kind: "all-threads" })}
          onPick={(id) => onSubviewChange({ kind: "thread", threadId: id })}
          onSent={(threadId) => {
            refreshThreads();
            onSubviewChange({ kind: "thread", threadId });
          }}
        />
      ) : (
        <AllThreadsView
          threads={threads}
          onBack={() => onSubviewChange({ kind: "empty" })}
          onPick={(id) => onSubviewChange({ kind: "thread", threadId: id })}
          onChanged={refreshThreads}
        />
      )}
    </PageScaffold>
  );
}

// ---------------------------------------------------------------------------

function EmptyState({
  threads,
  backfill,
  pendingCount,
  onStartBackfill,
  onShowAll,
  onPick,
  onSent,
}: {
  threads: ChatThreadDTO[];
  backfill: ChatBackfillProgressDTO | null;
  pendingCount: number | null;
  onStartBackfill: () => void;
  onShowAll: () => void;
  onPick: (threadId: string) => void;
  onSent: (threadId: string) => void;
}) {
  const recent = threads.slice(0, 5);

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8 py-10">
      <ComposeAndSend onSent={onSent} autoFocus />

      <BackfillBanner
        progress={backfill}
        pendingCount={pendingCount}
        onStart={onStartBackfill}
      />

      {recent.length > 0 && (
        <section data-testid="chat-recents">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
            Recents
          </h3>
          <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
            {recent.map((t) => (
              <li key={t.thread_id}>
                <button
                  type="button"
                  onClick={() => onPick(t.thread_id)}
                  className="flex w-full items-center justify-between py-2 text-left text-sm hover:text-[var(--text-primary)]"
                  data-testid="chat-recent-thread"
                >
                  <span className="truncate text-[var(--text-primary)]">{t.title}</span>
                  <span className="shrink-0 text-xs text-[var(--text-tertiary)]">
                    {formatRelativeTime(t.updated_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onShowAll}
            className="mt-3 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            data-testid="chat-show-all"
          >
            Show all threads →
          </button>
        </section>
      )}
    </div>
  );
}

function AllThreadsView({
  threads,
  onBack,
  onPick,
  onChanged,
}: {
  threads: ChatThreadDTO[];
  onBack: () => void;
  onPick: (id: string) => void;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => t.title.toLowerCase().includes(q));
  }, [threads, query]);

  const groups = useMemo(() => bucketThreadsByTime(filtered), [filtered]);

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 py-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 self-start text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <ChevronLeft className="h-4 w-4" /> Back
      </button>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search threads"
        data-testid="chat-thread-search"
        className="h-9 w-full rounded-md border border-[var(--border-subtle)] bg-white px-3 text-sm focus:border-[var(--ring)] focus:outline-none"
      />
      <div className="flex flex-col gap-6">
        {groups.map((g) =>
          g.threads.length === 0 ? null : (
            <section key={g.label}>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                {g.label}
              </h3>
              <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
                {g.threads.map((t) => (
                  <ThreadRow
                    key={t.thread_id}
                    thread={t}
                    onPick={() => onPick(t.thread_id)}
                    onChanged={onChanged}
                  />
                ))}
              </ul>
            </section>
          ),
        )}
      </div>
    </div>
  );
}

function ThreadRow({
  thread,
  onPick,
  onChanged,
}: {
  thread: ChatThreadDTO;
  onPick: () => void;
  onChanged: () => void;
}) {
  return (
    <li
      className="group flex items-center justify-between py-2"
      data-testid="chat-thread-row"
    >
      <button
        type="button"
        onClick={onPick}
        className="flex-1 truncate text-left text-sm text-[var(--text-primary)] hover:underline"
      >
        {thread.title}
      </button>
      <span className="mx-3 shrink-0 text-xs text-[var(--text-tertiary)]">
        {formatRelativeTime(thread.updated_at)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Delete thread"
        className="opacity-0 transition-opacity group-hover:opacity-100"
        onClick={async () => {
          await api.chat.deleteThread(thread.thread_id).catch(() => {});
          onChanged();
        }}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}

function ThreadView({
  threadId,
  onBack,
  onChanged,
  onOpenMeetingAt,
}: {
  threadId: string;
  onBack: () => void;
  onChanged: () => void;
  onOpenMeetingAt: (runId: string, startMs: number | null) => void;
}) {
  const [thread, setThread] = useState<ChatThreadDTO | null>(null);
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [liveText, setLiveText] = useState("");
  // Optimistic user message — appended the moment the user hits send so
  // the bubble renders immediately. Replaced by the persisted version on
  // the next `reload()`. Without this, the 2nd+ turn in a thread would
  // look like "thinking indicator but no user message" for the whole
  // LLM latency window.
  const [pendingUserMessage, setPendingUserMessage] = useState<ChatMessageDTO | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [installedModels, setInstalledModels] = useState<string[]>([]);
  const [hasClaudeKey, setHasClaudeKey] = useState(false);
  const [hasOpenaiKey, setHasOpenaiKey] = useState(false);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.llm.listInstalled().then(setInstalledModels).catch(() => {});
    api.secrets.has("claude").then(setHasClaudeKey).catch(() => {});
    api.secrets.has("openai").then(setHasOpenaiKey).catch(() => {});
    api.chat.getSettings().then((s) => setDefaultModel(s.default_model)).catch(() => {});
  }, []);

  const reload = useCallback(async () => {
    const resp = await api.chat.getThread(threadId);
    if (!resp) return;
    setThread(resp.thread);
    setMessages(resp.messages);
    // If the last persisted message is from the user, we're still waiting
    // on an assistant response (the user just sent a message from a parent
    // component and hasn't seen the reply stream yet). Surface the
    // thinking indicator so the UI shows motion immediately.
    const last = resp.messages[resp.messages.length - 1];
    if (last && last.role === "user") {
      setStreaming(true);
      setStatusLine("Searching meetings…");
    }
  }, [threadId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, statusLine, liveText]);

  useEffect(() => {
    const unsub = api.on.chatStream((event: ChatStreamEvent) => {
      if (event.type === "status") {
        setStatusLine(event.label);
      } else if (event.type === "token") {
        setLiveText((prev) => prev + event.chunk);
        setStatusLine(null);
      } else if (event.type === "messageComplete") {
        setStreaming(false);
        setStatusLine(null);
        setLiveText("");
        reload();
        onChanged();
      } else if (event.type === "threadTitle") {
        if (event.thread_id === threadId) {
          setThread((t) => (t ? { ...t, title: event.title } : t));
        }
      } else if (event.type === "error") {
        setStreaming(false);
        setStatusLine(null);
        setLiveText("");
      }
    });
    return unsub;
  }, [threadId, reload, onChanged]);

  const handleSend = useCallback(
    async (
      message: string,
      modelOverride?: string,
      filters?: ChatSendFilters,
    ) => {
      // Optimistically show the user's message right away so the bubble
      // appears before the model starts responding. Temporary id until
      // the backend persists it and `reload()` brings the real row.
      const now = new Date().toISOString();
      setPendingUserMessage({
        message_id: `pending-${now}`,
        thread_id: threadId,
        role: "user",
        content: message,
        citations: [],
        created_at: now,
      });
      setStreaming(true);
      setStatusLine("Searching meetings…");
      setLiveText("");
      try {
        await api.chat.send({
          threadId,
          userMessage: message,
          modelOverride,
          filters,
        });
      } finally {
        setStreaming(false);
        setStatusLine(null);
        setLiveText("");
        setPendingUserMessage(null);
        await reload();
        onChanged();
      }
    },
    [threadId, reload, onChanged],
  );

  const handleSeek = useCallback(
    (runId: string, startMs: number) => {
      onOpenMeetingAt(runId, startMs);
    },
    [onOpenMeetingAt],
  );

  const handleOpen = useCallback(
    (runId: string, _title: string, source: import("../../../shared/ipc").ChatCitationSource) => {
      onOpenMeetingAt(runId, null, source);
    },
    [onOpenMeetingAt],
  );

  if (!thread) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-0 h-full w-full max-w-[760px] flex-col px-4 md:px-6">
      <header className="flex items-center gap-2 border-b border-[var(--border-subtle)] py-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
          aria-label="Back"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2
          className="flex-1 truncate text-sm font-medium text-[var(--text-primary)]"
          data-testid="chat-thread-title"
        >
          {thread.title}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={onBack}
          className="h-7 px-2 text-xs"
          title="New thread"
          data-testid="chat-new-thread"
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> New
        </Button>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label="Thread options"
              data-testid="chat-thread-menu"
              className="h-7 w-7"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem
              onClick={() => {
                setRenameValue(thread.title);
                setRenameOpen(true);
              }}
              data-testid="chat-thread-menu-rename"
            >
              <Pencil className="mr-2 h-3.5 w-3.5" /> Rename
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-testid="chat-thread-menu-model">
                <Cpu className="mr-2 h-3.5 w-3.5" />
                <span>Model</span>
                <span className="ml-auto truncate text-xs text-[var(--text-tertiary)]">
                  {thread.model_id ?? `default (${defaultModel ?? "unset"})`}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64 max-h-96 overflow-y-auto">
                <DropdownMenuItem
                  onClick={async () => {
                    await api.chat.setThreadModel(thread.thread_id, null).catch(() => {});
                    setThread({ ...thread, model_id: null });
                  }}
                  data-testid="chat-thread-model-default"
                >
                  Use default ({defaultModel ?? "unset"})
                </DropdownMenuItem>
                {installedModels.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-[var(--text-tertiary)]">
                      Local (Ollama)
                    </DropdownMenuLabel>
                    {installedModels.map((m) => (
                      <DropdownMenuItem
                        key={m}
                        onClick={async () => {
                          await api.chat.setThreadModel(thread.thread_id, m).catch(() => {});
                          setThread({ ...thread, model_id: m });
                        }}
                        data-testid={`chat-thread-model-${m}`}
                      >
                        <span className="truncate">{m}</span>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                {hasClaudeKey && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-[var(--text-tertiary)]">
                      Anthropic
                    </DropdownMenuLabel>
                    {LLM_MODELS.filter((e) => e.provider === "claude").map((entry) => (
                      <DropdownMenuItem
                        key={entry.id}
                        onClick={async () => {
                          await api.chat.setThreadModel(thread.thread_id, entry.id).catch(() => {});
                          setThread({ ...thread, model_id: entry.id });
                        }}
                      >
                        <span className="truncate">Claude {entry.label}</span>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                {hasOpenaiKey && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-[var(--text-tertiary)]">
                      OpenAI
                    </DropdownMenuLabel>
                    {LLM_MODELS.filter((e) => e.provider === "openai").map((entry) => (
                      <DropdownMenuItem
                        key={entry.id}
                        onClick={async () => {
                          await api.chat.setThreadModel(thread.thread_id, entry.id).catch(() => {});
                          setThread({ ...thread, model_id: entry.id });
                        }}
                      >
                        <span className="truncate">{entry.label}</span>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                await api.chat.deleteThread(thread.thread_id).catch(() => {});
                onChanged();
                onBack();
              }}
              data-testid="chat-thread-menu-delete"
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {renameOpen && (
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-2 py-2">
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            className="h-8 flex-1 rounded-md border border-[var(--border-subtle)] bg-white px-2 text-sm"
            autoFocus
          />
          <Button
            size="sm"
            onClick={async () => {
              const trimmed = renameValue.trim();
              if (trimmed) {
                await api.chat.renameThread(thread.thread_id, trimmed);
                setThread({ ...thread, title: trimmed });
                onChanged();
              }
              setRenameOpen(false);
            }}
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRenameOpen(false)}>
            Cancel
          </Button>
        </div>
      )}

      <div
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto py-6"
        data-testid="chat-thread-messages"
      >
        {messages.map((m) => (
          <ChatMessage
            key={m.message_id}
            message={m}
            onSeek={handleSeek}
            onOpen={handleOpen}
          />
        ))}
        {pendingUserMessage && (
          <ChatMessage
            message={pendingUserMessage}
            onSeek={handleSeek}
            onOpen={handleOpen}
          />
        )}
        {liveText && (
          <div
            className="w-full whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]"
            data-testid="chat-message"
            data-role="assistant-live"
          >
            {liveText}
          </div>
        )}
        {streaming && !liveText && (
          <ThinkingIndicator label={statusLine} />
        )}
        <div ref={bottomRef} />
      </div>

      <div className="pb-6">
        <ChatComposer
          onSend={handleSend}
          disabled={streaming}
          initialModel={thread.model_id ?? null}
          onModelChange={async (modelId) => {
            await api.chat.setThreadModel(thread.thread_id, modelId ?? null);
          }}
        />
      </div>
    </div>
  );
}

function ComposeAndSend({
  onSent,
  autoFocus,
}: {
  onSent: (threadId: string) => void;
  autoFocus?: boolean;
}) {
  const [sending, setSending] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedFilters, setSelectedFilters] = useState<ChatSendFilters>({});
  const navigatedRef = useRef(false);

  const handleSend = useCallback(
    async (
      message: string,
      modelOverride?: string,
      filters?: ChatSendFilters,
    ) => {
      setSending(true);
      navigatedRef.current = false;
      const model = modelOverride ?? selectedModel ?? undefined;
      const effectiveFilters = filters ?? selectedFilters;
      // Subscribe to stream events so we can flip to the thread view as soon
      // as main emits `messageStart` with the thread_id — far faster than
      // waiting for the full LLM response to land.
      const unsub = api.on.chatStream((event) => {
        if (event.type === "messageStart" && !navigatedRef.current) {
          navigatedRef.current = true;
          // Persist the user's explicit model choice on the new thread so
          // subsequent turns in the thread keep using it.
          if (model) {
            void api.chat.setThreadModel(event.thread_id, model).catch(() => {});
          }
          onSent(event.thread_id);
        }
      });
      try {
        const resp = await api.chat.send({
          userMessage: message,
          modelOverride: model,
          filters: effectiveFilters,
        });
        if (!navigatedRef.current) {
          if (model) {
            void api.chat.setThreadModel(resp.thread_id, model).catch(() => {});
          }
          onSent(resp.thread_id);
        }
      } finally {
        setSending(false);
        unsub();
      }
    },
    [onSent, selectedModel, selectedFilters],
  );

  return (
    <ChatComposer
      onSend={handleSend}
      disabled={sending}
      autoFocus={autoFocus}
      initialModel={selectedModel}
      onModelChange={(m) => setSelectedModel(m)}
      initialFilters={selectedFilters}
      onFiltersChange={(f) => setSelectedFilters(f)}
    />
  );
}

function BackfillBanner({
  progress,
  pendingCount,
  onStart,
}: {
  progress: ChatBackfillProgressDTO | null;
  pendingCount: number | null;
  onStart: () => void;
}) {
  const [autoStarted, setAutoStarted] = useState(false);

  // Small libraries: auto-start as soon as we see pending meetings, no UI
  // noise. The user won't notice the indexing is happening.
  useEffect(() => {
    if (autoStarted) return;
    if (!progress || progress.state !== "idle") return;
    if (pendingCount != null && pendingCount > 0 && pendingCount < 5) {
      setAutoStarted(true);
      onStart();
    }
  }, [progress, pendingCount, onStart, autoStarted]);

  if (!progress) return null;

  // Running — unobtrusive strip visible across all bucket sizes.
  if (progress.state === "running") {
    return (
      <div
        className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-secondary)]"
        data-testid="chat-backfill-banner"
      >
        Indexing {progress.completed} of {progress.total} meetings — chat may miss
        recent ones until done.
      </div>
    );
  }

  // Idle + nothing pending: nothing to show.
  if (progress.state !== "idle" || !pendingCount || pendingCount <= 0) {
    return null;
  }

  // 5–50 meetings: a soft strip with a Start button — background-friendly,
  // not in your face.
  if (pendingCount <= 50) {
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-secondary)]"
        data-testid="chat-backfill-banner"
        data-variant="strip"
      >
        <span>
          Index your {pendingCount} meetings for chat. This runs in the background.
        </span>
        <Button size="sm" onClick={onStart} data-testid="chat-backfill-start">
          Start
        </Button>
      </div>
    );
  }

  // 50+ meetings: explicit Start/Later card with an estimate.
  const minutes = Math.max(1, Math.round((pendingCount * 3) / 60));
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--text-secondary)]"
      data-testid="chat-backfill-banner"
      data-variant="card"
    >
      <div>
        <h3 className="text-sm font-medium text-[var(--text-primary)]">
          Index your {pendingCount} meetings for chat
        </h3>
        <p className="mt-1 text-xs">
          Runs in the background. Estimated {minutes} minute
          {minutes === 1 ? "" : "s"} depending on meeting length.
        </p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onStart} data-testid="chat-backfill-start">
          Start indexing
        </Button>
        <Button
          size="sm"
          variant="ghost"
          data-testid="chat-backfill-later"
          onClick={() => {
            /* no-op — user dismisses by doing something else */
          }}
        >
          Later
        </Button>
      </div>
    </div>
  );
}

function bucketThreadsByTime(threads: ChatThreadDTO[]): {
  label: string;
  threads: ChatThreadDTO[];
}[] {
  const today: ChatThreadDTO[] = [];
  const thisWeek: ChatThreadDTO[] = [];
  const earlier: ChatThreadDTO[] = [];
  const now = Date.now();
  for (const t of threads) {
    const age = now - new Date(t.updated_at).getTime();
    if (age < 24 * 60 * 60 * 1000) today.push(t);
    else if (age < 7 * 24 * 60 * 60 * 1000) thisWeek.push(t);
    else earlier.push(t);
  }
  return [
    { label: "Today", threads: today },
    { label: "This week", threads: thisWeek },
    { label: "Earlier", threads: earlier },
  ];
}

function formatRelativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - d;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}
