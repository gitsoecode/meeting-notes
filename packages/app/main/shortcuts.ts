import { globalShortcut } from "electron";
import {
  applyToggleShortcut,
  resolveToggleShortcut,
  type ShortcutApplyResult,
} from "./shortcuts-core.js";

let currentToggleShortcut: string | null = null;
let toggleRecordingHandler: (() => void) | null = null;

export function setToggleRecordingHandler(handler: () => void): void {
  toggleRecordingHandler = handler;
}

export function syncToggleRecordingShortcut(
  shortcut: string | null | undefined
): ShortcutApplyResult {
  if (!toggleRecordingHandler) {
    throw new Error("Toggle recording handler has not been configured.");
  }

  const result = applyToggleShortcut(
    globalShortcut,
    currentToggleShortcut,
    resolveToggleShortcut(shortcut),
    toggleRecordingHandler
  );
  currentToggleShortcut = result.activeShortcut;
  return result;
}

export function getRegisteredToggleShortcut(): string | null {
  return currentToggleShortcut;
}
