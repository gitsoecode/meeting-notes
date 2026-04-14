// Reproduce the exact AudioTee path used in audio-monitor.ts, and verify
// whether PCM data arrives and yields real RMS when sound plays.
import { spawn } from "node:child_process";
import { AudioTee } from "audiotee";

const SAMPLE_RATE = parseInt(process.argv[2] || "16000", 10);

function accumulateS16LE(buf, state) {
  const len = buf.length - (buf.length % 2);
  for (let i = 0; i < len; i += 2) {
    let s = buf[i] | (buf[i + 1] << 8);
    if (s & 0x8000) s |= ~0xffff;
    const sq = s * s;
    if (sq > state.peakSq) state.peakSq = sq;
    state.sumSq += sq;
    state.sampleCount += 1;
  }
}

function toDb(amp, full = 32767) {
  if (amp <= 0) return -90;
  const db = 20 * Math.log10(amp / full);
  return db < -90 ? -90 : db;
}

async function main() {
  const state = { peakSq: 0, sumSq: 0, sampleCount: 0, totalBytes: 0, chunks: 0 };

  const tee = new AudioTee({ sampleRate: SAMPLE_RATE });
  tee.on("data", (chunk) => {
    if (chunk.data) {
      state.totalBytes += chunk.data.length;
      state.chunks += 1;
      accumulateS16LE(chunk.data, state);
    }
  });
  tee.on("error", (err) => console.error("audiotee error:", err.message));

  await tee.start();
  console.log("AudioTee started at", SAMPLE_RATE, "Hz");

  // Report levels every 500 ms
  const interval = setInterval(() => {
    const peakAmp = Math.sqrt(state.peakSq);
    const rmsAmp = state.sampleCount > 0 ? Math.sqrt(state.sumSq / state.sampleCount) : 0;
    console.log(
      `chunks=${state.chunks.toString().padStart(3)} bytes=${state.totalBytes.toString().padStart(6)} peak=${toDb(peakAmp).toFixed(1).padStart(6)} dB rms=${toDb(rmsAmp).toFixed(1).padStart(6)} dB`
    );
    state.peakSq = 0;
    state.sumSq = 0;
    state.sampleCount = 0;
  }, 500);

  // Play a system sound after 1 second
  setTimeout(() => {
    console.log("\n>>> Playing /System/Library/Sounds/Glass.aiff (should see levels rise)\n");
    spawn("afplay", ["/System/Library/Sounds/Glass.aiff"], { stdio: "ignore" });
  }, 1000);

  // After 2.5s, play a longer tone via say
  setTimeout(() => {
    console.log("\n>>> Speaking 'testing one two three four five' via macOS say\n");
    spawn("say", ["testing one two three four five six seven eight nine ten"], { stdio: "ignore" });
  }, 2500);

  // Stop after 8 seconds
  setTimeout(async () => {
    clearInterval(interval);
    await tee.stop();
    console.log("\nDone. Total chunks:", state.chunks, "total bytes:", state.totalBytes);
    process.exit(0);
  }, 8000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
