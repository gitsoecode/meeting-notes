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

export type ToolName = "ffmpeg" | "ffprobe" | "ollama" | "whisper-cli" | "python";
export type ArchTag = "arm64" | "x64" | "universal";
export type ArchiveType = "tgz" | "zip" | "raw";
export type SignatureCheckPolicy = "codesign-verify" | "none";

/**
 * How the installer materializes the binary on disk.
 *
 *  - "single-binary": archive contains exactly one executable. After
 *    extract + verify, atomically rename it to `<binDir>/<tool>`. The
 *    resolver finds it at that direct path.
 *
 *  - "preserve-tree": archive contains an executable PLUS sibling
 *    libraries the binary dlopen's at runtime (dylibs, .so files,
 *    helper binaries). After extract, the entire extraction tree is
 *    moved to `<binDir>/<tool>-runtime/` and a symlink at
 *    `<binDir>/<tool>` points at the executable inside the tree —
 *    so the resolver still sees the canonical `<binDir>/<tool>`
 *    path but spawn() resolves runtime deps from the sibling dir.
 */
export type InstallLayout = "single-binary" | "preserve-tree";

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
  installLayout: InstallLayout;
  /**
   * Free-form note about quirks the wizard should surface to users.
   * Today the only consumer is the Apple-Silicon-via-Rosetta case
   * for ffmpeg ("first run on Apple Silicon will prompt for a one-
   * time Rosetta install"). Surfaced in the wizard UI as small text.
   */
  notes?: string;
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
 * Manifest entries — pinned to specific (version, url, sha256) tuples.
 * Bumping any of these requires re-running `scripts/verify-manifest.mjs`
 * to confirm the SHA-256 still matches the bytes at the URL.
 *
 * whisper-cli is intentionally absent: whisper.cpp v1.8.4 ships only
 * Windows / Linux / iOS xcframework binaries — no signed macOS CLI in
 * Releases — so we hide the "whisper-local" ASR option from the wizard
 * for first beta and track it as a follow-up. See data-directory.md.
 */
