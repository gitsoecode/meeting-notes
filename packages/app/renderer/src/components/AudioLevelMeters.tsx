import { useEffect, useRef, useState } from "react";
import { Mic, Monitor, AlertTriangle, ExternalLink, RefreshCw, CheckCircle2, Folder, Activity } from "lucide-react";
import { api } from "../ipc-client";
import type {
  AudioDevice,
  AudioMonitorLevel,
  AudioMonitorSnapshot,
  AudioTestReport,
} from "../../../shared/ipc";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Meter } from "./ui/meter";
import { dbToPct, hasAudibleSignal } from "../lib/audio-meter";

const SYSTEM_DEFAULT_VALUE = "__system_default__";

export interface AppIdentity {
  displayName: string;
  tccBundleName: string;
  bundlePath: string | null;
  isDev: boolean;
  isPackaged: boolean;
}

type PermissionState = "granted" | "denied" | "not-determined" | "restricted" | "unknown";
interface AudioPermissions {
  microphone: PermissionState;
  systemAudio: PermissionState;
}

/**
 * Live audio level meters with an inline mic source dropdown.
 *
 * The banner for "System Audio Recording permission needed" is driven
 * exclusively by the OS-level probe (`systemPreferences.getMediaAccessStatus`)
 * so it cannot flicker on Bluetooth route changes or output-device switches.
 * A separate user-initiated "Diagnose audio" action exercises the full
 * capture pipeline and reports per-channel results.
 */
