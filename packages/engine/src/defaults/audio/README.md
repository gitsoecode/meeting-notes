# Bundled speech-denoise model

This directory ships the RNNoise model used by the engine's speech-focused
mic cleanup pass (ffmpeg's `arnndn` filter).

## Files

- `arnndn.rnnn` — RNNoise weights in ffmpeg's `arnndn` format. Source: the
  `somnolent-hogwash-2018-09-01/sh.rnnn` model from
  https://github.com/GregorR/rnnoise-models — a general-speech model widely
  used as the default weight file for ffmpeg's `arnndn` filter.
- `LICENSE.rnnoise-model` — upstream BSD-2-Clause license (© Mozilla /
  Xiph.Org / Jean-Marc Valin) covering the model weights. The model is
  redistributed unmodified under its original license terms, independent of
  the repository-wide FSL-1.1-ALv2 license that governs the rest of this
  source tree.

## Resolution

`resolveArnndnModelPath()` in `../../core/audio.ts` looks for this file at:

1. `process.env.MEETING_NOTES_ARNNDN_MODEL` (override)
2. `<engine>/dist/defaults/audio/arnndn.rnnn` (built output)
3. `<engine>/src/defaults/audio/arnndn.rnnn` (dev tree)

The engine's `build` script copies `src/defaults/` to `dist/defaults/` so the
shipped package includes the model.

If the file is missing at runtime, mic cleanup falls back to the ffmpeg-only
denoise chain and logs `cleanupQuality: "ffmpeg-fallback"`. That is a
degraded mode — callers should treat the presence of this file as required
for the normal speech-cleanup path.
