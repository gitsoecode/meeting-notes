import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { api } from "../ipc-client";
import type {
  AppConfigDTO,
  DepsCheckResult,
  DepsInstallTarget,
  DetectedVault,
  HardwareInfoDTO,
  InitConfigRequest,
} from "../../../shared/ipc";
import {
  LLM_MODELS,
  recommendLocalModel,
  findModelEntry,
  localModelIdsMatch,
} from "../constants";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Spinner } from "../components/ui/spinner";
import { Switch } from "../components/ui/switch";

interface SetupWizardProps {
  onComplete: () => void;
}

const TOTAL_STEPS = 5;

function hasInstalledLocalModel(
  installedLocalModels: readonly string[],
  modelId: string | null | undefined
): boolean {
  return installedLocalModels.some((installedModel) =>
    localModelIdsMatch(installedModel, modelId)
  );
}

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(0);

  const [usesObsidian, setUsesObsidian] = useState<boolean>(false);
  const [vaultPath, setVaultPath] = useState<string>("");
  const [detectedVaults, setDetectedVaults] = useState<DetectedVault[]>([]);

  const [dataPath, setDataPath] = useState<string>("");
  const [dataPathTouched, setDataPathTouched] = useState(false);
  const [retentionValue, setRetentionValue] = useState<string>("never");
  const [customRetentionDays, setCustomRetentionDays] = useState<string>("90");

  const [asrProvider, setAsrProvider] =
    useState<AppConfigDTO["asr_provider"]>("parakeet-mlx");
  const [claudeKey, setClaudeKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [hasClaude, setHasClaude] = useState<boolean>(false);
  const [hasOpenai, setHasOpenai] = useState<boolean>(false);
  const [keysChecked, setKeysChecked] = useState(false);

  const [llmProvider, setLlmProvider] = useState<AppConfigDTO["llm_provider"]>("claude");
  const [localLlmModel, setLocalLlmModel] = useState<string>("");
  const [hardware, setHardware] = useState<HardwareInfoDTO | null>(null);
  const [installedLocalModels, setInstalledLocalModels] = useState<string[]>([]);

  const [deps, setDeps] = useState<DepsCheckResult | null>(null);
  const [brewAvailable, setBrewAvailable] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState<DepsInstallTarget | "parakeet" | "local-llm" | null>(null);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installError, setInstallError] = useState<string | null>(null);
  const [skipBlackhole, setSkipBlackhole] = useState(false);
  const [restartingAudio, setRestartingAudio] = useState(false);
  const [restartAudioError, setRestartAudioError] = useState<string | null>(null);

  // Audio permissions (macOS). micPermission = native TCC status for mic;
  // systemAudioProbe = AudioTee zero-sample probe. Both are checked lazily
  // when the user lands on the dependencies step so we don't pop prompts
  // early in the flow.
  const [micPermission, setMicPermission] = useState<"unknown" | "granted" | "denied" | "not-determined" | "restricted">("unknown");
  const [micPermissionBusy, setMicPermissionBusy] = useState(false);
  const [systemAudioProbe, setSystemAudioProbe] = useState<
    | { status: "unknown" }
    | { status: "probing" }
    | { status: "granted" }
    | { status: "denied" }
    | { status: "unsupported" }
    | { status: "failed"; error: string }
  >({ status: "unknown" });
  const [appIdentity, setAppIdentity] = useState<{
    displayName: string;
    tccBundleName: string;
    bundlePath: string | null;
    isDev: boolean;
    isPackaged: boolean;
  } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [embedProgress, setEmbedProgress] = useState<{
    pct: number;
  } | null>(null);
  const [enableSemanticSearch, setEnableSemanticSearch] = useState(true);
  const [embedAlreadyInstalled, setEmbedAlreadyInstalled] = useState(false);

  useEffect(() => {
    api.obsidian.detectVaults().then(setDetectedVaults).catch(() => {});
  }, []);

  useEffect(() => {
    const unsub1 = api.on.depsInstallLog((line) =>
      setInstallLog((prev) => [...prev, line])
    );
    const unsub2 = api.on.setupAsrLog((line) =>
      setInstallLog((prev) => [...prev, line])
    );
    const unsub3 = api.on.setupLlmLog((line) =>
      setInstallLog((prev) => [...prev, line])
    );
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, []);

  useEffect(() => {
    if (step === 3 && !keysChecked) {
      setKeysChecked(true);
      api.secrets.has("claude").then(setHasClaude).catch(() => {});
      api.secrets.has("openai").then(setHasOpenai).catch(() => {});
      api.system.detectHardware().then(setHardware).catch(() => {});
      api.llm
        .check()
        .then((res) => setInstalledLocalModels(res.installedModels))
        .catch(() => setInstalledLocalModels([]));
      api.meetingIndex
        .embedModelStatus()
        .then((s) => setEmbedAlreadyInstalled(!!s.installed))
        .catch(() => setEmbedAlreadyInstalled(false));
    }
  }, [step, keysChecked]);

  useEffect(() => {
    if (llmProvider !== "ollama") return;
    if (localLlmModel) return;
    if (installedLocalModels.length > 0) {
      setLocalLlmModel(installedLocalModels[0]);
    } else {
      setLocalLlmModel(recommendLocalModel(hardware?.totalRamGb));
    }
  }, [llmProvider, hardware, installedLocalModels, localLlmModel]);

  useEffect(() => {
    if (step === 4) {
      api.depsCheck().then(setDeps).catch(() => {});
      api.deps.checkBrew().then(setBrewAvailable).catch(() => setBrewAvailable(false));
      // Load app identity so we can tell the user what to look for in
      // System Settings (e.g., "Electron" in dev, "Gistlist" in prod).
      api.system.getAppIdentity().then(setAppIdentity).catch(() => {});
      // Read current mic permission state (doesn't prompt).
      api.system
        .getMicrophonePermission()
        .then(({ status }) => setMicPermission(status as typeof micPermission))
        .catch(() => {});
    }
  }, [step]);

  const requestMicrophonePermission = async () => {
    setMicPermissionBusy(true);
    try {
      const res = await api.system.requestMicrophonePermission();
      setMicPermission(res.status as typeof micPermission);
    } catch {
      // noop
    } finally {
      setMicPermissionBusy(false);
    }
  };

  const probeSystemAudio = async () => {
    setSystemAudioProbe({ status: "probing" });
    try {
      const res = await api.system.probeSystemAudioPermission();
      if (res.status === "granted") setSystemAudioProbe({ status: "granted" });
      else if (res.status === "denied") setSystemAudioProbe({ status: "denied" });
      else if (res.status === "unsupported") setSystemAudioProbe({ status: "unsupported" });
      else setSystemAudioProbe({ status: "failed", error: res.error ?? "unknown error" });
    } catch (err) {
      setSystemAudioProbe({ status: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  };

  useEffect(() => {
    if (dataPathTouched) return;
    if (usesObsidian && vaultPath) {
      setDataPath(joinPath(vaultPath, "Meeting-notes"));
    } else if (!usesObsidian) {
      setDataPath("~/Documents/Gistlist");
    } else {
      setDataPath("");
    }
  }, [usesObsidian, vaultPath, dataPathTouched]);

  const pickVault = async () => {
    const picked = await api.config.pickDirectory();
    if (picked) setVaultPath(picked);
  };

  const pickDataDir = async () => {
    const picked = await api.config.pickDirectory();
    if (picked) {
      setDataPath(picked);
      setDataPathTouched(true);
    }
  };

  const installDep = async (target: DepsInstallTarget) => {
    setInstalling(target);
    setInstallLog([]);
    setInstallError(null);
    try {
      const result = await api.deps.install(target);
      if (!result.ok) {
        if (result.brewMissing) {
          setBrewAvailable(false);
          setInstallError("Homebrew is not installed. See the link below to get it, then re-run the install.");
        } else {
          setInstallError(result.error ?? "Install failed.");
        }
      }
      const fresh = await api.depsCheck();
      setDeps(fresh);
    } finally {
      setInstalling(null);
    }
  };

  const restartAudio = async () => {
    setRestartingAudio(true);
    setRestartAudioError(null);
    try {
      const result = await api.deps.restartAudio();
      if (!result.ok) {
        setRestartAudioError(result.error ?? "Failed to restart audio system.");
      } else {
        await new Promise((r) => setTimeout(r, 1500));
      }
      const fresh = await api.depsCheck();
      setDeps(fresh);
    } finally {
      setRestartingAudio(false);
    }
  };

  const installLocalLlm = async () => {
    if (!localLlmModel) return;
    setInstalling("local-llm");
    setInstallLog([]);
    setInstallError(null);
    try {
      await api.llm.setup({ model: localLlmModel });
      const res = await api.llm.check();
      setInstalledLocalModels(res.installedModels);
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(null);
    }
  };

  const installParakeet = async () => {
    setInstalling("parakeet");
    setInstallLog([]);
    setInstallError(null);
    try {
      await api.setupAsr({ force: false });
      const fresh = await api.depsCheck();
      setDeps(fresh);
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(null);
    }
  };

  const onFinish = async () => {
    setError(null);
    setBusy(true);
    try {
      if (claudeKey) await api.secrets.set("claude", claudeKey);
      if (openaiKey) await api.secrets.set("openai", openaiKey);

      const req: InitConfigRequest = {
        data_path: dataPath,
        obsidian_integration: {
          enabled: usesObsidian,
          vault_name: usesObsidian && vaultPath ? basename(vaultPath) : undefined,
          vault_path: usesObsidian && vaultPath ? vaultPath : undefined,
        },
        asr_provider: asrProvider,
        llm_provider: llmProvider,
        ollama_model: llmProvider === "ollama" ? localLlmModel : undefined,
        recording: { mic_device: "", system_device: "" },
        claude_api_key: claudeKey || undefined,
        openai_api_key: openaiKey || undefined,
        audio_retention_days:
          retentionValue === "never"
            ? null
            : retentionValue === "custom"
              ? parseInt(customRetentionDays, 10) || 90
              : parseInt(retentionValue, 10),
      };
      await api.config.initProject(req);
      // Embeddings are always local (Ollama + nomic-embed-text) regardless
      // of which LLM provider the user picked. Only pull if the user
      // opted in on step 3 and the model isn't already installed. Failure
      // is non-fatal — meeting-index search degrades to FTS-only without it.
      if (enableSemanticSearch && !embedAlreadyInstalled) {
        setEmbedProgress({ pct: 0 });
        const unsub = api.on.setupLlmProgress((p) =>
          setEmbedProgress({ pct: p.pct })
        );
        try {
          await api.meetingIndex.installEmbedModel();
        } catch (err) {
          console.warn("embedding model pull during setup failed", err);
        } finally {
          unsub();
          setEmbedProgress(null);
        }
      }
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const finishDisabled = useMemo(() => {
    if (busy || installing || restartingAudio) return true;
    if (!deps) return true;
    if (!deps.ffmpeg) return true;
    if (asrProvider === "parakeet-mlx" && !deps.parakeet) return true;
    // BlackHole no longer required — system audio is captured via AudioTee
    if (llmProvider === "ollama") {
      if (!localLlmModel) return true;
      if (!hasInstalledLocalModel(installedLocalModels, localLlmModel)) return true;
    }
    return false;
  }, [
    busy,
    installing,
    restartingAudio,
    deps,
    asrProvider,
    llmProvider,
    localLlmModel,
    installedLocalModels,
  ]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[radial-gradient(circle_at_top,rgba(45,107,63,0.08),transparent_32%),var(--bg-secondary)]">
      <div className="h-8 shrink-0 pl-20 [-webkit-app-region:drag]" />
      <div className="flex-1 overflow-y-auto px-6 pb-10 pt-5">
        <div className="mx-auto flex w-full max-w-[35rem] flex-col gap-4">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
            <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
            Gistlist setup
          </div>

          <div className="flex gap-1.5">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div
                key={i}
                className={[
                  "h-1 flex-1 rounded-full bg-[var(--bg-tertiary)]",
                  i < step ? "bg-[var(--success)]" : "",
                  i === step ? "bg-[var(--accent)]" : "",
                ].join(" ")}
              />
            ))}
          </div>

          {step === 0 && (
            <WizardStep
              title="Welcome to Gistlist"
              description="A local-first desktop app for meeting notes. Record in the app or import an existing recording, and your transcript, summary, and custom outputs land in editable markdown on disk. Obsidian is optional. Let's get you set up."
              footer={<Button onClick={() => setStep(1)}>Get started</Button>}
            />
          )}

          {step === 1 && (
            <WizardStep
              title="Do you use Obsidian?"
              description="Obsidian is an optional viewer. The app works perfectly without it — it has its own markdown editor and browser. If you already use Obsidian, we can store meetings inside your vault so they show up alongside your other notes."
              footer={
                <WizardActions
                  back={{ label: "Back", onClick: () => setStep(0) }}
                  primary={{
                    label: "Next",
                    onClick: () => setStep(2),
                    disabled: usesObsidian && !vaultPath,
                  }}
                />
              }
            >
              <SettingToggle
                id="wizard-use-obsidian"
                checked={usesObsidian}
                onCheckedChange={(checked) => {
                  setUsesObsidian(checked);
                  if (!checked) setVaultPath("");
                }}
                title="Yes, I use Obsidian"
              />

              {usesObsidian && (
                <div className="space-y-4">
                  <Field label="Vault path" htmlFor="wizard-vault-path">
                    <PickerRow>
                      <Input
                        id="wizard-vault-path"
                        value={vaultPath}
                        onChange={(e) => setVaultPath(e.target.value)}
                        placeholder="/Users/you/Obsidian/MyVault"
                      />
                      <Button variant="secondary" onClick={pickVault}>Pick…</Button>
                    </PickerRow>
                  </Field>

                  {detectedVaults.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                        Detected vaults
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {detectedVaults.map((v) => (
                          <Button
                            key={v.path}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="max-w-full"
                            onClick={() => setVaultPath(v.path)}
                            title={v.path}
                          >
                            <span className="truncate">{v.name}</span>
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </WizardStep>
          )}

          {step === 2 && (
            <WizardStep
              title="Where should meetings be stored?"
              description={
                usesObsidian
                  ? "This folder lives inside your Obsidian vault — the default is a Meeting-notes subfolder. Every meeting becomes its own markdown file."
                  : "Pick any folder on your machine. Every meeting becomes a subfolder with plain markdown files. You can change this later."
              }
              footer={
                <WizardActions
                  back={{ label: "Back", onClick: () => setStep(1) }}
                  primary={{
                    label: "Next",
                    onClick: () => setStep(3),
                    disabled: !dataPath,
                  }}
                />
              }
            >
              <Field label="Data directory" htmlFor="wizard-data-path">
                <PickerRow>
                  <Input
                    id="wizard-data-path"
                    value={dataPath}
                    onChange={(e) => {
                      setDataPath(e.target.value);
                      setDataPathTouched(true);
                    }}
                    placeholder="/Users/you/Documents/Gistlist"
                  />
                  <Button variant="secondary" onClick={pickDataDir}>Pick…</Button>
                </PickerRow>
              </Field>

              <Field label="Audio file retention">
                <Select value={retentionValue} onValueChange={setRetentionValue}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">Never delete</SelectItem>
                    <SelectItem value="7">After 7 days</SelectItem>
                    <SelectItem value="30">After 30 days</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
                {retentionValue === "custom" && (
                  <div className="flex items-center gap-2 pt-2">
                    <Input
                      type="number"
                      min={1}
                      value={customRetentionDays}
                      onChange={(e) => setCustomRetentionDays(e.target.value)}
                      className="w-24"
                    />
                    <span className="text-sm text-[var(--text-secondary)]">days</span>
                  </div>
                )}
                <p className="text-xs text-[var(--text-tertiary)]">
                  Audio files are large (~2 MB/min). Transcripts and notes are always kept.
                </p>
              </Field>
            </WizardStep>
          )}

          {step === 3 && (
            <WizardStep
              title="Transcription & Summarization"
              description="Pick your AI providers. Cloud models are faster and smarter; local models are private and free."
              footer={
                <WizardActions
                  back={{ label: "Back", onClick: () => setStep(2) }}
                  primary={{
                    label: "Next",
                    onClick: () => setStep(4),
                    disabled:
                      (llmProvider === "claude" && !(claudeKey || hasClaude)) ||
                      (llmProvider === "openai" && !(openaiKey || hasOpenai)) ||
                      (llmProvider === "ollama" && !localLlmModel) ||
                      (asrProvider === "openai" && !(openaiKey || hasOpenai)),
                  }}
                />
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Transcription (ASR)">
                  <Select
                    value={asrProvider}
                    onValueChange={(value) =>
                      setAsrProvider(value as AppConfigDTO["asr_provider"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="parakeet-mlx">Parakeet (local)</SelectItem>
                      <SelectItem value="openai">OpenAI (cloud)</SelectItem>
                      <SelectItem value="whisper-local">whisper.cpp (local)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Summarization (LLM)">
                  <Select
                    value={llmProvider}
                    onValueChange={(value) =>
                      setLlmProvider(value as "claude" | "openai" | "ollama")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="claude">Anthropic Claude</SelectItem>
                      <SelectItem value="openai">OpenAI ChatGPT</SelectItem>
                      <SelectItem value="ollama">Local (Ollama)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {llmProvider === "ollama" && (
                <div
                  className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4"
                  data-testid="local-llm-picker"
                >
                  <Field
                    label="Local model"
                    meta={
                      hardware?.totalRamGb
                        ? `${hardware.totalRamGb} GB RAM${hardware.chip ? `, ${hardware.chip}` : ""}`
                        : undefined
                    }
                  >
                    <Select value={localLlmModel} onValueChange={setLocalLlmModel}>
                      <SelectTrigger data-testid="local-llm-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(() => {
                          const curated = LLM_MODELS.filter(
                            (model) => model.provider === "ollama"
                          );
                          const recommendedId = recommendLocalModel(hardware?.totalRamGb);
                          const extras = installedLocalModels.filter(
                            (id) =>
                              !curated.some((m) => localModelIdsMatch(m.id, id)) &&
                              !/embed/i.test(id)
                          );
                          return (
                            <>
                              {curated.map((model) => {
                                const tooBig =
                                  typeof hardware?.totalRamGb === "number" &&
                                  typeof model.minRamGb === "number" &&
                                  model.minRamGb > hardware.totalRamGb;
                                const installed = hasInstalledLocalModel(
                                  installedLocalModels,
                                  model.id
                                );
                                const recommended =
                                  model.id === recommendedId;
                                const sizeLabel = model.sizeGb
                                  ? ` · ${model.sizeGb} GB`
                                  : "";
                                const tags: string[] = [];
                                if (installed) tags.push("✓ installed");
                                if (recommended && !tooBig)
                                  tags.push("recommended");
                                if (tooBig)
                                  tags.push(
                                    `needs ${model.minRamGb} GB RAM`
                                  );
                                const tagLabel = tags.length
                                  ? ` · ${tags.join(" · ")}`
                                  : "";
                                return (
                                  <SelectItem
                                    key={model.id}
                                    value={model.id}
                                    disabled={tooBig}
                                  >
                                    {model.label}
                                    {sizeLabel}
                                    {tagLabel}
                                  </SelectItem>
                                );
                              })}
                              {extras.map((id) => (
                                <SelectItem key={id} value={id}>
                                  {id} · ✓ installed
                                </SelectItem>
                              ))}
                            </>
                          );
                        })()}
                      </SelectContent>
                    </Select>
                    {localLlmModel && (
                      <Hint>{findModelEntry(localLlmModel)?.blurb}</Hint>
                    )}
                  </Field>
                </div>
              )}

              <div className="space-y-4">
                {(llmProvider === "claude") && (
                  <Field
                    label="Anthropic API key"
                    status={hasClaude ? "Already stored" : undefined}
                  >
                    <Input
                      type="password"
                      value={claudeKey}
                      onChange={(e) => setClaudeKey(e.target.value)}
                      placeholder={hasClaude ? "leave blank to keep existing" : "sk-ant-…"}
                    />
                    {hasClaude && !claudeKey && (
                      <Hint>
                        Found an Anthropic key in your macOS keychain. Leave blank to keep using it.
                      </Hint>
                    )}
                  </Field>
                )}

                {(llmProvider === "openai" || asrProvider === "openai") && (
                  <div className="space-y-3">
                    <Field
                      label="OpenAI API key"
                      status={hasOpenai ? "Already stored" : undefined}
                    >
                      <Input
                        type="password"
                        value={openaiKey}
                        onChange={(e) => setOpenaiKey(e.target.value)}
                        placeholder={hasOpenai ? "leave blank to keep existing" : "sk-…"}
                      />
                      {hasOpenai && !openaiKey && (
                        <Hint>
                          Found an OpenAI key in your macOS keychain. Leave blank to keep using it.
                        </Hint>
                      )}
                    </Field>

                    {asrProvider === "openai" && (
                      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                        OpenAI caps uploads at 25 MB. Meetings longer than ~80 min will fail; use Parakeet (local) for longer recordings.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div data-testid="semantic-search-opt-in">
                {embedAlreadyInstalled ? (
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
                    <div className="text-sm font-medium text-[var(--text-primary)]">
                      Semantic meeting search
                    </div>
                    <div className="mt-1 text-sm text-[var(--text-secondary)]">
                      The local embedding model is already installed — semantic search is ready for Claude Desktop via MCP.
                    </div>
                  </div>
                ) : (
                  <SettingToggle
                    id="wizard-enable-semantic-search"
                    checked={enableSemanticSearch}
                    onCheckedChange={setEnableSemanticSearch}
                    title="Enable semantic meeting search (~274 MB download)"
                    description="Lets Claude Desktop (via MCP) find your transcripts by meaning, not just keywords (e.g. asking about “rates” will hit a transcript that said “pricing”). Runs locally — your transcripts never leave your machine. You can change this later in Settings."
                  />
                )}
              </div>
            </WizardStep>
          )}

          {step === 4 && (
            <WizardStep
              title="Dependencies"
              description="These are the tools Gistlist uses to record and transcribe audio. Missing items can be installed for you with Homebrew."
              footer={
                <WizardActions
                  back={{ label: "Back", onClick: () => setStep(3), disabled: installing !== null }}
                  secondary={{
                    label: "Re-check",
                    onClick: () => {
                      api.depsCheck().then(setDeps).catch(() => {});
                      api.deps.checkBrew().then(setBrewAvailable).catch(() => {});
                    },
                    disabled: installing !== null,
                  }}
                  primary={{
                    label: busy
                      ? embedProgress
                        ? `Pulling embedding model… ${embedProgress.pct}%`
                        : "Finishing…"
                      : "Finish setup",
                    onClick: onFinish,
                    disabled: finishDisabled,
                  }}
                />
              }
            >
              {deps == null ? (
                <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <Spinner className="h-4 w-4" />
                  Checking dependencies…
                </div>
              ) : (
                <div className="space-y-3">
                  <DependencyRow
                    name="ffmpeg"
                    ok={!!deps.ffmpeg}
                    value={deps.ffmpeg ?? undefined}
                    installLabel="Install via Homebrew"
                    installing={installing === "ffmpeg"}
                    anyInstalling={installing !== null}
                    brewAvailable={brewAvailable}
                    onInstall={() => installDep("ffmpeg")}
                  />
                  {/* Audio permissions — actionable during setup so recording works on first try */}
                  <AudioPermissionsPanel
                    systemAudioSupported={deps.systemAudioSupported}
                    micPermission={micPermission}
                    micPermissionBusy={micPermissionBusy}
                    systemAudioProbe={systemAudioProbe}
                    appIdentity={appIdentity}
                    onRequestMic={requestMicrophonePermission}
                    onProbeSystemAudio={probeSystemAudio}
                  />
                  {asrProvider === "parakeet-mlx" && (
                    <DependencyRow
                      name="Parakeet"
                      ok={!!deps.parakeet}
                      value={deps.parakeet ?? undefined}
                      installLabel="Install Parakeet"
                      installing={installing === "parakeet"}
                      anyInstalling={installing !== null}
                      brewAvailable={true}
                      onInstall={installParakeet}
                      footerNote={
                        !deps.parakeet
                          ? "Creates a Python venv at ~/.gistlist/parakeet-venv and downloads model weights (~600 MB). Takes about a minute."
                          : undefined
                      }
                    />
                  )}
                  {llmProvider === "ollama" && localLlmModel && (
                    <DependencyRow
                      name={`Model: ${localLlmModel}`}
                      ok={hasInstalledLocalModel(installedLocalModels, localLlmModel)}
                      value={
                        hasInstalledLocalModel(installedLocalModels, localLlmModel)
                          ? "ready"
                          : undefined
                      }
                      installLabel={`Download ${localLlmModel}`}
                      installing={installing === "local-llm"}
                      anyInstalling={installing !== null}
                      brewAvailable={true}
                      onInstall={installLocalLlm}
                      footerNote={
                        !hasInstalledLocalModel(installedLocalModels, localLlmModel)
                          ? `Downloads ${
                              findModelEntry(localLlmModel)?.sizeGb ?? "~5"
                            } GB to ~/.ollama/models. One-time. Shared with any system Ollama install.`
                          : undefined
                      }
                    />
                  )}
                </div>
              )}

              {brewAvailable === false && (
                <Card className="border-[var(--warning)]/40 bg-[var(--warning-muted)]/50 shadow-none">
                  <CardContent className="space-y-3 p-4">
                    <div className="text-sm font-medium text-[var(--text-primary)]">Homebrew is not installed</div>
                    <div className="text-sm text-[var(--text-secondary)]">
                      Homebrew is the macOS package manager we use to install ffmpeg. Open Terminal and run:
                    </div>
                    <pre className="overflow-x-auto rounded-lg border border-[var(--border-default)] bg-white px-3 py-2 font-mono text-xs text-[var(--text-primary)]">
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
                    </pre>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        api.deps.checkBrew().then(setBrewAvailable);
                      }}
                    >
                      Re-check
                    </Button>
                  </CardContent>
                </Card>
              )}

              {installLog.length > 0 && (
                <pre className="max-h-52 overflow-auto rounded-xl border border-[var(--border-default)] bg-[var(--text-primary)] px-4 py-3 font-mono text-xs leading-6 text-[rgba(255,255,255,0.88)]">
                  {installLog.join("\n")}
                </pre>
              )}

              {installError && (
                <div className="text-sm text-[var(--error)]">{installError}</div>
              )}

              {/* BlackHole skip checkbox removed — system audio is automatic */}

              {busy && embedProgress && (
                <div
                  className="space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3"
                  data-testid="embed-pull-progress"
                >
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[var(--text-primary)]">
                      Downloading embedding model (~274 MB)
                    </span>
                    <span className="font-mono text-xs text-[var(--text-secondary)]">
                      {embedProgress.pct}%
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded bg-[var(--bg-tertiary)]">
                    <div
                      className="h-full bg-[var(--accent)] transition-[width]"
                      style={{ width: `${embedProgress.pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Powers semantic meeting search (used by Claude Desktop
                    via MCP). Runs locally — your transcripts never leave
                    your machine.
                  </p>
                </div>
              )}

              {error && (
                <div className="text-sm text-[var(--error)]">{error}</div>
              )}
            </WizardStep>
          )}
        </div>
      </div>
    </div>
  );
}

function WizardStep({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card className="rounded-2xl border-[var(--border-default)] bg-white shadow-[0_18px_44px_rgba(31,45,28,0.10)]">
      <CardContent className="space-y-6 p-7">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">{title}</h2>
          <p className="text-sm leading-6 text-[var(--text-secondary)]">{description}</p>
        </div>
        {children ? <div className="space-y-5">{children}</div> : null}
        {footer ? <div className="border-t border-[var(--border-subtle)] pt-5">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}

function WizardActions({
  back,
  secondary,
  primary,
}: {
  back?: { label: string; onClick: () => void; disabled?: boolean };
  secondary?: { label: string; onClick: () => void; disabled?: boolean };
  primary: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {back ? (
        <Button variant="secondary" onClick={back.onClick} disabled={back.disabled}>
          {back.label}
        </Button>
      ) : null}
      <div className="ml-auto flex flex-wrap gap-3">
        {secondary ? (
          <Button variant="secondary" onClick={secondary.onClick} disabled={secondary.disabled}>
            {secondary.label}
          </Button>
        ) : null}
        <Button onClick={primary.onClick} disabled={primary.disabled}>
          {primary.label}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  meta,
  status,
  children,
}: {
  label: string;
  htmlFor?: string;
  meta?: string;
  status?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label htmlFor={htmlFor} className="text-sm font-medium text-[var(--text-primary)]">
          {label}
        </label>
        {meta ? <span className="text-xs text-[var(--text-tertiary)]">{meta}</span> : null}
        {status ? <Badge variant="success" className="w-fit">{status}</Badge> : null}
      </div>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="text-xs leading-5 text-[var(--text-secondary)]">{children}</div>;
}

function PickerRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-3 sm:flex-row">{children}</div>;
}

function SettingToggle({
  id,
  checked,
  onCheckedChange,
  title,
  description,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
      <label htmlFor={id} className="cursor-pointer space-y-1">
        <div className="text-sm font-medium text-[var(--text-primary)]">{title}</div>
        {description ? <div className="text-sm leading-5 text-[var(--text-secondary)]">{description}</div> : null}
      </label>
    </div>
  );
}

interface DependencyRowProps {
  name: string;
  ok: boolean;
  value?: string;
  installLabel: string;
  installing: boolean;
  anyInstalling: boolean;
  brewAvailable: boolean | null;
  onInstall: () => void;
  footerNote?: string;
}

function DependencyRow({
  name,
  ok,
  value,
  installLabel,
  installing,
  anyInstalling,
  brewAvailable,
  onInstall,
  footerNote,
}: DependencyRowProps) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm font-medium text-[var(--text-primary)]">{name}</div>
            <DependencyStateBadge ok={ok} warning={false} />
            {value ? <span className="truncate font-mono text-xs text-[var(--text-secondary)]">{value}</span> : null}
            {!value ? <span className="text-xs text-[var(--text-secondary)]">{ok ? "installed" : "not installed"}</span> : null}
          </div>
          {footerNote && !ok ? <div className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">{footerNote}</div> : null}
        </div>
        {!ok ? (
          <Button variant="secondary" onClick={onInstall} disabled={anyInstalling || brewAvailable === false}>
            {installing ? <><Spinner className="h-3.5 w-3.5" /> Installing…</> : installLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function DependencyStateBadge({
  ok,
  warning,
}: {
  ok: boolean;
  warning: boolean;
}) {
  if (ok) {
    return (
      <Badge variant="success" className="gap-1 normal-case tracking-normal">
        <CheckCircle2 className="h-3 w-3" />
        Ready
      </Badge>
    );
  }
  if (warning) {
    return (
      <Badge variant="warning" className="gap-1 normal-case tracking-normal">
        <AlertTriangle className="h-3 w-3" />
        Needs attention
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1 normal-case tracking-normal">
      <XCircle className="h-3 w-3" />
      Missing
    </Badge>
  );
}

function joinPath(a: string, b: string): string {
  if (a.endsWith("/")) return a + b;
  return `${a}/${b}`;
}

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

// ---- Audio permissions panel used in the Dependencies wizard step ----

type SystemAudioProbeState =
  | { status: "unknown" }
  | { status: "probing" }
  | { status: "granted" }
  | { status: "denied" }
  | { status: "unsupported" }
  | { status: "failed"; error: string };

function AudioPermissionsPanel({
  systemAudioSupported,
  micPermission,
  micPermissionBusy,
  systemAudioProbe,
  appIdentity,
  onRequestMic,
  onProbeSystemAudio,
}: {
  systemAudioSupported: boolean;
  micPermission: "unknown" | "granted" | "denied" | "not-determined" | "restricted";
  micPermissionBusy: boolean;
  systemAudioProbe: SystemAudioProbeState;
  appIdentity: { displayName: string; tccBundleName: string; bundlePath: string | null; isDev: boolean; isPackaged: boolean } | null;
  onRequestMic: () => void;
  onProbeSystemAudio: () => void;
}) {
  const bundleLabel = appIdentity?.tccBundleName ?? "Gistlist";
  const isDev = appIdentity?.isDev ?? false;

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 space-y-4">
      <div className="text-sm font-medium text-[var(--text-primary)]">Audio permissions</div>

      {/* Microphone */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm text-[var(--text-primary)] min-w-[120px]">Microphone</div>
          {micPermission === "granted" ? (
            <Badge className="gap-1 bg-[var(--success-muted,#dcfce7)] text-[var(--success,#15803d)]">
              <CheckCircle2 className="h-3 w-3" />
              Granted
            </Badge>
          ) : micPermission === "denied" || micPermission === "restricted" ? (
            <Badge variant="destructive" className="gap-1">
              <XCircle className="h-3 w-3" />
              Denied
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1">
              <Info className="h-3 w-3" />
              {micPermission === "not-determined" ? "Not yet granted" : "Unknown"}
            </Badge>
          )}
          {micPermission !== "granted" ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={onRequestMic}
              disabled={micPermissionBusy}
            >
              {micPermissionBusy ? "Requesting…" : "Grant microphone access"}
            </Button>
          ) : null}
          {micPermission === "denied" ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => api.system.openMicrophonePermissionPane().catch(() => {})}
            >
              Open Settings
            </Button>
          ) : null}
        </div>
        <div className="text-xs text-[var(--text-secondary)]">
          Needed to record your voice. macOS will show a permission prompt the first time.
        </div>
      </div>

      {/* System audio */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm text-[var(--text-primary)] min-w-[120px]">System audio</div>
          {!systemAudioSupported ? (
            <>
              <Badge variant="secondary" className="gap-1">
                <Info className="h-3 w-3" />
                Unsupported
              </Badge>
              <Badge variant="secondary" className="gap-1 bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                Optional
              </Badge>
              <span className="text-xs text-[var(--text-secondary)]">
                Requires macOS 14.2+ — mic-only recording still works.
              </span>
            </>
          ) : systemAudioProbe.status === "granted" ? (
            <Badge className="gap-1 bg-[var(--success-muted,#dcfce7)] text-[var(--success,#15803d)]">
              <CheckCircle2 className="h-3 w-3" />
              Granted
            </Badge>
          ) : systemAudioProbe.status === "denied" ? (
            <Badge variant="destructive" className="gap-1">
              <XCircle className="h-3 w-3" />
              Not granted
            </Badge>
          ) : systemAudioProbe.status === "probing" ? (
            <Badge variant="secondary" className="gap-1">
              <Spinner className="h-3 w-3" />
              Checking (≈2s)…
            </Badge>
          ) : systemAudioProbe.status === "failed" ? (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              Failed
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1">
              <Info className="h-3 w-3" />
              Not yet checked
            </Badge>
          )}
          {systemAudioSupported && systemAudioProbe.status !== "granted" && systemAudioProbe.status !== "probing" ? (
            <Button size="sm" variant="secondary" onClick={onProbeSystemAudio}>
              Check system audio
            </Button>
          ) : null}
        </div>
        {systemAudioSupported && systemAudioProbe.status === "denied" ? (
          <div className="rounded-md border border-[var(--warning)]/40 bg-[var(--warning-muted,rgba(245,158,11,0.08))] px-3 py-2 text-xs space-y-2">
            <div className="text-[var(--text-secondary)]">
              macOS is delivering silent audio because the <strong>"System Audio Recording Only"</strong> permission
              hasn't been granted.{" "}
              {isDev ? (
                <>Because this is a development build, grant the permission to <strong className="text-[var(--text-primary)]">"Electron"</strong> (not "Gistlist"). A packaged build will correctly show "Gistlist".</>
              ) : (
                <>Grant it to <strong className="text-[var(--text-primary)]">"{bundleLabel}"</strong>.</>
              )}
            </div>
            <ol className="ml-4 list-decimal space-y-0.5 text-[var(--text-secondary)]">
              <li>Open System Settings (button below).</li>
              <li>Scroll to <strong className="text-[var(--text-primary)]">"System Audio Recording Only"</strong>.</li>
              <li>
                If <strong className="text-[var(--text-primary)]">{isDev ? "Electron" : bundleLabel}</strong> is in
                the list, turn its switch on. Otherwise click <strong className="text-[var(--text-primary)]">+</strong>{" "}
                and drag it from the Finder window (use <em>Reveal in Finder</em>).
              </li>
              <li>Come back here and click <em>Check system audio</em>.</li>
            </ol>
            {appIdentity?.bundlePath ? (
              <div className="font-mono text-[10px] text-[var(--text-tertiary)] break-all">
                {appIdentity.bundlePath}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => api.system.openAudioPermissionPane().catch(() => {})}
              >
                Open System Settings
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => api.system.revealAppBundle().catch(() => {})}
              >
                Reveal {isDev ? "Electron" : bundleLabel} in Finder
              </Button>
            </div>
          </div>
        ) : systemAudioSupported ? (
          <div className="text-xs text-[var(--text-secondary)]">
            Captures the other participants in your meeting (browser, Zoom, Teams, etc.). The check plays nothing —
            it just verifies audio data is flowing through macOS's CoreAudio tap.
          </div>
        ) : null}
      </div>
    </div>
  );
}
