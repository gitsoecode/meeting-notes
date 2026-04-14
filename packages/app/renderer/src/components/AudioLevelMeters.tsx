import { useEffect, useRef, useState } from "react";
import { Mic, Monitor, AlertTriangle, ExternalLink, RefreshCw, CheckCircle2, Folder } from "lucide-react";
import { api } from "../ipc-client";
import type {
  AudioDevice,
  AudioMonitorLevel,
  AudioMonitorSnapshot,
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

/**
 * Live audio level meters with an inline mic source dropdown.
 *
 * Shows two channels (mic + system audio) with real-time peak/RMS meters
 * driven by the main-process audio-monitor module. The mic dropdown
 * switches the monitored source live, and permission errors surface
 * actionable remediation (Open System Settings, with the exact name the
 * user needs to look for).
 *
 * Uses the shared `Meter` primitive — same component as the live recording
 * view — so the visual language stays consistent between Settings and the
 * live capture indicator.
 */
export function AudioLevelMeters({
  active,
  micDevice,
  availableDevices,
  systemAudioSupported,
  onMicDeviceChange,
  onDevicesRefreshed,
}: {
  /** When false, the meter is paused (e.g., Settings tab not visible). */
  active: boolean;
  /** Current mic device config value. Empty string / "default" = auto. */
  micDevice: string;
  /** Known audio devices (from the last list call). */
  availableDevices: AudioDevice[];
  /** True when macOS >= 14.2; used to label the system-audio row. */
  systemAudioSupported: boolean;
  /** Called when the user picks a different mic from the dropdown. */
  onMicDeviceChange: (deviceName: string) => void;
  /** Called when the monitor re-enumerates devices. */
  onDevicesRefreshed?: (devices: AudioDevice[]) => void;
}) {
  const [snapshot, setSnapshot] = useState<AudioMonitorSnapshot | null>(null);
  const [restartingFor, setRestartingFor] = useState(0);
  const [appIdentity, setAppIdentity] = useState<AppIdentity | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    api.system.getAppIdentity().then(setAppIdentity).catch(() => {});
  }, []);

  useEffect(() => {
    if (!active) return;

    const unsubscribe = api.on.audioMonitorLevels((s) => setSnapshot(s));

    let cancelled = false;
    api.recording
      .startAudioMonitor({ micDevice: micDevice || undefined })
      .then((devices) => {
        if (cancelled) return;
        startedRef.current = true;
        if (devices && onDevicesRefreshed) onDevicesRefreshed(devices);
      })
      .catch((err) => {
        console.warn("audio monitor start failed", err);
      });

    return () => {
      cancelled = true;
      unsubscribe();
      if (startedRef.current) {
        api.recording.stopAudioMonitor().catch(() => {});
        startedRef.current = false;
      }
      setSnapshot(null);
    };
  }, [active, micDevice, restartingFor, onDevicesRefreshed]);

  const refresh = async () => {
    try {
      await api.recording.stopAudioMonitor();
    } catch {
      // ignore
    }
    startedRef.current = false;
    setRestartingFor((n) => n + 1);
  };

  const micSelectValue = micDevice === "" || micDevice === "default" ? SYSTEM_DEFAULT_VALUE : micDevice;

  return (
    <div className="space-y-6">
      {/* ---- Mic row ---- */}
      <ChannelRow
        icon={<Mic className="h-3.5 w-3.5" />}
        label="Microphone"
        left={
          <Select value={micSelectValue} onValueChange={(v) => onMicDeviceChange(v === SYSTEM_DEFAULT_VALUE ? "" : v)}>
            <SelectTrigger>
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
        }
        meter={<MeterWithOverlay level={snapshot?.mic} active={active} size="default" />}
        status={<ChannelStatus level={snapshot?.mic} active={active} appIdentity={appIdentity} channel="mic" />}
      />

      {/* ---- System audio row ---- */}
      <ChannelRow
        icon={<Monitor className="h-3.5 w-3.5" />}
        label="System audio"
        left={
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-secondary)]">
            {systemAudioSupported ? "Automatic (AudioTee / macOS 14.2+)" : "Not available (requires macOS 14.2+)"}
          </div>
        }
        meter={<MeterWithOverlay level={snapshot?.system} active={active && systemAudioSupported} size="default" />}
        status={
          <ChannelStatus
            level={snapshot?.system}
            active={active && systemAudioSupported}
            appIdentity={appIdentity}
            channel="system"
          />
        }
      />

      {/* ---- Footer ---- */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-xs text-[var(--text-tertiary)] flex-1">
          Speak into your mic and play a sound (e.g., a YouTube video) to verify both channels.
          This runs the same capture pipeline as a real recording.
        </p>
        <Button variant="ghost" size="sm" onClick={refresh} className="flex-none">
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          Refresh
        </Button>
      </div>
    </div>
  );
}

