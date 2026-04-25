import { useEffect, useRef, useState } from "react";
import {
  KeyRound,
  FolderOpen,
} from "lucide-react";
import { api } from "../ipc-client";
import type {
  AppConfigDTO,
  AudioDevice,
  DepsCheckResult,
} from "../../../shared/ipc";
import { classifyModelClient, findModelEntry } from "../constants";
import { PageIntro, PageScaffold } from "../components/PageScaffold";
import { ShortcutRecorder } from "../components/ShortcutRecorder";
import { ModelDropdown } from "../components/ModelDropdown";
import { LocalModelInstaller } from "../components/LocalModelInstaller";
import { AudioLevelMeters } from "../components/AudioLevelMeters";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Spinner } from "../components/ui/spinner";
import { Switch } from "../components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Table, TableBody, TableCell, TableRow } from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";

const DEFAULT_CHAT_PROMPT =
  "Below is the full context from a meeting I recorded and processed. " +
  "Please review it and be ready to answer questions, generate follow-ups, " +
  "or help me take action on what was discussed.";

interface SettingsProps {
  config: AppConfigDTO;
  onChange: (c: AppConfigDTO) => void;
}

type PendingConfirmState = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirmVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  action: () => Promise<void> | void;
};

export function Settings({ config, onChange }: SettingsProps) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [hasClaude, setHasClaude] = useState(false);
  const [hasOpenai, setHasOpenai] = useState(false);
  const [claudeInput, setClaudeInput] = useState("");
  const [openaiInput, setOpenaiInput] = useState("");
  const [deps, setDeps] = useState<DepsCheckResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setupAsrMode, setSetupAsrMode] = useState<"install" | "reinstall" | null>(null);
  const [installedLocal, setInstalledLocal] = useState<string[]>([]);
  const [pullModel, setPullModel] = useState("");
  const [pullOpen, setPullOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmState | null>(null);
  const [confirmingAction, setConfirmingAction] = useState(false);
  const [installingWhisper, setInstallingWhisper] = useState(false);

  const apiKeysRef = useRef<HTMLElement>(null);

  const refreshInstalledLocal = () => {
    api.llm
      .listInstalled()
      .then(setInstalledLocal)
      .catch(() => setInstalledLocal([]));
  };

  const refreshDeps = () => {
    api.depsCheck().then(setDeps).catch(() => setDeps(null));
  };

  useEffect(() => {
    api.recording.listAudioDevices().then(setDevices).catch(() => {});
    api.secrets.has("claude").then(setHasClaude).catch(() => {});
    api.secrets.has("openai").then(setHasOpenai).catch(() => {});
    refreshDeps();
    refreshInstalledLocal();
  }, []);

  const save = async (next: AppConfigDTO) => {
    setError(null);
    try {
      await api.config.save(next);
      onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const setObsidianEnabled = async (enabled: boolean) => {
    setBusy("obsidian");
    try {
      await api.config.setObsidianEnabled(enabled);
      const fresh = await api.config.get();
      if (fresh) onChange(fresh);
    } finally {
      setBusy(null);
    }
  };

  const setObsidianVault = async () => {
    const picked = await api.config.pickDirectory({
      defaultPath: config.obsidian_integration.vault_path,
    });
    if (!picked) return;
    setBusy("vault");
    try {
      await api.config.setObsidianVault(picked);
      const fresh = await api.config.get();
      if (fresh) onChange(fresh);
    } finally {
      setBusy(null);
    }
  };

  const onChangeDataDir = async () => {
    const picked = await api.config.pickDirectory({ defaultPath: config.data_path });
    if (!picked) return;
    setPendingConfirm({
      title: "Move meeting storage?",
      description: `Move all meeting files to ${picked}? Existing files will be moved.`,
      confirmLabel: "Move files",
      cancelLabel: "Keep current location",
      confirmVariant: "default",
      action: async () => {
        setBusy("data-path");
        try {
          await api.config.setDataPath(picked);
          const fresh = await api.config.get();
          if (fresh) onChange(fresh);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(null);
        }
      },
    });
  };

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

  const onSaveClaudeKey = async () => {
    if (!claudeInput) return;
    await api.secrets.set("claude", claudeInput);
    setClaudeInput("");
    setHasClaude(true);
  };

  const onSaveOpenaiKey = async () => {
    if (!openaiInput) return;
    await api.secrets.set("openai", openaiInput);
    setOpenaiInput("");
    setHasOpenai(true);
  };

  const parakeetInstalled = Boolean(deps?.parakeet.path);
  const whisperInstalled = Boolean(deps?.whisper.path);

  const scrollToApiKeys = () => {
    apiKeysRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const installWhisper = async () => {
    setInstallingWhisper(true);
    try {
      const result = await api.deps.install("whisper-cpp");
      if (!result.ok) {
        if (result.brewMissing) {
          setError("Homebrew is not installed. Install it from brew.sh, then try again.");
        } else {
          setError(result.error ?? "Failed to install whisper-cpp.");
        }
      }
      refreshDeps();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallingWhisper(false);
    }
  };

  const dependencyRows =
    deps == null
      ? []
      : [
          {
            label: "ffmpeg",
            value:
              deps.ffmpeg.path
                ? `${deps.ffmpeg.path}${deps.ffmpeg.source ? ` (${deps.ffmpeg.source})` : ""}`
                : "not found",
            version: deps.ffmpeg.version,
            ok: !!deps.ffmpeg.path,
          },
          {
            label: "Python",
            value: deps.python.path ?? "not found",
            version: deps.python.version,
            ok: !!deps.python.path,
          },
          {
            label: "Parakeet",
            value: deps.parakeet.path ?? "not installed",
            version: deps.parakeet.version,
            ok: !!deps.parakeet.path,
          },
          {
            label: "whisper.cpp",
            value:
              deps.whisper.path
                ? `${deps.whisper.path}${deps.whisper.source ? ` (${deps.whisper.source})` : ""}`
                : "not found",
            version: deps.whisper.version,
            ok: !!deps.whisper.path,
          },
          {
            label: "Ollama",
            value: deps.ollama.daemon
              ? `running (${deps.ollama.source ?? "unknown"})`
              : "not running",
            version: deps.ollama.version ?? null,
            ok: deps.ollama.daemon,
          },
        ];

  return (
    <PageScaffold className="gap-4 md:gap-5">
      <PageIntro
        title="Settings"
        compact
        description="Changes take effect immediately."
      />

      {error && (
        <div className="rounded-lg border border-[var(--error)]/20 bg-[var(--error-muted)] px-4 py-3 text-sm text-[var(--error)]">
          {error}
        </div>
      )}

      <Tabs defaultValue="models" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="audio">Audio</TabsTrigger>
          <TabsTrigger value="meeting-index">Meeting index</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
          <TabsTrigger value="system">Other</TabsTrigger>
        </TabsList>

        {/* ── Models tab ── */}
        <TabsContent value="models" className="max-w-2xl space-y-5 outline-none">

          {/* Text Analysis */}
          <section className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base font-semibold tracking-[-0.01em] text-[var(--text-primary)]">Text Analysis</h3>
              <p className="text-sm leading-6 text-[var(--text-secondary)]">Default model for meeting summaries and prompt outputs.</p>
            </div>
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-secondary)]">Default model</label>
                <ModelDropdown
                  value={
                    config.llm_provider === "ollama"
                      ? config.ollama.model
                      : config.llm_provider === "openai"
                      ? config.openai.model
                      : config.claude.model
                  }
                  installedLocalModels={installedLocal}
                  availableKeys={{ claude: hasClaude, openai: hasOpenai }}
                  allowCustom={false}
                  localMode="installed-only"
                  onChange={(next) => {
                    if (!next) return;
                    const kind = classifyModelClient(next);
                    if (kind === "claude") {
                      void save({
                        ...config,
                        llm_provider: "claude",
                        claude: { ...config.claude, model: next },
                      });
                    } else if (kind === "openai") {
                      void save({
                        ...config,
                        llm_provider: "openai",
                        openai: { ...config.openai, model: next },
                      });
                    } else {
                      void save({
                        ...config,
                        llm_provider: "ollama",
                        ollama: { ...config.ollama, model: next },
                      });
                    }
                  }}
                />
                <p className="text-xs text-[var(--text-tertiary)]">
                  Cloud models are faster; local models stay offline and cost nothing per run.
                </p>
              </div>
            </div>
          </section>

          <Separator />

          {/* Transcription */}
          <section className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base font-semibold tracking-[-0.01em] text-[var(--text-primary)]">Transcription</h3>
              <p className="text-sm leading-6 text-[var(--text-secondary)]">How recordings are converted to text.</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="settings-asr" className="text-sm font-medium text-[var(--text-secondary)]">Provider</label>
                <Select
                  value={config.asr_provider}
                  onValueChange={(value) =>
                    void save({ ...config, asr_provider: value as AppConfigDTO["asr_provider"] })
                  }
                >
                  <SelectTrigger id="settings-asr">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="parakeet-mlx">Parakeet (local, MLX)</SelectItem>
                    <SelectItem value="openai">OpenAI Whisper (cloud)</SelectItem>
                    <SelectItem value="whisper-local">whisper.cpp (local)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Parakeet conditional */}
              {config.asr_provider === "parakeet-mlx" && (
                <div className="space-y-2">
                  {deps == null ? (
                    <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                      <Spinner className="h-3.5 w-3.5" /> Checking…
                    </div>
                  ) : parakeetInstalled ? (
                    <div className="space-y-1.5">
                      <p className="text-sm text-[var(--success)]">Installed</p>
                      <p className="text-xs text-[var(--text-tertiary)]">{deps.parakeet.path}</p>
                      <button
                        type="button"
                        className="text-xs text-[var(--text-tertiary)] underline decoration-dotted hover:text-[var(--text-secondary)]"
                        onClick={() => {
                          setPendingConfirm({
                            title: "Reinstall Parakeet?",
                            description: "This will remove and recreate the Python environment from scratch (~2 GB download).",
                            confirmLabel: "Reinstall",
                            confirmVariant: "default",
                            action: () => setSetupAsrMode("reinstall"),
                          });
                        }}
                      >
                        Reinstall
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm text-[var(--warning-text)]">Not installed</p>
                      <p className="text-xs text-[var(--text-tertiary)]">
                        Requires Python 3.11+ and ~2 GB disk space.
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setPendingConfirm({
                            title: "Install Parakeet?",
                            description: "This will create a Python environment and download the Parakeet model (~2 GB). This takes about a minute.",
                            confirmLabel: "Install",
                            confirmVariant: "default",
                            action: () => setSetupAsrMode("install"),
                          });
                        }}
                      >
                        Install Parakeet
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* OpenAI Whisper conditional */}
              {config.asr_provider === "openai" && (
                <div className="space-y-2">
                  {hasOpenai ? (
                    <p className="text-sm text-[var(--success)]">Ready</p>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-sm text-[var(--warning-text)]">Needs API key</p>
                      <p className="text-xs text-[var(--text-tertiary)]">
                        <button
                          type="button"
                          className="underline decoration-dotted hover:text-[var(--text-secondary)]"
                          onClick={scrollToApiKeys}
                        >
                          Add your OpenAI API key
                        </button>{" "}
                        below to enable cloud transcription.
                      </p>
                    </div>
                  )}
                  <p className="text-xs text-[var(--text-tertiary)]">
                    Uploads are capped at 25 MB per file (~80 min after transcoding). Use a local provider for longer recordings.
                  </p>
                </div>
              )}

              {/* whisper.cpp conditional */}
              {config.asr_provider === "whisper-local" && (
                <div className="space-y-2">
                  {deps == null ? (
                    <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                      <Spinner className="h-3.5 w-3.5" /> Checking…
                    </div>
                  ) : whisperInstalled ? (
                    <div className="space-y-1.5">
                      <p className="text-sm text-[var(--success)]">Installed</p>
                      <p className="text-xs text-[var(--text-tertiary)]">{deps.whisper.path}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm text-[var(--warning-text)]">Not installed</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={installingWhisper}
                        onClick={() => {
                          setPendingConfirm({
                            title: "Install whisper-cpp?",
                            description: "This will install whisper-cpp via Homebrew.",
                            confirmLabel: "Install",
                            confirmVariant: "default",
                            action: installWhisper,
                          });
                        }}
                      >
                        {installingWhisper ? <><Spinner className="h-4 w-4" /> Installing…</> : "Install via Homebrew"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          <Separator />

          {/* API Keys */}
          <section ref={apiKeysRef} className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base font-semibold tracking-[-0.01em] text-[var(--text-primary)]">API Keys</h3>
              <p className="text-sm leading-6 text-[var(--text-secondary)]">Stored securely in your macOS Keychain.</p>
            </div>
            <div className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
                    <KeyRound className="h-3.5 w-3.5" />
                    Anthropic API key
                    {hasClaude && <span className="text-xs text-[var(--success)]">✓ stored</span>}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={claudeInput}
                      onChange={(e) => setClaudeInput(e.target.value)}
                      onBlur={() => { if (claudeInput) void onSaveClaudeKey(); }}
                      placeholder={hasClaude ? "••••• stored" : "paste key"}
                    />
                    <Button onClick={onSaveClaudeKey} disabled={!claudeInput} variant="secondary" size="sm">
                      Save
                    </Button>
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)]">Used by Claude models for text analysis.</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
                    <KeyRound className="h-3.5 w-3.5" />
                    OpenAI API key
                    {hasOpenai && <span className="text-xs text-[var(--success)]">✓ stored</span>}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={openaiInput}
                      onChange={(e) => setOpenaiInput(e.target.value)}
                      onBlur={() => { if (openaiInput) void onSaveOpenaiKey(); }}
                      placeholder={hasOpenai ? "••••• stored" : "paste key"}
                    />
                    <Button onClick={onSaveOpenaiKey} disabled={!openaiInput} variant="secondary" size="sm">
                      Save
                    </Button>
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)]">Used by OpenAI models for text analysis and cloud transcription.</p>
                </div>
              </div>
            </div>
          </section>

          <Separator />

          {/* Local Models */}
          <section className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base font-semibold tracking-[-0.01em] text-[var(--text-primary)]">Local Models</h3>
              <p className="text-sm leading-6 text-[var(--text-secondary)]">Download and manage Ollama models on your machine.</p>
            </div>
            <div>
              <LocalModelInstaller
                installedModels={installedLocal}
                onInstall={(model, sizeGb) => {
                  const sizeText = sizeGb ? ` (~${sizeGb} GB)` : "";
                  setPendingConfirm({
                    title: `Install ${model}?`,
                    description: `This will download ${model}${sizeText} via Ollama.`,
                    confirmLabel: "Install",
                    confirmVariant: "default",
                    action: () => {
                      setPullModel(model);
                      setPullOpen(true);
                    },
                  });
                }}
                onRemove={(model) => {
                  setPendingConfirm({
                    title: "Remove local model?",
                    description: `Remove ${model} from local storage?`,
                    confirmLabel: "Remove model",
                    cancelLabel: "Keep model",
                    confirmVariant: "destructive",
                    action: async () => {
                      try {
                        await api.llm.remove(model);
                        refreshInstalledLocal();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                      }
                    },
                  });
                }}
              />
            </div>
          </section>

          <Separator />

          {/* Chat Launcher */}
          <section className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base font-semibold tracking-[-0.01em] text-[var(--text-primary)]">Chat Launcher</h3>
              <p className="text-sm leading-6 text-[var(--text-secondary)]">
                Default prompt used when exporting meeting context to an external AI chat app.
              </p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-secondary)]">
                  Completed meeting prompt
                </label>
                <Textarea
                  value={config.chat_launcher?.default_prompt ?? DEFAULT_CHAT_PROMPT}
                  onChange={(e) =>
                    void save({
                      ...config,
                      chat_launcher: {
                        ...config.chat_launcher,
                        default_prompt: e.target.value,
                      },
                    })
                  }
                  rows={3}
                  className="resize-none"
                />
                <p className="text-xs text-[var(--text-secondary)]">
                  Pre-filled when launching chat from a completed meeting.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-secondary)]">
                  Draft meeting prompt
                </label>
                <Textarea
                  value={config.chat_launcher?.draft_prompt ?? ""}
                  onChange={(e) =>
                    void save({
                      ...config,
                      chat_launcher: {
                        default_prompt: config.chat_launcher?.default_prompt ?? DEFAULT_CHAT_PROMPT,
                        ...config.chat_launcher,
                        draft_prompt: e.target.value || undefined,
                      },
                    })
                  }
                  rows={2}
                  className="resize-none"
                  placeholder="Help me prepare for this meeting — suggest talking points and questions."
                />
                <p className="text-xs text-[var(--text-secondary)]">
                  Pre-filled when launching chat from a draft meeting.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-secondary)]">
                  During-recording prompt
                </label>
                <Textarea
                  value={config.chat_launcher?.recording_prompt ?? ""}
                  onChange={(e) =>
                    void save({
                      ...config,
                      chat_launcher: {
                        default_prompt: config.chat_launcher?.default_prompt ?? DEFAULT_CHAT_PROMPT,
                        ...config.chat_launcher,
                        recording_prompt: e.target.value || undefined,
                      },
                    })
                  }
                  rows={2}
                  className="resize-none"
                  placeholder="Help me with real-time questions and action items."
                />
                <p className="text-xs text-[var(--text-secondary)]">
                  Pre-filled when launching chat during an active recording.
                </p>
              </div>
            </div>
          </section>
        </TabsContent>

        {/* ── Audio tab ── */}
        <TabsContent value="audio" className="max-w-2xl space-y-5 outline-none">
          <section className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base font-semibold tracking-[-0.01em] text-[var(--text-primary)]">Audio Input</h3>
              <p className="text-sm leading-6 text-[var(--text-secondary)]">
                Pick your microphone and verify both channels are receiving audio. Changes take effect immediately.
              </p>
            </div>
            <div>
              <AudioLevelMeters
                active
                micDevice={config.recording.mic_device}
                availableDevices={devices}
                systemAudioSupported={deps?.systemAudioSupported ?? true}
                onMicDeviceChange={(device) =>
                  void save({
                    ...config,
                    recording: { ...config.recording, mic_device: device },
                  })
                }
                onDevicesRefreshed={setDevices}
              />
            </div>
          </section>
        </TabsContent>

        {/* ── Storage tab ── */}
        <TabsContent value="storage" className="max-w-2xl space-y-5 outline-none">
          <section className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base font-semibold tracking-[-0.01em] text-[var(--text-primary)]">Data Storage</h3>
              <p className="text-sm leading-6 text-[var(--text-secondary)]">Meeting recordings and notes are stored here.</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-secondary)]">Meetings directory</label>
                <div className="flex gap-2">
                  <Input value={config.data_path} readOnly className="bg-[var(--bg-secondary)]" />
                  <Button variant="secondary" size="sm" onClick={onChangeDataDir} disabled={busy === "data-path"}>
                    Move…
                  </Button>
                  <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => api.config.openDataDirectory()}>
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <Separator />

          <section className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base font-semibold tracking-[-0.01em] text-[var(--text-primary)]">Obsidian Integration</h3>
              <p className="text-sm leading-6 text-[var(--text-secondary)]">Automatically sync notes to your Obsidian vault.</p>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-[var(--text-primary)]">Enable integration</div>
                  <p className="text-xs text-[var(--text-tertiary)]">Open notes in Obsidian alongside the desktop app.</p>
                </div>
                <Switch
                  checked={config.obsidian_integration.enabled}
                  onCheckedChange={(checked) => void setObsidianEnabled(checked)}
                  disabled={busy === "obsidian"}
                />
              </div>

              {config.obsidian_integration.enabled && (
                <div className="space-y-2 pt-2">
                  <label className="text-sm font-medium text-[var(--text-secondary)]">Vault path</label>
                  <div className="flex gap-2">
                    <Input
                      value={config.obsidian_integration.vault_path ?? ""}
                      readOnly
                      placeholder="(not set)"
                      className="bg-[var(--bg-secondary)]"
                    />
                    <Button variant="secondary" size="sm" onClick={setObsidianVault} disabled={busy === "vault"}>
                      Pick…
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <Separator />

          <AudioRetentionSection config={config} onSave={save} />
        </TabsContent>

        {/* ── General tab ── */}
        <TabsContent value="system" className="max-w-2xl space-y-5 outline-none">
          <section className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base font-semibold tracking-[-0.01em] text-[var(--text-primary)]">Keyboard Shortcuts</h3>
              <p className="text-sm leading-6 text-[var(--text-secondary)]">Global shortcuts that work even when the app is in the background.</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-secondary)]">Toggle recording</label>
                <ShortcutRecorder
                  value={config.shortcuts.toggle_recording}
                  onChange={(next) =>
                    void save({ ...config, shortcuts: { ...config.shortcuts, toggle_recording: next } })
                  }
                />
              </div>
            </div>
          </section>

          <Separator />

          <section className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base font-semibold tracking-[-0.01em] text-[var(--text-primary)]">System Health</h3>
              <p className="text-sm leading-6 text-[var(--text-secondary)]">Check status of required background tools.</p>
            </div>
            <div className="space-y-2">
              {deps == null ? (
                <div className="flex items-center gap-2 py-4 text-sm text-[var(--text-secondary)]">
                  <Spinner className="h-3.5 w-3.5" />
                  Checking dependencies…
                </div>
              ) : (
                <div className="overflow-hidden rounded-md border border-[var(--border-subtle)]">
                  <Table>
                    <TableBody>
                      {dependencyRows.map((row) => (
                        <TableRow key={row.label}>
                          <TableCell className="font-medium">{row.label}</TableCell>
                          <TableCell className="text-[var(--text-tertiary)]">
                            {row.version ?? "—"}
                          </TableCell>
                          <TableCell className={`text-right ${row.ok ? "text-[var(--success)]" : "text-[var(--error)] font-medium"}`}>
                            {row.value}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="meeting-index" className="max-w-2xl space-y-5 outline-none">
          <MeetingIndexSettingsSection />
        </TabsContent>

        <TabsContent value="integrations" className="max-w-2xl space-y-5 outline-none">
          <IntegrationsSection />
        </TabsContent>
      </Tabs>

      {setupAsrMode && (
        <SetupAsrModal
          mode={setupAsrMode}
          binaryPath={deps?.parakeet ?? null}
          onClose={() => {
            setSetupAsrMode(null);
            refreshDeps();
          }}
        />
      )}

      {pullOpen && (
        <PullLocalModelModal
          model={pullModel.trim()}
          onClose={() => {
            setPullOpen(false);
            setPullModel("");
            refreshInstalledLocal();
            refreshDeps();
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function PullLocalModelModal({
  model,
  onClose,
}: {
  model: string;
  onClose: () => void;
}) {
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ pct: number; completed: number; total: number } | null>(null);

  useEffect(() => {
    const unsub = api.on.setupLlmLog((line) =>
      setLog((prev) => {
        // Replace the last percentage line in-place instead of appending
        if (/^\s+\d+%/.test(line) && prev.length > 0 && /^\s+\d+%/.test(prev[prev.length - 1])) {
          return [...prev.slice(0, -1), line];
        }
        return [...prev, line];
      })
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = api.on.setupLlmProgress((p) => setProgress(p));
    return () => unsub();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRunning(true);
    setLog([]);
    setError(null);
    setProgress(null);
    api.llm
      .setup({ model })
      .then(() => { if (!cancelled) setDone(true); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) { setRunning(false); setProgress(null); } });
    return () => { cancelled = true; };
  }, [model]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {running && <Spinner className="size-4" />}
            {done ? `Pulled ${model}` : `Pulling ${model}`}
          </DialogTitle>
          <DialogDescription>
            Downloads into <code>~/.ollama/models</code>.
            {running && " Download continues in the background if you close this dialog."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {progress && running && (
            <div className="space-y-1.5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border-default)]">
                <div
                  className="h-2 rounded-full bg-[var(--brand)] transition-[width] duration-300 ease-out"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                {progress.pct}% &mdash; {formatBytes(progress.completed)} / {formatBytes(progress.total)}
              </p>
            </div>
          )}
          <div className="max-h-40 overflow-auto rounded-md border border-[var(--border-default)] bg-white p-3 font-mono text-xs text-[var(--text-secondary)]">
            {log.length > 0 ? (
              <pre className="whitespace-pre-wrap">{log.join("\n")}</pre>
            ) : running ? "Waiting for progress…" : "No output."}
          </div>
          {error && (
            <div className="rounded-md border border-[var(--error)]/20 bg-[var(--error-muted)] px-3 py-2 text-sm text-[var(--error)]">
              {error}
            </div>
          )}
          {done && (
            <div className="rounded-md border border-[var(--success)]/20 bg-[var(--success-muted)] px-3 py-2 text-sm text-[var(--success)]">
              Model pulled successfully.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {running ? "Close (continues in background)" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SetupAsrModal({
  mode,
  binaryPath,
  onClose,
}: {
  mode: "install" | "reinstall";
  binaryPath: string | null;
  onClose: () => void;
}) {
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReinstall = mode === "reinstall";
  const title = isReinstall ? "Reinstall Parakeet" : "Install Parakeet";
  const description = isReinstall
    ? "Removes and recreates the Python environment from scratch."
    : "Creates a Python environment and downloads the Parakeet model.";

  useEffect(() => {
    const unsub = api.on.setupAsrLog((line) => setLog((prev) => [...prev, line]));
    return () => unsub();
  }, []);

  const onRun = async () => {
    setRunning(true);
    setLog([]);
    setError(null);
    try {
      await api.setupAsr({ force: isReinstall });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !running && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {binaryPath && (
            <p className="text-xs text-[var(--text-tertiary)]">Binary: <code>{binaryPath}</code></p>
          )}
          <div className="max-h-60 overflow-auto rounded-md border border-[var(--border-default)] bg-white p-3 font-mono text-xs text-[var(--text-secondary)]">
            {log.length > 0 ? (
              <pre className="whitespace-pre-wrap">{log.join("\n")}</pre>
            ) : running ? "Waiting for installer output…" : "No output yet."}
          </div>
          {error && (
            <div className="rounded-md border border-[var(--error)]/20 bg-[var(--error-muted)] px-3 py-2 text-sm text-[var(--error)]">
              {error}
            </div>
          )}
          {done && (
            <div className="rounded-md border border-[var(--success)]/20 bg-[var(--success-muted)] px-3 py-2 text-sm text-[var(--success)]">
              Parakeet {isReinstall ? "reinstalled" : "installed"} successfully.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={running}>Close</Button>
          <Button onClick={onRun} disabled={running}>
            {running ? <><Spinner className="h-4 w-4" /> {isReinstall ? "Reinstalling…" : "Installing…"}</> : isReinstall ? "Reinstall" : "Install"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function retentionMode(days: number | null): string {
  if (days == null) return "never";
  if (days === 7) return "7";
  if (days === 30) return "30";
  return "custom";
}

function AudioRetentionSection({
  config,
  onSave,
}: {
  config: AppConfigDTO;
  onSave: (next: AppConfigDTO) => Promise<void>;
}) {
  const mode = retentionMode(config.audio_retention_days);
  const [customDays, setCustomDays] = useState(
    mode === "custom" ? String(config.audio_retention_days) : "90"
  );

  const handleModeChange = (value: string) => {
    if (value === "never") {
      void onSave({ ...config, audio_retention_days: null });
    } else if (value === "custom") {
      const parsed = parseInt(customDays, 10);
      void onSave({ ...config, audio_retention_days: parsed > 0 ? parsed : 90 });
    } else {
      void onSave({ ...config, audio_retention_days: parseInt(value, 10) });
    }
  };

  const handleCustomDaysChange = (value: string) => {
    setCustomDays(value);
    const parsed = parseInt(value, 10);
    if (parsed > 0) {
      void onSave({ ...config, audio_retention_days: parsed });
    }
  };

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold tracking-[-0.01em] text-[var(--text-primary)]">Audio File Retention</h3>
        <p className="text-sm leading-6 text-[var(--text-secondary)]">
          Automatically delete audio recordings from completed meetings after a set period.
          Transcripts and notes are always kept.
        </p>
      </div>
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-[var(--text-secondary)]">
            Delete audio after
          </label>
          <Select value={mode} onValueChange={handleModeChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="never">Never</SelectItem>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {mode === "custom" && (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              value={customDays}
              onChange={(e) => handleCustomDaysChange(e.target.value)}
              className="w-24"
            />
            <span className="text-sm text-[var(--text-secondary)]">days</span>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Meeting index settings — embed model + indexing controls. The index is
// read by the MCP server (Claude Desktop) for semantic search over
// transcripts; no in-app chat surface reads it anymore.
// ---------------------------------------------------------------------------

function MeetingIndexSettingsSection() {
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    api.meetingIndex.backfillCountPending().then(setPendingCount).catch(() => {});
  }, []);

  return (
    <>
      <EmbedModelSection />

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">Indexing</h3>
        <p className="text-xs text-[var(--text-secondary)]">
          Claude Desktop (via MCP) searches an embedding index over your
          transcripts and summaries.
          {pendingCount && pendingCount > 0
            ? ` ${pendingCount} meetings are not yet indexed.`
            : " All meetings are indexed."}
        </p>
        <Button
          size="sm"
          onClick={async () => {
            try {
              await api.meetingIndex.backfillStart();
            } catch {
              /* noop */
            }
          }}
          data-testid="meeting-index-backfill-start"
        >
          Re-run indexing
        </Button>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Meeting-index embedding model installer — shown in Settings (and reused
// by the SetupWizard's LLM step) so users can see whether semantic search
// is ready and, if not, pull the model with visible progress. The index is
// consumed by the MCP server.
// ---------------------------------------------------------------------------

function EmbedModelSection() {
  const [status, setStatus] = useState<{ model: string; installed: boolean } | null>(null);
  const [pulling, setPulling] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; completed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    api.meetingIndex
      .embedModelStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!pulling) return;
    const unsub = api.on.setupLlmProgress((p) => setProgress(p));
    return () => unsub();
  }, [pulling]);

  const install = async () => {
    setPulling(true);
    setError(null);
    setProgress(null);
    try {
      await api.meetingIndex.installEmbedModel();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPulling(false);
      setProgress(null);
      refresh();
    }
  };

  if (!status) {
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">
          Meeting-index embedding model
        </h3>
        <p className="text-xs text-[var(--text-secondary)]">Checking status…</p>
      </section>
    );
  }

  return (
    <section className="space-y-3" data-testid="meeting-index-embed-model-section">
      <h3 className="text-sm font-medium text-[var(--text-primary)]">
        Meeting-index embedding model
      </h3>
      <p className="text-xs text-[var(--text-secondary)]">
        Powers semantic search over your transcripts (consumed by Claude
        Desktop via MCP). Search still works without it but falls back to
        exact keyword matching.
      </p>
      <div className="flex items-center gap-3 text-sm">
        <span className="font-mono text-xs">{status.model}</span>
        {status.installed ? (
          <span
            className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800"
            data-testid="meeting-index-embed-model-status"
            data-installed="true"
          >
            ✓ Installed
          </span>
        ) : (
          <span
            className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
            data-testid="meeting-index-embed-model-status"
            data-installed="false"
          >
            Not installed
          </span>
        )}
      </div>
      {!status.installed && (
        <Button
          size="sm"
          disabled={pulling}
          onClick={() => void install()}
          data-testid="meeting-index-embed-model-install"
        >
          {pulling
            ? progress
              ? `Installing… ${progress.pct}%`
              : "Installing…"
            : "Install"}
        </Button>
      )}
      {progress && pulling && (
        <div className="h-1 w-full overflow-hidden rounded bg-[var(--bg-secondary)]">
          <div
            className="h-full bg-[var(--accent)]"
            style={{ width: `${progress.pct}%` }}
          />
        </div>
      )}
      {error && (
        <div className="text-xs text-[var(--error)]" data-testid="meeting-index-embed-model-error">
          {error}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Integrations — Claude Desktop MCP extension install + live status.
// ---------------------------------------------------------------------------

function IntegrationsSection() {
  const [status, setStatus] = useState<import("../../../shared/ipc").McpIntegrationStatus | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<"installed" | "uninstalled" | null>(null);

  const refreshStatus = async () => {
    try {
      const s = await api.integrations.getMcpStatus();
      setStatus(s);
    } catch {
      // Swallow — renderer can still render last-known state.
    }
  };

  useEffect(() => {
    void refreshStatus();
    const id = setInterval(refreshStatus, 10_000);
    return () => clearInterval(id);
  }, []);

  const handleInstall = async () => {
    setActionError(null);
    setLastAction(null);
    setBusy(true);
    try {
      const result = await api.integrations.installMcpForClaude();
      if (!result.ok) {
        setActionError(result.error ?? "Couldn't write Claude Desktop config.");
      } else {
        setLastAction("installed");
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      void refreshStatus();
    }
  };

  const handleUninstall = async () => {
    setActionError(null);
    setLastAction(null);
    setBusy(true);
    try {
      const result = await api.integrations.uninstallMcpForClaude();
      if (!result.ok) {
        setActionError(result.error ?? "Couldn't update Claude Desktop config.");
      } else {
        setLastAction("uninstalled");
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      void refreshStatus();
    }
  };

  const ollamaLabel = status?.ollamaRunning
    ? "Ollama running — semantic search available"
    : "Ollama not running — keyword search only";

  const claudeDesktopLabel = (() => {
    switch (status?.claudeDesktopInstalled) {
      case "yes":
        return "Claude Desktop detected";
      case "no":
        return "Claude Desktop not found — install it from claude.ai/download first";
      default:
        return "Claude Desktop detection unavailable on this platform";
    }
  })();

  const configLabel = (() => {
    if (status?.configReadError) {
      return `Config file is unreadable: ${status.configReadError}`;
    }
    return status?.configInstalled
      ? "Installed — restart Claude Desktop to pick up changes"
      : "Not installed";
  })();

  const meetingsLabel =
    status?.meetingsIndexed == null
      ? "Meetings database not yet created — record a meeting first"
      : `${status.meetingsIndexed} meeting${status.meetingsIndexed === 1 ? "" : "s"} indexed`;

  const installDisabled =
    busy || !status?.serverJsExists || Boolean(status?.configReadError);

  return (
    <section className="space-y-5" data-testid="integrations-section">
      <div className="space-y-1">
        <h3 className="text-base font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Claude Desktop
        </h3>
        <p className="text-sm leading-6 text-[var(--text-secondary)]">
          Connect Gistlist to Claude Desktop and query your meetings directly
          from any Claude conversation. Install writes a <code>gistlist</code>{" "}
          entry into Claude Desktop's config so it can spawn Gistlist on demand
          and read your meetings locally.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={handleInstall}
          disabled={installDisabled}
          data-testid="integrations-install-mcp"
        >
          {busy && lastAction !== "uninstalled" ? (
            <>
              <Spinner className="mr-2 h-4 w-4" />
              Writing config…
            </>
          ) : status?.configInstalled ? (
            "Reinstall Gistlist for Claude Desktop"
          ) : (
            "Install Gistlist for Claude Desktop"
          )}
        </Button>
        {status?.configInstalled && (
          <Button
            variant="secondary"
            onClick={handleUninstall}
            disabled={busy}
            data-testid="integrations-uninstall-mcp"
          >
            Uninstall
          </Button>
        )}
      </div>

      {!status?.serverJsExists && (
        <p
          className="text-xs text-[var(--text-secondary)]"
          data-testid="integrations-server-missing"
        >
          Gistlist's bundled MCP server wasn't found at{" "}
          <code>{status?.serverJsPath}</code>. Try reinstalling Gistlist.
        </p>
      )}

      {actionError && (
        <div
          className="rounded-md border border-[var(--error)] bg-[var(--error-bg,transparent)] p-3 text-sm text-[var(--error)]"
          data-testid="integrations-install-error"
        >
          {actionError}{" "}
          <a
            className="underline"
            href="https://gistlist.app/docs/claude-desktop-setup"
            target="_blank"
            rel="noreferrer"
          >
            See setup guide →
          </a>
        </div>
      )}

      {lastAction === "installed" && !actionError && (
        <p
          className="text-xs text-[var(--text-secondary)]"
          data-testid="integrations-opened"
        >
          Wrote the config entry. <strong>Restart Claude Desktop</strong>, then
          ask it <em>"list my recent meetings"</em> to test.
        </p>
      )}
      {lastAction === "uninstalled" && !actionError && (
        <p
          className="text-xs text-[var(--text-secondary)]"
          data-testid="integrations-uninstalled"
        >
          Removed the config entry. Restart Claude Desktop to drop the server.
        </p>
      )}

      <Separator />

      <div className="space-y-2" data-testid="integrations-status">
        <h4 className="text-sm font-medium text-[var(--text-primary)]">Status</h4>
        <ul className="space-y-1 text-sm text-[var(--text-secondary)]">
          <li data-testid="integrations-status-extension">
            <span className="font-medium text-[var(--text-primary)]">Integration:</span>{" "}
            {configLabel}
          </li>
          <li data-testid="integrations-status-claude-desktop">
            <span className="font-medium text-[var(--text-primary)]">Claude Desktop:</span>{" "}
            {claudeDesktopLabel}
          </li>
          <li data-testid="integrations-status-ollama">
            <span className="font-medium text-[var(--text-primary)]">Semantic search:</span>{" "}
            {ollamaLabel}
          </li>
          <li data-testid="integrations-status-db">
            <span className="font-medium text-[var(--text-primary)]">Library:</span>{" "}
            {meetingsLabel}
          </li>
        </ul>
      </div>

      <div className="text-xs text-[var(--text-secondary)]">
        <a
          className="underline"
          href="https://gistlist.app/docs/claude-desktop-setup"
          target="_blank"
          rel="noreferrer"
          data-testid="integrations-docs-link"
        >
          Setup guide & troubleshooting →
        </a>
      </div>
    </section>
  );
}