export const TOOL_MANIFEST: ToolManifestEntry[] = [
  {
    // arm64 ffmpeg — used on Apple Silicon. Sourced from osxexperts.net
    // because evermeet.cx (our x64 source) does not ship arm64 builds.
    // The osxexperts maintainer's published page hash drifts independently
    // of the bytes (the hash next to the download link is sometimes from
    // a prior build). We pin the bytes-on-disk SHA-256 we observed at
    // download time; verify-manifest catches any future byte drift on
    // re-fetch.
    //
    // License is GPL-3.0-or-later — this build is configured with
    // `--enable-gpl --enable-libx264 --enable-libx265` (visible in
    // `ffmpeg -version`'s configuration line). The x64 entry below is
    // LGPL because evermeet ships a no-GPL build; we accept the license
    // asymmetry per arch because no LGPL arm64 macOS prebuilt exists in
    // a comparable trust-and-distribution posture today. See
    // docs/private_plans/privacy-posture-analysis.md for the
    // distribution analysis. The app spawns ffmpeg as a separate
    // subprocess (no linking), so GPL-binary distribution alongside
    // FSL-1.1-ALv2 source is fine.
    //
    // The osxexperts binaries are ad-hoc (linker) signed and pass our
    // strict `codesign --verify --deep --strict` policy.
    tool: "ffmpeg",
    version: "8.1",
    platform: "darwin",
    arch: "arm64",
    minMacOS: "12.0",
    url: "https://www.osxexperts.net/ffmpeg81arm.zip",
    sha256:
      "ebb82529562b71170807bbc6b0e7eb4f0b13af8cbb0e085bb9e8f6fe709598ad",
    archiveType: "zip",
    binaryPathInArchive: "ffmpeg",
    installLayout: "single-binary",
    signatureCheck: "codesign-verify",
    license: {
      spdx: "GPL-3.0-or-later",
      url: "https://www.ffmpeg.org/legal.html",
      buildVariant:
        "osxexperts.net static GPL build for Apple Silicon (--enable-gpl --enable-libx264 --enable-libx265, ad-hoc signed, ~22 MB zip → ~52 MB binary)",
    },
    verifyExec: { args: ["-version"], expectExit: 0, timeoutMs: 5000 },
    notes:
      "Native arm64 build for Apple Silicon. macOS 12.0+ (LC_BUILD_VERSION minOS).",
  },
  {
    tool: "ffmpeg",
    version: "7.1.1",
    platform: "darwin",
    arch: "x64",
    minMacOS: "11.0",
    url: "https://evermeet.cx/ffmpeg/ffmpeg-7.1.1.zip",
    sha256:
      "8d7917c1cebd7a29e68c0a0a6cc4ecc3fe05c7fffed958636c7018b319afdda4",
    archiveType: "zip",
    binaryPathInArchive: "ffmpeg",
    installLayout: "single-binary",
    // evermeet.cx ships unsigned static builds — SHA-256 is the trust
    // anchor. The app itself is hardenedRuntime + notarized, so spawning
    // an unsigned child via execFile is fine (would only matter under
    // the library-validation entitlement, which we don't claim).
    signatureCheck: "none",
    license: {
      spdx: "LGPL-2.1-or-later",
      url: "https://www.ffmpeg.org/legal.html",
      buildVariant:
        "evermeet.cx LGPL static build (no GPL components, ~25 MB zip → 79 MB binary)",
    },
    verifyExec: { args: ["-version"], expectExit: 0, timeoutMs: 5000 },
    notes:
      "x86_64 build — used on Intel Macs only. Apple Silicon resolves the arm64 entry above; Rosetta is no longer the default path for ffmpeg on Apple Silicon.",
  },
  {
    // arm64 ffprobe — paired with arm64 ffmpeg above. Same osxexperts
    // upstream, same trust posture (page hash drifts, we pin observed
    // bytes), same GPL build flags, same ad-hoc signature.
    tool: "ffprobe",
    version: "8.1",
    platform: "darwin",
    arch: "arm64",
    minMacOS: "12.0",
    url: "https://www.osxexperts.net/ffprobe81arm.zip",
    sha256:
      "a6640a77d38a6f0527c5b597e599cb36a3427a6931444ed80bc62542421950a1",
    archiveType: "zip",
    binaryPathInArchive: "ffprobe",
    installLayout: "single-binary",
    signatureCheck: "codesign-verify",
    license: {
      spdx: "GPL-3.0-or-later",
      url: "https://www.ffmpeg.org/legal.html",
      buildVariant:
        "osxexperts.net static GPL build for Apple Silicon (paired with ffmpeg above, ad-hoc signed, ~22 MB zip → ~52 MB binary)",
    },
    verifyExec: { args: ["-version"], expectExit: 0, timeoutMs: 5000 },
    notes:
      "Native arm64 build for Apple Silicon. Installed as a side effect of installDep('ffmpeg') — never user-installable on its own.",
  },
  {
    // Paired with ffmpeg above. The wizard installs both as a unit when
    // the user clicks "Install ffmpeg" — the System Health row says
    // "ffmpeg" but its ok-status reflects both binaries because the
    // engine's audio.ts uses ffprobe for duration / stream info and
    // would silently fail if ffprobe were missing.
    tool: "ffprobe",
    version: "7.1.1",
    platform: "darwin",
    arch: "x64",
    minMacOS: "11.0",
    url: "https://evermeet.cx/ffmpeg/ffprobe-7.1.1.zip",
    sha256:
      "5a0a77d5e0c689f7b577788e286dd46b2c6120babd14301cce7a79fcfd3f7d28",
    archiveType: "zip",
    binaryPathInArchive: "ffprobe",
    installLayout: "single-binary",
    signatureCheck: "none",
    license: {
      spdx: "LGPL-2.1-or-later",
      url: "https://www.ffmpeg.org/legal.html",
      buildVariant:
        "evermeet.cx LGPL static build (no GPL components, ~25 MB zip → 79 MB binary)",
    },
    verifyExec: { args: ["-version"], expectExit: 0, timeoutMs: 5000 },
    notes:
      "x86_64 build — used on Intel Macs only. Apple Silicon resolves the arm64 entry above. Installed as a side effect of installDep('ffmpeg') — never user-installable on its own.",
  },
  {
    // App-managed Python runtime, used as a sub-step of the Parakeet
    // (Apple-Silicon-only ASR) install chain. Built by Astral's
    // python-build-standalone project: pinned per-arch, signed/relocatable
    // tarball with a portable layout. We extract the whole `python/`
    // tree under <binDir>/python-runtime/ and symlink <binDir>/python at
    // python-runtime/python/bin/python3.
    //
    // Apple-Silicon-only by design: Parakeet is the only consumer and
    // mlx-audio requires MLX, which is Apple-Silicon-only. If a future
    // feature genuinely needs Python on Intel, add an x64 entry then.
    //
    // Trust model: SHA-256 only. PBS binaries aren't notarized in a way
    // that maps onto the existing codesign-verify path; same posture as
    // the evermeet ffmpeg builds.
    tool: "python",
    version: "3.12.13",
    platform: "darwin",
    arch: "arm64",
    minMacOS: "11.0",
    url: "https://github.com/astral-sh/python-build-standalone/releases/download/20260414/cpython-3.12.13%2B20260414-aarch64-apple-darwin-install_only.tar.gz",
    sha256:
      "8966b2bcd9fa03ba22c080ad15a86bc12e41a00122b16f4b3740e302261124d9",
    archiveType: "tgz",
    binaryPathInArchive: "python/bin/python3",
    installLayout: "preserve-tree",
    signatureCheck: "none",
    license: {
      spdx: "PSF-2.0",
      url: "https://docs.python.org/3/license.html",
      buildVariant:
        "python-build-standalone CPython 3.12.13 (release 20260414, aarch64-apple-darwin install_only)",
    },
    verifyExec: { args: ["-V"], expectExit: 0, timeoutMs: 5000 },
    notes:
      "Internal sub-step of the Parakeet install chain. Apple-Silicon-only — there is no Intel x64 entry because MLX (and therefore mlx-audio) is Apple Silicon-only.",
  },
  {
    tool: "ollama",
    version: "0.21.2",
    platform: "darwin",
    arch: "universal",
    minMacOS: "12.0",
    url: "https://github.com/ollama/ollama/releases/download/v0.21.2/ollama-darwin.tgz",
    sha256:
      "f14bb761dc3ef251a68081b4888920c187abe3ed53483db813ee8fb9c0a1af3e",
    archiveType: "tgz",
    binaryPathInArchive: "ollama",
    // The tarball ships `ollama` plus ~14 sibling .so/.dylib files the
    // binary dlopen's at runtime (libggml-cpu-* CPU variants, etc.).
    // We can't atomic-rename just the binary — dyld won't find its
    // siblings. Preserve-tree layout extracts the whole archive into
    // `<binDir>/ollama-runtime/` and symlinks the canonical
    // `<binDir>/ollama` at the executable inside.
    installLayout: "preserve-tree",
    signatureCheck: "codesign-verify",
    license: {
      spdx: "MIT",
      url: "https://github.com/ollama/ollama/blob/main/LICENSE",
    },
    verifyExec: { args: ["--version"], expectExit: 0, timeoutMs: 10000 },
  },
];

/**
 * Look up the manifest entry for a (tool, arch) pair.
 *
 * Lookup order:
 *   1. Exact arch match (arm64 → arm64 entry, x64 → x64 entry).
 *   2. Universal entry for the tool.
 *   3. **Rosetta fallback**: on arm64, if no arm64 or universal entry
 *      exists, fall back to the x64 entry. macOS auto-installs Rosetta 2
 *      on first invocation of an x86_64 binary, so the binary still
 *      runs (a few seconds slower the very first time). The entry's
 *      `notes` field surfaces the Rosetta caveat in the wizard UI.
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

  // 1. Exact arch
  const exact = TOOL_MANIFEST.find((e) => e.tool === tool && e.arch === archTag);
  if (exact) return exact;

  // 2. Universal
  const universal = TOOL_MANIFEST.find(
    (e) => e.tool === tool && e.arch === "universal"
  );
  if (universal) return universal;

  // 3. Rosetta fallback (arm64 only)
  if (archTag === "arm64") {
    const x64 = TOOL_MANIFEST.find((e) => e.tool === tool && e.arch === "x64");
    if (x64) return x64;
  }

  return null;
}