export function AudioLevelMeters({
  active,
  micDevice,
  availableDevices,
  systemAudioSupported,
  onMicDeviceChange,
  onDevicesRefreshed,
}: {
  active: boolean;
  micDevice: string;
  availableDevices: AudioDevice[];
  systemAudioSupported: boolean;
  onMicDeviceChange: (deviceName: string) => void;
  onDevicesRefreshed?: (devices: AudioDevice[]) => void;
}) {
  const [snapshot, setSnapshot] = useState<AudioMonitorSnapshot | null>(null);
  const [restartTick, setRestartTick] = useState(0);
  const [appIdentity, setAppIdentity] = useState<AppIdentity | null>(null);
  const [permissions, setPermissions] = useState<AudioPermissions>({
    microphone: "unknown",
    systemAudio: "unknown",
  });
  const [diagnose, setDiagnose] = useState<
    { status: "idle" } | { status: "running" } | { status: "done"; report: AudioTestReport } | { status: "error"; message: string }
  >({ status: "idle" });

  const onDevicesRefreshedRef = useRef(onDevicesRefreshed);
  onDevicesRefreshedRef.current = onDevicesRefreshed;

  useEffect(() => {
    api.system.getAppIdentity().then(setAppIdentity).catch(() => {});
  }, []);

  // Keep permission status fresh. We poll on mount, when the user forces a
  // Refresh, and whenever the OS reports a device change (the usual trigger
  // for "someone revoked permission in System Settings" is also a
  // plug/unplug event).
  useEffect(() => {
    let cancelled = false;
    const refreshPermissions = async () => {
      try {
        const next = await api.system.getAudioPermissions();
        if (!cancelled) setPermissions(next);
      } catch {
        // ignore
      }
    };
    void refreshPermissions();
    const handleChange = () => {
      void refreshPermissions();
    };
    try {
      navigator.mediaDevices?.addEventListener?.("devicechange", handleChange);
    } catch {
      // ignore — not all contexts support mediaDevices
    }
    return () => {
      cancelled = true;
      try {
        navigator.mediaDevices?.removeEventListener?.("devicechange", handleChange);
      } catch {
        // ignore
      }
    };
  }, [restartTick]);

  // Start the monitor exactly once per `active` toggle. Mic dropdown changes
  // take the light `switchAudioMonitorMic` path below so AudioTee doesn't
  // restart (restarting it briefly surfaces as a no-signal flicker).
  useEffect(() => {
    if (!active) return;

    const unsubscribe = api.on.audioMonitorLevels((s) => setSnapshot(s));

    let started = false;
    let cancelled = false;
    api.recording
      .startAudioMonitor({ micDevice: micDevice || undefined })
      .then((devices) => {
        if (cancelled) return;
        started = true;
        if (devices) onDevicesRefreshedRef.current?.(devices);
      })
      .catch((err) => {
        console.warn("audio monitor start failed", err);
      });

    const handleDeviceChange = () => {
      // A device plug/unplug may change which physical mic "System default"
      // resolves to. Ask the monitor to re-pick.
      api.recording.switchAudioMonitorMic(micDevice || "").catch(() => {});
    };
    try {
      navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);
    } catch {
      // ignore
    }

    return () => {
      cancelled = true;
      unsubscribe();
      try {
        navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
      } catch {
        // ignore
      }
      if (started) {
        api.recording.stopAudioMonitor().catch(() => {});
      }
      setSnapshot(null);
    };
    // We intentionally exclude `micDevice` here — mic changes are handled
    // by the lighter effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, restartTick]);

  // Mic-dropdown changes: swap only the ffmpeg capture, leave AudioTee alone.
  // Skip the first run for a given `active` cycle so we don't race the
  // initial `startAudioMonitor` call above.
  const lastMicRef = useRef<string | null>(null);
  useEffect(() => {
    if (!active) {
      lastMicRef.current = null;
      return;
    }
    if (lastMicRef.current === null) {
      lastMicRef.current = micDevice;
      return;
    }
    if (lastMicRef.current === micDevice) return;
    lastMicRef.current = micDevice;
    api.recording.switchAudioMonitorMic(micDevice || "").catch(() => {});
  }, [active, micDevice]);

  const refresh = async () => {
    try {
      await api.recording.stopAudioMonitor();
    } catch {
      // ignore
    }
    setRestartTick((n) => n + 1);
  };

  const runDiagnose = async () => {
    setDiagnose({ status: "running" });
    try {
      const report = await api.recording.testAudio();
      setDiagnose({ status: "done", report });
      // A real diagnose may have consumed the mic — re-kick the monitor.
      setRestartTick((n) => n + 1);
    } catch (err) {
      setDiagnose({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const micSelectValue = micDevice === "" || micDevice === "default" ? SYSTEM_DEFAULT_VALUE : micDevice;
  const resolvedMicName = snapshot?.mic.source;
  const showResolved =
    micSelectValue === SYSTEM_DEFAULT_VALUE &&
    resolvedMicName &&
    resolvedMicName !== "(no microphone)";
  const micPermissionBanner = permissions.microphone === "denied" || permissions.microphone === "restricted";
  // Intentionally no always-on banner for system audio: on macOS 14.2+ the
  // "System Audio Recording Only" TCC is separate from "Screen Recording",
  // and there is no reliable OS-level probe for the former. The Diagnose
  // dialog runs a real capture and reports authoritatively.
  // Keep the permission read available for Diagnose follow-ups.
  void permissions.systemAudio;

  return (
    <div className="space-y-6">
      {/* ---- Mic row ---- */}
      <ChannelRow
        icon={<Mic className="h-3.5 w-3.5" />}
        label="Microphone"
      >
        <Select value={micSelectValue} onValueChange={(v) => onMicDeviceChange(v === SYSTEM_DEFAULT_VALUE ? "" : v)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select microphone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SYSTEM_DEFAULT_VALUE}>System default (auto-pick a physical mic)</SelectItem>
            {availableDevices.map((d) => (
              <SelectItem key={d.name} value={d.name}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showResolved ? (
          <p className="text-xs text-[var(--text-tertiary)]">
            Currently capturing from <span className="text-[var(--text-secondary)]">{resolvedMicName}</span>
          </p>
        ) : null}
        <MeterWithOverlay level={snapshot?.mic} active={active} size="default" />
        <ChannelStatus level={snapshot?.mic} active={active} />
        {micPermissionBanner ? (
          <PermissionBanner
            channel="mic"
            state={permissions.microphone}
            appIdentity={appIdentity}
          />
        ) : null}
      </ChannelRow>

      {/* ---- System audio row ---- */}
      <ChannelRow
        icon={<Monitor className="h-3.5 w-3.5" />}
        label="System audio"
      >
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-secondary)]">
          {systemAudioSupported ? "Automatic (AudioTee / macOS 14.2+)" : "Not available (requires macOS 14.2+)"}
        </div>
        <MeterWithOverlay level={snapshot?.system} active={active && systemAudioSupported} size="default" />
        <ChannelStatus level={snapshot?.system} active={active && systemAudioSupported} />
      </ChannelRow>

      {/* ---- Diagnose audio result ---- */}
      {diagnose.status !== "idle" ? (
        <DiagnoseResult state={diagnose} appIdentity={appIdentity} />
      ) : null}

      {/* ---- Footer ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="flex-1 min-w-[220px] text-xs text-[var(--text-tertiary)]">
          Speak into your mic or play a sound to verify both channels. For a full end-to-end check, use <em>Diagnose audio</em>.
        </p>
        <div className="flex flex-none gap-2">
          <Button variant="ghost" size="sm" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={runDiagnose}
            disabled={diagnose.status === "running"}
          >
            <Activity className="h-3.5 w-3.5 mr-1" />
            {diagnose.status === "running" ? "Diagnosing…" : "Diagnose audio"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ChannelRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        <span className="text-[var(--text-tertiary)]">{icon}</span>
        {label}
      </div>
      {children}
    </div>
  );
}

function MeterWithOverlay({
  level,
  active,
  size,
}: {
  level?: AudioMonitorLevel;
  active: boolean;
  size: "default" | "lg";
}) {
  const hasError = Boolean(level?.error);
  const signal = hasAudibleSignal(level?.peakDb);
  const showListening = active && !hasError && !signal;
  const showError = active && hasError;
  const showPaused = !active;

  return (
    <Meter
      size={size}
      value={dbToPct(level?.rmsDb)}
      peak={dbToPct(level?.peakDb)}
      active={active && !hasError}
    >
      {showPaused ? <CaptionText>Paused</CaptionText> : null}
      {showError ? <CaptionText tone="warning">No signal</CaptionText> : null}
      {showListening ? <CaptionText>Listening…</CaptionText> : null}
    </Meter>
  );
}

function CaptionText({ children, tone }: { children: React.ReactNode; tone?: "warning" }) {
  return (
    <span
      className={
        "text-[10px] uppercase tracking-wide " +
        (tone === "warning" ? "text-[var(--warning)]" : "text-[var(--text-tertiary)]")
      }
    >
      {children}
    </span>
  );
}

function ChannelStatus({ level, active }: { level?: AudioMonitorLevel; active: boolean }) {
  if (!active) return null;
  if (level?.error) {
    return (
      <div className="flex items-start gap-1.5 text-xs text-[var(--warning-text,var(--text-secondary))]">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-[var(--warning)]" />
        <span>{level.error}</span>
      </div>
    );
  }
  if (level?.active) {
    const hasSignal = hasAudibleSignal(level?.peakDb);
    return (
      <div className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
        {hasSignal && typeof level.peakDb === "number" ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />
            <span>Receiving audio — peak {level.peakDb.toFixed(1)} dB</span>
          </>
        ) : (
          <span>Listening… (no signal yet)</span>
        )}
      </div>
    );
  }
  return null;
}

function PermissionBanner({
  channel,
  state,
  appIdentity,
}: {
  channel: "mic" | "system";
  state: PermissionState;
  appIdentity: AppIdentity | null;
}) {
  const isDev = appIdentity?.isDev ?? false;
  const bundleLabel = appIdentity?.tccBundleName ?? "Meeting Notes";
  const bundleName = isDev ? "Electron" : bundleLabel;
  const bundlePath = appIdentity?.bundlePath ?? null;

  if (channel === "mic") {
    return (
      <div className="rounded-md border border-[var(--warning)]/40 bg-[var(--warning-muted,rgba(245,158,11,0.08))] p-3 text-xs space-y-2">
        <div className="flex items-start gap-1.5 font-medium text-[var(--warning)]">
          <AlertTriangle className="h-3.5 w-3.5 flex-none mt-[1px]" />
          Microphone permission {state === "denied" ? "denied" : "restricted"}
        </div>
        <div className="text-[var(--text-secondary)]">
          macOS won't let the app read from any microphone until this is granted.
          Grant it to <strong className="text-[var(--text-primary)]">"{bundleName}"</strong>.
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            api.system.openMicrophonePermissionPane().catch(() => {});
          }}
        >
          <ExternalLink className="h-3.5 w-3.5 mr-1" />
          Open Microphone Settings
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[var(--warning)]/40 bg-[var(--warning-muted,rgba(245,158,11,0.08))] p-3 text-xs space-y-2">
      <div className="flex items-start gap-1.5 font-medium text-[var(--warning)]">
        <AlertTriangle className="h-3.5 w-3.5 flex-none mt-[1px]" />
        System Audio Recording permission needed
      </div>
      <div className="text-[var(--text-secondary)]">
        macOS hasn't granted this app the System Audio Recording permission.{" "}
        {isDev ? (
          <>
            Because this is a development build, the permission belongs to{" "}
            <strong className="text-[var(--text-primary)]">"Electron"</strong>, not "Meeting Notes".
          </>
        ) : (
          <>Grant it to <strong className="text-[var(--text-primary)]">"{bundleLabel}"</strong>.</>
        )}
      </div>
      <details className="text-[var(--text-secondary)]">
        <summary className="cursor-pointer text-[var(--text-primary)]">Show steps</summary>
        <ol className="ml-4 mt-2 list-decimal space-y-1">
          <li>Click <em>Open System Settings</em> below.</li>
          <li>Scroll to <strong className="text-[var(--text-primary)]">"System Audio Recording Only"</strong>.</li>
          <li>Turn <strong className="text-[var(--text-primary)]">{bundleName}</strong> on, or add it with <strong>+</strong> if it's missing.</li>
          <li>Return here and click <em>Refresh</em>.</li>
        </ol>
        {bundlePath ? (
          <div className="mt-2 font-mono text-[10px] text-[var(--text-tertiary)] break-all">
            {bundlePath}
          </div>
        ) : null}
      </details>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            api.system.openAudioPermissionPane().catch(() => {});
          }}
        >
          <ExternalLink className="h-3.5 w-3.5 mr-1" />
          Open System Settings
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            api.system.revealAppBundle().catch(() => {});
          }}
        >
          <Folder className="h-3.5 w-3.5 mr-1" />
          Reveal {bundleName} in Finder
        </Button>
      </div>
    </div>
  );
}

function DiagnoseResult({
  state,
  appIdentity,
}: {
  state:
    | { status: "running" }
    | { status: "done"; report: AudioTestReport }
    | { status: "error"; message: string };
  appIdentity: AppIdentity | null;
}) {
  if (state.status === "running") {
    return (
      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/60 p-3 text-xs text-[var(--text-secondary)]">
        Recording a short test clip on mic and system audio. Play a sound (YouTube, music) so the system channel has something to hear…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="rounded-md border border-[var(--error)]/40 bg-[var(--error-muted,rgba(220,38,38,0.08))] p-3 text-xs text-[var(--error)]">
        Diagnose failed: {state.message}
      </div>
    );
  }
  const { report } = state;
  const systemResult = report.results.find((r) => r.role === "system");
  const systemProblem = !!systemResult && (systemResult.error || !systemResult.recorded || systemResult.isSilent);
  const isDev = appIdentity?.isDev ?? false;
  const bundleLabel = appIdentity?.tccBundleName ?? "Meeting Notes";
  const bundleName = isDev ? "Electron" : bundleLabel;
  return (
    <div className="space-y-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/40 p-3 text-xs">
      <div className="font-medium text-[var(--text-primary)]">Audio diagnose results</div>
      <ul className="space-y-1">
        {report.results.map((r) => {
          const label = r.role === "mic" ? `Microphone — ${r.deviceName || "(unknown)"}` : "System audio (AudioTee)";
          let tone = "text-[var(--text-secondary)]";
          let status: string;
          if (r.error) {
            tone = "text-[var(--error)]";
            status = `Capture failed — ${r.error}`;
          } else if (!r.recorded) {
            tone = "text-[var(--error)]";
            status = "Capture didn't start";
          } else if (r.isSilent) {
            tone = "text-[var(--warning)]";
            status = `No signal detected (max ${r.maxVolumeDb.toFixed(1)} dB) — check output routing / volume`;
          } else {
            tone = "text-[var(--success)]";
            status = `Signal detected (peak ${r.maxVolumeDb.toFixed(1)} dB)`;
          }
          return (
            <li key={r.role} className="flex items-start gap-2">
              <span className="min-w-[160px] text-[var(--text-tertiary)]">{label}</span>
              <span className={tone}>{status}</span>
            </li>
          );
        })}
      </ul>
      {systemProblem ? (
        <div className="space-y-2 pt-1">
          <p className="text-[var(--text-secondary)]">
            If something was playing during the test, the most likely cause is a missing{" "}
            <strong className="text-[var(--text-primary)]">System Audio Recording</strong> permission for{" "}
            <strong className="text-[var(--text-primary)]">"{bundleName}"</strong>.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                api.system.openAudioPermissionPane().catch(() => {});
              }}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              Open System Settings
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                api.system.revealAppBundle().catch(() => {});
              }}
            >
              <Folder className="h-3.5 w-3.5 mr-1" />
              Reveal {bundleName} in Finder
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
