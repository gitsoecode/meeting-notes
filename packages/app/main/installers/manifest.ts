/**
 * Dependency manifest — the single source of truth for what binaries
 * the setup wizard installs and where to fetch them from.
 *
 * Editing this file is the *only* way to bump a tool version. Pinned
 * URLs (no "latest"), pinned SHA-256, explicit license / arch /
 * minMacOS — every field is a deliberate decision.
 *
 * Companion: scripts/verify-manifest.mjs fetches each url, hashes the
 * bytes, and asserts the committed sha256 matches. Any version bump
 * that forgets to update the hash fails the check before merge.
 */

export type ToolName = "ffmpeg" | "ollama" | "whisper-cli";
export type ArchTag = "arm64" | "x64" | "universal";
export type ArchiveType = "tgz" | "zip" | "raw";
export type SignatureCheckPolicy = "codesign-verify" | "none";

export interface ToolLicense {
  /** SPDX identifier (e.g., "LGPL-2.1-or-later", "MIT", "Apache-2.0"). */
  spdx: string;
  /** Public link to the license text, surfaced in the Licenses screen. */
  url: string;
  /**
   * Free-form note about the specific build variant — e.g., "LGPL-2.1
   * static build from evermeet.cx" — recorded so the licenses screen
   * can be precise about exactly what variant was downloaded.
   */
  buildVariant?: string;
}

export interface VerifyExecPolicy {
  /** Args passed to the binary post-install (typically `["--version"]`). */
  args: string[];
  /** Expected exit code. Anything else is treated as a failed install. */
  expectExit: number;
  /** Hard timeout — hangs are treated as failure, with stderr captured. */
  timeoutMs: number;
}

export interface ToolManifestEntry {
  tool: ToolName;
  /** Human-readable version, e.g. "7.1.1" — referenced in UI and logs. */
  version: string;
  platform: "darwin";
  arch: ArchTag;
  /**
   * Minimum macOS version this binary supports. Must match the app's
   * declared support matrix — the resolver does not silently raise the
   * floor. See docs/data-directory.md for the current matrix.
   */
  minMacOS: string;
  /** Pinned download URL. Never floating "latest" or a redirector. */
  url: string;
  /** Hex-encoded SHA-256 of the bytes at `url`. Verified post-download. */
  sha256: string;
  archiveType: ArchiveType;
  /**
   * Path within the extracted archive that points at the executable
   * we want to install. Empty string for `archiveType: "raw"` — in
   * that case the download itself is the binary.
   */
  binaryPathInArchive: string;
  /**
   * "codesign-verify" runs `codesign --verify --deep --strict` against
   * the extracted binary before atomic-rename into binDir(). "none"
   * means we accept SHA-256 as the sole trust anchor (used for tools
   * that ship unsigned, like Ollama's CLI tarball).
   */
  signatureCheck: SignatureCheckPolicy;
  license: ToolLicense;
  verifyExec: VerifyExecPolicy;
}

/**
 * Manifest entries — populated incrementally as Phase 2 lands each tool.
 * Empty by design at the foundation phase: the resolver, IPC, download
 * helper, and verifier land first against an empty manifest, then each
 * binary's entry is added with its own commit so a single `git log` per
 * tool tells you exactly when its URL/hash/license was set.
 */
export const TOOL_MANIFEST: ToolManifestEntry[] = [];

/**
 * Look up the manifest entry for a (tool, arch) pair.
 *
 * - Exact arch match preferred (e.g., `arm64` matches an arm64 entry).
 * - Falls back to a `universal` entry when one exists.
 * - Returns null when the manifest has no coverage for this tool yet
 *   (expected during Phase 0/1 before installers are added).
 *
 * Only darwin arm64 / darwin x64 are supported — other archs return
 * null. The wizard surfaces this as "Unsupported architecture" rather
 * than attempting an install.
 */
export function findManifestEntry(
  tool: ToolName,
  arch: NodeJS.Architecture = process.arch
): ToolManifestEntry | null {
  const archTag: ArchTag | null =
    arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : null;
  if (archTag === null) return null;

  return (
    TOOL_MANIFEST.find((e) => e.tool === tool && e.arch === archTag) ??
    TOOL_MANIFEST.find((e) => e.tool === tool && e.arch === "universal") ??
    null
  );
}
