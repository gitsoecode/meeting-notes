import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Plus, Search, Settings2 } from "lucide-react";
import { api } from "../ipc-client";
import type { AppConfigDTO, PromptRow, RunSummary } from "../../../shared/ipc";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { ModelDropdown } from "../components/ModelDropdown";
import { PageScaffold } from "../components/PageScaffold";
import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../components/ui/accordion";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Input } from "../components/ui/input";
import { Spinner } from "../components/ui/spinner";
import { Switch } from "../components/ui/switch";
import { Textarea } from "../components/ui/textarea";
import { Separator } from "../components/ui/separator";
import { classifyModelClient, localModelIdsMatch, relativeDateLabel } from "../constants";
import { getDefaultPromptModel } from "../lib/prompt-metadata";
import { isPrimaryPromptId } from "../../../shared/meeting-prompts";

function sortPrompts(a: PromptRow, b: PromptRow) {
  if (a.sort_order != null && b.sort_order != null && a.sort_order !== b.sort_order) {
    return a.sort_order - b.sort_order;
  }
  if (a.sort_order != null && b.sort_order == null) return -1;
  if (a.sort_order == null && b.sort_order != null) return 1;
  return a.label.localeCompare(b.label);
}

function toPromptSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface PromptsEditorProps {
  config: AppConfigDTO;
  initialPromptId?: string;
  onDirtyChange?: (isDirty: boolean) => void;
}

type PendingConfirmState = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirmVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  action: () => Promise<void> | void;
};

function modelIdsMatch(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  if (classifyModelClient(left) === "ollama" || classifyModelClient(right) === "ollama") {
    return localModelIdsMatch(left, right);
  }
  return left === right;
}

