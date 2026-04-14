// Exercise the full audio-monitor path (compiled) and verify it detects
// the "silently recording zeros" TCC-permission case.
import { spawn } from "node:child_process";
import { AudioTee } from "audiotee";

// Duplicated here so this script stays self-contained. Must match audio-monitor.ts.
function hasPermissionIssue(state) {
  const elapsedMs = Date.now() - state.startedAt;
  if (elapsedMs < 1500) return false;
  if (state.totalSamples < 8000) return false;
  return state.zeroSampleCount === state.totalSamples;
}

async function run() {
  const state = {
    peakSq: 0,
    zeroSampleCount: 0,
    totalSamples: 0,
    totalBytes: 0,
    startedAt: Date.now(),
  };

  const tee = new AudioTee({ sampleRate: 16000 });
  tee.on("data", (chunk) => {
    if (!chunk.data) return;
    state.totalBytes += chunk.data.length;
    const len = chunk.data.length - (chunk.data.length % 2);
    for (let i = 0; i < len; i += 2) {
      let s = chunk.data[i] | (chunk.data[i + 1] << 8);
      if (s & 0x8000) s |= ~0xffff;
      if (s === 0) state.zeroSampleCount += 1;
      state.totalSamples += 1;
      const sq = s * s;
      if (sq > state.peakSq) state.peakSq = sq;
    }
  });
  await tee.start();

  // Play sound throughout
  setTimeout(() => spawn("afplay", ["/System/Library/Sounds/Glass.aiff"], { stdio: "ignore" }), 500);
  setTimeout(() => spawn("say", ["one two three four five"], { stdio: "ignore" }), 2000);

  setTimeout(async () => {
    await tee.stop();
    const issue = hasPermissionIssue(state);
    console.log(JSON.stringify({
      totalBytes: state.totalBytes,
      totalSamples: state.totalSamples,
      zeroSampleCount: state.zeroSampleCount,
      peakAmplitude: Math.sqrt(state.peakSq),
      nonZeroPct: state.totalSamples
        ? (100 * (state.totalSamples - state.zeroSampleCount) / state.totalSamples).toFixed(2) + "%"
        : "0%",
      permissionIssue: issue,
      diagnosis: issue
        ? "TCC permission NOT granted — AudioTee is streaming silent zeros"
        : state.totalBytes > 0
          ? "TCC permission granted — real audio is being captured"
          : "No data at all — AudioTee may have failed to start",
    }, null, 2));
    process.exit(issue ? 2 : 0);
  }, 5000);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
