import { useEffect, useMemo, useState } from "react";
import type { RecordingStatus } from "../../../shared/ipc";

/**
 * Emits a live "H:MM:SS" / "M:SS" elapsed-time label while a recording is
 * active. Ticks once per second; returns an empty string (and stops the
 * interval) when the recording is not active or has no start timestamp.
 *
 * Pass `isRecording` as the gate rather than inferring it so the caller can
 * distinguish paused vs. running (paused recordings freeze the timer).
 */
export function useElapsedLabel(recording: RecordingStatus, isRecording: boolean): string {
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!isRecording || !recording.started_at) {
      setElapsedSec(0);
      return;
    }
    const start = new Date(recording.started_at).getTime();
    const update = () => setElapsedSec(Math.floor((Date.now() - start) / 1000));
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [isRecording, recording.started_at]);

  return useMemo(() => {
    const h = Math.floor(elapsedSec / 3600);
    const m = Math.floor((elapsedSec % 3600) / 60);
    const s = elapsedSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }, [elapsedSec]);
}
