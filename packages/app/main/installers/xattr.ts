/**
 * Best-effort macOS Gatekeeper-quarantine xattr stripper for freshly
 * installed binaries and runtime trees.
 *
 * Why this exists: on macOS Sequoia (15+) Gatekeeper is more aggressive
 * about blocking first-launch of binaries that aren't signed by the
 * current user, and a `com.apple.quarantine` xattr can wedge the daemon
 * spawn that follows the wizard's Ollama install. Files we wrote via
 * `node:fs` streams typically don't carry the xattr in the first place
 * (LaunchServices isn't involved), so this is best-effort cleanup —
 * `xattr -dr` exits non-zero when there's nothing to strip and that's
 * fine.
 *
 * No-op on non-darwin. Pure (no Electron / `paths` imports), so it's
 * directly importable from `node:test` without a packaged Electron app.
 */
import { spawn } from "node:child_process";

export async function stripQuarantineXattr(target: string): Promise<void> {
  if (process.platform !== "darwin") return;
  await new Promise<void>((resolve) => {
    const child = spawn(
      "xattr",
      ["-dr", "com.apple.quarantine", target],
      { shell: false, stdio: "ignore" }
    );
    child.on("error", () => resolve());
    child.on("exit", () => resolve());
  });
}
