import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { Meter } from "./ui/meter";

/**
 * Compact live channel indicators for the recording view.
 *
 * - Mic bar: driven by a renderer-side `getUserMedia` tap with a short
 *   Web Audio analyser chain. Purely cosmetic — ffmpeg remains the source
 *   of truth for what's actually written to disk. The goal is to help the
 *   user see at a glance that mic audio is flowing, and how much background
 *   noise is present, without introducing any capture competition with the
 *   main-process recording pipeline.
 *
 * - System indicator: a small pulsing dot when `systemCapturing` is true.
 *   We do not tap the AudioTee stream from the renderer (the stream is
 *   owned by the main-process recorder), so the honest minimal signal here
 *   is "yes, capture is live" rather than a fake level bar.
 *
 * Styling is intentionally muted: thin bars, low contrast at idle, gradient
 * fill only becomes vivid when the signal is strong.
 */
export function LiveChannelMeters({
  isRecording,
  systemCapturing,
}: {
  isRecording: boolean;
  systemCapturing: boolean;
}) {
  const { peak, rms } = useMicLevel(isRecording);

  return (
    <div className="flex items-center gap-3">
      <div
        className="flex items-center gap-1.5"
        title="Microphone input level"
      >
        <Mic className="h-3 w-3 text-[var(--text-tertiary)]" aria-hidden />
        <Meter
          size="sm"
          value={rms}
          peak={peak}
          active={isRecording}
          className="w-[96px]"
          aria-label="Microphone input level"
        />
      </div>
      {systemCapturing ? (
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--success)] animate-pulse"
          title="System audio capturing"
          aria-label="System audio capturing"
        />
      ) : null}
    </div>
  );
}

/**
 * Tap the renderer's microphone via `getUserMedia` and compute a peak/RMS
 * level on each animation frame. Returns values already mapped to 0–100
 * for the `Meter` primitive.
 *
 * Returns `{ peak: 0, rms: 0 }` when `active` is false and cleans up the
 * stream / AudioContext so the mic indicator in the OS clears.
 */
function useMicLevel(active: boolean): { peak: number; rms: number } {
  const [level, setLevel] = useState<{ peak: number; rms: number }>({ peak: 0, rms: 0 });
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!active) {
      setLevel({ peak: 0, rms: 0 });
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);

        let peakHold = 0;
        let peakDecayAt = performance.now();

        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let sumSq = 0;
          let instPeak = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128; // −1..1
            const abs = Math.abs(v);
            if (abs > instPeak) instPeak = abs;
            sumSq += v * v;
          }
          const rmsAmp = Math.sqrt(sumSq / buf.length);

          // Peak-hold with gentle decay (~20% per 100 ms).
          const now = performance.now();
          if (now - peakDecayAt > 100) {
            peakHold *= 0.8;
            peakDecayAt = now;
          }
          if (instPeak > peakHold) peakHold = instPeak;

          setLevel({ peak: amplitudeToPct(peakHold), rms: amplitudeToPct(rmsAmp) });
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        console.warn("live mic meter error", err);
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
      setLevel({ peak: 0, rms: 0 });
    };
  }, [active]);

  return level;
}

/**
 * Map a linear amplitude in 0..1 (peak amplitude from Web Audio analyser)
 * to a 0–100 percent for the Meter bar. We use a mild perceptual curve
 * (log-ish) so quiet speech registers visibly while loud peaks still fill
 * the bar without clipping early.
 */
function amplitudeToPct(amp: number): number {
  if (!Number.isFinite(amp) || amp <= 0) return 0;
  // 20 * log10(amp) maps 0..1 to −∞..0 dB. Map −60 dB..0 dB onto 0..100.
  const db = 20 * Math.log10(Math.min(1, amp));
  const pct = ((db + 60) / 60) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}
