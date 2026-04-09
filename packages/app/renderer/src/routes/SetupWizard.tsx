import { useEffect, useMemo, useState } from "react";
import { api } from "../ipc-client";
import type {
  AppConfigDTO,
  DepsCheckResult,
  DepsInstallTarget,
  DetectedVault,
  HardwareInfoDTO,
  InitConfigRequest,
} from "../../../shared/ipc";
import { LLM_MODELS, recommendLocalModel, findModelEntry } from "../constants";

interface SetupWizardProps {
  onComplete: () => void;
}

// Five visible steps: Welcome → Obsidian → Data dir → Transcription/keys → Deps.
// The old "Audio devices" step is gone; the main process auto-fills mic and
// system devices from the AVFoundation device list on finish.
const TOTAL_STEPS = 5;

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(0);

  // ---- Step 1: Obsidian ----
  const [usesObsidian, setUsesObsidian] = useState<boolean>(false);
  const [vaultPath, setVaultPath] = useState<string>("");
  const [detectedVaults, setDetectedVaults] = useState<DetectedVault[]>([]);

  // ---- Step 2: Data directory ----
  // dataPathTouched gates the auto-default logic: once the user edits, we
  // stop overwriting their value when they toggle Obsidian on/off.
  const [dataPath, setDataPath] = useState<string>("");
  const [dataPathTouched, setDataPathTouched] = useState(false);

  // ---- Step 3: Transcription + API keys ----
  const [asrProvider, setAsrProvider] =
    useState<AppConfigDTO["asr_provider"]>("parakeet-mlx");
  const [claudeKey, setClaudeKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  // Existing-key detection is *deferred* — the Keychain check runs the first
  // time the user reaches step 3, not on wizard mount. This keeps the macOS
  // password prompt from firing at the welcome screen with no explanation.
  const [hasClaude, setHasClaude] = useState<boolean>(false);
  const [hasOpenai, setHasOpenai] = useState<boolean>(false);
  const [keysChecked, setKeysChecked] = useState(false);
  // ---- Local LLM (Ollama) opt-in ----
  // useLocalLlm flips the wizard from "cloud-by-default" mode to "local-by-
  // default" mode. The Anthropic key field becomes optional, a model picker
  // appears under it, and step 4 picks up an extra DepRow that pulls the
  // selected model into ~/.ollama/models. Hardware detection runs once on
  // entry to step 3 so we can recommend a model that fits the user's RAM.
  const [useLocalLlm, setUseLocalLlm] = useState<boolean>(false);
  const [localLlmModel, setLocalLlmModel] = useState<string>("");
  const [hardware, setHardware] = useState<HardwareInfoDTO | null>(null);
  const [installedLocalModels, setInstalledLocalModels] = useState<string[]>([]);

  // ---- Step 4: Dependencies ----
  const [deps, setDeps] = useState<DepsCheckResult | null>(null);
  const [brewAvailable, setBrewAvailable] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState<DepsInstallTarget | "parakeet" | "local-llm" | null>(null);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installError, setInstallError] = useState<string | null>(null);
  const [skipBlackhole, setSkipBlackhole] = useState(false);
  const [restartingAudio, setRestartingAudio] = useState(false);
  const [restartAudioError, setRestartAudioError] = useState<string | null>(null);

  // ---- General ----
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Detect Obsidian vaults once on mount — cheap, no Keychain or network.
  useEffect(() => {
    api.obsidian.detectVaults().then(setDetectedVaults).catch(() => {});
  }, []);

  // Subscribe to dep-install log lines (brew), Parakeet setup-asr lines, and
  // local-LLM pull lines on the same state buffer so the UI can just show
  // "whatever is currently installing" without caring which pipe it came
  // from.
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

  // Defer the Keychain check until the user actually reaches step 3.
  // hasSecret() calls getPassword() under the hood, which triggers the
  // macOS login-password prompt the first time — we want that to happen
  // only *after* the "Keys are stored in the macOS Keychain…" disclosure
  // is visible on screen.
  useEffect(() => {
    if (step === 3 && !keysChecked) {
      setKeysChecked(true);
      api.secrets.has("claude").then(setHasClaude).catch(() => {});
      api.secrets.has("openai").then(setHasOpenai).catch(() => {});
      // Hardware detection — used to recommend a local LLM that fits the
      // user's machine. Cheap (synchronous os.* calls in the main process).
      api.system.detectHardware().then(setHardware).catch(() => {});
      // Probe Ollama once. If a system daemon is already running this also
      // returns the user's already-pulled models so we can avoid duplicate
      // downloads later.
      api.llm
        .check()
        .then((res) => setInstalledLocalModels(res.installedModels))
        .catch(() => setInstalledLocalModels([]));
    }
  }, [step, keysChecked]);

  // When the user toggles "use local model" or hardware comes back, pick
  // a default model. Prefer something they already have pulled (zero
  // download), otherwise the RAM-aware recommendation.
  useEffect(() => {
    if (!useLocalLlm) return;
    if (localLlmModel) return;
    if (installedLocalModels.length > 0) {
      setLocalLlmModel(installedLocalModels[0]);
    } else {
      setLocalLlmModel(recommendLocalModel(hardware?.totalRamGb));
    }
  }, [useLocalLlm, hardware, installedLocalModels, localLlmModel]);

  // Refresh deps + brew availability every time we enter the deps step.
  useEffect(() => {
    if (step === 4) {
      api.depsCheck().then(setDeps).catch(() => {});
      api.deps.checkBrew().then(setBrewAvailable).catch(() => setBrewAvailable(false));
    }
  }, [step]);

  // Auto-default the data-directory field based on the Obsidian answer.
  // Runs whenever usesObsidian or vaultPath changes, as long as the user
  // hasn't manually edited the field yet.
  useEffect(() => {
    if (dataPathTouched) return;
    if (usesObsidian && vaultPath) {
      setDataPath(joinPath(vaultPath, "Meeting-notes"));
    } else if (!usesObsidian) {
      setDataPath("~/Documents/Meeting Notes");
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
      // Re-check regardless — a partial failure might still have landed the
      // binary, and even a clean failure should refresh the UI.
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
        // Give coreaudiod ~1.5s to relaunch and re-enumerate HAL plugins
        // before we re-query AVFoundation. Without the wait the device
        // list often comes back stale.
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
      // Refresh installed list so the row flips to ✓.
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
        llm_provider: useLocalLlm ? "ollama" : "claude",
        ollama_model: useLocalLlm ? localLlmModel : undefined,
        // Audio devices auto-filled in the main process from
        // listAudioDevices(). Leave blank and let config:init pick defaults.
        recording: { mic_device: "", system_device: "" },
        claude_api_key: claudeKey || undefined,
        openai_api_key: openaiKey || undefined,
      };
      await api.config.initProject(req);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Finish gate: ffmpeg is hard-required; Parakeet is required only when the
  // user picked parakeet-mlx; BlackHole is soft-required (user can skip).
  const finishDisabled = useMemo(() => {
    if (busy || installing || restartingAudio) return true;
    if (!deps) return true;
    if (!deps.ffmpeg) return true;
    if (asrProvider === "parakeet-mlx" && !deps.parakeet) return true;
    if (deps.blackhole !== "loaded" && !skipBlackhole) return true;
    if (useLocalLlm) {
      if (!localLlmModel) return true;
      if (!installedLocalModels.includes(localLlmModel)) return true;
    }
    return false;
  }, [
    busy,
    installing,
    restartingAudio,
    deps,
    asrProvider,
    skipBlackhole,
    useLocalLlm,
    localLlmModel,
    installedLocalModels,
  ]);

  return (
    <div className="wizard-shell">
      <div className="wizard-titlebar" />
      <div className="wizard-body">
        <div className="wizard-brand">Meeting Notes setup</div>
        <div className="wizard">
          <div className="wizard-progress">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div
                key={i}
                className={`wizard-progress-dot ${
                  i < step ? "done" : i === step ? "active" : ""
                }`}
              />
            ))}
          </div>

          {step === 0 && (
            <div className="wizard-step">
              <h2>Welcome to Meeting Notes</h2>
              <p className="muted">
                A local-first meeting workspace. Press Start before a call, take
                notes while you talk, press Stop — and a transcript + summary +
                any custom outputs land in plain markdown on your disk. Let's
                get you set up.
              </p>
              <div className="actions">
                <button className="primary" onClick={() => setStep(1)}>
                  Get started
                </button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="wizard-step">
              <h2>Do you use Obsidian?</h2>
              <p className="muted">
                Obsidian is an optional viewer. The app works perfectly without
                it — it has its own markdown editor and browser. If you already
                use Obsidian, we can store meetings inside your vault so they
                show up alongside your other notes.
              </p>
              <div className="checkbox-row">
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={usesObsidian}
                    onChange={(e) => {
                      setUsesObsidian(e.target.checked);
                      // Switching answers resets the "I touched the data
                      // path" flag so the smart default re-applies. Users
                      // who already picked a custom path keep it.
                      if (!e.target.checked) {
                        setVaultPath("");
                      }
                    }}
                  />
                  <span className="slider" />
                </label>
                <span>Yes, I use Obsidian</span>
              </div>
              {usesObsidian && (
                <>
                  <label style={{ marginTop: 16 }}>Vault path</label>
                  <div className="row">
                    <input
                      value={vaultPath}
                      onChange={(e) => setVaultPath(e.target.value)}
                      placeholder="/Users/you/Obsidian/MyVault"
                    />
                    <button onClick={pickVault}>Pick…</button>
                  </div>
                  {detectedVaults.length > 0 && (
                    <>
                      <div className="muted" style={{ marginTop: 10 }}>
                        Detected vaults:
                      </div>
                      <div className="chip-row">
                        {detectedVaults.map((v) => (
                          <button
                            key={v.path}
                            className="chip"
                            onClick={() => setVaultPath(v.path)}
                            title={v.path}
                          >
                            {v.name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
              <div className="actions">
                <button onClick={() => setStep(0)}>Back</button>
                <button
                  className="primary"
                  onClick={() => setStep(2)}
                  disabled={usesObsidian && !vaultPath}
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="wizard-step">
              <h2>Where should meetings be stored?</h2>
              <p className="muted">
                {usesObsidian
                  ? "This folder lives inside your Obsidian vault — the default is a Meeting-notes subfolder. Every meeting becomes its own markdown file."
                  : "Pick any folder on your machine. Every meeting becomes a subfolder with plain markdown files. You can change this later."}
              </p>
              <label>Data directory</label>
              <div className="row">
                <input
                  value={dataPath}
                  onChange={(e) => {
                    setDataPath(e.target.value);
                    setDataPathTouched(true);
                  }}
                  placeholder="/Users/you/Documents/Meeting Notes"
                />
                <button onClick={pickDataDir}>Pick…</button>
              </div>
              <div className="actions">
                <button onClick={() => setStep(1)}>Back</button>
                <button
                  className="primary"
                  onClick={() => setStep(3)}
                  disabled={!dataPath}
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="wizard-step">
              <h2>Transcription &amp; API keys</h2>
              <p className="muted">
                Keys are stored in the macOS Keychain — more secure than config
                files. macOS may ask for your login password the first time we
                check for an existing key.
              </p>

              <label>Transcription provider</label>
              <select
                value={asrProvider}
                onChange={(e) =>
                  setAsrProvider(e.target.value as AppConfigDTO["asr_provider"])
                }
              >
                <option value="parakeet-mlx">
                  Parakeet (local, recommended on Apple Silicon)
                </option>
                <option value="openai">OpenAI (cloud)</option>
                <option value="whisper-local">whisper.cpp (local)</option>
              </select>

              {/* Local-LLM opt-in. When ON, the Anthropic key field
                  becomes optional and a model picker appears below. */}
              <div className="checkbox-row" style={{ marginTop: 16 }}>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={useLocalLlm}
                    onChange={(e) => setUseLocalLlm(e.target.checked)}
                  />
                  <span className="slider" />
                </label>
                <div>
                  <strong>Use a local model for summarization</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    No API key, fully offline. Slower than cloud (30 s – 2 min
                    per prompt on Apple Silicon). You can switch later in
                    Settings.
                  </div>
                </div>
              </div>

              {useLocalLlm && (
                <div style={{ marginTop: 12 }}>
                  {installedLocalModels.length > 0 && (
                    <>
                      <label>Already on this machine</label>
                      <select
                        value={
                          installedLocalModels.includes(localLlmModel)
                            ? localLlmModel
                            : ""
                        }
                        onChange={(e) => setLocalLlmModel(e.target.value)}
                      >
                        <option value="">— pick from below instead —</option>
                        {installedLocalModels.map((m) => (
                          <option key={m} value={m}>
                            ✓ {m}
                          </option>
                        ))}
                      </select>
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        Picking one of these means zero download — we reuse
                        models you've already pulled with Ollama.
                      </div>
                    </>
                  )}
                  <label style={{ marginTop: 12 }}>
                    Recommended for your machine
                    {hardware?.totalRamGb && (
                      <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>
                        ({hardware.totalRamGb} GB RAM
                        {hardware.chip ? `, ${hardware.chip}` : ""})
                      </span>
                    )}
                  </label>
                  <select
                    value={localLlmModel}
                    onChange={(e) => setLocalLlmModel(e.target.value)}
                  >
                    {LLM_MODELS.filter((m) => m.provider === "ollama").map((m) => {
                      const tooBig =
                        typeof hardware?.totalRamGb === "number" &&
                        typeof m.minRamGb === "number" &&
                        m.minRamGb > hardware.totalRamGb;
                      const installed = installedLocalModels.includes(m.id);
                      const sizeLabel = m.sizeGb ? ` · ${m.sizeGb} GB` : "";
                      return (
                        <option key={m.id} value={m.id} disabled={tooBig}>
                          {installed ? "✓ " : ""}
                          {m.label}
                          {sizeLabel}
                          {tooBig ? ` · needs ${m.minRamGb} GB RAM` : ""}
                        </option>
                      );
                    })}
                  </select>
                  {localLlmModel && (
                    <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                      {findModelEntry(localLlmModel)?.blurb}
                    </div>
                  )}
                </div>
              )}

              <label style={{ marginTop: 14 }}>
                Anthropic API key (for Claude)
                {useLocalLlm && (
                  <span className="muted" style={{ marginLeft: 8, fontWeight: 400 }}>
                    — optional in local mode
                  </span>
                )}
                {hasClaude && (
                  <span
                    style={{ color: "var(--success)", marginLeft: 8, fontWeight: 400 }}
                  >
                    ✓ already stored in Keychain
                  </span>
                )}
              </label>
              <input
                type="password"
                value={claudeKey}
                onChange={(e) => setClaudeKey(e.target.value)}
                placeholder={
                  hasClaude
                    ? "leave blank to keep existing key"
                    : useLocalLlm
                      ? "optional — only needed for Claude prompts"
                      : "sk-ant-…"
                }
              />

              {asrProvider === "openai" && (
                <>
                  <label style={{ marginTop: 14 }}>
                    OpenAI API key (for transcription)
                    {hasOpenai && (
                      <span
                        style={{ color: "var(--success)", marginLeft: 8, fontWeight: 400 }}
                      >
                        ✓ already stored in Keychain
                      </span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder={
                      hasOpenai ? "leave blank to keep existing key" : "sk-…"
                    }
                  />
                  <div
                    className="muted"
                    style={{ marginTop: 6, color: "var(--warning)", fontSize: 12 }}
                    title="OpenAI's transcription endpoint enforces a 25 MB per-file upload limit. We transcode to 32 kbps mono Opus to stretch that from ~13 min (PCM) to ~80 min per channel, but beyond that the request will fail. Automatic chunking would lift this ceiling and is on the roadmap."
                  >
                    ⚠ OpenAI caps uploads at 25 MB per file. Meetings longer
                    than ~80 min per audio channel will fail — use Parakeet
                    (local) for long recordings. Automatic chunking is on the
                    roadmap.
                  </div>
                </>
              )}

              <div className="actions">
                <button onClick={() => setStep(2)}>Back</button>
                <button
                  className="primary"
                  onClick={() => setStep(4)}
                  disabled={
                    (!useLocalLlm && !(claudeKey || hasClaude)) ||
                    (asrProvider === "openai" && !(openaiKey || hasOpenai)) ||
                    (useLocalLlm && !localLlmModel)
                  }
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="wizard-step">
              <h2>Dependencies</h2>
              <p className="muted">
                These are the tools Meeting Notes uses to record and transcribe
                audio. Missing items can be installed for you with Homebrew.
              </p>

              {deps == null ? (
                <div className="muted">Checking…</div>
              ) : (
                <div>
                  <DepRow
                    name="ffmpeg"
                    ok={!!deps.ffmpeg}
                    value={deps.ffmpeg ?? undefined}
                    installLabel="Install via Homebrew"
                    installing={installing === "ffmpeg"}
                    anyInstalling={installing !== null}
                    brewAvailable={brewAvailable}
                    onInstall={() => installDep("ffmpeg")}
                  />
                  <BlackHoleRow
                    status={deps.blackhole}
                    installing={installing === "blackhole"}
                    anyBusy={installing !== null || restartingAudio}
                    brewAvailable={brewAvailable}
                    restarting={restartingAudio}
                    onInstall={() => installDep("blackhole")}
                    onRestartAudio={restartAudio}
                    restartError={restartAudioError}
                  />
                  {asrProvider === "parakeet-mlx" && (
                    <DepRow
                      name="Parakeet"
                      ok={!!deps.parakeet}
                      value={deps.parakeet ?? undefined}
                      installLabel="Install Parakeet"
                      installing={installing === "parakeet"}
                      anyInstalling={installing !== null}
                      brewAvailable={true /* uses python, not brew */}
                      onInstall={installParakeet}
                      footerNote={
                        !deps.parakeet
                          ? "Creates a Python venv at ~/.meeting-notes/parakeet-venv and downloads model weights (~600 MB). Takes about a minute."
                          : undefined
                      }
                    />
                  )}
                  {useLocalLlm && localLlmModel && (
                    <DepRow
                      name={`Model: ${localLlmModel}`}
                      ok={installedLocalModels.includes(localLlmModel)}
                      value={
                        installedLocalModels.includes(localLlmModel)
                          ? "ready"
                          : undefined
                      }
                      installLabel={`Download ${localLlmModel}`}
                      installing={installing === "local-llm"}
                      anyInstalling={installing !== null}
                      brewAvailable={true /* Ollama is bundled, no brew needed */}
                      onInstall={installLocalLlm}
                      footerNote={
                        !installedLocalModels.includes(localLlmModel)
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
                <div
                  className="card"
                  style={{ marginTop: 12, borderColor: "var(--warning)" }}
                >
                  <div style={{ fontWeight: 500, marginBottom: 6 }}>
                    Homebrew is not installed
                  </div>
                  <div className="muted" style={{ marginBottom: 8 }}>
                    Homebrew is the macOS package manager we use to install
                    ffmpeg and BlackHole. Open Terminal and run:
                  </div>
                  <pre
                    className="log-view"
                    style={{ maxHeight: 60, marginBottom: 8, userSelect: "text" }}
                  >
                    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
                  </pre>
                  <button
                    onClick={() => {
                      api.deps.checkBrew().then(setBrewAvailable);
                    }}
                  >
                    Re-check
                  </button>
                </div>
              )}

              {installLog.length > 0 && (
                <pre
                  className="log-view"
                  style={{ marginTop: 12, maxHeight: 200 }}
                >
                  {installLog.join("\n")}
                </pre>
              )}
              {installError && (
                <div
                  className="muted"
                  style={{ color: "var(--danger)", marginTop: 8 }}
                >
                  {installError}
                </div>
              )}

              {deps && deps.blackhole !== "loaded" && (
                <div
                  className="checkbox-row"
                  style={{ marginTop: 14, fontSize: 13 }}
                >
                  <input
                    type="checkbox"
                    checked={skipBlackhole}
                    onChange={(e) => setSkipBlackhole(e.target.checked)}
                  />
                  <span className="muted">
                    Skip — I don't need to capture the other side of calls
                    (mic-only recording)
                  </span>
                </div>
              )}

              {error && (
                <div
                  className="muted"
                  style={{ color: "var(--danger)", marginTop: 8 }}
                >
                  {error}
                </div>
              )}

              <div className="actions">
                <button
                  onClick={() => setStep(3)}
                  disabled={installing !== null}
                >
                  Back
                </button>
                <button
                  onClick={() => {
                    api.depsCheck().then(setDeps).catch(() => {});
                    api.deps.checkBrew().then(setBrewAvailable).catch(() => {});
                  }}
                  disabled={installing !== null}
                >
                  Re-check
                </button>
                <button
                  className="primary"
                  onClick={onFinish}
                  disabled={finishDisabled}
                >
                  {busy ? "Finishing…" : "Finish setup"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface DepRowProps {
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

function DepRow({
  name,
  ok,
  value,
  installLabel,
  installing,
  anyInstalling,
  brewAvailable,
  onInstall,
  footerNote,
}: DepRowProps) {
  return (
    <div style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
      <div className="row">
        <span style={{ width: 120, fontWeight: 500 }}>{name}</span>
        <span
          style={{
            width: 18,
            textAlign: "center",
            color: ok ? "var(--success)" : "var(--danger)",
          }}
        >
          {ok ? "✓" : "✗"}
        </span>
        {ok && value ? (
          <span className="mono muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {value}
          </span>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>
            {ok ? "installed" : "not installed"}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {!ok && (
          <button
            onClick={onInstall}
            disabled={anyInstalling || brewAvailable === false}
          >
            {installing ? "Installing…" : installLabel}
          </button>
        )}
      </div>
      {footerNote && !ok && (
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          {footerNote}
        </div>
      )}
    </div>
  );
}

interface BlackHoleRowProps {
  status: "missing" | "installed-not-loaded" | "loaded";
  installing: boolean;
  anyBusy: boolean;
  brewAvailable: boolean | null;
  restarting: boolean;
  onInstall: () => void;
  onRestartAudio: () => void;
  restartError: string | null;
}

function BlackHoleRow({
  status,
  installing,
  anyBusy,
  brewAvailable,
  restarting,
  onInstall,
  onRestartAudio,
  restartError,
}: BlackHoleRowProps) {
  // BlackHole has three legitimate display states: loaded (✓), missing
  // (offer brew install), and "installed-not-loaded" (cask is on disk but
  // coreaudiod hasn't picked it up yet — offer Restart Audio instead).
  const icon =
    status === "loaded" ? "✓" : status === "installed-not-loaded" ? "⚠" : "✗";
  const iconColor =
    status === "loaded"
      ? "var(--success)"
      : status === "installed-not-loaded"
        ? "var(--warning)"
        : "var(--danger)";
  const statusText =
    status === "loaded"
      ? "loaded"
      : status === "installed-not-loaded"
        ? "installed but not loaded by macOS"
        : "not installed";
  return (
    <div style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
      <div className="row">
        <span style={{ width: 120, fontWeight: 500 }}>BlackHole 2ch</span>
        <span style={{ width: 18, textAlign: "center", color: iconColor }}>
          {icon}
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          {statusText}
        </span>
        <span style={{ flex: 1 }} />
        {status === "missing" && (
          <button
            onClick={onInstall}
            disabled={anyBusy || brewAvailable === false}
          >
            {installing ? "Installing…" : "Install via Homebrew"}
          </button>
        )}
        {status === "installed-not-loaded" && (
          <button onClick={onRestartAudio} disabled={anyBusy}>
            {restarting ? "Restarting…" : "Restart audio"}
          </button>
        )}
      </div>
      {status === "missing" && brewAvailable !== false && (
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          macOS will ask you to approve the virtual audio driver. Follow the
          prompt — no restart needed.
        </div>
      )}
      {status === "installed-not-loaded" && (
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          The driver is on disk but macOS hasn't loaded it yet. Restart Audio
          relaunches coreaudiod (you'll be asked for your login password). If
          that doesn't work, log out and back in.
        </div>
      )}
      {restartError && (
        <div
          className="muted"
          style={{ color: "var(--danger)", marginTop: 6, fontSize: 12 }}
        >
          {restartError}
        </div>
      )}
    </div>
  );
}

// -------- Tiny path helpers (can't import node:path in the renderer) --------

function joinPath(a: string, b: string): string {
  if (a.endsWith("/")) return a + b;
  return `${a}/${b}`;
}

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}