function ChannelRow({
  icon,
  label,
  left,
  meter,
  status,
}: {
  icon: React.ReactNode;
  label: string;
  left: React.ReactNode;
  meter: React.ReactNode;
  status: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        <span className="text-[var(--text-tertiary)]">{icon}</span>
        {label}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)] gap-3 items-center">
        {left}
        {meter}
      </div>
      {status}
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

// ---- Per-channel status line with permission remediation when needed ----

function ChannelStatus({
  level,
  active,
  appIdentity,
  channel,
}: {
  level?: AudioMonitorLevel;
  active: boolean;
  appIdentity: AppIdentity | null;
  channel: "mic" | "system";
}) {
  if (!active) {
    return null;
  }
  const error = level?.error;
  if (error) {
    return <PermissionRemediation error={error} appIdentity={appIdentity} channel={channel} />;
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

function PermissionRemediation({
  error,
  appIdentity,
  channel,
}: {
  error: string;
  appIdentity: AppIdentity | null;
  channel: "mic" | "system";
}) {
  const isSystemAudioPerm = /System Audio Recording/i.test(error);
  const bundleLabel = appIdentity?.tccBundleName ?? "Meeting Notes";
  const isDev = appIdentity?.isDev ?? false;

  if (isSystemAudioPerm) {
    const bundleName = isDev ? "Electron" : bundleLabel;
    const bundlePath = appIdentity?.bundlePath ?? null;
    return (
      <div className="rounded-md border border-[var(--warning)]/40 bg-[var(--warning-muted,rgba(245,158,11,0.08))] p-3 text-xs space-y-2">
        <div className="flex items-start gap-1.5 font-medium text-[var(--warning)]">
          <AlertTriangle className="h-3.5 w-3.5 flex-none mt-[1px]" />
          System Audio Recording permission needed
        </div>
        <div className="text-[var(--text-secondary)]">
          macOS is delivering silent audio because the permission hasn't been granted.{" "}
          {isDev ? (
            <>
              Because this is a development build, the permission belongs to{" "}
              <strong className="text-[var(--text-primary)]">"Electron"</strong>, not "Meeting Notes". A packaged
              build will correctly show "Meeting Notes".
            </>
          ) : (
            <>
              Grant it to <strong className="text-[var(--text-primary)]">"{bundleLabel}"</strong>.
            </>
          )}
        </div>
        <ol className="ml-4 list-decimal space-y-1 text-[var(--text-secondary)]">
          <li>Click <em>Open System Settings</em> below.</li>
          <li>
            Scroll to <strong className="text-[var(--text-primary)]">"System Audio Recording Only"</strong>{" "}
            (a separate section below "Screen &amp; System Audio Recording").
          </li>
          <li>
            If <strong className="text-[var(--text-primary)]">{bundleName}</strong> is already in the list,
            turn its switch <strong className="text-[var(--text-primary)]">on</strong>.
          </li>
          <li>
            If it's <strong className="text-[var(--text-primary)]">not</strong> in the list, click the{" "}
            <strong className="text-[var(--text-primary)]">+</strong> button, then drag{" "}
            <strong className="text-[var(--text-primary)]">{bundleName}.app</strong> from the Finder window
            that opens below. (Use <em>Reveal in Finder</em> to locate it.)
          </li>
          <li>
            Return here and click <em>Refresh</em>. The bar should move when audio plays.
          </li>
        </ol>
        {bundlePath ? (
          <div className="pt-1 font-mono text-[10px] text-[var(--text-tertiary)] break-all">
            {bundlePath}
          </div>
        ) : null}
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

  // Mic permission case (or any other error).
  return (
    <div className="rounded-md border border-[var(--warning)]/40 bg-[var(--warning-muted,rgba(245,158,11,0.08))] p-3 text-xs space-y-2">
      <div className="flex items-start gap-1.5 font-medium text-[var(--warning)]">
        <AlertTriangle className="h-3.5 w-3.5 flex-none mt-[1px]" />
        {channel === "mic" ? "Microphone not available" : "Audio channel error"}
      </div>
      <div className="text-[var(--text-secondary)]">{error}</div>
      {channel === "mic" ? (
        <div className="pt-1">
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
      ) : null}
    </div>
  );
}
