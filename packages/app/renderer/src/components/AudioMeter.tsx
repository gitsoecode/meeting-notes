import { useEffect, useRef, useState } from "react";

/**
 * Purely cosmetic mic level meter using getUserMedia. Active is intentionally
 * independent of the ffmpeg recording — this just visualises "yes audio is
 * reaching the OS from the mic". ffmpeg remains the source of truth for what
 * gets written to disk.
 */
export function AudioMeter({ active }: { active: boolean }) {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!active) return;
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
        analyser.fftSize = 256;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (let i = 0; i < data.length; i++) {
            const v = Math.abs(data[i] - 128) / 128;
            if (v > peak) peak = v;
          }
          setLevel(peak);
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        console.warn("mic meter error", err);
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
      setLevel(0);
    };
  }, [active]);

  const pct = Math.min(100, Math.round(level * 150));
  return (
    <div className="audio-meter">
      <div className="audio-meter-track">
        <div className="audio-meter-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="audio-meter-label">mic</span>
    </div>
  );
}