export function PromptsEditor({ config, initialPromptId, onDirtyChange }: PromptsEditorProps) {
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftFilename, setDraftFilename] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftModelOverride, setDraftModelOverride] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runAgainstOpen, setRunAgainstOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [installedLocalModels, setInstalledLocalModels] = useState<string[]>([]);
  const [hasClaude, setHasClaude] = useState(false);
  const [hasOpenai, setHasOpenai] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmState | null>(null);
  const [confirmingAction, setConfirmingAction] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const defaultModel = useMemo(() => getDefaultPromptModel(config), [config]);

  const refreshInstalledLocal = () => {
    api.llm.listInstalled().then(setInstalledLocalModels).catch(() => setInstalledLocalModels([]));
  };

  const refresh = async (preferredPromptId?: string | null) => {
    setLoading(true);
    try {
      const list = await api.prompts.list();
      setPrompts(list);
      const requestedPrompt =
        preferredPromptId != null
          ? list.find((prompt) => prompt.id === preferredPromptId) ?? null
          : null;
      const defaultPrompt =
        requestedPrompt
        ?? list.find((prompt) => isPrimaryPromptId(prompt.id))
        ?? list[0]
        ?? null;
      const target =
        requestedPrompt
        ?? (activeId != null
          ? list.find((prompt) => prompt.id === activeId) ?? defaultPrompt
          : defaultPrompt);
      if (target) {
        setActiveId(target.id);
        setDraftBody(target.body);
        setDraftLabel(target.label);
        setDraftFilename(target.filename);
        setDraftDescription(target.description ?? "");
        setDraftModelOverride(target.model);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh(initialPromptId ?? null);
    refreshInstalledLocal();
    api.secrets.has("claude").then(setHasClaude).catch(() => {});
    api.secrets.has("openai").then(setHasOpenai).catch(() => {});
  }, [initialPromptId]);

  const active = prompts.find((prompt) => prompt.id === activeId) ?? null;

  const filteredPrompts = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return prompts;
    return prompts.filter(p => p.label.toLowerCase().includes(query) || p.id.toLowerCase().includes(query));
  }, [prompts, searchQuery]);

  const preloadedPrompts = useMemo(
    () =>
      filteredPrompts
        .filter((prompt) => prompt.builtin)
        .sort((left, right) => {
          if (isPrimaryPromptId(left.id) && !isPrimaryPromptId(right.id)) return -1;
          if (!isPrimaryPromptId(left.id) && isPrimaryPromptId(right.id)) return 1;
          return sortPrompts(left, right);
        }),
    [filteredPrompts]
  );

  const customPrompts = useMemo(
    () => filteredPrompts.filter((prompt) => !prompt.builtin).sort(sortPrompts),
    [filteredPrompts]
  );

  const hasUnsavedChanges = useMemo(() => 
    active != null && (
      draftBody !== active.body ||
      draftLabel !== active.label ||
      draftFilename !== active.filename ||
      draftDescription !== (active.description ?? "") ||
      draftModelOverride !== active.model
    ), [active, draftBody, draftLabel, draftFilename, draftDescription, draftModelOverride]);

  const resolvedDraftModel = draftModelOverride ?? defaultModel ?? "";

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);

  const onConfirmPendingAction = async () => {
    if (!pendingConfirm) return;
    setConfirmingAction(true);
    try {
      await pendingConfirm.action();
      setPendingConfirm(null);
    } finally {
      setConfirmingAction(false);
    }
  };

  const selectPrompt = (prompt: PromptRow) => {
    const switchPrompt = () => {
      setActiveId(prompt.id);
      setDraftBody(prompt.body);
      setDraftLabel(prompt.label);
      setDraftFilename(prompt.filename);
      setDraftDescription(prompt.description ?? "");
      setDraftModelOverride(prompt.model);
    };

    if (!hasUnsavedChanges) {
      switchPrompt();
      return;
    }

    setPendingConfirm({
      title: "Discard prompt changes?",
      description: "You have unsaved edits to this prompt. Discard them and switch prompts?",
      confirmLabel: "Discard changes",
      cancelLabel: "Keep editing",
      action: switchPrompt,
    });
  };

  const onSave = async () => {
    if (!active) return;
    setSaving(true);
    try {
      await api.prompts.save(active.id, draftBody, {
        label: draftLabel,
        filename: draftFilename,
        description: draftDescription.trim() || null,
        model: draftModelOverride,
      });
      await refresh(active.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const onSetAutoRun = async (prompt: PromptRow, auto: boolean) => {
    if (prompt.auto === auto && prompt.enabled === auto) return;
    await api.prompts.setAuto(prompt.id, auto);
    await refresh(prompt.id);
  };

  const onReset = async () => {
    if (!active?.builtin) return;
    setPendingConfirm({
      title: "Reset prompt to default?",
      description: `Reset "${active.label}" to its factory default content?`,
      confirmLabel: "Reset prompt",
      cancelLabel: "Keep current version",
      confirmVariant: "destructive",
      action: async () => {
        await api.prompts.resetToDefault(active.id);
        await refresh(active.id);
      },
    });
  };

  const onOpenFinder = () => api.prompts.openInFinder(activeId ?? undefined);

  if (loading) {
    return (
      <PageScaffold>
        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <Spinner className="h-3.5 w-3.5" /> Loading prompts…
        </div>
      </PageScaffold>
    );
  }

  return (
    <PageScaffold>
      {error && (
        <div className="mb-4 rounded-md border border-[var(--error)]/20 bg-[var(--error-muted)] px-3 py-2 text-sm text-[var(--error)]">
          {error}
        </div>
      )}

      <div className="flex h-[calc(100vh-var(--header-height)-2.5rem)] gap-0 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-white shadow-sm">
        <div className="flex w-52 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-secondary)]/30 lg:w-64">
          <div className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Library</h2>
              <Button
                variant="secondary"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => setNewOpen(true)}
                aria-label="Create prompt"
              >
                <Plus className="h-3.5 w-3.5" />
                New
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
              <Input
                placeholder="Filter..."
                className="h-8 bg-white/50 pl-8 text-xs focus:bg-white"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-4">
            <div className="space-y-4">
              {preloadedPrompts.length > 0 && (
                <div className="space-y-1 px-2" data-testid="prompt-category-pre-loaded">
                  <div className="px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--text-tertiary)]/70">
                    Pre-loaded
                  </div>
                  <div className="space-y-0.5">
                    {preloadedPrompts.map((prompt) => (
                      <PromptSidebarItem
                        key={prompt.id}
                        prompt={prompt}
                        active={activeId === prompt.id}
                        dirty={hasUnsavedChanges && activeId === prompt.id}
                        dataTestId={isPrimaryPromptId(prompt.id) ? "prompt-root-item" : undefined}
                        emphasized={isPrimaryPromptId(prompt.id)}
                        onSelect={() => selectPrompt(prompt)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {(customPrompts.length > 0 || !searchQuery) && (
                <div className="space-y-1 px-2" data-testid="prompt-custom-group">
                  <div className="px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--text-tertiary)]/70">
                    Custom
                  </div>
                  <div className="space-y-0.5 px-0.5">
                    {customPrompts.length === 0 ? (
                      <div className="px-3 py-2 text-[11px] italic text-[var(--text-tertiary)]">
                        None yet
                      </div>
                    ) : (
                      customPrompts.map((prompt) => (
                        <PromptSidebarItem
                          key={prompt.id}
                          prompt={prompt}
                          active={activeId === prompt.id}
                          dirty={hasUnsavedChanges && activeId === prompt.id}
                          onSelect={() => selectPrompt(prompt)}
                        />
                      ))
                    )}
                  </div>
                </div>
              )}

              {searchQuery && preloadedPrompts.length === 0 && customPrompts.length === 0 && (
                <div className="px-4 py-8 text-center text-xs text-[var(--text-tertiary)]">
                  No prompts matching &ldquo;{searchQuery}&rdquo;
                </div>
              )}
            </div>
          </div>
        </div>

        {active ? (
          <div className="flex flex-1 flex-col bg-white">
            <div className={`flex items-center justify-between border-b px-4 py-4 transition-colors md:px-6 ${hasUnsavedChanges ? "border-[var(--warning)]/50 bg-[var(--warning-muted)]/5" : "border-[var(--border-subtle)] bg-white"}`}>
              <div className="flex-1">
                <Input
                  id="prompt-title"
                  value={draftLabel}
                  onChange={(e) => setDraftLabel(e.target.value)}
                  className="h-auto border-none bg-transparent p-0 text-xl font-bold shadow-none focus-visible:ring-0"
                />
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-xs text-[var(--text-secondary)]"
                  onClick={onOpenFinder}
                  aria-label="Open in Finder"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Finder
                </Button>
                <Button
                  onClick={onSave}
                  disabled={saving || !hasUnsavedChanges}
                  size="sm"
                  className={`h-8 transition-all duration-300 ${hasUnsavedChanges ? "bg-[var(--accent)] shadow-lg ring-4 ring-[var(--accent)]/15 scale-105" : ""}`}
                >
                  {saving ? <><Spinner className="mr-2 h-3.5 w-3.5" /> Saving</> : "Save changes"}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Prompt actions">
                      <Settings2 className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {active.builtin && (
                      <DropdownMenuItem onSelect={onReset}>Reset to default</DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => setRunAgainstOpen(true)}>
                      Run against meeting
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex flex-wrap items-center gap-4 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/20 px-4 py-3 md:gap-6 md:px-6">
                <div className="flex items-center gap-3">
                  <label
                    htmlFor="prompt-output-filename"
                    className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]"
                  >
                    Output
                  </label>
                  <Input
                    id="prompt-output-filename"
                    value={draftFilename}
                    onChange={(e) => setDraftFilename(e.target.value)}
                    className="h-8 w-40 bg-white text-xs md:w-48"
                    placeholder="summary.md"
                  />
                </div>
                <Separator orientation="vertical" className="hidden h-4 md:block" />
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Model</span>
                  <ModelDropdown
                    value={resolvedDraftModel}
                    onChange={(next) =>
                      setDraftModelOverride(
                        !next || modelIdsMatch(next, defaultModel) ? null : next
                      )
                    }
                    installedLocalModels={installedLocalModels}
                    availableKeys={{ claude: hasClaude, openai: hasOpenai }}
                    allowCustom={false}
                    localMode="installed-only"
                    className="w-40 md:w-48"
                  />
                </div>
                <Separator orientation="vertical" className="hidden h-4 md:block" />
                <div className="flex items-center gap-3">
                  <Switch
                    id="prompt-auto-run"
                    checked={active.enabled && active.auto}
                    onCheckedChange={(checked) => void onSetAutoRun(active, checked)}
                  />
                  <label
                    htmlFor="prompt-auto-run"
                    className="text-xs font-semibold text-[var(--text-secondary)]"
                  >
                    Auto-run
                  </label>
                </div>
              </div>

              <Accordion
                type="single"
                collapsible
                value={detailsOpen ? "details" : undefined}
                onValueChange={(value) => setDetailsOpen(value === "details")}
                className="w-full bg-[var(--bg-secondary)]/20"
              >
                <AccordionItem
                  value="details"
                  className="rounded-none border-0 border-b border-[var(--border-subtle)] bg-transparent px-0"
                >
                  <AccordionTrigger className="min-h-8 px-4 py-0 text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] hover:no-underline md:px-6">
                    Details
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-0 pt-0 md:px-6 [&>div]:pb-5">
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_13rem]">
                      <div className="space-y-2 md:col-span-2">
                        <label
                          htmlFor="prompt-description"
                          className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-tertiary)]"
                        >
                          Description
                        </label>
                        <Textarea
                          id="prompt-description"
                          value={draftDescription}
                          onChange={(e) => setDraftDescription(e.target.value)}
                          className="min-h-[88px] resize-y text-sm"
                          placeholder="Short note to explain what this prompt is for."
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                          System ID
                        </label>
                        <div className="flex h-9 items-center rounded-md border border-[var(--border-default)] bg-white px-3 font-mono text-sm text-[var(--text-secondary)] shadow-sm">
                          {active.id}
                        </div>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <div className="flex min-h-0 flex-1 bg-white p-6">
                <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-[var(--border-subtle)] bg-white shadow-sm focus-within:ring-1 focus-within:ring-[var(--accent)]/30">
                  <MarkdownEditor value={draftBody} onChange={setDraftBody} className="h-full" />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center bg-[var(--bg-secondary)]/10 text-sm text-[var(--text-tertiary)]">
            Select a prompt from the library to edit
          </div>
        )}
      </div>

      {runAgainstOpen && active && (
        <RunAgainstMeetingModal
          promptId={active.id}
          promptLabel={active.label}
          onClose={() => setRunAgainstOpen(false)}
        />
      )}

      {newOpen && (
        <NewPromptModal
          onClose={() => setNewOpen(false)}
          onCreated={(id) => {
            setNewOpen(false);
            setActiveId(id);
            void refresh(id);
          }}
        />
      )}

      <ConfirmDialog
        open={pendingConfirm != null}
        onOpenChange={(open) => {
          if (!open && !confirmingAction) {
            setPendingConfirm(null);
          }
        }}
        title={pendingConfirm?.title ?? ""}
        description={pendingConfirm?.description ?? ""}
        cancelLabel={pendingConfirm?.cancelLabel}
        confirmLabel={pendingConfirm?.confirmLabel ?? "Confirm"}
        confirmVariant={pendingConfirm?.confirmVariant}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => void onConfirmPendingAction()}
        disabled={confirmingAction}
      />
    </PageScaffold>
  );
}

function PromptSidebarItem({
  prompt,
  active,
  dirty,
  onSelect,
  dataTestId,
  emphasized,
}: {
  prompt: PromptRow;
  active: boolean;
  dirty?: boolean;
  onSelect: () => void;
  dataTestId?: string;
  emphasized?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={dataTestId}
      className={`group relative flex w-full items-center justify-between rounded-md px-3 py-[7px] text-left transition-all ${
        emphasized
          ? active
            ? "bg-[rgba(45,107,63,0.14)] font-semibold text-[var(--text-primary)] shadow-sm ring-1 ring-[rgba(45,107,63,0.18)]"
            : "bg-[rgba(45,107,63,0.06)] text-[var(--text-primary)] hover:bg-[rgba(45,107,63,0.11)]"
          : active
            ? "bg-white font-semibold text-[var(--text-primary)] shadow-sm ring-1 ring-black/5"
            : "text-[var(--text-secondary)] hover:bg-white/60 hover:text-[var(--text-primary)]"
      }`}
    >
      <div className="min-w-0">
        <span className="block truncate text-xs leading-snug">{prompt.label}</span>
        {emphasized ? (
          <div className="mt-0.5 text-[10px] font-semibold uppercase leading-tight tracking-[0.14em] text-[var(--accent)]">
            Primary prompt
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {dirty && (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
        )}
      </div>
      {active && (
        <div className="absolute inset-y-0 left-0 my-auto h-4 w-0.5 rounded-full bg-[var(--accent)]" />
      )}
    </button>
  );
}

function RunAgainstMeetingModal({
  promptId,
  promptLabel,
  onClose,
}: {
  promptId: string;
  promptLabel: string;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    api.runs.list().then(setRuns);
  }, []);

  const sortedFiltered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? runs.filter((run) => run.title.toLowerCase().includes(query))
      : runs;
    const sorted = [...filtered].sort((a, b) => {
      return (Date.parse(b.started || b.date) || 0) - (Date.parse(a.started || a.date) || 0);
    });
    return showAll ? sorted : sorted.slice(0, 12);
  }, [runs, search, showAll]);

  const toggle = (folder: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  const onRun = async () => {
    if (selected.size === 0) return;
    setRunning(true);
    setError(null);
    try {
      for (const folder of selected) {
        await api.runs.startReprocess({ runFolder: folder, onlyIds: [promptId] });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run "{promptLabel}"</DialogTitle>
          <DialogDescription>Select meetings to run this prompt against.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search meetings" />
          <div className="max-h-[320px] space-y-1 overflow-auto rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2">
            {sortedFiltered.map((run) => (
              <button
                key={run.folder_path}
                type="button"
                onClick={() => toggle(run.folder_path)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${
                  selected.has(run.folder_path)
                    ? "bg-[rgba(45,107,63,0.08)] font-medium text-[var(--text-primary)]"
                    : "bg-white text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-[var(--text-primary)]">{run.title}</div>
                  <div className="text-xs text-[var(--text-tertiary)]">
                    {relativeDateLabel(run.started || run.date)}
                  </div>
                </div>
                <Badge
                  variant={
                    run.status === "complete" ? "success"
                      : run.status === "processing" ? "info"
                      : run.status === "error" ? "destructive"
                      : "warning"
                  }
                >
                  {run.status}
                </Badge>
              </button>
            ))}
          </div>
          {runs.length > 12 ? (
            <Button variant="ghost" size="sm" onClick={() => setShowAll((prev) => !prev)}>
              {showAll ? "Show fewer" : "Show all"}
            </Button>
          ) : null}
          {error ? <div className="text-sm text-[var(--error)]">{error}</div> : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={running}>Cancel</Button>
          <Button onClick={onRun} disabled={running || selected.size === 0}>
            {running ? <><Spinner className="h-3.5 w-3.5" /> Running…</> : `Run on ${selected.size}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewPromptModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [filename, setFilename] = useState("");
  const [body, setBody] = useState("Describe what this prompt should produce.");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idEdited, setIdEdited] = useState(false);
  const [filenameEdited, setFilenameEdited] = useState(false);

  useEffect(() => {
    const slug = toPromptSlug(label);
    if (!idEdited) {
      setId(slug);
    }
    if (!filenameEdited) {
      setFilename(slug ? `${slug}.md` : "");
    }
  }, [label, idEdited, filenameEdited]);

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.prompts.create(id.trim(), label.trim(), filename.trim(), body);
      onCreated(id.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[780px] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-[var(--border-subtle)] bg-[linear-gradient(180deg,rgba(45,107,63,0.07),rgba(45,107,63,0))] px-6 pb-5 pt-6">
          <DialogTitle>New prompt</DialogTitle>
          <DialogDescription className="max-w-[44rem] text-[15px] leading-6">
            Start with a name and the instructions you want it to run. Advanced details are optional.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 px-6 py-6">
          <div className="space-y-2">
            <label htmlFor="new-prompt-label" className="text-sm font-medium text-[var(--text-primary)]">
              Prompt name
            </label>
            <Input
              id="new-prompt-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Follow-up email"
              className="h-11 text-base"
            />
            <p className="text-xs text-[var(--text-tertiary)]">
              This is what shows up in your prompt library.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="new-prompt-body" className="text-sm font-medium text-[var(--text-primary)]">
              Body
            </label>
            <Textarea
              id="new-prompt-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={9}
              className="min-h-[220px] resize-y text-sm leading-6"
            />
            <p className="text-xs text-[var(--text-tertiary)]">
              Write the instructions for what this prompt should produce.
            </p>
          </div>

          <Accordion
            type="single"
            collapsible
            defaultValue="advanced"
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/20"
          >
            <AccordionItem value="advanced" className="border-0">
              <AccordionTrigger className="px-4 py-3 text-xs font-bold uppercase tracking-[0.15em] text-[var(--text-tertiary)] hover:no-underline">
                Advanced details
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4 pt-0 [&>div]:pb-0">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor="new-prompt-id" className="text-xs font-medium text-[var(--text-secondary)]">
                      ID
                    </label>
                    <Input
                      id="new-prompt-id"
                      value={id}
                      onChange={(e) => {
                        setIdEdited(true);
                        setId(e.target.value);
                      }}
                      placeholder="follow-up-email"
                    />
                    <p className="text-xs text-[var(--text-tertiary)]">
                      Used internally and in the saved prompt file name.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="new-prompt-fn" className="text-xs font-medium text-[var(--text-secondary)]">
                      Output filename
                    </label>
                    <Input
                      id="new-prompt-fn"
                      value={filename}
                      onChange={(e) => {
                        setFilenameEdited(true);
                        setFilename(e.target.value);
                      }}
                      placeholder="follow-up-email.md"
                    />
                    <p className="text-xs text-[var(--text-tertiary)]">
                      Defaults to the generated ID with a `.md` extension.
                    </p>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {label.trim() ? (
            <div className="rounded-lg border border-[var(--border-subtle)] bg-white px-4 py-3 text-xs text-[var(--text-secondary)]">
              Creates <span className="font-medium text-[var(--text-primary)]">{id || "untitled-prompt"}</span>
              {" "}and saves output to{" "}
              <span className="font-medium text-[var(--text-primary)]">{filename || "untitled-prompt.md"}</span>.
            </div>
          ) : null}

          {error ? <div className="text-sm text-[var(--error)]">{error}</div> : null}
        </div>
        <DialogFooter className="border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]/20 px-6 py-4">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={onSave} disabled={saving || !id.trim() || !label.trim() || !filename.trim()}>
            {saving ? <><Spinner className="h-3.5 w-3.5" /> Creating…</> : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
