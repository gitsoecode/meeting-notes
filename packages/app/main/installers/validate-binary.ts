/**
 * Pure (electron-free) validation of an already-resolved binary.
 *
 * Split out from `validated-resolve.ts` so the unit test suite in
 * `packages/app/test/*.test.mjs` can import this without dragging in
 * `bundled.ts` → `paths.ts` → `electron`. The convenience wrapper that
 * looks up the resolver lives in `validated-resolve.ts` and is what
 * production code calls; tests import this module directly and pass
 * synthetic `{path, source}` inputs.
 *
 * Validation rules (mirror the production policy):
 *   - System-PATH binaries: never spawn (Phase 2 — would risk macOS
 *     CLT install on /usr/bin/python3). Marked `system-unverified`,
 *     still injectable (engine accepts the system-path risk).
 *   - App-managed binaries: arch via `isHostArchBinary`, then verifyExec
 *     via the manifest's policy. Both must pass to be injectable.
 */
import { runVerifyExec } from "./verifyExec.js";
import { isHostArchBinary } from "./arch.js";
import type { ToolManifestEntry, ToolName } from "./manifest.js";

export type Verified =
  | "verified"
  | "system-bundled"
  | "system-unverified"
  | "missing";

export interface ValidatedResolution {
  path: string | null;
  source: "app-installed" | "bundled" | "system" | null;
  version: string | null;
  verified: Verified;
  injectable: boolean;
}

export interface ResolvedBinary {
  path: string;
  source: "app-installed" | "bundled" | "system";
}

/**
 * Try to extract a version string from `verifyExec` output. Generic
 * pattern that works for ffmpeg / ffprobe / Python / Ollama. Returns
 * null when nothing matches.
 */
export function parseVersion(tool: ToolName, output: string): string | null {
  const patterns: RegExp[] = [
    new RegExp(`${tool} version (\\S+)`, "i"),
    /Python (\S+)/,
    /(\d+\.\d+\.\d+\S*)/,
  ];
  for (const re of patterns) {
    const m = output.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

/**
 * Validate an already-resolved binary. Pure function — no resolveBin,
 * no electron, no manifest lookup. Callers (production: validated-
 * resolve.ts; tests: directly) pass the resolved info plus the
 * manifest entry (or null when the tool isn't manifest-managed).
 */
export async function validateResolvedBinary(
  tool: ToolName,
  resolved: ResolvedBinary,
  manifestEntry: ToolManifestEntry | null
): Promise<ValidatedResolution> {
  if (resolved.source !== "app-installed" && resolved.source !== "bundled") {
    // System-PATH: don't spawn. Engine accepts the system-path risk.
    return {
      path: resolved.path,
      source: resolved.source,
      version: null,
      verified: "system-unverified",
      injectable: true,
    };
  }

  const archOk = await isHostArchBinary(resolved.path);
  if (!archOk) {
    return {
      path: resolved.path,
      source: resolved.source,
      version: null,
      verified: "system-unverified",
      injectable: false,
    };
  }

  if (!manifestEntry) {
    // Arch matches but no manifest entry to drive verifyExec. Trust
    // the arch check and let the engine try; this branch is unreachable
    // for tools we manage (would be a manifest-coverage bug).
    return {
      path: resolved.path,
      source: resolved.source,
      version: null,
      verified: "verified",
      injectable: true,
    };
  }

  let result;
  try {
    result = await runVerifyExec(resolved.path, manifestEntry.verifyExec);
  } catch {
    return {
      path: resolved.path,
      source: resolved.source,
      version: null,
      verified: "system-unverified",
      injectable: false,
    };
  }
  if (!result.ok) {
    return {
      path: resolved.path,
      source: resolved.source,
      version: null,
      verified: "system-unverified",
      injectable: false,
    };
  }

  return {
    path: resolved.path,
    source: resolved.source,
    version: parseVersion(tool, result.output),
    verified: "verified",
    injectable: true,
  };
}
