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
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
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

const SYSTEM_DEFAULT_DEVICE = "";
const SYSTEM_DEFAULT_DEVICE_VALUE = "__system_default__";

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

  const apiKeysRef = useRef<HTMLDivElement>(null);

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

  const parakeetInstalled = Boolean(deps?.parakeet);
  const whisperInstalled = Boolean(deps?.whisper);

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

  const micDeviceValue =
    config.recording.mic_device === SYSTEM_DEFAULT_DEVICE
      ? SYSTEM_DEFAULT_DEVICE_VALUE
      : config.recording.mic_device;

  const dependencyRows =
    deps == null
      ? []
      : [
          {
            label: "ffmpeg",
            value: deps.ffmpeg ?? "not found — brew install ffmpeg",
            version: deps.ffmpegVersion ?? null,
            ok: !!deps.ffmpeg,
          },
          {
            label: "BlackHole (2ch)",
            value:
              deps.blackhole === "loaded"
                ? "loaded"
                : deps.blackhole === "installed-not-loaded"
                ? "installed but not loaded"
                : "not found",
            version: null,
            ok: deps.blackhole === "loaded",
          },
          {
            label: "Python",
            value: deps.python ?? "not found",
            version: deps.pythonVersion ?? null,
            ok: !!deps.python,
          },
          {
            label: "Parakeet",
            value: deps.parakeet ?? "not installed",
            version: null,
            ok: !!deps.parakeet,
          },
          {
            label: "whisper.cpp",
            value: deps.whisper ?? "not found",
            version: null,
            ok: !!deps.whisper,
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
          <TabsTrigger value="storage">Storage</TabsTrigger>
          <TabsTrigger value="system">Other</TabsTrigger>
        </TabsList>

        {/* ── Models tab ── */}
        <TabsContent value="models" className="max-w-2xl space-y-5 outline-none">

          {/* Card 1: Text Analysis */}
          <Card className="overflow-hidden p-5 md:p-6">
            <CardHeader className="mb-3">
              <div className="space-y-1">
                <CardTitle>Text Analysis</CardTitle>
                <CardDescription>Default model for meeting summaries and prompt outputs.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
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
            </CardContent>
          </Card>

          {/* Card 2: Transcription */}
          <Card className="overflow-hidden p-5 md:p-6">
            <CardHeader className="mb-3">
              <div className="space-y-1">
                <CardTitle>Transcription</CardTitle>
                <CardDescription>How recordings are converted to text.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
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
                      <p className="text-xs text-[var(--text-tertiary)]">{deps.parakeet}</p>
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
                      <p className="text-xs text-[var(--text-tertiary)]">{deps.whisper}</p>
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
            </CardContent>
          </Card>

          {/* Card 3: API Keys */}
          <Card ref={apiKeysRef} className="overflow-hidden p-5 md:p-6">
            <CardHeader className="mb-3">
              <div className="space-y-1">
                <CardTitle>API Keys</CardTitle>
                <CardDescription>Stored securely in your macOS Keychain.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
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
            </CardContent>
          </Card>

          {/* Card 4: Local Models */}
          <Card className="overflow-hidden p-5 md:p-6">
            <CardHeader className="mb-3">
              <div className="space-y-1">
                <CardTitle>Local Models</CardTitle>
                <CardDescription>Download and manage Ollama models on your machine.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>

          <Card className="overflow-hidden p-5 md:p-6">
            <CardHeader className="mb-3">
              <div className="space-y-1">
                <CardTitle>Chat Launcher</CardTitle>
                <CardDescription>
                  Default prompt used when exporting meeting context to an external AI chat app.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
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
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Audio tab ── */}
        <TabsContent value="audio" className="max-w-2xl space-y-5 outline-none">
          <Card className="overflow-hidden p-5 md:p-6">
            <CardHeader className="mb-3">
              <div className="space-y-1">
                <CardTitle>Audio Devices</CardTitle>
                <CardDescription>Pick which mic and system audio device to capture.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="settings-mic" className="text-sm font-medium text-[var(--text-secondary)]">Microphone</label>
                <Select
                  value={micDeviceValue}
                  onValueChange={(value) =>
                    void save({
                      ...config,
                      recording: {
                        ...config.recording,
                        mic_device: value === SYSTEM_DEFAULT_DEVICE_VALUE ? SYSTEM_DEFAULT_DEVICE : value,
                      },
                    })
                  }
                >
                  <SelectTrigger id="settings-mic">
                    <SelectValue placeholder="System default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SYSTEM_DEFAULT_DEVICE_VALUE}>System default</SelectItem>
                    {devices.map((d) => (
                      <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label htmlFor="settings-sys-audio" className="text-sm font-medium text-[var(--text-secondary)]">System Audio (Loopback)</label>
                <Select
                  value={config.recording.system_device}
                  onValueChange={(value) =>
                    void save({ ...config, recording: { ...config.recording, system_device: value } })
                  }
                >
                  <SelectTrigger id="settings-sys-audio">
                    <SelectValue placeholder="Select device" />
                  </SelectTrigger>
                  <SelectContent>
                    {devices.map((d) => (
                      <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-[var(--text-tertiary)]">
                  Requires BlackHole or a similar loopback driver to capture meeting participants.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Storage tab ── */}
        <TabsContent value="storage" className="max-w-2xl space-y-5 outline-none">
          <Card className="overflow-hidden p-5 md:p-6">
            <CardHeader className="mb-3">
              <div className="space-y-1">
                <CardTitle>Data Storage</CardTitle>
                <CardDescription>Meeting recordings and notes are stored here.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-secondary)]">Meetings directory</label>
                <div className="flex gap-2">
                  <Input value={config.data_path} readOnly className="bg-[var(--bg-secondary)]" />
                  <Button variant="secondary" onClick={onChangeDataDir} disabled={busy === "data-path"}>
                    Move…
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => api.config.openDataDirectory()}>
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden p-5 md:p-6">
            <CardHeader className="mb-3">
              <div className="space-y-1">
                <CardTitle>Obsidian Integration</CardTitle>
                <CardDescription>Automatically sync notes to your Obsidian vault.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
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
                    <Button variant="secondary" onClick={setObsidianVault} disabled={busy === "vault"}>
                      Pick…
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <AudioRetentionCard config={config} onSave={save} />
        </TabsContent>

        {/* ── General tab ── */}
        <TabsContent value="system" className="max-w-2xl space-y-5 outline-none">
          <Card className="overflow-hidden p-5 md:p-6">
            <CardHeader className="mb-3">
              <div className="space-y-1">
                <CardTitle>Keyboard Shortcuts</CardTitle>
                <CardDescription>Global shortcuts that work even when the app is in the background.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-secondary)]">Toggle recording</label>
                <ShortcutRecorder
                  value={config.shortcuts.toggle_recording}
                  onChange={(next) =>
                    void save({ ...config, shortcuts: { ...config.shortcuts, toggle_recording: next } })
                  }
                />
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden p-5 md:p-6">
            <CardHeader className="pb-2 mb-3">
              <CardTitle>System Health</CardTitle>
              <CardDescription>Check status of required background tools.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {deps == null ? (
                <div className="flex items-center gap-2 py-4 text-sm text-[var(--text-secondary)]">
                  <Spinner className="h-3.5 w-3.5" />
                  Checking dependencies…
                </div>
              ) : (
                <div className="overflow-hidden rounded-md border border-[var(--border-default)]">
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
            </CardContent>
          </Card>
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

function AudioRetentionCard({
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
    <Card className="overflow-hidden p-5 md:p-6">
      <CardHeader className="mb-3">
        <div className="space-y-1">
          <CardTitle>Audio File Retention</CardTitle>
          <CardDescription>
            Automatically delete audio recordings from completed meetings after a set period.
            Transcripts and notes are always kept.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
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
      </CardContent>
    </Card>
  );
}
