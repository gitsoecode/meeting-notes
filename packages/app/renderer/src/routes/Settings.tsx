import { useEffect, useState } from "react";
import { api } from "../ipc-client";
import type {
  AppConfigDTO,
  AudioDevice,
  DepsCheckResult,
} from "../../../shared/ipc";
import { classifyModelClient } from "../constants";
import { ShortcutRecorder } from "../components/ShortcutRecorder";
import { ModelDropdown } from "../components/ModelDropdown";

const SYSTEM_DEFAULT_DEVICE = "";

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
  const [installedLocal, setInstalledLocal] = useState<string[]>([]);
  const [pullModel, setPullModel] = useState("");
  const [pullOpen, setPullOpen] = useState(false);

  const refreshInstalledLocal = () => {
    api.llm
      .listInstalled()
      .then(setInstalledLocal)
      .catch(() => setInstalledLocal([]));
  };

  useEffect(() => {
    api.recording.listAudioDevices().then(setDevices).catch(() => {});
    api.secrets.has("claude").then(setHasClaude).catch(() => {});
    api.secrets.has("openai").then(setHasOpenai).catch(() => {});
    api.depsCheck().then(setDeps).catch(() => {});
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

      {error && <div className="muted tone-error">{error}</div>}

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
          <option value={SYSTEM_DEFAULT_DEVICE}>System default (auto-resolve)</option>
          {devices.map((d) => (
            <option key={d.name} value={d.name}>{d.name}</option>
          ))}
          {config.recording.mic_device &&
          !devices.find((d) => d.name === config.recording.mic_device) ? (
            <option value={config.recording.mic_device}>{config.recording.mic_device}</option>
          ) : null}
        </select>
        <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          "System default" picks the current default input each time you start
          recording, so swapping headphones mid-day still works.
        </div>
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
        <label>Default model</label>
        <ModelDropdown
          value={
            config.llm_provider === "ollama"
              ? config.ollama.model
              : config.claude.model
          }
          installedLocalModels={installedLocal}
          onChange={(next) => {
            if (!next) return;
            const kind = classifyModelClient(next);
            if (kind === "claude") {
              save({
                ...config,
                llm_provider: "claude",
                claude: { ...config.claude, model: next },
              });
            } else {
              save({
                ...config,
                llm_provider: "ollama",
                ollama: { ...config.ollama, model: next },
              });
            }
          }}
        />
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          Cloud (Claude) is fast but uses API credits. Local (Ollama) is free
          and offline but slower per section. Individual prompts can override
          this default in the Prompts editor.
        </div>

        <label style={{ marginTop: 16 }}>Anthropic API key</label>
        {config.llm_provider === "ollama" ? (
          <div
            className="muted"
            style={{ fontSize: 12, marginTop: 4 }}
            title="Local mode is selected — no Claude key required unless you add a per-prompt Claude override."
          >
            {hasClaude
              ? "Stored in Keychain (optional in local mode)."
              : "Optional — only needed if a prompt targets a Claude model."}
            <div className="row" style={{ marginTop: 6 }}>
              <input
                type="password"
                value={claudeInput}
                onChange={(e) => setClaudeInput(e.target.value)}
                placeholder={hasClaude ? "••••• stored in Keychain" : "paste key to set (optional)"}
              />
              <button onClick={onSaveClaudeKey} disabled={!claudeInput}>Save</button>
            </div>
          </div>
        ) : (
          <div className="row">
            <input
              type="password"
              value={claudeInput}
              onChange={(e) => setClaudeInput(e.target.value)}
              placeholder={hasClaude ? "••••• stored in Keychain" : "paste key to set"}
            />
            <button onClick={onSaveClaudeKey} disabled={!claudeInput}>Save</button>
          </div>
        )}
        {config.asr_provider === "openai" && (
          <>
            <label style={{ marginTop: 12 }}>OpenAI API key (for transcription)</label>
            <div className="row">
              <input
                type="password"
                value={openaiInput}
                onChange={(e) => setOpenaiInput(e.target.value)}
                placeholder={hasOpenai ? "••••• stored in Keychain" : "paste key to set"}
              />
              <button onClick={onSaveOpenaiKey} disabled={!openaiInput}>Save</button>
            </div>
            <div
              className="muted tone-warning"
              style={{ marginTop: 6, fontSize: 12 }}
              title="OpenAI's transcription endpoint enforces a 25 MB per-file upload limit. We transcode to 32 kbps mono Opus to stretch that from ~13 min (PCM) to ~80 min per channel, but beyond that the request will fail. Automatic chunking would lift this ceiling and is on the roadmap."
            >
              ⚠ OpenAI caps uploads at 25 MB per file. Meetings longer than
              ~80 min per audio channel will fail — switch to Parakeet (local)
              for long recordings. Automatic chunking is on the roadmap.
            </div>
          </>
        )}
      </div>

      {/* --- Local models (Ollama) --- */}
      <div className="card">
        <div className="card-header">Local models</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Models pulled via Ollama. Stored in <code>~/.ollama/models</code> so
          they're shared with any other Ollama install on your machine — no
          duplicate downloads.
        </div>
        {installedLocal.length === 0 ? (
          <div className="muted">No local models installed yet.</div>
        ) : (
          <div className="column">
            {installedLocal.map((m) => (
              <div key={m} className="row" style={{ alignItems: "center" }}>
                <span style={{ flex: 1 }}>{m}</span>
                <button
                  onClick={async () => {
                    if (!confirm(`Remove ${m}? You can re-pull anytime.`)) return;
                    try {
                      await api.llm.remove(m);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err));
                    }
                    refreshInstalledLocal();
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <input
            value={pullModel}
            onChange={(e) => setPullModel(e.target.value)}
            placeholder="Pull a model — e.g. qwen3.5:9b or llama3.1:8b"
          />
          <button
            disabled={!pullModel.trim() || pullOpen}
            onClick={() => setPullOpen(true)}
          >
            Pull
          </button>
        </div>
        <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          Browse the full library at{" "}
          <a href="https://ollama.com/library" target="_blank" rel="noreferrer">
            ollama.com/library
          </a>
          .
        </div>
      </div>

      {/* --- Shortcuts --- */}
      <div className="card">
        <div className="card-header">Shortcuts</div>
        <label>Toggle recording</label>
        <ShortcutRecorder
          value={config.shortcuts.toggle_recording}
          onChange={(next) =>
            save({
              ...config,
              shortcuts: { ...config.shortcuts, toggle_recording: next },
            })
          }
        />
        <div className="muted" style={{ marginTop: 4 }}>
          Click the button and press your shortcut. Requires restart to apply.
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
              <span className={deps.blackhole === "loaded" ? "" : "muted"}>
                {deps.blackhole === "loaded"
                  ? "loaded"
                  : deps.blackhole === "installed-not-loaded"
                    ? "installed but not loaded — restart audio (sudo killall coreaudiod) or log out/in"
                    : "not found — brew install --cask blackhole-2ch"}
              </span>
            </div>
            <div className="row">
              <span>Python:</span>
              <span className={deps.python ? "" : "muted"}>
                {deps.python ?? "not found"}
              </span>
            </div>
            <div className="row">
              <span>Parakeet:</span>
              <span className={deps.parakeet ? "" : "muted"}>
                {deps.parakeet ?? "not installed — use Install button above"}
              </span>
            </div>
            <div className="row">
              <span>Ollama daemon:</span>
              <span className={deps.ollama.daemon ? "" : "muted"}>
                {deps.ollama.daemon
                  ? `running (${deps.ollama.source ?? "unknown"})`
                  : "not running — bundled binary will start it on demand"}
              </span>
            </div>
          </div>
        )}
      </div>

      {setupAsrOpen && (
        <SetupAsrModal
          onClose={() => {
            setSetupAsrOpen(false);
            // Pick up new status after install so the Deps card flips to ✓.
            api.depsCheck().then(setDeps).catch(() => {});
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
          }}
        />
      )}
    </>
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
      .then(() => {
        if (!cancelled) setDone(true);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setRunning(false);
      });
    return () => {
      cancelled = true;
    };
  }, [model]);

  return (
    <div className="modal-backdrop" onClick={() => !running && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 700 }}>
        <h2>Pulling {model}</h2>
        <p className="muted">
          Downloads to <code>~/.ollama/models</code>. Safe to leave open in the
          background.
        </p>
        {log.length > 0 && <pre className="log-view">{log.join("\n")}</pre>}
        {error && <div className="muted tone-error">{error}</div>}
        {done && <div className="muted tone-success">Done.</div>}
        <div className="actions">
          <button onClick={onClose} disabled={running}>
            Close
          </button>
        </div>
      </div>
    </div>
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
        {error && <div className="muted tone-error">{error}</div>}
        {done && <div className="muted tone-success">Done.</div>}
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
