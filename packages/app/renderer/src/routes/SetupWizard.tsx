import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { api } from "../ipc-client";
import type {
  AppConfigDTO,
  DepsCheckResult,
  DepsInstallTarget,
  DetectedVault,
  HardwareInfoDTO,
  InitConfigRequest,
  ResolvedTool,
} from "../../../shared/ipc";
import {
  recommendLocalModel,
  recommendedLocalModelIds,
  findModelEntry,
  localModelIdsMatch,
} from "../constants";
import { ModelDropdown } from "../components/ModelDropdown";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { DependencyInstallProgress } from "../components/wizard/DependencyInstallProgress";
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
  /**
   * When provided, the wizard pre-fills every step from the existing
   * config instead of first-run defaults. Used when reopening from
   * Settings → Other → "Run setup again" so users don't lose their
   * data path, Obsidian vault, ASR/LLM choices, or retention setting
   * just by clicking through.
   */
  initialConfig?: AppConfigDTO;
  /**
   * When provided, a "Cancel" button appears in the wizard chrome.
   * Calling it should dismiss the wizard without writing config —
   * the App-level handler clears the reopen flag and returns the user
   * to Settings. Omitted on first-run so fresh users must complete
   * setup.
   */
  onCancel?: () => void;
}

// Must match the SelectItem values rendered in step 2's retention dropdown
// (see the Select around line 597). Drift between this set and the rendered
// options would surface as a blank/invalid value when the wizard reopens
// against a config whose retention number isn't a real preset.
const RETENTION_PRESETS = new Set([7, 30]);

/**
 * Map an `audio_retention_days` value to the wizard's three-way control:
 *   - null → "never"
 *   - 7 or 30 → that number stringified (matches a real SelectItem)
 *   - any other positive number (e.g. 90, 180, 365 from older configs) →
 *     "custom" with the integer surfaced in the custom-days input
 */
function retentionFromConfig(days: number | null): {
  value: string;
  custom: string;
} {
  if (days === null) return { value: "never", custom: "90" };
  if (RETENTION_PRESETS.has(days)) return { value: String(days), custom: "90" };
  return { value: "custom", custom: String(days) };
}

// Named-step indices. Use these instead of magic numbers in `step === N`
// checks so a future insert/remove only touches this enum + the wizard's
// step-jsx blocks. The indices themselves still drive the progress dots
// and the underlying `step: number` state.
const STEP = {
  WELCOME: 0,
  STORAGE: 1,
  RETENTION: 2,
  PROVIDERS: 3,
  PERMISSIONS: 4,
  DEPS: 5,
} as const;
const TOTAL_STEPS = 6;

function hasInstalledLocalModel(
  installedLocalModels: readonly string[],
  modelId: string | null | undefined
): boolean {
  return installedLocalModels.some((installedModel) =>
    localModelIdsMatch(installedModel, modelId)
  );
}

