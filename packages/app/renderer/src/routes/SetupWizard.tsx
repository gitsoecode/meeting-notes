import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { api } from "../ipc-client";
import type {
  AppConfigDTO,
  DepsCheckResult,
  DepsInstallTarget,
  DetectedVault,
  HardwareInfoDTO,
  InitConfigRequest,
  InstallerProgressEvent,
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
import {
  DependencyChecklist,
  humanBytes,
} from "../components/wizard/DependencyChecklist";
import { useInstallChain } from "../components/wizard/useInstallChain";
import {
  deriveRequiredInstalls,
  totalRemainingBytes,
  // @ts-expect-error — adjacent .mjs file with JSDoc types only.
} from "../components/wizard/installChain.mjs";
import type {
  DepId,
  ProgressSnapshot,
  RequiredInstall,
} from "../components/wizard/installChain.types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Spinner } from "../components/ui/spinner";
import { Switch } from "../components/ui/switch";

const deriveRequiredInstallsFn = deriveRequiredInstalls as (input: {
  deps: DepsCheckResult;
  asrProvider: string;
  llmProvider: string;
  enableSemanticSearch: boolean;
  localLlmModel: string | null;
  localLlmInstalled: boolean;
  embedAlreadyInstalled: boolean;
  localLlmSizeGb?: number | null;
}) => RequiredInstall[];
const totalRemainingBytesFn = totalRemainingBytes as (
  plan: readonly RequiredInstall[],
) => number;

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

/**
 * Translate an `installer-progress` event into a short human label for
 * the chain row. Mirrors the InstallerPhase enum without coupling to it.
 */
function phaseLabel(ev: InstallerProgressEvent): string | undefined {
  switch (ev.phase) {
    case "download":
      return "Downloading";
    case "verify-checksum":
      return "Verifying checksum";
    case "extract":
      return "Extracting";
    case "verify-signature":
      return "Verifying signature";
    case "verify-exec":
      return "Verifying executable";
    case "complete":
      return "Finishing";
    case "failed":
      return "Failed";
    default:
      return undefined;
  }
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
  // Activity log — fed by `deps-install:log`, `setup-asr:log`, and
  // `setup-llm:log` IPC streams. Rendered inside a collapsed accordion
  // below the dependency checklist.
  const [installLog, setInstallLog] = useState<string[]>([]);
  const installLogRef = useRef<HTMLPreElement>(null);
  const [skipBlackhole, setSkipBlackhole] = useState(false);
  const [restartingAudio, setRestartingAudio] = useState(false);
  const [restartAudioError, setRestartAudioError] = useState<string | null>(null);

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

  // Refresh `deps` from main after any install completes so the
  // chain-derived plan re-derives `alreadyReady` for follow-on rows
  // (e.g. an Ollama install flips the embed-model row's prereq).
  const refreshDeps = useCallback(async () => {
    try {
      const fresh = await api.depsCheck();
      setDeps(fresh);
    } catch (err) {
      throw new Error(
        `Install completed but post-install check failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }, []);

  // Per-dep dispatchers used by the install-chain hook. Each resolves
  // on success or throws with a user-readable message on failure. The
  // chain owns row state (running/done/failed/cancelled); these
  // helpers no longer touch wizard UI state directly.
  const installDep = useCallback(
    async (target: DepsInstallTarget): Promise<void> => {
      const result = await api.deps.install(target);
      if (!result.ok) {
        // failedPhase tells the user *which* step blew up (download /
        // verify-checksum / extract / verify-signature / verify-exec).
        // Surfacing it makes a Retry less frustrating — the user knows
        // whether to expect a quick fix or a network reset.
        const phase = result.failedPhase ? ` [${result.failedPhase}]` : "";
        throw new Error(
          `Install failed${phase}: ${result.error ?? "unknown error"}`,
        );
      }
      if (target === "ollama") {
        // Ollama just landed on disk. Bring the daemon up so subsequent
        // model pulls don't pay the cold-start cost. The IPC handler
        // returns `daemon: false` when ensureOllamaDaemon throws (e.g.
        // the binary spawned but :11434 never answered, or codesign
        // refused to launch it). Treat that as an install-completion
        // problem the user needs to see — silent success here would
        // leave the embed-model row blocked with no obvious cause.
        const llmStatus = await api.llm.check().catch(() => null);
        if (!llmStatus || !llmStatus.daemon) {
          throw new Error(
            "Ollama installed but the daemon failed to start. See ~/.gistlist/ollama.log for details.",
          );
        }
      }
      await refreshDeps();
    },
    [refreshDeps],
  );

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

  // Pull the local embedding model (nomic-embed-text via Ollama) when
  // the chain reaches the embed-model row. The IPC handler accepts an
  // optional baseUrl; we rely on its default fallback
  // (`http://127.0.0.1:11434`) which lives in main where the bundled
  // daemon URL is canonically known. Re-runs from Settings still pull
  // from config. v0.1.9 specifically removed the silent-pull-on-Finish
  // path; the chain now performs the pull explicitly when the user
  // clicks Install all.
  //
  // Post-install readiness gate: we MUST confirm the status check says
  // installed before resolving. Otherwise the chain marks the row done,
  // Finish unlocks, and the user ships with a missing dep that we just
  // claimed succeeded. Throwing here keeps the row in `failed` state so
  // Retry surfaces — and Finish stays gated by `allDepsReady`.
  const installEmbedModel = useCallback(async (): Promise<void> => {
    await api.meetingIndex.installEmbedModel();
    const fresh = await api.meetingIndex.embedModelStatus();
    setEmbedAlreadyInstalled(!!fresh.installed);
    if (!fresh.installed) {
      throw new Error(
        "Embedding model install reported success but the post-install status check still says missing.",
      );
    }
  }, []);

  const installLocalLlm = useCallback(async (): Promise<void> => {
    if (!localLlmModel) {
      throw new Error("No local LLM model selected");
    }
    await api.llm.setup({ model: localLlmModel });
    const res = await api.llm.check();
    setInstalledLocalModels(res.installedModels);
    // Same readiness gate as embed-model: confirm the daemon now lists
    // the model we just pulled. Without this, a silent-failure setup
    // (daemon mid-restart, model name typo, partial download) would let
    // the chain mark the row done despite the model still being absent.
    if (!hasInstalledLocalModel(res.installedModels, localLlmModel)) {
      throw new Error(
        `Local LLM install reported success but the daemon does not list ${localLlmModel}.`,
      );
    }
  }, [localLlmModel]);

  const installParakeet = useCallback(async (): Promise<void> => {
    // setup-asr returns { ok, error, failedPhase } (mirrors deps:install).
    // The auto-chain installs ffmpeg + ffprobe + Python before building
    // the venv, so this single call is the user-visible "Install
    // Parakeet" action.
    const result = await api.setupAsr({ force: false });
    if (!result.ok) {
      const phase = result.failedPhase ? ` [${result.failedPhase}]` : "";
      throw new Error(
        `Install failed${phase}: ${result.error ?? "unknown error"}`,
      );
    }
    await refreshDeps();
  }, [refreshDeps]);

  // Compute the install plan from current wizard inputs. Re-derives
  // when any input changes — but the chain hook only resets state when
  // the plan signature changes AND the chain isn't running, so a
  // mid-install re-derive (e.g. a depsCheck refresh after one row
  // finishes) is a safe no-op.
  const requiredInstalls = useMemo<RequiredInstall[]>(() => {
    if (!deps) return [];
    return deriveRequiredInstallsFn({
      deps,
      asrProvider,
      llmProvider,
      enableSemanticSearch,
      localLlmModel: localLlmModel || null,
      localLlmInstalled: hasInstalledLocalModel(
        installedLocalModels,
        localLlmModel,
      ),
      embedAlreadyInstalled,
      localLlmSizeGb: findModelEntry(localLlmModel)?.sizeGb ?? null,
    });
  }, [
    deps,
    asrProvider,
    llmProvider,
    enableSemanticSearch,
    localLlmModel,
    installedLocalModels,
    embedAlreadyInstalled,
  ]);

  const dispatchers = useMemo(
    () => ({
      ffmpeg: () => installDep("ffmpeg"),
      parakeet: () => installParakeet(),
      ollama: () => installDep("ollama"),
      "embed-model": () => installEmbedModel(),
      "local-llm": () => installLocalLlm(),
    }),
    [installDep, installParakeet, installEmbedModel, installLocalLlm],
  );

  const installChain = useInstallChain({
    plan: requiredInstalls,
    dispatchers,
    // The hook only fires onCancel when isCancellable returns true, so
    // the activeId here is always parakeet. Calling cancelSetupAsr is
    // safe to dispatch unconditionally since the IPC owns the no-op
    // case (no active setup → no-op).
    onCancel: () => {
      void api.cancelSetupAsr();
    },
    // Today only Parakeet exposes a real abort signal (engine setup-asr
    // respects an AbortController). For other deps, Cancel is a
    // graceful "stop after this finishes" — the row stays Failed if it
    // genuinely fails after the cancel request, instead of being
    // misclassified as Cancelled.
    isCancellable: (id) => id === "parakeet",
  });

  // EMA-smoothed transfer-rate sample for the active install. Reset
  // when the active dep changes OR when the underlying tool changes
  // (Parakeet's auto-chain emits installer-progress for ffmpeg first
  // then python — different download streams, so the rate window
  // shouldn't span them). EMA alpha matches the deleted Variation B
  // panel's smoothing so users see comparable MB/s readouts.
  const progressSampleRef = useRef<{
    rowId: DepId | null;
    tool: string | null;
    lastSampleAt: number;
    lastBytesDone: number;
    bytesPerSec: number;
  }>({
    rowId: null,
    tool: null,
    lastSampleAt: 0,
    lastBytesDone: 0,
    bytesPerSec: 0,
  });
  const PROGRESS_EMA_ALPHA = 0.3;

  // Forward `installer-progress` events into the active chain row.
  // The event's `tool` field can be a sub-tool of Parakeet's auto-chain
  // (`ffmpeg`, `python`); when Parakeet is active, route everything
  // there so the user sees one unified progress for that row.
  useEffect(() => {
    return api.on.installerProgress((ev: InstallerProgressEvent) => {
      const id = installChain.currentId;
      if (id === null) return;
      // Decide which chain row this event belongs to. For Parakeet we
      // forward every sub-tool's bytes to the parakeet row; for direct
      // installs we only accept events whose tool matches the row. The
      // ffmpeg row represents the ffmpeg+ffprobe bundle, so accept
      // both tool names — `installFfmpegBundle` emits progress for
      // each in sequence (ffmpeg, then ffprobe) and the row should
      // track the active sub-tool, not stall at "ffmpeg done" while
      // ffprobe is still downloading.
      let targetId: DepId | null = null;
      if (id === "parakeet") {
        targetId = "parakeet";
      } else if (
        ((ev.tool === "ffmpeg" || ev.tool === "ffprobe") && id === "ffmpeg") ||
        (ev.tool === "ollama" && id === "ollama")
      ) {
        targetId = id;
      }
      if (targetId === null) return;

      // Compute speed (bytes/sec) and ETA from a per-tool EMA. Reset
      // the window when the row OR sub-tool changes so a Parakeet
      // ffmpeg→python boundary doesn't smear the rate readout.
      const sample = progressSampleRef.current;
      const now = Date.now();
      const bytesDone =
        typeof ev.bytesDone === "number" ? ev.bytesDone : 0;
      const bytesTotal =
        typeof ev.bytesTotal === "number" ? ev.bytesTotal : null;

      let bytesPerSec = sample.bytesPerSec;
      if (sample.rowId !== targetId || sample.tool !== ev.tool) {
        // New stream — reset.
        sample.rowId = targetId;
        sample.tool = ev.tool;
        sample.lastSampleAt = now;
        sample.lastBytesDone = bytesDone;
        sample.bytesPerSec = 0;
        bytesPerSec = 0;
      } else if (now > sample.lastSampleAt && bytesDone > sample.lastBytesDone) {
        const dtSec = (now - sample.lastSampleAt) / 1000;
        const instant = (bytesDone - sample.lastBytesDone) / dtSec;
        bytesPerSec =
          sample.bytesPerSec === 0
            ? instant
            : PROGRESS_EMA_ALPHA * instant +
              (1 - PROGRESS_EMA_ALPHA) * sample.bytesPerSec;
        sample.lastSampleAt = now;
        sample.lastBytesDone = bytesDone;
        sample.bytesPerSec = bytesPerSec;
      }

      const etaSeconds =
        bytesTotal && bytesPerSec > 0
          ? Math.max(0, (bytesTotal - bytesDone) / bytesPerSec)
          : undefined;

      const snapshot: ProgressSnapshot = {
        phase: phaseLabel(ev),
        bytes:
          typeof ev.bytesDone === "number" && bytesTotal !== null
            ? { done: ev.bytesDone, total: bytesTotal }
            : undefined,
        speed: bytesPerSec > 0 ? bytesPerSec : undefined,
        eta: etaSeconds,
      };
      installChain.setProgress(targetId, snapshot);
    });
  }, [installChain]);

  // Forward `setup-llm:progress` events (pct only) into the embed-model
  // and local-llm rows. Both pulls report through this channel.
  useEffect(() => {
    return api.on.setupLlmProgress((p) => {
      const id = installChain.currentId;
      if (id === "embed-model" || id === "local-llm") {
        installChain.setProgress(id, { percent: p.pct });
      }
    });
  }, [installChain]);

  const allDepsReady = useMemo(() => {
    if (requiredInstalls.length === 0) return false;
    return requiredInstalls.every((item) => {
      const row = installChain.rows[item.id];
      return row && (row.kind === "ready" || row.kind === "done");
    });
  }, [requiredInstalls, installChain.rows]);

  const remainingBytes = useMemo(
    () => totalRemainingBytesFn(requiredInstalls),
    [requiredInstalls],
  );

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

  // Finish enables only when every required dep is `ready` or `done`.
  // The chain owns the per-dep status; a system-unverified app-managed
  // binary surfaces as `pending` (deriveRequiredInstalls treats it as
  // not-ready), so the chain's Install all flow repairs it before
  // Finish unlocks. No separate gate needed here.
  const finishDisabled =
    busy || restartingAudio || !deps || !allDepsReady;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[radial-gradient(circle_at_top,rgba(45,107,63,0.08),transparent_32%),var(--bg-secondary)]">
      <div className="h-8 shrink-0 pl-20 [-webkit-app-region:drag]" />
      <div className="flex-1 overflow-y-auto px-6 pb-16 pt-5">
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
                disabled={busy || installChain.chainState === "running"}
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
              title="Setting up Gistlist"
              description="Installing the tools needed to record and transcribe."
              footer={
                <DepsStepFooter
                  busy={busy}
                  finishDisabled={finishDisabled}
                  installChainState={installChain.chainState}
                  remainingBytes={remainingBytes}
                  onBack={() => setStep(STEP.PERMISSIONS)}
                  onInstallAll={installChain.start}
                  onRetry={installChain.retry}
                  onCancel={installChain.cancel}
                  onResume={installChain.retry}
                  onFinish={onFinish}
                />
              }
            >
              {deps == null ? (
                <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <Spinner className="h-4 w-4" />
                  Checking dependencies…
                </div>
              ) : (
                <DependencyChecklist
                  plan={requiredInstalls}
                  rows={installChain.rows}
                  currentId={installChain.currentId}
                  onRetry={installChain.retry}
                />
              )}

              {installLog.length > 0 ? (
                <details
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3"
                  data-testid="install-activity-log"
                >
                  <summary className="cursor-pointer text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                    Activity log
                  </summary>
                  <pre
                    ref={installLogRef}
                    className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] leading-5 text-[var(--text-secondary)]"
                  >
                    {installLog.join("\n")}
                  </pre>
                </details>
              ) : null}

              {error ? (
                <div className="text-sm text-[var(--error)]">{error}</div>
              ) : null}
            </WizardStep>
          )}
        </div>
      </div>
    </div>
  );
}

interface DepsStepFooterProps {
  busy: boolean;
  finishDisabled: boolean;
  installChainState:
    | "idle"
    | "running"
    | "paused"
    | "cancelled"
    | "done";
  remainingBytes: number;
  onBack: () => void;
  onInstallAll: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onResume: () => void;
  onFinish: () => void;
}

/**
 * Footer for the Dependencies step. Drives the per-state action set:
 *   - idle       → [Back] [Install all (~X)]   (or [Finish setup] when nothing pending)
 *   - running    → [Cancel]                    (Back disabled)
 *   - paused     → [Back] [Retry]              (failed row blocks chain)
 *   - cancelled  → [Back] [Resume install]
 *   - done       → [Back] [Finish setup]
 */
function DepsStepFooter({
  busy,
  finishDisabled,
  installChainState,
  remainingBytes,
  onBack,
  onInstallAll,
  onRetry,
  onCancel,
  onResume,
  onFinish,
}: DepsStepFooterProps) {
  const backDisabled = installChainState === "running" || busy;

  if (installChainState === "running") {
    return (
      <WizardActions
        back={{ label: "Back", onClick: onBack, disabled: true }}
        primary={{
          label: "Cancel",
          onClick: onCancel,
          // The reducer accepts only one cancel; subsequent clicks are
          // no-ops. We don't need to disable the button — the action is
          // idempotent — but a cleaner UI: leave it enabled.
        }}
      />
    );
  }

  if (installChainState === "paused") {
    return (
      <WizardActions
        back={{ label: "Back", onClick: onBack, disabled: backDisabled }}
        primary={{ label: "Retry", onClick: onRetry }}
      />
    );
  }

  if (installChainState === "cancelled") {
    return (
      <WizardActions
        back={{ label: "Back", onClick: onBack, disabled: backDisabled }}
        primary={{
          label: remainingBytes > 0
            ? `Resume install (~${humanBytes(remainingBytes)})`
            : "Resume install",
          onClick: onResume,
        }}
      />
    );
  }

  // idle or done — show Install all if there's anything pending,
  // otherwise the chain is effectively done and Finish takes over.
  if (remainingBytes > 0 && installChainState !== "done") {
    return (
      <WizardActions
        back={{ label: "Back", onClick: onBack, disabled: backDisabled }}
        primary={{
          label: `Install all (~${humanBytes(remainingBytes)})`,
          onClick: onInstallAll,
        }}
      />
    );
  }

  return (
    <WizardActions
      back={{ label: "Back", onClick: onBack, disabled: backDisabled }}
      primary={{
        label: busy ? "Finishing…" : "Finish setup",
        onClick: onFinish,
        disabled: finishDisabled,
      }}
    />
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
  // The footer renders as a sticky bottom bar inside the Card. `sticky
  // bottom-0` pins it to the bottom of the wizard's scroll container
  // (the `overflow-y-auto` ancestor) so a tall step (Dependencies on a
  // fresh install with the activity log expanded) keeps Back/Continue
  // visible without manual scrolling. The negative margins extend the
  // bar flush with the Card edges; the rounded-b matches the Card.
  return (
    <Card className="rounded-2xl border-[var(--border-default)] bg-white shadow-[0_18px_44px_rgba(31,45,28,0.10)]">
      <CardContent className="space-y-6 p-7">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">{title}</h2>
          <p className="text-sm leading-6 text-[var(--text-secondary)]">{description}</p>
        </div>
        {children ? <div className="space-y-5">{children}</div> : null}
        {footer ? (
          <div className="sticky bottom-0 -mx-7 -mb-7 rounded-b-2xl border-t border-[var(--border-subtle)] bg-white/95 px-7 py-5 backdrop-blur supports-[backdrop-filter]:bg-white/85">
            {footer}
          </div>
        ) : null}
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
