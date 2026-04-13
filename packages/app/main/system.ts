import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface HardwareInfo {
  arch: string;
  platform: NodeJS.Platform;
  totalRamGb: number;
  /** "Apple M2 Pro" / "Apple M1" / undefined on non-mac. Cosmetic only. */
  chip?: string;
  appleSilicon: boolean;
}

/**
 * Parsed macOS version (e.g. { major: 14, minor: 2 } for Sonoma 14.2).
 * Returns null on non-macOS platforms.
 */
export interface MacOsVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

let cachedMacOsVersion: MacOsVersion | null | undefined;

/**
 * Get the macOS version, or null if not on macOS.
 */
export function getMacOsVersion(): MacOsVersion | null {
  if (cachedMacOsVersion !== undefined) return cachedMacOsVersion;
  if (process.platform !== "darwin") {
    cachedMacOsVersion = null;
    return null;
  }
  const raw = os.release(); // Darwin kernel version, e.g. "23.2.0" for macOS 14.2
  // macOS version = Darwin kernel major - 9 (approximately):
  // Darwin 23.x = macOS 14.x, Darwin 24.x = macOS 15.x, etc.
  // More reliable: use sw_vers or process.getSystemVersion() in Electron
  try {
    // Electron provides process.getSystemVersion() which returns "14.2.1" etc.
    const sysVer = (process as any).getSystemVersion?.() as string | undefined;
    if (sysVer) {
      const parts = sysVer.split(".").map(Number);
      cachedMacOsVersion = {
        major: parts[0] ?? 0,
        minor: parts[1] ?? 0,
        patch: parts[2] ?? 0,
        raw: sysVer,
      };
      return cachedMacOsVersion;
    }
  } catch {
    // Not in Electron context
  }
  // Fallback: parse os.release() Darwin version
  const parts = raw.split(".").map(Number);
  const darwinMajor = parts[0] ?? 0;
  cachedMacOsVersion = {
    major: darwinMajor >= 20 ? darwinMajor - 9 : 10,
    minor: parts[1] ?? 0,
    patch: parts[2] ?? 0,
    raw,
  };
  return cachedMacOsVersion;
}

/**
 * Returns true if the system supports automatic system audio capture
 * via CoreAudio taps (requires macOS 14.2+).
 */
export function isSystemAudioSupported(): boolean {
  const ver = getMacOsVersion();
  if (!ver) return false;
  return ver.major > 14 || (ver.major === 14 && ver.minor >= 2);
}

let cached: HardwareInfo | null = null;

export async function detectHardware(): Promise<HardwareInfo> {
  if (cached) return cached;
  const platform = process.platform;
  const arch = os.arch();
  const totalRamGb = Math.round(os.totalmem() / 1e9);
  const appleSilicon = platform === "darwin" && arch === "arm64";
  let chip: string | undefined;
  if (platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("/usr/sbin/sysctl", [
        "-n",
        "machdep.cpu.brand_string",
      ]);
      chip = stdout.trim() || undefined;
    } catch {
      // sysctl missing or failed — non-fatal, the field is cosmetic.
    }
  }
  cached = { arch, platform, totalRamGb, chip, appleSilicon };
  return cached;
}
