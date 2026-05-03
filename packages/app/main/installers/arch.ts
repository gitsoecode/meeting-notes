/**
 * Mach-O architecture validation for installed binaries.
 *
 * Used by `isPinnedVersionInstalled` (install-tool.ts) and the deps:check
 * IPC handler to confirm that an on-disk binary's CPU type matches the
 * host's Node `process.arch`. This catches the failure mode where an
 * old wizard install left an x86_64 binary on disk and a fresh arm64
 * macOS (or UTM guest without Rosetta) cannot spawn it — the kernel
 * returns EBADARCH (libuv -86) immediately.
 *
 * Implementation uses the absolute path `/usr/bin/file -bL` rather than
 * PATH `file`. The `-L` flag follows symlinks so preserve-tree installs
 * (Python: `<binDir>/python` → `<binDir>/python-runtime/python/bin/python3`)
 * report the target binary's arch, not the symlink's.
 *
 * Accepts both thin Mach-O (one architecture, must match `expectedArch`)
 * and universal Mach-O (multiple architectures, must contain `expectedArch`).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Map Node's `process.arch` to the Mach-O architecture token. */
export function expectedMachOArch(
  hostArch: NodeJS.Architecture = process.arch
): "arm64" | "x86_64" | null {
  if (hostArch === "arm64") return "arm64";
  if (hostArch === "x64") return "x86_64";
  return null;
}

/**
 * Inspect `binaryPath` with `/usr/bin/file -bL` and return whether its
 * Mach-O arch matches the host. Returns `false` for any unexpected
 * output, missing file, or sub-process error — the caller treats false
 * as "this binary won't run, reinstall."
 */
export async function isHostArchBinary(binaryPath: string): Promise<boolean> {
  const expected = expectedMachOArch();
  if (!expected) return false;
  let stdout: string;
  try {
    const result = await execFileAsync("/usr/bin/file", ["-bL", binaryPath]);
    stdout = result.stdout;
  } catch {
    return false;
  }
  // Thin Mach-O example: "Mach-O 64-bit executable arm64\n"
  // Universal example: "Mach-O universal binary with 2 architectures: [x86_64:Mach-O ...] [arm64:Mach-O ...]\n"
  if (/^Mach-O universal binary/.test(stdout)) {
    return stdout.includes(`[${expected}:`) || stdout.includes(` ${expected} `);
  }
  if (/^Mach-O .* executable /.test(stdout)) {
    return stdout.trim().endsWith(expected);
  }
  return false;
}
