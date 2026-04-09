import { DEFAULT_CONFIG } from "@meeting-notes/engine";

export interface ShortcutRegistry {
  register: (shortcut: string, handler: () => void) => boolean;
  unregister: (shortcut: string) => void;
}

export interface ShortcutApplyResult {
  ok: boolean;
  activeShortcut: string | null;
}

export function resolveToggleShortcut(shortcut: string | null | undefined): string {
  const candidate = shortcut?.trim();
  return candidate || DEFAULT_CONFIG.shortcuts.toggle_recording;
}

export function applyToggleShortcut(
  registry: ShortcutRegistry,
  currentShortcut: string | null,
  nextShortcut: string,
  handler: () => void
): ShortcutApplyResult {
  if (currentShortcut) {
    registry.unregister(currentShortcut);
  }

  if (registry.register(nextShortcut, handler)) {
    return { ok: true, activeShortcut: nextShortcut };
  }

  if (currentShortcut && currentShortcut !== nextShortcut && registry.register(currentShortcut, handler)) {
    return { ok: false, activeShortcut: currentShortcut };
  }

  return { ok: false, activeShortcut: null };
}
