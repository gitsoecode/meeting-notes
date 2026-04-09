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
