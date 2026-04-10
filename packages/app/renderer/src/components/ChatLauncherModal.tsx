import { useEffect, useMemo, useState } from "react";
import { ClipboardCopy, Check } from "lucide-react";
import { api } from "../ipc-client";
import type {
  AppConfigDTO,
  ChatAppId,
  ChatAppInfo,
  LaunchChatResult,
  RunDetail,
} from "../../../shared/ipc";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Spinner } from "./ui/spinner";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";

interface ChatLauncherModalProps {
  runFolder: string;
  detail: RunDetail;
  config: AppConfigDTO;
  onClose: () => void;
}

const DEFAULT_PROMPT =
  "Below is the full context from a meeting I recorded and processed. " +
  "Please review it and be ready to answer questions, generate follow-ups, " +
  "or help me take action on what was discussed.";

export function ChatLauncherModal({
  runFolder,
  detail,
  config,
  onClose,
}: ChatLauncherModalProps) {
  const [apps, setApps] = useState<ChatAppInfo[]>([]);
  const [loadingApps, setLoadingApps] = useState(true);
  const [selectedApp, setSelectedApp] = useState<ChatAppId | null>(null);
  const [customAppName, setCustomAppName] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [prompt, setPrompt] = useState(
    config.chat_launcher?.default_prompt || DEFAULT_PROMPT
  );
  const [launching, setLaunching] = useState(false);
  const [result, setResult] = useState<LaunchChatResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mdFiles = useMemo(
    () =>
      detail.files
        .filter((f) => f.kind === "document" && f.name.endsWith(".md"))
        .map((f) => f.name)
        .sort(),
    [detail.files]
  );

  // Initialize: detect apps and pre-select all md files
  useEffect(() => {
    setSelectedFiles(mdFiles);
    api.chatLauncher
      .detectApps()
      .then((detected) => {
        setApps(detected);
        const firstInstalled = detected.find(
          (a) => a.installed && a.id !== "custom"
        );
        setSelectedApp(firstInstalled?.id ?? "custom");
      })
      .catch(() => {
        // Handler not registered yet — fall back to showing all apps as available
        const fallback: ChatAppInfo[] = [
          { id: "chatgpt", label: "ChatGPT", installed: true },
          { id: "claude", label: "Claude", installed: true },
          { id: "ollama", label: "Ollama", installed: true },
          { id: "custom", label: "Custom", installed: true },
        ];
        setApps(fallback);
        setSelectedApp("chatgpt");
      })
      .finally(() => setLoadingApps(false));
  }, [mdFiles]);

  const toggleFile = (name: string) => {
    setSelectedFiles((prev) =>
      prev.includes(name) ? prev.filter((f) => f !== name) : [...prev, name]
    );
  };

  const installedApps = useMemo(
    () => apps.filter((a) => a.installed),
    [apps]
  );

  const selectedAppLabel = useMemo(() => {
    if (selectedApp === "custom") return customAppName || "Custom";
    return apps.find((a) => a.id === selectedApp)?.label ?? "";
  }, [selectedApp, customAppName, apps]);

  const estimatedChars = useMemo(() => {
    let total = prompt.length;
    for (const name of selectedFiles) {
      const file = detail.files.find((f) => f.name === name);
      total += (file?.size ?? 0) + name.length + 10;
    }
    return total;
  }, [prompt, selectedFiles, detail.files]);

  const canLaunch =
    selectedApp != null &&
    (selectedApp !== "custom" || customAppName.trim() !== "") &&
    selectedFiles.length > 0;

  const onLaunch = async () => {
    if (!canLaunch || !selectedApp) return;
    setLaunching(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.chatLauncher.launch({
        appId: selectedApp,
        customAppName: selectedApp === "custom" ? customAppName.trim() : undefined,
        runFolder,
        fileNames: selectedFiles,
        startingPrompt: prompt,
      });
      if (res.ok) {
        setResult(res);
      } else {
        setError(res.error ?? "Launch failed.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-4 max-w-lg">
        <DialogHeader>
          <DialogTitle>Launch chat</DialogTitle>
          <DialogDescription>
            Copy meeting context to your clipboard and open an AI chat app.
            Paste to start chatting.
          </DialogDescription>
        </DialogHeader>

        {result?.ok ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-[var(--accent)]/20 bg-[rgba(45,107,63,0.06)] px-4 py-3 text-sm text-[var(--text-primary)]">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
              <div>
                <div className="font-medium">
                  Context copied &amp; {selectedAppLabel} launched
                </div>
                <div className="mt-1 text-[var(--text-secondary)]">
                  {(result.charsCopied ?? 0).toLocaleString()} characters on
                  your clipboard. Press{" "}
                  <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-xs font-mono">
                    Cmd+V
                  </kbd>{" "}
                  in {selectedAppLabel} to paste.
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {/* App selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-secondary)]">
                App
              </label>
              {loadingApps ? (
                <div className="flex items-center gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5 text-sm text-[var(--text-secondary)]">
                  <Spinner />
                  Detecting installed apps…
                </div>
              ) : installedApps.length === 0 ? (
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5 text-sm text-[var(--text-secondary)]">
                  No supported chat apps detected.
                </div>
              ) : (
                <Select
                  value={selectedApp ?? undefined}
                  onValueChange={(v) => setSelectedApp(v as ChatAppId)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select an app" />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={4}>
                    {installedApps.map((app) => (
                      <SelectItem key={app.id} value={app.id}>
                        {app.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {selectedApp === "custom" && (
                <Input
                  placeholder="App name (e.g. Cursor)"
                  value={customAppName}
                  onChange={(e) => setCustomAppName(e.target.value)}
                />
              )}
            </div>

            {/* File selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-[var(--text-secondary)]">
                  Files to include
                </label>
                <div className="flex items-center gap-1.5 text-xs">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedFiles(mdFiles)}
                    disabled={selectedFiles.length === mdFiles.length}
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedFiles([])}
                    disabled={selectedFiles.length === 0}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <div className="max-h-[200px] space-y-1.5 overflow-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]/40 p-3 pr-1">
                {mdFiles.length === 0 ? (
                  <div className="rounded-md bg-white px-3 py-2.5 text-sm text-[var(--text-secondary)]">
                    No markdown files available for this meeting.
                  </div>
                ) : (
                  mdFiles.map((name) => {
                    const checked = selectedFiles.includes(name);
                    const file = detail.files.find((f) => f.name === name);
                    return (
                      <label
                        key={name}
                        className={`flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors cursor-pointer ${
                          checked
                            ? "border-[var(--accent)] bg-white shadow-sm"
                            : "border-[var(--border-default)] bg-white hover:bg-[var(--bg-primary)]"
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleFile(name)}
                        />
                        <div className="min-w-0 flex-1">
                          <span className="font-medium text-[var(--text-primary)]">
                            {name}
                          </span>
                        </div>
                        {file && (
                          <Badge variant="neutral" className="shrink-0">
                            {formatSize(file.size)}
                          </Badge>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {/* Starting prompt */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-secondary)]">
                Starting prompt
              </label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                className="resize-none"
                placeholder="Instructions to include before the meeting files…"
              />
              <div className="text-xs text-[var(--text-secondary)]">
                ~{estimatedChars.toLocaleString()} characters will be copied
              </div>
            </div>

            {error && (
              <div className="text-sm text-[var(--error)]">{error}</div>
            )}

            <DialogFooter>
              <Button variant="secondary" onClick={onClose} disabled={launching}>
                Cancel
              </Button>
              <Button onClick={onLaunch} disabled={!canLaunch || launching}>
                {launching ? (
                  <>
                    <Spinner />
                    Launching…
                  </>
                ) : (
                  <>
                    <ClipboardCopy className="h-3.5 w-3.5" />
                    Copy &amp; Launch
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