export function SetupWizard({ onComplete, initialConfig, onCancel }: SetupWizardProps) {
  const [step, setStep] = useState(0);

  // When `initialConfig` is provided we treat that as the authoritative
  // source for every step's initial state. Without it (first-run), we
  // fall back to the original hardcoded defaults.
  const seedRetention = retentionFromConfig(
    initialConfig?.audio_retention_days ?? null
  );

  const [usesObsidian, setUsesObsidian] = useState<boolean>(
    initialConfig?.obsidian_integration.enabled ?? false
  );
  const [vaultPath, setVaultPath] = useState<string>(
    initialConfig?.obsidian_integration.vault_path ?? ""
  );
  const [detectedVaults, setDetectedVaults] = useState<DetectedVault[]>([]);

  const [dataPath, setDataPath] = useState<string>(initialConfig?.data_path ?? "");
  // Seed `dataPathTouched=true` when reopened so the auto-suggest effect
  // (which derives a default path from Obsidian/no-Obsidian) doesn't
  // overwrite the user's existing data_path.
  const [dataPathTouched, setDataPathTouched] = useState(Boolean(initialConfig));
  const [retentionValue, setRetentionValue] = useState<string>(seedRetention.value);
  const [customRetentionDays, setCustomRetentionDays] = useState<string>(seedRetention.custom);

  const [asrProvider, setAsrProvider] =
    useState<AppConfigDTO["asr_provider"]>(initialConfig?.asr_provider ?? "parakeet-mlx");
  const [claudeKey, setClaudeKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [hasClaude, setHasClaude] = useState<boolean>(false);
  const [hasOpenai, setHasOpenai] = useState<boolean>(false);
  const [keysChecked, setKeysChecked] = useState(false);

  const [llmProvider, setLlmProvider] = useState<AppConfigDTO["llm_provider"]>(
    initialConfig?.llm_provider ?? "ollama"
  );
  const [localLlmModel, setLocalLlmModel] = useState<string>(
    initialConfig?.llm_provider === "ollama" ? initialConfig.ollama.model : ""
  );
  const [hardware, setHardware] = useState<HardwareInfoDTO | null>(null);
  const [installedLocalModels, setInstalledLocalModels] = useState<string[]>([]);
  // Tracks whether the step-3 `llm.check()` round-trip has completed, so
  // the auto-select effect below can distinguish "not loaded yet" from
  // "loaded, user has no chat models". Without this, hardware (a fast
  // synchronous IPC) typically resolves before Ollama's HTTP probe, and
  // the auto-select would lock in the recommended default before the
  // installed-models list could win.
  const [installedLocalModelsLoaded, setInstalledLocalModelsLoaded] =
    useState(false);

  const [deps, setDeps] = useState<DepsCheckResult | null>(null);
  const [brewAvailable, setBrewAvailable] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState<DepsInstallTarget | "parakeet" | "local-llm" | null>(null);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const installLogRef = useRef<HTMLPreElement>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  // Used by the DependencyInstallProgress "Retry" button to re-fire the
  // exact install that failed without the user having to re-click the
  // row. Set at install start; cleared on Dismiss.
  const lastInstallTargetRef = useRef<
    DepsInstallTarget | "parakeet" | "local-llm" | null
  >(null);
  const [skipBlackhole, setSkipBlackhole] = useState(false);
  const [restartingAudio, setRestartingAudio] = useState(false);
  const [restartAudioError, setRestartAudioError] = useState<string | null>(null);
  const [recheckBusy, setRecheckBusy] = useState(false);

  // Audio permissions (macOS).
  //
  // micPermission: native TCC status for mic, read via the no-prompt
  // Electron `systemPreferences.getMediaAccessStatus("microphone")`
  // bridge. Safe to query on mount.
  //
  // systemAudioProbe: AudioTee zero-sample probe state machine. Two-stage
  // (Test → Verify) per the Phase 3 plan to eliminate the "first probe
  // flashes red while the TCC dialog is still open" flicker:
  //   unknown          — initial.
  //   prompting        — first probe in flight (this is what triggers the
  //                       TCC dialog). UI shows neutral "asking macOS for
  //                       permission" copy. The probe's eventual result
  //                       is resolved against `probeRequestIdRef` — only
  //                       a `granted` settles to `granted` directly;
  //                       `denied` and `failed` transition to
  //                       `awaitingVerify` because the user almost
  //                       certainly hasn't clicked Allow yet.
  //   awaitingVerify   — first probe came back not-granted. Button:
  //                       "Verify". User clicks once they've granted in
  //                       the TCC dialog above.
  //   verifying        — second probe in flight. Increments
  //                       probeRequestIdRef, so any late first-probe
  //                       result is discarded by the requestId guard.
  //   granted/denied/failed — terminal states from a verified probe.
  //
  // The `system:capabilities` IPC (called on mount of the new Permissions
  // step) tells us whether the macOS host even supports system-audio
  // capture (14.2+). It does NOT tell us whether the user has previously
  // granted — TCC for ScreenCaptureKit's system-audio sub-permission has
  // no documented non-prompting query. So returning users start in
  // `unknown` and a "Test" click transitions through `prompting → granted`
  // immediately when the OS already remembers their grant.
  const [micPermission, setMicPermission] = useState<"unknown" | "granted" | "denied" | "not-determined" | "restricted">("unknown");
  const [micPermissionBusy, setMicPermissionBusy] = useState(false);
  type SystemAudioFsm =
    | { status: "unknown" }
    | { status: "prompting" }
    | { status: "awaitingVerify" }
    | { status: "verifying" }
    | { status: "granted" }
    | { status: "denied" }
    | { status: "unsupported" }
    | { status: "failed"; error: string };
  const [systemAudioProbe, setSystemAudioProbe] = useState<SystemAudioFsm>({
    status: "unknown",
  });
  const probeRequestIdRef = useRef<number>(0);
  const [systemAudioSupportedCap, setSystemAudioSupportedCap] = useState<boolean | null>(null);
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
    const node = installLogRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [installLog]);

  useEffect(() => {
    if (step === STEP.PROVIDERS && !keysChecked) {
      setKeysChecked(true);
      api.secrets.has("claude").then(setHasClaude).catch(() => {});
      api.secrets.has("openai").then(setHasOpenai).catch(() => {});
      api.system.detectHardware().then(setHardware).catch(() => {});
      api.llm
        .check()
        .then((res) => setInstalledLocalModels(res.installedModels))
        .catch(() => setInstalledLocalModels([]))
        .finally(() => setInstalledLocalModelsLoaded(true));
      api.meetingIndex
        .embedModelStatus()
        .then((s) => setEmbedAlreadyInstalled(!!s.installed))
        .catch(() => setEmbedAlreadyInstalled(false));
    }
  }, [step, keysChecked]);

  useEffect(() => {
    if (llmProvider !== "ollama") return;
    if (localLlmModel) return;
    // Wait for both step-3 fetches before locking in a default. With
    // ollama as the first-run provider this effect runs on initial mount
    // (hardware=null, models not yet probed). Picking now would freeze in
    // recommendLocalModel(undefined)=qwen3.5:2b, and the truthy guard
    // above blocks any later correction. Even after step 3 fires,
    // hardware (a fast process-info IPC) typically resolves before
    // Ollama's HTTP probe, so we also need to wait for the model list
    // or the "installed wins" branch silently loses to the recommended
    // default.
    if (!hardware) return;
    if (!installedLocalModelsLoaded) return;
    const installedChatModels = installedLocalModels.filter(
      (id) => !/embed/i.test(id)
    );
    if (installedChatModels.length > 0) {
      setLocalLlmModel(installedChatModels[0]);
    } else {
      setLocalLlmModel(recommendLocalModel(hardware.totalRamGb));
    }
  }, [
    llmProvider,
    hardware,
    installedLocalModels,
    installedLocalModelsLoaded,
    localLlmModel,
  ]);

  // Parakeet (MLX) doesn't run on Intel Macs. If hardware detection comes
  // back as Intel and the user is still on the parakeet-mlx default,
  // auto-switch to OpenAI cloud ASR — the only working option on x64.
  useEffect(() => {
    if (hardware?.appleSilicon === false && asrProvider === "parakeet-mlx") {
      setAsrProvider("openai");
    }
  }, [hardware?.appleSilicon, asrProvider]);

  useEffect(() => {
    if (step === STEP.PERMISSIONS) {
      // Permissions step is a sibling of Dependencies and runs FIRST
      // (between providers and deps). Status reads only — never trigger
      // a permission dialog or run a subprocess as a side effect of
      // landing on this step. The mic request and the system-audio probe
      // run only when the user clicks their respective buttons. The
      // `system:capabilities` IPC is a no-spawn macOS-version check
      // (factored out of `isSystemAudioSupported`) so the Permissions
      // step doesn't have to wait on the heavier deps:check pipeline.
      api.system.capabilities()
        .then((c) => setSystemAudioSupportedCap(c.systemAudioSupported))
        .catch(() => setSystemAudioSupportedCap(false));
      api.system.getAppIdentity().then(setAppIdentity).catch(() => {});
      api.system
        .getMicrophonePermission()
        .then(({ status }) => setMicPermission(status as typeof micPermission))
        .catch(() => {});
    }
    if (step === STEP.DEPS) {
      // Status reads only on the dependencies step too; mic/system-audio
      // already lives on the Permissions step.
      api.depsCheck().then(setDeps).catch(() => {});
      api.deps.checkBrew().then(setBrewAvailable).catch(() => setBrewAvailable(false));
      api.system.getAppIdentity().then(setAppIdentity).catch(() => {});
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

  // First-stage probe — kicks off the TCC dialog. Per the Phase 3 FSM,
  // the probe's result handling depends on the user having had a chance
  // to click Allow:
  //   - `granted` is treated as final and transitions straight to the
  //     `granted` terminal state. Returning users who already granted
  //     fall into this branch and never see the awaitingVerify stage.
  //   - `denied`/`failed` are treated as "user hasn't responded yet."
  //     The result is discarded (the badge stays neutral) and the FSM
  //     moves to `awaitingVerify` for the user to click Verify.
  //
  // The requestId guard means a *late* first-probe `denied` arriving
  // after the user has already moved on to Verify won't overwrite the
  // verified result.
  const startSystemAudioPrompt = async () => {
    const myRequestId = ++probeRequestIdRef.current;
    setSystemAudioProbe({ status: "prompting" });
    try {
      const res = await api.system.probeSystemAudioPermission();
      if (probeRequestIdRef.current !== myRequestId) return;
      if (res.status === "unsupported") {
        setSystemAudioProbe({ status: "unsupported" });
        return;
      }
      if (res.status === "granted") {
        setSystemAudioProbe({ status: "granted" });
        return;
      }
      // denied/failed during the first probe — discard and wait for
      // the user to click Verify.
      setSystemAudioProbe({ status: "awaitingVerify" });
    } catch {
      if (probeRequestIdRef.current !== myRequestId) return;
      setSystemAudioProbe({ status: "awaitingVerify" });
    }
  };

  // Second-stage verify — runs after the user reports they've clicked
  // Allow in the TCC dialog. Result is now treated as authoritative,
  // gated by the requestId guard so any in-flight first-stage Promise
  // can't clobber it.
  const verifySystemAudio = async () => {
    const myRequestId = ++probeRequestIdRef.current;
    setSystemAudioProbe({ status: "verifying" });
    try {
      const res = await api.system.probeSystemAudioPermission();
      if (probeRequestIdRef.current !== myRequestId) return;
      if (res.status === "granted") setSystemAudioProbe({ status: "granted" });
      else if (res.status === "denied") setSystemAudioProbe({ status: "denied" });
      else if (res.status === "unsupported") setSystemAudioProbe({ status: "unsupported" });
      else setSystemAudioProbe({ status: "failed", error: res.error ?? "unknown error" });
    } catch (err) {
      if (probeRequestIdRef.current !== myRequestId) return;
      setSystemAudioProbe({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Re-read the mic permission after the user fixed it in System Settings.
  // Without this, granting in the OS dialog leaves the wizard's cached
  // `micPermission` stale and `Next` stays disabled until the user
  // reloads. Surfaced as a "Re-check microphone permission" button in
  // the denied/restricted diagnostic block.
  const recheckMicPermission = async () => {
    setMicPermissionBusy(true);
    try {
      const { status } = await api.system.getMicrophonePermission();
      setMicPermission(status as typeof micPermission);
    } catch {
      // noop
    } finally {
      setMicPermissionBusy(false);
    }
  };

  useEffect(() => {
    if (dataPathTouched) return;
    if (usesObsidian && vaultPath) {
      setDataPath(joinPath(vaultPath, "Gistlist"));
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
    // Phase 5 invariant: starting a new install resets prior result
    // state so a stale "complete" / "failed" panel from a previous run
    // doesn't bleed into the next.
    setInstalling(target);
    setInstallLog([]);
    setInstallError(null);
    lastInstallTargetRef.current = target;
    try {
      const result = await api.deps.install(target);
      if (!result.ok) {
        // failedPhase tells the user *which* step blew up (download
        // / verify-checksum / extract / verify-signature / verify-exec).
        // Surfacing it makes a Retry button less frustrating — the user
        // knows whether to expect a quick fix or a network reset.
        const phase = result.failedPhase ? ` [${result.failedPhase}]` : "";
        setInstallError(`Install failed${phase}: ${result.error ?? "unknown error"}`);
      } else if (target === "ollama") {
        // Ollama just landed on disk. Bring the daemon up so subsequent
        // model pulls don't pay the cold-start cost. The IPC handler
        // returns `daemon: false` when ensureOllamaDaemon throws (e.g.
        // the binary spawned but :11434 never answered, or codesign
        // refused to launch it). Treat that as an install-completion
        // problem the user needs to see — silent swallowing here leaves
        // them staring at a green "installed" row with a red LLM
        // provider check and no idea why.
        const llmStatus = await api.llm.check().catch(() => null);
        if (!llmStatus || !llmStatus.daemon) {
          setInstallError(
            "Ollama installed but the daemon failed to start. See ~/.gistlist/ollama.log for details."
          );
        }
      }
      try {
        const fresh = await api.depsCheck();
        setDeps(fresh);
      } catch (err) {
        // depsCheck failure leaves the row in stale state — surface it
        // explicitly so the user doesn't think the install silently failed.
        setInstallError(
          `Install completed but post-install check failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    } catch (err) {
      // IPC throw / preload failure — the install never returned. Without
      // this catch the spinner clears with no error and the row keeps its
      // pre-install "Missing" state, looking like the install silently
      // succeeded but did nothing.
      setInstallError(err instanceof Error ? err.message : String(err));
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
    } catch (err) {
      setRestartAudioError(err instanceof Error ? err.message : String(err));
    } finally {
      setRestartingAudio(false);
    }
  };

  // Pull the local embedding model (nomic-embed-text via Ollama) on
  // explicit click — not as a surprise side effect of Finish. See the
  // `embed-model` row on the Dependencies step. Reuses the same
  // `installLog` plumbing as the other installs so the
  // DependencyInstallProgress panel surfaces progress + raw log.
  const installEmbedModel = async () => {
    setInstalling("embed-model" as DepsInstallTarget);
    setInstallLog([]);
    setInstallError(null);
    lastInstallTargetRef.current = "embed-model" as DepsInstallTarget;
    const unsub = api.on.setupLlmProgress((p) =>
      setEmbedProgress({ pct: p.pct })
    );
    try {
      await api.meetingIndex.installEmbedModel();
      const fresh = await api.meetingIndex.embedModelStatus().catch(() => null);
      setEmbedAlreadyInstalled(!!fresh?.installed);
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
    } finally {
      unsub();
      setEmbedProgress(null);
      setInstalling(null);
    }
  };

  const installLocalLlm = async () => {
    if (!localLlmModel) return;
    setInstalling("local-llm");
    setInstallLog([]);
    setInstallError(null);
    lastInstallTargetRef.current = "local-llm";
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
    lastInstallTargetRef.current = "parakeet";
    try {
      // setup-asr returns { ok, error, failedPhase } (mirrors deps:install)
      // so the install pane gets the same `[<phase>]: ...` UX without
      // string-parsing a thrown Error. The chain auto-installs ffmpeg +
      // ffprobe + Python before building the venv, so a one-click flow.
      const result = await api.setupAsr({ force: false });
      if (!result.ok) {
        const phase = result.failedPhase ? ` [${result.failedPhase}]` : "";
        setInstallError(`Install failed${phase}: ${result.error ?? "unknown error"}`);
      }
      try {
        const fresh = await api.depsCheck();
        setDeps(fresh);
      } catch (err) {
        setInstallError(
          (prev) =>
            prev ??
            `Install completed but post-install check failed: ${
              err instanceof Error ? err.message : String(err)
            }`
        );
      }
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
      // The embedding model used to be pulled silently here as a side
      // effect of Finish — surprising users with a 274 MB download
      // they hadn't explicitly approved. As of v0.1.9 the model is its
      // own dependency row on the Dependencies step (when semantic
      // search is enabled), with an explicit "Download embedding
      // model" button. Finish gates on it via `finishDisabled` below
      // when semantic search is on, so users can't reach this point
      // without having already done the install (or having toggled
      // semantic search off).
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
    if (!deps.ffmpeg.path) return true;
    // ffprobe is paired with ffmpeg — engine audio code requires both.
    if (!deps.ffprobe.path) return true;
    // Phase-1B Finish gate: an app-managed binary that failed arch /
    // spawn validation (verified === "system-unverified" while source is
    // app-installed or bundled) means the engine path is poisoned and
    // recording would EBADARCH on first use. Force the user to "Install
    // clean copy" before Finish enables. System-PATH binaries (Homebrew)
    // can finish — same rationale as Phase 2 not spawning them: we
    // intentionally don't validate them.
    const blockedByAppManaged = (tool: { source: string | null; verified: ResolvedTool["verified"] | undefined }) =>
      (tool.source === "app-installed" || tool.source === "bundled") &&
      tool.verified === "system-unverified";
    if (blockedByAppManaged(deps.ffmpeg)) return true;
    if (blockedByAppManaged(deps.ffprobe)) return true;
    // Python only matters when the user picked Parakeet — cloud ASR
    // doesn't touch the app-managed Python runtime, so a stale wrong-
    // arch python in <binDir>/python should NOT silently dead-end the
    // Finish button for an OpenAI-Whisper user. Gate to parakeet-mlx,
    // and pair this with the Parakeet repair CTA below so the
    // parakeet-mlx user has a visible recovery path.
    if (asrProvider === "parakeet-mlx" && blockedByAppManaged(deps.python)) {
      return true;
    }
    if (asrProvider === "parakeet-mlx" && !deps.parakeet.path) return true;
    // System-audio probe lives on the Permissions step now and is optional
    // (mic-only recording works); it does not gate Finish on the Deps step.
    if (llmProvider === "ollama") {
      if (!localLlmModel) return true;
      if (!hasInstalledLocalModel(installedLocalModels, localLlmModel)) return true;
    }
    // The embedding model used to be pulled silently on Finish — that
    // surprised users with a 274 MB download. v0.1.9 moved it to a
    // dedicated row with explicit click. Gate Finish so the user can't
    // ship without having explicitly downloaded the model they
    // opted into.
    if (enableSemanticSearch && !embedAlreadyInstalled) return true;
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
    enableSemanticSearch,
    embedAlreadyInstalled,
  ]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[radial-gradient(circle_at_top,rgba(45,107,63,0.08),transparent_32%),var(--bg-secondary)]">
      <div className="h-8 shrink-0 pl-20 [-webkit-app-region:drag]" />
      <div className="flex-1 overflow-y-auto px-6 pb-10 pt-5">
        <div className="mx-auto flex w-full max-w-[35rem] flex-col gap-4">
          <div className="flex items-center justify-between gap-2 text-sm font-medium text-[var(--text-secondary)]">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
              Gistlist setup
            </div>
            {onCancel && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onCancel}
                disabled={busy || installing !== null}
                data-testid="wizard-cancel"
              >
                Cancel
              </Button>
            )}
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

          {step === STEP.WELCOME && (
            <WizardStep
              title="Welcome to Gistlist"
              description="A local-first desktop app for meeting notes. Record in the app or import an existing recording, and your transcript, summary, and custom outputs land in editable markdown on disk. Obsidian is optional. Let's get you set up."
              footer={<Button onClick={() => setStep(STEP.STORAGE)}>Get started</Button>}
            >
              <p
                className="text-xs leading-5 text-[var(--text-tertiary)]"
                data-testid="wizard-legal-acknowledgment"
              >
                By using Gistlist you agree to the{" "}
                <a
                  className="underline underline-offset-2 hover:text-[var(--text-secondary)]"
                  href="https://gistlist.app/terms"
                  target="_blank"
                  rel="noreferrer"
                >
                  Terms of Service
                </a>{" "}
                and{" "}
                <a
                  className="underline underline-offset-2 hover:text-[var(--text-secondary)]"
                  href="https://gistlist.app/privacy"
                  target="_blank"
                  rel="noreferrer"
                >
                  Privacy Policy
                </a>
                .
              </p>
            </WizardStep>
          )}

          {step === STEP.STORAGE && (
            <WizardStep
              title="Do you use Obsidian?"
              description="Obsidian is an optional viewer. The app works perfectly without it — it has its own markdown editor and browser. If you already use Obsidian, we can store meetings inside your vault so they show up alongside your other notes."
              footer={
                <WizardActions
                  back={{ label: "Back", onClick: () => setStep(STEP.WELCOME) }}
                  primary={{
                    label: "Next",
                    onClick: () => setStep(STEP.RETENTION),
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

          {step === STEP.RETENTION && (
            <WizardStep
              title="Where should meetings be stored?"
              description={
                usesObsidian
                  ? "This folder lives inside your Obsidian vault — the default is a Gistlist subfolder. Every meeting becomes its own markdown file."
                  : "Pick any folder on your machine. Every meeting becomes a subfolder with plain markdown files. You can change this later."
              }
              footer={
                <WizardActions
                  back={{ label: "Back", onClick: () => setStep(STEP.STORAGE) }}
                  primary={{
                    label: "Next",
                    onClick: () => setStep(STEP.PROVIDERS),
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

          {step === STEP.PROVIDERS && (
            <WizardStep
              title="Transcription & Summarization"
              description="Pick your AI providers. Cloud models are faster and smarter; local models are private and free."
              footer={
                <WizardActions
                  back={{ label: "Back", onClick: () => setStep(STEP.RETENTION) }}
                  primary={{
                    label: "Next",
                    onClick: () => setStep(STEP.PERMISSIONS),
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
                      {/* Parakeet runs on MLX, which is Apple-Silicon-only.
                          Render the option only when hardware detection
                          has positively confirmed Apple Silicon — using
                          `=== true` (not `!== false`) so the option is
                          hidden during the brief unknown-hardware window
                          on first paint. Otherwise an Intel user could
                          see Parakeet flash in before the hint below
                          replaces it. */}
                      {hardware?.appleSilicon === true && (
                        <SelectItem value="parakeet-mlx">Parakeet (local)</SelectItem>
                      )}
                      <SelectItem value="openai">OpenAI (cloud)</SelectItem>
                      {/* whisper.cpp (local) intentionally hidden for first
                          beta — whisper.cpp Releases don't currently ship
                          a signed macOS binary, so the manifest has no
                          entry, so installTool("whisper-cli") would fail
                          and a user who picked it would silently end up
                          with no working ASR. Re-add when upstream ships
                          a signed binary or we host our own. See
                          packages/app/main/installers/manifest.ts. */}
                    </SelectContent>
                  </Select>
                  {hardware == null && (
                    <Hint>Checking hardware…</Hint>
                  )}
                  {hardware?.appleSilicon === false && (
                    <Hint>
                      Local Parakeet transcription requires Apple Silicon. On
                      Intel Macs use OpenAI cloud transcription instead.
                    </Hint>
                  )}
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
                    <ModelDropdown
                      value={localLlmModel}
                      onChange={setLocalLlmModel}
                      providerFilter="ollama"
                      // Filter out embedding-only tags (e.g. nomic-embed-text)
                      // so the LLM picker doesn't list them as chat models.
                      // The semantic-search opt-in below installs the
                      // embedding model separately.
                      installedLocalModels={installedLocalModels.filter(
                        (id) => !/embed/i.test(id)
                      )}
                      totalRamGb={hardware?.totalRamGb}
                      allowCustom
                      selectableWhenUninstalled
                      recommendedIds={recommendedLocalModelIds(hardware?.totalRamGb)}
                      triggerTestId="local-llm-select"
                    />
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

          {step === STEP.PERMISSIONS && (
            <WizardStep
              title="Permissions"
              description="Grant microphone access (required) and optionally test system audio. We won't show any OS dialogs without your click."
              footer={
                <WizardActions
                  back={{ label: "Back", onClick: () => setStep(STEP.PROVIDERS) }}
                  primary={{
                    label: "Next",
                    onClick: () => setStep(STEP.DEPS),
                    // Mic is required to record meetings — block Next until granted.
                    // System audio is optional and ignored here.
                    disabled: micPermission !== "granted",
                  }}
                />
              }
            >
              {/* While the system:capabilities IPC is in flight, render a
                  spinner instead of dropping into the panel with
                  systemAudioSupported=false (which would flash the
                  "Unsupported" badge before the real value lands). */}
              {systemAudioSupportedCap === null ? (
                <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <Spinner className="h-4 w-4" />
                  Loading capabilities…
                </div>
              ) : (
                <AudioPermissionsPanel
                  systemAudioSupported={systemAudioSupportedCap}
                  micPermission={micPermission}
                  micPermissionBusy={micPermissionBusy}
                  systemAudioProbe={systemAudioProbe}
                  appIdentity={appIdentity}
                  onRequestMic={requestMicrophonePermission}
                  onRecheckMic={recheckMicPermission}
                  onStartSystemAudioPrompt={startSystemAudioPrompt}
                  onVerifySystemAudio={verifySystemAudio}
                />
              )}
              {micPermission !== "granted" && (
                <p className="text-xs text-[var(--text-tertiary)]">
                  Grant microphone access to continue.
                </p>
              )}
            </WizardStep>
          )}

          {step === STEP.DEPS && (
            <WizardStep
              title="Dependencies"
              description="These are the tools Gistlist uses to record and transcribe audio. Missing items can be installed for you — no Terminal needed."
              footer={
                <WizardActions
                  back={{ label: "Back", onClick: () => setStep(STEP.PERMISSIONS), disabled: installing !== null }}
                  secondary={{
                    label: "Re-check",
                    onClick: async () => {
                      setRecheckBusy(true);
                      try {
                        const [fresh, brew] = await Promise.allSettled([
                          api.depsCheck(),
                          api.deps.checkBrew(),
                        ]);
                        if (fresh.status === "fulfilled") setDeps(fresh.value);
                        if (brew.status === "fulfilled")
                          setBrewAvailable(brew.value);
                      } finally {
                        setRecheckBusy(false);
                      }
                    },
                    disabled: installing !== null,
                    busy: recheckBusy,
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
              {(installing !== null || installError !== null || installLog.length > 0) && (
                <DependencyInstallProgress
                  installing={installing}
                  lastInstallTarget={lastInstallTargetRef.current}
                  installError={installError}
                  installLog={installLog}
                  onDismiss={() => {
                    setInstallError(null);
                    setInstallLog([]);
                    lastInstallTargetRef.current = null;
                  }}
                  onRetry={() => {
                    const target = lastInstallTargetRef.current;
                    if (!target) return;
                    if (target === "parakeet") void installParakeet();
                    else if (target === "local-llm") void installLocalLlm();
                    else void installDep(target);
                  }}
                  // Only Parakeet exposes a working cancel today (engine
                  // setup-asr respects the AbortController). Others
                  // ignore the cancel — better to omit the button than
                  // show a no-op.
                  onCancel={
                    installing === "parakeet"
                      ? () => api.cancelSetupAsr()
                      : undefined
                  }
                />
              )}
              {deps == null ? (
                <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <Spinner className="h-4 w-4" />
                  Checking dependencies…
                </div>
              ) : (
                <div className="space-y-3">
                  {installing !== "ffmpeg" && (
                  <DependencyRow
                    name="ffmpeg"
                    ok={!!deps.ffmpeg.path && !!deps.ffprobe.path}
                    value={
                      deps.ffmpeg.path && deps.ffprobe.path
                        ? `${deps.ffmpeg.path}${deps.ffmpeg.source ? ` (${deps.ffmpeg.source})` : ""}`
                        : deps.ffmpeg.path && !deps.ffprobe.path
                          ? "ffmpeg present · ffprobe missing"
                          : !deps.ffmpeg.path && deps.ffprobe.path
                            ? "ffprobe present · ffmpeg missing"
                            : undefined
                    }
                    installLabel="Install ffmpeg + ffprobe"
                    installing={installing === "ffmpeg"}
                    anyInstalling={installing !== null}
                    brewAvailable={true}
                    onInstall={() => installDep("ffmpeg")}
                    footerNote={
                      !deps.ffmpeg.path || !deps.ffprobe.path
                        ? "Downloads ~50 MB. Apple Silicon gets a native arm64 build (osxexperts.net, GPL); Intel gets the existing LGPL build (evermeet.cx)."
                        : undefined
                    }
                    // Combined ffmpeg+ffprobe row: take the weaker of the
                    // two `verified` states so a clean ffmpeg + system
                    // ffprobe still shows amber.
                    verified={
                      deps.ffmpeg.verified === "system-unverified" ||
                      deps.ffprobe.verified === "system-unverified"
                        ? "system-unverified"
                        : deps.ffmpeg.verified === "missing" ||
                            deps.ffprobe.verified === "missing"
                          ? "missing"
                          : "verified"
                    }
                    cleanCopyLabel="Install clean ffmpeg + ffprobe"
                  />
                  )}
                  {asrProvider === "parakeet-mlx" && installing !== "parakeet" && (() => {
                    // Treat the Parakeet row as broken if EITHER the
                    // venv binary is missing OR the underlying Python
                    // runtime failed validation. The venv itself was
                    // built against that Python, so a wrong-arch Python
                    // means the venv can't load — the row shouldn't
                    // claim "Ready" while the runtime is broken.
                    // Re-running installParakeet (= setup-asr chain)
                    // reinstalls Python and rebuilds the venv against
                    // it, so the existing button is the correct repair
                    // affordance.
                    const pythonBroken =
                      (deps.python.source === "app-installed" ||
                        deps.python.source === "bundled") &&
                      deps.python.verified === "system-unverified";
                    const parakeetOk = !!deps.parakeet.path && !pythonBroken;
                    return (
                      <DependencyRow
                        name="Parakeet"
                        ok={parakeetOk}
                        value={deps.parakeet.path ?? undefined}
                        installLabel={pythonBroken ? "Repair Parakeet runtime" : "Install Parakeet"}
                        installing={installing === "parakeet"}
                        anyInstalling={installing !== null}
                        brewAvailable={true}
                        onInstall={installParakeet}
                        onCancel={() => api.cancelSetupAsr()}
                        footerNote={
                          pythonBroken
                            ? "The app-managed Python runtime under <binDir>/python failed validation (likely wrong arch — common after upgrading from an Intel install or running in a UTM guest without Rosetta). Repair re-runs the full Parakeet install chain, which reinstalls Python and rebuilds the venv against it."
                            : !deps.parakeet.path
                              ? "Installs an app-managed Python runtime (Apple-Silicon-only), ffmpeg if missing, and the Parakeet model — about 1 GB total. First run can take a few minutes on a slow connection while the model weights download."
                              : undefined
                        }
                      />
                    );
                  })()}
                  {llmProvider === "ollama" && installing !== "ollama" && (
                    <DependencyRow
                      name="Ollama"
                      ok={deps.ollama.daemon}
                      value={
                        deps.ollama.daemon
                          ? `running${deps.ollama.source ? ` (${deps.ollama.source})` : ""}`
                          : undefined
                      }
                      installLabel="Install Ollama"
                      installing={installing === "ollama"}
                      anyInstalling={installing !== null}
                      brewAvailable={true}
                      onInstall={() => installDep("ollama")}
                      footerNote={
                        !deps.ollama.daemon
                          ? "Downloads ~130 MB. Lands at <userData>/bin/ollama-runtime/. Models live at ~/.ollama/models so a future system Ollama install picks them up."
                          : undefined
                      }
                      verified={deps.ollama.verified}
                      cleanCopyLabel="Install clean Ollama"
                    />
                  )}
                  {/* Embedding model row — only shown when the user
                      opted into semantic search (Claude Desktop / MCP
                      integration) on the Providers step. Pulls
                      nomic-embed-text via Ollama on click; previously
                      this was a surprise 274 MB download triggered by
                      Finish setup. */}
                  {enableSemanticSearch && installing !== ("embed-model" as DepsInstallTarget) && (
                    <DependencyRow
                      name="Embedding model (nomic-embed-text)"
                      ok={embedAlreadyInstalled}
                      value={embedAlreadyInstalled ? "ready" : undefined}
                      installLabel="Download embedding model"
                      installing={installing === ("embed-model" as DepsInstallTarget)}
                      anyInstalling={installing !== null}
                      brewAvailable={true}
                      onInstall={installEmbedModel}
                      footerNote={
                        !embedAlreadyInstalled
                          ? "Downloads ~274 MB to ~/.ollama/models. Powers semantic meeting search via the Claude Desktop MCP integration. Runs locally — your transcripts never leave your machine."
                          : undefined
                      }
                    />
                  )}
                  {llmProvider === "ollama" && localLlmModel && deps.ollama.daemon && (
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

              {/* Brew prompt removed — Phase 2 replaced Homebrew with direct
                  download. The wizard never asks the user to open Terminal. */}
              {/* The raw install log + standalone error live inside the
                  DependencyInstallProgress panel above (Phase 5 — they
                  share state but render under the new chrome). */}

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
  secondary?: { label: string; onClick: () => void; disabled?: boolean; busy?: boolean };
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
          <Button
            variant="secondary"
            onClick={secondary.onClick}
            disabled={secondary.disabled || secondary.busy}
          >
            {secondary.busy ? (
              <span className="flex items-center gap-2">
                <Spinner className="h-3.5 w-3.5" />
                Checking…
              </span>
            ) : (
              secondary.label
            )}
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
  /**
   * Optional cancel handler. When provided AND `installing` is true,
   * the row renders an enabled "Cancel" button next to the spinner so
   * the user can abort a long-running install (e.g. Parakeet's
   * model-weight download). Without this, the install button is just
   * a disabled "Installing…" spinner with no exit.
   */
  onCancel?: () => void;
  footerNote?: string;
  /**
   * Phase-1B `verified` discriminator from `ResolvedTool.verified`. Drives
   * the badge color and the "Install clean copy" CTA:
   *   - "verified" / undefined → green Ready
   *   - "system-bundled"       → green Ready (system Ollama with daemon up)
   *   - "system-unverified"    → amber "Found (unverified)" + "Install clean copy"
   *   - "missing"              → red "Missing" + the regular Install CTA
   */
  verified?: "verified" | "system-bundled" | "system-unverified" | "missing";
  /** Label for the "Install clean copy" CTA when verified === "system-unverified". */
  cleanCopyLabel?: string;
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
  onCancel,
  footerNote,
  verified,
  cleanCopyLabel,
}: DependencyRowProps) {
  const isUnverified = verified === "system-unverified";
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm font-medium text-[var(--text-primary)]">{name}</div>
            <DependencyStateBadge ok={ok} warning={isUnverified} />
            {value ? <span className="truncate font-mono text-xs text-[var(--text-secondary)]">{value}</span> : null}
            {!value ? <span className="text-xs text-[var(--text-secondary)]">{ok ? "installed" : "not installed"}</span> : null}
          </div>
          {footerNote && !ok ? <div className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">{footerNote}</div> : null}
          {isUnverified ? (
            <div className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
              Found a system-installed copy at this path. We can't safely verify it without spawning, so the wizard treats it as unverified. Install a clean app-managed copy to remove the ambiguity.
            </div>
          ) : null}
        </div>
        {!ok ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={onInstall} disabled={anyInstalling || brewAvailable === false}>
              {installing ? <><Spinner className="h-3.5 w-3.5" /> Installing…</> : installLabel}
            </Button>
            {installing && onCancel ? (
              <Button variant="ghost" size="sm" onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
          </div>
        ) : isUnverified ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={onInstall} disabled={anyInstalling}>
              {installing ? <><Spinner className="h-3.5 w-3.5" /> Installing…</> : (cleanCopyLabel ?? "Install clean copy")}
            </Button>
          </div>
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
  // Warning takes precedence over ok. A row that resolves to a path
  // (`ok=true`) but is `system-unverified` (`warning=true`) must NOT
  // render green Ready — that was the regression the previous patch
  // shipped. Amber wins, then green, then red.
  if (warning) {
    return (
      <Badge variant="warning" className="gap-1 normal-case tracking-normal">
        <AlertTriangle className="h-3 w-3" />
        Found (unverified)
      </Badge>
    );
  }
  if (ok) {
    return (
      <Badge variant="success" className="gap-1 normal-case tracking-normal">
        <CheckCircle2 className="h-3 w-3" />
        Ready
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

// ---- Audio permissions panel used in the Permissions wizard step ----
//
// The system-audio block is a two-stage Test → Verify FSM (see the
// `startSystemAudioPrompt` / `verifySystemAudio` helpers in SetupWizard
// for the state diagram). The first probe triggers the macOS TCC
// dialog; its result is intentionally discarded (the badge stays
// neutral) so the user doesn't see a red "Failed" badge while they're
// still deciding whether to click Allow. The second probe runs after
// the user clicks "Verify" and writes the authoritative state.

type SystemAudioProbeState =
  | { status: "unknown" }
  | { status: "prompting" }
  | { status: "awaitingVerify" }
  | { status: "verifying" }
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
  onRecheckMic,
  onStartSystemAudioPrompt,
  onVerifySystemAudio,
}: {
  systemAudioSupported: boolean;
  micPermission: "unknown" | "granted" | "denied" | "not-determined" | "restricted";
  micPermissionBusy: boolean;
  systemAudioProbe: SystemAudioProbeState;
  appIdentity: { displayName: string; tccBundleName: string; bundlePath: string | null; isDev: boolean; isPackaged: boolean } | null;
  onRequestMic: () => void;
  onRecheckMic: () => void;
  onStartSystemAudioPrompt: () => void;
  onVerifySystemAudio: () => void;
}) {
  const bundleLabel = appIdentity?.tccBundleName ?? "Gistlist";
  const isDev = appIdentity?.isDev ?? false;

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 space-y-4">
      <div className="space-y-1">
        <div className="text-sm font-medium text-[var(--text-primary)]">Audio permissions</div>
        <div className="text-xs text-[var(--text-secondary)]">
          Microphone access is required. System audio is optional — only needed if you record meetings with other speakers playing through your speakers.
        </div>
      </div>

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
          <Button
            size="sm"
            variant="ghost"
            onClick={() => api.system.openMicrophonePermissionPane().catch(() => {})}
          >
            Open Settings
          </Button>
        </div>
        {micPermission === "denied" || micPermission === "restricted" ? (
          <div className="rounded-md border border-[var(--warning)]/40 bg-[var(--warning-muted,rgba(245,158,11,0.08))] px-3 py-2 text-xs space-y-2">
            <div className="text-[var(--text-secondary)]">
              macOS will not let Gistlist enumerate or capture microphones until you grant the
              <strong> "Microphone"</strong> permission.{" "}
              {isDev ? (
                <>This is a development build, so grant the permission to <strong className="text-[var(--text-primary)]">"Electron"</strong> (not "Gistlist"). The packaged build correctly identifies as "Gistlist".</>
              ) : (
                <>Grant it to <strong className="text-[var(--text-primary)]">"{bundleLabel}"</strong>.</>
              )}
            </div>
            <ol className="ml-4 list-decimal space-y-0.5 text-[var(--text-secondary)]">
              <li>Open System Settings (button above).</li>
              <li>Go to <strong className="text-[var(--text-primary)]">Privacy &amp; Security → Microphone</strong>.</li>
              <li>
                If <strong className="text-[var(--text-primary)]">{isDev ? "Electron" : bundleLabel}</strong> is in
                the list, turn its switch on. Otherwise click <strong className="text-[var(--text-primary)]">+</strong>{" "}
                and drag it from the Finder window (use <em>Reveal in Finder</em> below).
              </li>
              <li>Come back to Gistlist — you may be asked to relaunch.</li>
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
                onClick={() => api.system.revealAppBundle().catch(() => {})}
              >
                Reveal {isDev ? "Electron" : bundleLabel} in Finder
              </Button>
              {/* Re-check after the user fixed permission in System Settings. Without
                  this, the wizard's cached `micPermission` stays "denied" until the
                  user reloads, and Next on the Permissions step stays disabled. */}
              <Button
                size="sm"
                variant="secondary"
                onClick={onRecheckMic}
                disabled={micPermissionBusy}
              >
                {micPermissionBusy ? "Checking…" : "Re-check microphone permission"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-xs text-[var(--text-secondary)]">
            Needed to record your voice. macOS will show a permission prompt the first time. If your physical mic doesn't appear in the Audio settings dropdown after granting, quit and relaunch Gistlist — macOS sometimes caches the empty device list.
          </div>
        )}
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
          ) : systemAudioProbe.status === "prompting" ? (
            <Badge variant="secondary" className="gap-1">
              <Spinner className="h-3 w-3" />
              Awaiting permission…
            </Badge>
          ) : systemAudioProbe.status === "awaitingVerify" ? (
            <Badge variant="secondary" className="gap-1">
              <Info className="h-3 w-3" />
              Waiting to verify
            </Badge>
          ) : systemAudioProbe.status === "verifying" ? (
            <Badge variant="secondary" className="gap-1">
              <Spinner className="h-3 w-3" />
              Verifying…
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
          {systemAudioSupported && systemAudioProbe.status === "prompting" ? null : null}
          {systemAudioSupported && systemAudioProbe.status === "verifying" ? null : null}
          {systemAudioSupported &&
            (systemAudioProbe.status === "unknown" ||
              systemAudioProbe.status === "granted") && (
              <Button
                size="sm"
                variant={systemAudioProbe.status === "unknown" ? "default" : "secondary"}
                onClick={onStartSystemAudioPrompt}
              >
                {systemAudioProbe.status === "granted" ? "Re-test" : "Test system audio"}
              </Button>
            )}
          {systemAudioSupported &&
            (systemAudioProbe.status === "awaitingVerify" ||
              systemAudioProbe.status === "denied" ||
              systemAudioProbe.status === "failed") && (
              <Button size="sm" variant="default" onClick={onVerifySystemAudio}>
                Verify
              </Button>
            )}
        </div>
        {systemAudioSupported && systemAudioProbe.status === "prompting" ? (
          <div className="text-xs text-[var(--text-secondary)]">
            macOS is asking for permission. Click <strong>Allow</strong> in the dialog above, then click <em>Verify</em>.
          </div>
        ) : null}
        {systemAudioSupported && systemAudioProbe.status === "awaitingVerify" ? (
          <div className="text-xs text-[var(--text-secondary)]">
            Click <em>Verify</em> once you've granted permission in the macOS dialog.
          </div>
        ) : null}
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
              <li>Come back here and click <em>Verify</em>.</li>
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
            Captures other participants in your meeting (browser, Zoom, Teams). Optional — mic-only recording works without it. Testing plays a brief tone and asks macOS for permission to capture system audio.
          </div>
        ) : null}
      </div>
    </div>
  );
}
