import { useEffect, useMemo, useState } from "react";
import { ArrowUp, User, X } from "lucide-react";
import { api } from "../ipc-client";
import { LLM_MODELS } from "../constants";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import type { ChatSendFilters, ParticipantDTO } from "../../../shared/ipc";

interface ChatComposerProps {
  onSend: (
    message: string,
    modelOverride?: string,
    filters?: ChatSendFilters,
  ) => void;
  disabled?: boolean;
  placeholder?: string;
  initialModel?: string | null;
  onModelChange?: (model: string | null) => void;
  initialFilters?: ChatSendFilters;
  onFiltersChange?: (filters: ChatSendFilters) => void;
  autoFocus?: boolean;
}

export function ChatComposer({
  onSend,
  disabled,
  placeholder = "What do you want to know?",
  initialModel,
  onModelChange,
  initialFilters,
  onFiltersChange,
  autoFocus = false,
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const [model, setModel] = useState<string | null>(initialModel ?? null);
  const [installed, setInstalled] = useState<string[]>([]);
  const [hasClaude, setHasClaude] = useState(false);
  const [hasOpenai, setHasOpenai] = useState(false);
  const [settingsModel, setSettingsModel] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ParticipantDTO[]>([]);
  const [filters, setFilters] = useState<ChatSendFilters>(initialFilters ?? {});

  useEffect(() => {
    api.llm.listInstalled().then(setInstalled).catch(() => setInstalled([]));
    api.secrets.has("claude").then(setHasClaude).catch(() => {});
    api.secrets.has("openai").then(setHasOpenai).catch(() => {});
    api.chat.getSettings().then((s) => setSettingsModel(s.default_model)).catch(() => {});
    api.chat
      .listParticipants()
      .then((list) => setParticipants(list.filter((p) => p.run_count > 0).slice(0, 50)))
      .catch(() => setParticipants([]));
  }, []);

  const updateFilters = (next: ChatSendFilters) => {
    setFilters(next);
    onFiltersChange?.(next);
  };

  const effectiveModel = model ?? settingsModel ?? "default";

  const options = useMemo(() => {
    const localOpts = installed.map((m) => ({ id: m, label: m, kind: "local" as const }));
    const cloudOpts: { id: string; label: string; kind: "cloud" }[] = [];
    if (hasClaude) {
      for (const entry of LLM_MODELS.filter((e) => e.provider === "claude")) {
        cloudOpts.push({ id: entry.id, label: `Claude ${entry.label}`, kind: "cloud" });
      }
    }
    if (hasOpenai) {
      for (const entry of LLM_MODELS.filter((e) => e.provider === "openai")) {
        cloudOpts.push({ id: entry.id, label: entry.label, kind: "cloud" });
      }
    }
    return { local: localOpts, cloud: cloudOpts };
  }, [installed, hasClaude, hasOpenai]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed, model ?? undefined, filters);
    setValue("");
  };

  return (
    <div
      // Focus halo: a single box-shadow-based glow instead of Tailwind's
      // `ring + ring-offset` sandwich, which rendered inconsistently at
      // the rounded corners and got visually "clipped" near tight
      // scroll-overflow ancestors. box-shadow draws fully outside the
      // element without affecting layout, and a single soft blur reads as
      // a focus halo across all browsers.
      className="rounded-2xl border border-[var(--border-subtle)] bg-white shadow-sm transition-[box-shadow,border-color] duration-150 focus-within:border-[rgba(45,107,63,0.7)] focus-within:shadow-[0_0_0_3px_rgba(45,107,63,0.18)]"
      data-testid="chat-composer"
    >
      <Textarea
        data-testid="chat-composer-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        disabled={disabled}
        autoFocus={autoFocus}
        rows={2}
        placeholder={placeholder}
        className="min-h-[56px] w-full resize-none border-none bg-transparent px-4 py-3 text-base shadow-none outline-none focus-visible:outline-none focus-visible:ring-0 focus:outline-none focus:ring-0"
      />
      <div className="flex items-center justify-between gap-2 px-3 pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="h-7 gap-1 px-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
              data-testid="chat-model-picker"
            >
              {effectiveModel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64 max-h-96 overflow-y-auto">
            <DropdownMenuItem
              onClick={() => {
                setModel(null);
                onModelChange?.(null);
              }}
            >
              Default ({settingsModel ?? "unset"})
            </DropdownMenuItem>
            {options.local.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-[var(--text-tertiary)]">
                  Local (Ollama)
                </DropdownMenuLabel>
                {options.local.map((opt) => (
                  <DropdownMenuItem
                    key={opt.id}
                    onClick={() => {
                      setModel(opt.id);
                      onModelChange?.(opt.id);
                    }}
                  >
                    <span className="truncate">{opt.label}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
            {options.cloud.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-[var(--text-tertiary)]">
                  Cloud
                </DropdownMenuLabel>
                {options.cloud.map((opt) => (
                  <DropdownMenuItem
                    key={opt.id}
                    onClick={() => {
                      setModel(opt.id);
                      onModelChange?.(opt.id);
                    }}
                  >
                    <span className="truncate">{opt.label}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <ParticipantFilter
          participants={participants}
          active={filters.participant ?? null}
          onChange={(next) =>
            updateFilters({ ...filters, participant: next ?? undefined })
          }
        />
        </div>

        <Button
          type="button"
          size="icon"
          onClick={handleSend}
          disabled={disabled || value.trim().length === 0}
          className="h-8 w-8 shrink-0 rounded-full"
          aria-label="Send message"
          data-testid="chat-composer-send"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function ParticipantFilter({
  participants,
  active,
  onChange,
}: {
  participants: ParticipantDTO[];
  active: string | null;
  onChange: (next: string | null) => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return participants;
    return participants.filter((p) =>
      [p.label, p.email ?? ""]
        .some((field) => field.toLowerCase().includes(q)),
    );
  }, [participants, query]);

  if (active) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-0.5 text-xs text-[var(--text-primary)]"
        data-testid="chat-participant-chip"
        data-participant={active}
      >
        <User className="h-3 w-3" aria-hidden />
        <span className="truncate max-w-[10rem]">{active}</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Clear participant filter"
          className="rounded hover:bg-black/5"
          data-testid="chat-participant-clear"
        >
          <X className="h-3 w-3" />
        </button>
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          className="h-7 gap-1 px-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
          data-testid="chat-participant-picker"
        >
          <User className="h-3 w-3" aria-hidden />
          Filter
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 max-h-96 overflow-y-auto">
        <DropdownMenuLabel className="text-xs text-[var(--text-tertiary)]">
          Filter by participant
        </DropdownMenuLabel>
        <div className="px-2 pb-1">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search names…"
            className="h-7 w-full rounded border border-[var(--border-subtle)] bg-white px-2 text-xs"
            data-testid="chat-participant-search"
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        <DropdownMenuSeparator />
        {query.trim() && filtered.length === 0 && (
          <DropdownMenuItem
            onClick={() => onChange(query.trim())}
            data-testid="chat-participant-option-freeform"
          >
            <span className="truncate">Use "{query.trim()}"</span>
            <span className="ml-auto text-xs text-[var(--text-tertiary)]">
              free text
            </span>
          </DropdownMenuItem>
        )}
        {filtered.length === 0 && !query.trim() && (
          <div className="px-2 py-1 text-xs text-[var(--text-tertiary)]">
            No participants detected in your library. Type a name above to
            filter by meeting title.
          </div>
        )}
        {filtered.map((p) => (
          <DropdownMenuItem
            key={p.participant_id}
            onClick={() => onChange(p.label)}
            data-testid={`chat-participant-option-${p.participant_id}`}
          >
            <span className="truncate">{p.label}</span>
            <span className="ml-auto text-xs text-[var(--text-tertiary)]">
              {p.run_count}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
