import { useEffect, useState } from "react";
import { api } from "../ipc-client";
import type {
  AppConfigDTO,
  AudioDevice,
  DepsCheckResult,
} from "../../../shared/ipc";

interface SettingsProps {
  config: AppConfigDTO;
  onChange: (c: AppConfigDTO) => void;
}

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

  useEffect(() => {
    api.recording.listAudioDevices().then(setDevices).catch(() => {});
    api.secrets.has("claude").then(setHasClaude).catch(() => {});
    api.secrets.has("openai").then(setHasOpenai).catch(() => {});
    api.depsCheck().then(setDeps).catch(() => {});
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
    const picked = await api.config.pickDirectory({ defaultPath: config.obsidian_integration.vault_path });
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
    if (!confirm(`Move all meeting files to ${picked}? Existing files will be moved.`)) return;
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

  return (
    <>
      <h1 className="section-title">Settings</h1>
      <p className="section-subtitle">Every value here takes effect immediately.</p>

      {error && <div className="muted" style={{ color: "var(--danger)" }}>{error}</div>}

      {/* --- General --- */}
      <div className="card">
        <div className="card-header">General</div>
        <div className="checkbox-row">
          <label className="switch">
            <input
              type="checkbox"
              checked={config.obsidian_integration.enabled}
              onChange={(e) => setObsidianEnabled(e.target.checked)}
              disabled={busy === "obsidian"}
            />
            <span className="slider" />
          </label>
          <div>
            <strong>Use Obsidian as viewer</strong>
            <div className="muted">
              When on, notes open in Obsidian during recording and meeting files have "Open in
              Obsidian" buttons. You can change this anytime.
            </div>
          </div>
        </div>
        {config.obsidian_integration.enabled && (
          <>
            <label style={{ marginTop: 12 }}>Vault path</label>
            <div className="row">
              <input
                value={config.obsidian_integration.vault_path ?? ""}
                readOnly
                placeholder="(not set)"
              />
              <button onClick={setObsidianVault} disabled={busy === "vault"}>
                Pick…
              </button>
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
              Vault name: {config.obsidian_integration.vault_name ?? "—"}
            </div>
          </>
        )}
        <label style={{ marginTop: 16 }}>Data directory</label>
        <div className="row">
          <input value={config.data_path} readOnly />
          <button onClick={onChangeDataDir} disabled={busy === "data-path"}>
            Change…
          </button>
          <button onClick={() => api.config.openInFinder(config.data_path)}>
            Open in Finder
          </button>
        </div>
      </div>

      {/* --- Audio --- */}
      <div className="card">
        <div className="card-header">Audio</div>
        <label>Mic device</label>
        <select
          value={config.recording.mic_device}
          onChange={(e) =>
            save({
              ...config,
              recording: { ...config.recording, mic_device: e.target.value },
            })
          }
        >
          {devices.map((d) => (
            <option key={d.name} value={d.name}>{d.name}</option>
          ))}
          {devices.find((d) => d.name === config.recording.mic_device) ? null : (
            <option value={config.recording.mic_device}>{config.recording.mic_device}</option>
          )}
        </select>
        <label style={{ marginTop: 12 }}>System audio device</label>
        <select
          value={config.recording.system_device}
          onChange={(e) =>
            save({
              ...config,
              recording: { ...config.recording, system_device: e.target.value },
            })
          }
        >
          {devices.map((d) => (
            <option key={d.name} value={d.name}>{d.name}</option>
          ))}
          {devices.find((d) => d.name === config.recording.system_device) ? null : (
            <option value={config.recording.system_device}>{config.recording.system_device}</option>
          )}
        </select>
      </div>

      {/* --- Transcription --- */}
      <div className="card">
        <div className="card-header">Transcription</div>
        <label>Provider</label>
        <select
          value={config.asr_provider}
          onChange={(e) =>
            save({
              ...config,
              asr_provider: e.target.value as AppConfigDTO["asr_provider"],
            })
          }
        >
          <option value="parakeet-mlx">Parakeet (local, MLX)</option>
          <option value="openai">OpenAI</option>
          <option value="whisper-local">whisper.cpp (local)</option>
        </select>
        {config.asr_provider === "parakeet-mlx" && (
          <div style={{ marginTop: 12 }}>
            <button onClick={() => setSetupAsrOpen(true)}>Install / reinstall Parakeet</button>
          </div>
        )}
      </div>

      {/* --- LLM --- */}
      <div className="card">
        <div className="card-header">LLM</div>
        <label>Model</label>
        <input
          value={config.claude.model}
          onChange={(e) => save({ ...config, claude: { ...config.claude, model: e.target.value } })}
        />
        <label style={{ marginTop: 12 }}>Anthropic API key</label>
        <div className="row">
          <input
            type="password"
            value={claudeInput}
            onChange={(e) => setClaudeInput(e.target.value)}
            placeholder={hasClaude ? "••••• stored in Keychain" : "paste key to set"}
          />
          <button onClick={onSaveClaudeKey} disabled={!claudeInput}>Save</button>
        </div>
        {config.asr_provider === "openai" && (
          <>
            <label style={{ marginTop: 12 }}>OpenAI API key</label>
            <div className="row">
              <input
                type="password"
                value={openaiInput}
                onChange={(e) => setOpenaiInput(e.target.value)}
                placeholder={hasOpenai ? "••••• stored in Keychain" : "paste key to set"}
              />
              <button onClick={onSaveOpenaiKey} disabled={!openaiInput}>Save</button>
            </div>
          </>
        )}
      </div>

      {/* --- Shortcuts --- */}
      <div className="card">
        <div className="card-header">Shortcuts</div>
        <label>Toggle recording</label>
        <input
          value={config.shortcuts.toggle_recording}
          onChange={(e) =>
            save({
              ...config,
              shortcuts: { ...config.shortcuts, toggle_recording: e.target.value },
            })
          }
        />
        <div className="muted" style={{ marginTop: 4 }}>
          Requires restart to apply. Use Electron accelerator syntax, e.g.
          <span className="mono"> CommandOrControl+Shift+M</span>
        </div>
      </div>

      {/* --- Deps --- */}
      <div className="card">
        <div className="card-header">Dependencies</div>
        {deps == null ? (
          <div className="muted">Checking…</div>
        ) : (
          <div className="column">
            <div className="row">
              <span>ffmpeg:</span>
              <span className={deps.ffmpeg ? "" : "muted"}>
                {deps.ffmpeg ?? "not found — brew install ffmpeg"}
              </span>
            </div>
            <div className="row">
              <span>BlackHole (2ch):</span>
              <span className={deps.blackhole ? "" : "muted"}>
                {deps.blackhole ? "installed" : "not found — brew install --cask blackhole-2ch"}
              </span>
            </div>
            <div className="row">
              <span>Python:</span>
              <span className={deps.python ? "" : "muted"}>
                {deps.python ?? "not found"}
              </span>
            </div>
          </div>
        )}
      </div>

      {setupAsrOpen && (
        <SetupAsrModal onClose={() => setSetupAsrOpen(false)} />
      )}
    </>
  );
}

function SetupAsrModal({ onClose }: { onClose: () => void }) {
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = api.on.setupAsrLog((line) => {
      setLog((prev) => [...prev, line]);
    });
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 700 }}>
        <h2>Install Parakeet</h2>
        <p className="muted">
          Installs the Python venv and Parakeet MLX into ~/.meeting-notes. May take a minute.
        </p>
        {log.length > 0 && (
          <pre className="log-view">{log.join("\n")}</pre>
        )}
        {error && <div className="muted" style={{ color: "var(--danger)" }}>{error}</div>}
        {done && <div className="muted" style={{ color: "var(--success)" }}>Done.</div>}
        <div className="actions">
          <button onClick={onClose} disabled={running}>Close</button>
          <button className="primary" onClick={onRun} disabled={running}>
            {running ? "Installing…" : "Install"}
          </button>
        </div>
      </div>
    </div>
  );
}
