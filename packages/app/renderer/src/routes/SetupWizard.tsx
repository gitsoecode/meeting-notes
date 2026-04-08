import { useEffect, useState } from "react";
import { api } from "../ipc-client";
import type {
  AudioDevice,
  AppConfigDTO,
  DepsCheckResult,
  InitConfigRequest,
} from "../../../shared/ipc";

interface SetupWizardProps {
  onComplete: () => void;
}

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const totalSteps = 6;

  // Draft config values
  const [dataPath, setDataPath] = useState<string>("");
  const [obsidianEnabled, setObsidianEnabled] = useState<boolean>(false);
  const [vaultPath, setVaultPath] = useState<string>("");
  const [vaultName, setVaultName] = useState<string>("");

  const [asrProvider, setAsrProvider] =
    useState<AppConfigDTO["asr_provider"]>("parakeet-mlx");
  const [micDevice, setMicDevice] = useState("");
  const [systemDevice, setSystemDevice] = useState("");

  const [claudeKey, setClaudeKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");

  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [deps, setDeps] = useState<DepsCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.recording.listAudioDevices().then((list) => {
      setDevices(list);
      if (list.length > 0) {
        setMicDevice((prev) => prev || list[0].name);
        const bh = list.find((d) => /blackhole/i.test(d.name));
        setSystemDevice((prev) => prev || (bh ? bh.name : list[0].name));
      }
    });
    api.depsCheck().then(setDeps);
  }, []);

  const pickDataDir = async () => {
    const picked = await api.config.pickDirectory();
    if (picked) {
      setDataPath(picked);
      // If picked directory looks like an Obsidian vault (contains `.obsidian`), auto-enable
      // — we can't easily detect here, so offer it on the next step.
    }
  };

  const pickVaultDir = async () => {
    const picked = await api.config.pickDirectory();
    if (picked) {
      setVaultPath(picked);
      const name = picked.split("/").filter(Boolean).pop() ?? "";
      setVaultName(name);
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
          enabled: obsidianEnabled,
          vault_name: obsidianEnabled ? vaultName : undefined,
          vault_path: obsidianEnabled ? vaultPath : undefined,
        },
        asr_provider: asrProvider,
        recording: { mic_device: micDevice, system_device: systemDevice },
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

  return (
    <div className="wizard">
      <div className="wizard-progress">
        {Array.from({ length: totalSteps }).map((_, i) => (
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
            A local-first meeting workspace. Press Start before a call, take notes, press
            Stop — and a transcript + summary + any custom outputs land in plain markdown on
            your disk. Let's get you set up.
          </p>
          <div className="actions">
            <button className="primary" onClick={() => setStep(1)}>Get started</button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="wizard-step">
          <h2>Where should meetings be stored?</h2>
          <p className="muted">
            Pick any folder — a regular directory or an existing Obsidian vault. Every
            meeting becomes a subfolder with plain markdown files. You can change this later.
          </p>
          <label>Data directory</label>
          <div className="row">
            <input value={dataPath} onChange={(e) => setDataPath(e.target.value)} placeholder="/Users/you/Documents/Meeting Notes" />
            <button onClick={pickDataDir}>Pick…</button>
          </div>
          <div className="actions">
            <button onClick={() => setStep(0)}>Back</button>
            <button className="primary" onClick={() => setStep(2)} disabled={!dataPath}>
              Next
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="wizard-step">
          <h2>Obsidian integration</h2>
          <p className="muted">
            If you use Obsidian, we can pop notes open in Obsidian when recording starts and
            show "Open in Obsidian" buttons on meeting files. The on-disk layout is identical
            either way — this is just which viewer gets the spotlight.
          </p>
          <div className="checkbox-row">
            <label className="switch">
              <input
                type="checkbox"
                checked={obsidianEnabled}
                onChange={(e) => setObsidianEnabled(e.target.checked)}
              />
              <span className="slider" />
            </label>
            <span>Use Obsidian as viewer</span>
          </div>
          {obsidianEnabled && (
            <>
              <label style={{ marginTop: 12 }}>Vault path</label>
              <div className="row">
                <input
                  value={vaultPath}
                  onChange={(e) => setVaultPath(e.target.value)}
                  placeholder="/Users/you/Obsidian/MyVault"
                />
                <button onClick={pickVaultDir}>Pick…</button>
              </div>
              <label style={{ marginTop: 12 }}>Vault name (for obsidian:// URIs)</label>
              <input value={vaultName} onChange={(e) => setVaultName(e.target.value)} />
            </>
          )}
          <div className="actions">
            <button onClick={() => setStep(1)}>Back</button>
            <button
              className="primary"
              onClick={() => setStep(3)}
              disabled={obsidianEnabled && (!vaultPath || !vaultName)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="wizard-step">
          <h2>Audio devices</h2>
          <p className="muted">
            The mic is your voice. System audio captures the other side of the call —
            install BlackHole 2ch to route Meet/Zoom output back into Meeting Notes.
          </p>
          <label>Mic</label>
          <select value={micDevice} onChange={(e) => setMicDevice(e.target.value)}>
            {devices.map((d) => (
              <option key={d.name} value={d.name}>{d.name}</option>
            ))}
          </select>
          <label style={{ marginTop: 12 }}>System audio</label>
          <select value={systemDevice} onChange={(e) => setSystemDevice(e.target.value)}>
            {devices.map((d) => (
              <option key={d.name} value={d.name}>{d.name}</option>
            ))}
          </select>
          <div className="actions">
            <button onClick={() => setStep(2)}>Back</button>
            <button className="primary" onClick={() => setStep(4)} disabled={!micDevice}>
              Next
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="wizard-step">
          <h2>Transcription & LLM</h2>
          <label>Transcription provider</label>
          <select
            value={asrProvider}
            onChange={(e) => setAsrProvider(e.target.value as AppConfigDTO["asr_provider"])}
          >
            <option value="parakeet-mlx">Parakeet (local, recommended on Apple Silicon)</option>
            <option value="openai">OpenAI (cloud)</option>
            <option value="whisper-local">whisper.cpp (local)</option>
          </select>

          <label style={{ marginTop: 12 }}>Anthropic API key (for Claude)</label>
          <input
            type="password"
            value={claudeKey}
            onChange={(e) => setClaudeKey(e.target.value)}
            placeholder="sk-ant-…"
          />

          {asrProvider === "openai" && (
            <>
              <label style={{ marginTop: 12 }}>OpenAI API key (for transcription)</label>
              <input
                type="password"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder="sk-…"
              />
            </>
          )}
          <div className="muted" style={{ marginTop: 6 }}>
            Keys are stored in the macOS Keychain, not in config files.
          </div>
          <div className="actions">
            <button onClick={() => setStep(3)}>Back</button>
            <button className="primary" onClick={() => setStep(5)} disabled={!claudeKey}>
              Next
            </button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="wizard-step">
          <h2>Dependencies</h2>
          {deps == null ? (
            <div className="muted">Checking…</div>
          ) : (
            <div className="column">
              <DepRow
                name="ffmpeg"
                ok={!!deps.ffmpeg}
                hint="brew install ffmpeg"
                value={deps.ffmpeg ?? undefined}
              />
              <DepRow
                name="BlackHole 2ch"
                ok={deps.blackhole}
                hint="brew install --cask blackhole-2ch"
              />
              <DepRow
                name="Python 3"
                ok={!!deps.python}
                hint="brew install python@3.11"
                value={deps.python ?? undefined}
              />
            </div>
          )}
          {error && <div className="muted" style={{ color: "var(--danger)" }}>{error}</div>}
          <div className="actions">
            <button onClick={() => setStep(4)}>Back</button>
            <button className="primary" onClick={onFinish} disabled={busy}>
              {busy ? "Finishing…" : "Finish setup"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DepRow({
  name,
  ok,
  hint,
  value,
}: {
  name: string;
  ok: boolean;
  hint: string;
  value?: string;
}) {
  return (
    <div className="row">
      <span style={{ width: 120, fontWeight: 500 }}>{name}</span>
      <span style={{ color: ok ? "var(--success)" : "var(--danger)" }}>
        {ok ? "✓" : "✗"}
      </span>
      {value ? <span className="mono muted">{value}</span> : null}
      {!ok && <span className="mono muted">{hint}</span>}
    </div>
  );
}
