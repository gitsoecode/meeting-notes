/**
 * Validated resolution for engine-injectable binaries — convenience
 * wrapper around the pure `validateResolvedBinary` helper.
 *
 * Both app startup (`packages/app/main/index.ts`) and the `deps:check`
 * IPC handler need to "find a binary AND inject its path into the
 * engine," but only if the binary actually works on this host. A stale
 * x64 ffmpeg in `<binDir>` on an arm64 Mac without Rosetta would
 * EBADARCH the moment the engine tries to spawn it — so resolution-
 * without-validation is unsafe at every entry point.
 *
 * The pure validation lives in `validate-binary.ts` so unit tests can
 * import it without dragging in `bundled.ts` → `paths.ts` → `electron`.
 * This file just adds the resolveBin + manifest-lookup glue that
 * production code uses.
 *
 * Note: when validation fails, this helper returns `injectable: false`
 * but does NOT continue past the bad app-managed binary to find a
 * system fallback. Callers that want PATH fallback respect
 * `injectable === false` by simply not injecting — the engine then
 * runs against bare `ffmpeg`/`ffprobe`/`python3` via the OS PATH that
 * the packaged app was launched with.
 */
import { resolveBin } from "../bundled.js";
import { findManifestEntry, type ToolName } from "./manifest.js";
import {
  validateResolvedBinary,
  type ValidatedResolution,
  type Verified,
} from "./validate-binary.js";

export type { ValidatedResolution, Verified };

export async function resolveAndValidate(
  tool: ToolName
): Promise<ValidatedResolution> {
  const resolved = await resolveBin(tool);
  if (!resolved) {
    return {
      path: null,
      source: null,
      version: null,
      verified: "missing",
      injectable: false,
    };
  }
  return validateResolvedBinary(tool, resolved, findManifestEntry(tool));
}
