import type { MeetingNotesApi } from "../../shared/ipc";

/**
 * Thin wrapper around `window.api` that the main process exposes via the
 * preload contextBridge. Centralising access here gives us one place to
 * handle the "api not present" case during Vite dev when the renderer is
 * occasionally loaded outside Electron for quick visual checks.
 */
export const api: MeetingNotesApi = window.api;

export type { MeetingNotesApi };
