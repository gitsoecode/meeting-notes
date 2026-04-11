import { useEffect, useState } from "react";
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
import { classifyModelClient } from "../constants";
import { PageIntro, PageScaffold } from "../components/PageScaffold";
import { ShortcutRecorder } from "../components/ShortcutRecorder";
import { ModelDropdown } from "../components/ModelDropdown";
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
  const [setupAsrOpen, setSetupAsrOpen] = useState(false);
  const [installedLocal, setInstalledLocal] = useState<string[]>([]);
  const [pullModel, setPullModel] = useState("");
  const [pullOpen, setPullOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmState | null>(null);
  const [confirmingAction, setConfirmingAction] = useState(false);

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
  const parakeetActionLabel = parakeetInstalled ? "Check / repair" : "Install Parakeet";

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
            ok: deps.blackhole === "loaded",
          },
          {
            label: "Python",
            value: deps.python ?? "not found",
            ok: !!deps.python,
          },
          {
            label: "Parakeet",
            value: deps.parakeet ?? "not installed",
            ok: !!deps.parakeet,
          },
          {
            label: "Ollama",
            value: deps.ollama.daemon
              ? `running (${deps.ollama.source ?? "unknown"})`
              : "not running",
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
          <TabsTrigger value="audio">Transcription</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
          <TabsTrigger value="system">General</TabsTrigger>
        </TabsList>

        <TabsContent value="models" className="max-w-2xl space-y-5 outline-none">
          <Card className="overflow-hidden p-5 md:p-6">
            <CardHeader className="mb-3">
              <div className="space-y-1">
                <CardTitle>AI Provider</CardTitle>
                <CardDescription>Choose your default LLM and manage API keys.</CardDescription>
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
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden p-5 md:p-6">
            <CardHeader className="mb-3">
              <div className="space-y-1">
                <CardTitle>Local Models</CardTitle>
                <CardDescription>Manage models running on your machine via Ollama.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-secondary)]">Pull a new model</label>
                <div className="flex gap-2">
                  <ModelDropdown
                    className="flex-1"
                    providerFilter="ollama"
                    value={pullModel}
                    onChange={setPullModel}
                    localMode="all"
                    allowCustom
                    triggerClassName="bg-white"
                  />
                  <Button onClick={() => setPullOpen(true)} disabled={!pullModel.trim() || pullOpen}>
                    Pull
                  </Button>
                </div>
              </div>

              {installedLocal.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[var(--text-secondary)]">Installed models</label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {installedLocal.map((model) => (
                      <div
                        key={model}
                        className="flex items-center justify-between rounded-md border border-[var(--border-default)] bg-white px-3 py-1.5 text-sm"
                      >
                        <span className="truncate text-[var(--text-primary)]">{model}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-[var(--error)] hover:bg-[var(--error-muted)] hover:text-[var(--error)]"
                          onClick={() => {
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
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audio" className="max-w-2xl space-y-5 outline-none">
          <Card className="overflow-hidden p-5 md:p-6">
            <CardHeader className="mb-3">
              <div className="space-y-1">
                <CardTitle>Speech-to-Text</CardTitle>
                <CardDescription>Select a transcription provider for your recordings.</CardDescription>
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
                    <SelectItem value="parakeet-mlx">
                      Parakeet (local, MLX{parakeetInstalled ? ", installed" : ""})
                    </SelectItem>
                    <SelectItem value="openai">OpenAI (cloud)</SelectItem>
                    <SelectItem value="whisper-local">whisper.cpp (local)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {config.asr_provider === "parakeet-mlx" && (
                <div className="flex items-center justify-between rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${parakeetInstalled ? "bg-[var(--success)]" : "bg-[var(--warning-text)]"}`} />
                    <span className="text-[var(--text-primary)]">
                      {parakeetInstalled ? "Parakeet installed" : "Parakeet needs setup"}
                    </span>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setSetupAsrOpen(true)}>
                    {parakeetActionLabel}
                  </Button>
                </div>
              )}

              {config.asr_provider === "openai" && (
                <div className="rounded-md bg-blue-50 p-3 text-xs text-blue-700">
                  OpenAI caps uploads at 25 MB per file. We transcode audio to stretch this to ~80 minutes, but longer recordings will fail. Use Parakeet for unlimited local transcription.
                </div>
              )}
            </CardContent>
          </Card>

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
        </TabsContent>

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

          <Card className="overflow-hidden p-5 md:p-6">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 mb-3">
              <div className="space-y-1">
                <CardTitle>System Health</CardTitle>
                <CardDescription>Check status of required background tools.</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={refreshDeps} className="h-8">
                Refresh
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {deps == null ? (
                <div className="flex items-center gap-2 py-4 text-sm text-[var(--text-secondary)]">
                  <Spinner className="h-3.5 w-3.5" />
                  Checking dependencies…
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-default)] rounded-md border border-[var(--border-default)]">
                  {dependencyRows.map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center justify-between bg-white px-3 py-2 text-sm"
                    >
                      <span className="font-medium text-[var(--text-primary)]">{row.label}</span>
                      <span className={row.ok ? "text-[var(--success)]" : "text-[var(--error)] font-medium"}>
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {setupAsrOpen && (
        <SetupAsrModal
          installed={parakeetInstalled}
          binaryPath={deps?.parakeet ?? null}
          onClose={() => {
            setSetupAsrOpen(false);
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

  useEffect(() => {
    const unsub = api.on.setupLlmLog((line) => setLog((prev) => [...prev, line]));
    return () => unsub();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRunning(true);
    setLog([]);
    setError(null);
    api.llm
      .setup({ model })
      .then(() => { if (!cancelled) setDone(true); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setRunning(false); });
    return () => { cancelled = true; };
  }, [model]);

  return (
    <Dialog open onOpenChange={(open) => !open && !running && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Pulling {model}</DialogTitle>
          <DialogDescription>
            Downloads into <code>~/.ollama/models</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="max-h-60 overflow-auto rounded-md border border-[var(--border-default)] bg-white p-3 font-mono text-xs text-[var(--text-secondary)]">
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
          <Button variant="secondary" onClick={onClose} disabled={running}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SetupAsrModal({
  installed,
  binaryPath,
  onClose,
}: {
  installed: boolean;
  binaryPath: string | null;
  onClose: () => void;
}) {
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = api.on.setupAsrLog((line) => setLog((prev) => [...prev, line]));
    return () => unsub();
  }, []);

  const onRun = async () => {
    setRunning(true);
    setLog([]);
    setError(null);
    try {
      await api.setupAsr({ force: false });
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
          <DialogTitle>{installed ? "Check / repair Parakeet" : "Install Parakeet"}</DialogTitle>
          <DialogDescription>
            {installed
              ? <>Refreshes the environment in <code>~/.meeting-notes</code> and reruns the smoke test.</>
              : <>Creates a Python environment and installs Parakeet MLX into <code>~/.meeting-notes</code>.</>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {installed && binaryPath && (
            <p className="text-xs text-[var(--text-tertiary)]">Current binary: <code>{binaryPath}</code></p>
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
              {installed ? "Parakeet verified." : "Parakeet installed."}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={running}>Close</Button>
          <Button onClick={onRun} disabled={running}>
            {running ? <><Spinner className="h-4 w-4" /> {installed ? "Checking…" : "Installing…"}</> : installed ? "Run setup" : "Install"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
