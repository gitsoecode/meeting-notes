import { FfmpegRecorder } from "@meeting-notes/engine";

let cachedDevices: string[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000;

export async function getCachedAudioDevices(): Promise<string[]> {
  if (cachedDevices && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedDevices;
  }
  const recorder = new FfmpegRecorder();
  cachedDevices = await recorder.listAudioDevices();
  cacheTimestamp = Date.now();
  return cachedDevices;
}

export function invalidateDeviceCache(): void {
  cachedDevices = null;
  cacheTimestamp = 0;
}
