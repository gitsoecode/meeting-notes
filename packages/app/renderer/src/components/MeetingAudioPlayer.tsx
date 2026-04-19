import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Plyr from "plyr";
// Plyr's icon sprite lives at renderer/public/plyr.svg (copied from
// node_modules at build time). Loading it from the default CDN
// (https://cdn.plyr.io/3.8.4/plyr.svg) is blocked by our renderer CSP
// (connect-src 'self' only), which leaves empty square buttons.
// Relative path because Electron serves the built renderer over file://
// — absolute `/plyr.svg` resolves to the filesystem root.
const plyrIconUrl = "plyr.svg";
import { X } from "lucide-react";
import { api } from "../ipc-client";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

const PLYR_BASE_CONFIG: Plyr.Options = {
  controls: ["play", "progress", "current-time", "duration", "mute", "volume", "settings"],
  settings: ["speed"],
  speed: { selected: 1, options: [0.75, 1, 1.25, 1.5, 2] },
  keyboard: { focused: true, global: false },
  tooltips: { controls: true, seek: true },
  hideControls: false,
  resetOnEnd: true,
  // Without this, Plyr renders empty square buttons (sprite never loads).
  iconUrl: plyrIconUrl,
  // Suppresses Plyr's attempt to fetch cdn.plyr.io/static/blank.mp4 for
  // Vimeo/YouTube embed shims we never use.
  blankVideo: "",
  loadSprite: true,
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface PlaybackState {
  isOpen: boolean;
  currentTimeSec: number;
  lastSeekAt: number;
}

interface PlaybackController extends PlaybackState {
  /** Seek to `sec` and start playback. */
  seekAndPlay: (sec: number) => void;
  /** Pause, hide the pocket, and release the blob URL. */
  close: () => void;
  /** A consumer (Recording tab) can register an element as the "inline"
   *  host. While registered, the shared player chrome portals into it
   *  instead of the floating pocket. */
  setInlineHost: (el: HTMLElement | null) => void;
  combinedAudioAvailable: boolean;
}

const PlaybackContext = createContext<PlaybackController | null>(null);

export function usePlayback(): PlaybackController {
  const ctx = useContext(PlaybackContext);
  if (!ctx) throw new Error("usePlayback must be used inside a <PlaybackProvider>");
  return ctx;
}

// (PLYR_BASE_CONFIG defined above.)

// ---------------------------------------------------------------------------
// <PlaybackInlineHost>
// Mount inside the Recording tab's combined-audio slot. While mounted, the
// shared Plyr chrome renders here instead of the floating pocket.
// ---------------------------------------------------------------------------

export function PlaybackInlineHost({ className }: { className?: string }) {
  const { setInlineHost } = usePlayback();
  const [el, setEl] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    setInlineHost(el);
    return () => setInlineHost(null);
  }, [el, setInlineHost]);

  return (
    <div
      ref={setEl}
      data-testid="playback-inline-host"
      className={cn(
        "plyr-host rounded-xl border border-[var(--border-default)] bg-white p-2",
        className,
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface PlaybackProviderProps {
  runFolder: string;
  combinedAudioFileName: string | null;
  children: React.ReactNode;
}

export function PlaybackProvider({
  runFolder,
  combinedAudioFileName,
  children,
}: PlaybackProviderProps) {
  // blobUrl is the state we render into the <audio src> attribute. Once set
  // it doesn't change for the lifetime of the meeting, so Plyr's init runs
  // on an element that already has a valid source — no Plyr `source` setter
  // involved (that one destroys + recreates the audio element internally,
  // invalidating any React ref and breaking direct DOM control).
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const loadStartedRef = useRef(false);

  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const plyrRef = useRef<Plyr | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [lastSeekAt, setLastSeekAt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inlineHost, setInlineHostState] = useState<HTMLElement | null>(null);
  const [pocketBody, setPocketBody] = useState<HTMLElement | null>(null);

  // Pending seek target for calls that arrive before the audio element is
  // mounted (e.g. ?t=ms deep links from chat citations). Applied once the
  // element attaches + its source is ready.
  const pendingSeekRef = useRef<number | null>(null);

  const setInlineHost = useCallback((el: HTMLElement | null) => {
    setInlineHostState(el);
  }, []);

  const releaseSource = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setBlobUrl(null);
    loadStartedRef.current = false;
  }, []);

  // Fetch the combined blob URL as soon as the meeting provides a filename.
  // We do this proactively (not on click) because the user gesture token
  // doesn't survive the await — synchronous seekAndPlay below relies on
  // the source already being loaded.
  useEffect(() => {
    if (!combinedAudioFileName) return;
    if (loadStartedRef.current) return;
    loadStartedRef.current = true;
    setLoading(true);
    setLoadError(null);
    api.runs
      .getMediaSource(runFolder, combinedAudioFileName)
      .then((url) => {
        if (!url) {
          setLoadError("Combined audio file could not be loaded.");
          return;
        }
        blobUrlRef.current = url;
        setBlobUrl(url);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [runFolder, combinedAudioFileName]);

  // Reset blob URL when the meeting changes.
  useEffect(() => {
    return () => {
      releaseSource();
    };
  }, [runFolder, releaseSource]);

  // Plyr lifecycle per audioEl. React Portal remounts the element when the
  // target host changes (pocket ↔ inline); we treat every fresh audioEl as
  // a new Plyr instance, destroying the previous one.
  useLayoutEffect(() => {
    if (!audioEl) {
      plyrRef.current = null;
      return;
    }
    const media = audioEl as HTMLMediaElement & { plyr?: Plyr };
    const plyr = media.plyr ?? new Plyr(audioEl, PLYR_BASE_CONFIG);
    plyrRef.current = plyr;

    // Restore prior playhead if we have one (portal remount mid-session).
    const resumeAt = currentTimeSec;
    if (resumeAt > 0 && Number.isFinite(resumeAt)) {
      const restore = () => {
        try {
          audioEl.currentTime = resumeAt;
        } catch {
          /* noop */
        }
        audioEl.removeEventListener("loadedmetadata", restore);
      };
      if (audioEl.readyState >= 1) restore();
      else audioEl.addEventListener("loadedmetadata", restore);
    }

    const onTime = () => setCurrentTimeSec(audioEl.currentTime ?? 0);
    audioEl.addEventListener("timeupdate", onTime);
    return () => {
      audioEl.removeEventListener("timeupdate", onTime);
      try {
        plyr.destroy();
      } catch {
        /* noop */
      }
    };
    // `currentTimeSec` is intentionally read via closure at setup time so
    // that the resume position reflects the moment of portal remount, not
    // every subsequent time update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioEl]);

  const seekAndPlay = useCallback(
    (sec: number) => {
      // Always open the pocket so the audio chrome renders into its portal
      // target, which in turn mounts the <audio> element via React tree.
      setIsOpen(true);
      setLastSeekAt(Date.now());

      const audio = audioEl;
      if (!audio || !blobUrl) {
        // Element / source not ready yet. Stash the intent so the mount
        // effect can replay it as soon as the element attaches. This is
        // the hot path for chat-citation deep links: InitialSeek fires
        // before the blob URL has loaded.
        pendingSeekRef.current = sec;
        return;
      }

      const apply = () => {
        try {
          audio.currentTime = Math.max(
            0,
            Math.min(sec, audio.duration || sec),
          );
        } catch {
          /* noop */
        }
        setCurrentTimeSec(audio.currentTime ?? 0);
        // audio.play() must run in the same tick as the user gesture for
        // the autoplay policy — no await separates this from the click.
        const p = audio.play();
        if (p && typeof p.catch === "function") {
          p.catch(() => {
            /* autoplay rejected — user can press play */
          });
        }
      };

      if (
        audio.readyState >= 1 &&
        Number.isFinite(audio.duration) &&
        audio.duration > 0
      ) {
        apply();
      } else {
        const onReady = () => {
          audio.removeEventListener("loadedmetadata", onReady);
          audio.removeEventListener("canplay", onReady);
          apply();
        };
        audio.addEventListener("loadedmetadata", onReady, { once: true });
        audio.addEventListener("canplay", onReady, { once: true });
      }
    },
    [audioEl, blobUrl],
  );

  // Replay any pending seek once the audio element + blob URL are ready.
  // Runs whenever either dependency settles, so a deep-link seek that
  // arrived during the blob fetch finally lands without user action.
  useEffect(() => {
    if (pendingSeekRef.current == null) return;
    if (!audioEl || !blobUrl) return;
    const pending = pendingSeekRef.current;
    pendingSeekRef.current = null;
    // Fire through seekAndPlay to reuse the readyState-branch logic.
    seekAndPlay(pending);
  }, [audioEl, blobUrl, seekAndPlay]);

  const close = useCallback(() => {
    try {
      audioEl?.pause();
    } catch {
      /* noop */
    }
    setIsOpen(false);
  }, [audioEl]);

  const combinedAudioAvailable = combinedAudioFileName != null;

  const controller = useMemo<PlaybackController>(
    () => ({
      isOpen,
      currentTimeSec,
      lastSeekAt,
      seekAndPlay,
      close,
      setInlineHost,
      combinedAudioAvailable,
    }),
    [isOpen, currentTimeSec, lastSeekAt, seekAndPlay, close, setInlineHost, combinedAudioAvailable],
  );

  // The <audio> element + Plyr render once, then get portaled between hosts.
  const chrome = (
    <div className="plyr-host min-w-0 flex-1">
      {blobUrl ? (
        <audio
          ref={setAudioEl}
          src={blobUrl}
          preload="metadata"
          controls
          // `playsinline` hints to mobile Safari but has no downside elsewhere.
          playsInline
        />
      ) : (
        <div className="flex h-10 items-center px-2 text-xs text-[var(--text-secondary)]">
          {loadError ? loadError : loading ? "Loading audio…" : "Preparing player…"}
        </div>
      )}
    </div>
  );

  const preferInline = inlineHost != null;
  const pocketVisible = !preferInline && (isOpen || loadError != null);
  const portalTarget: HTMLElement | null = preferInline ? inlineHost : pocketBody;

  return (
    <PlaybackContext.Provider value={controller}>
      {children}

      <div
        data-testid="pocket-player"
        data-state={pocketVisible ? "open" : "closed"}
        aria-hidden={!pocketVisible}
        className={cn(
          "pointer-events-none fixed bottom-4 left-1/2 z-40 w-full max-w-3xl -translate-x-1/2 px-4 transition-all duration-200",
          pocketVisible
            ? "translate-y-0 opacity-100 pointer-events-auto"
            : "translate-y-4 opacity-0",
        )}
      >
        <div className="rounded-xl border border-[var(--border-default)] bg-white p-2 shadow-lg">
          <div className="flex items-center gap-2">
            <div ref={setPocketBody} className="plyr-host min-w-0 flex-1" />
            <Button
              variant="ghost"
              size="icon"
              onClick={close}
              aria-label="Close audio player"
              className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {loadError ? (
            <div className="mt-1 px-1 text-xs text-[var(--error)]">{loadError}</div>
          ) : null}
        </div>
      </div>

      {portalTarget ? createPortal(chrome, portalTarget) : null}
    </PlaybackContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// InlinePlyrAudio — standalone themed player for one-off media files that
// aren't the combined-playback target (e.g. per-channel mic.wav/system.wav
// on the Recording tab). Keeps the same Plyr look as the unified player,
// but owns its own instance — state doesn't sync with the shared one.
// ---------------------------------------------------------------------------

interface InlinePlyrAudioProps {
  src: string;
  className?: string;
}

export function InlinePlyrAudio({ src, className }: InlinePlyrAudioProps) {
  const [el, setEl] = useState<HTMLAudioElement | null>(null);

  useLayoutEffect(() => {
    if (!el) return;
    const media = el as HTMLMediaElement & { plyr?: Plyr };
    if (media.plyr) return;
    const plyr = new Plyr(el, PLYR_BASE_CONFIG);
    return () => {
      try {
        plyr.destroy();
      } catch {
        /* noop */
      }
    };
  }, [el]);

  return (
    <div className={cn("plyr-host", className)}>
      <audio ref={setEl} src={src} preload="metadata" controls playsInline />
    </div>
  );
}
