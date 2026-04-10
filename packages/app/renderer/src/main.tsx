import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

function reportRendererError(payload: {
  source: string;
  message: string;
  stack?: string;
  detail?: string;
}) {
  try {
    void window.api.logs.reportRendererError({
      ...payload,
      href: window.location.href,
      userAgent: window.navigator.userAgent,
    });
  } catch {
    // Last-resort logging should never throw.
  }
}

window.addEventListener("error", (event) => {
  reportRendererError({
    source: "window.error",
    message: event.message || "Unknown renderer error",
    stack: event.error instanceof Error ? event.error.stack : undefined,
    detail: event.filename
      ? `${event.filename}:${event.lineno}:${event.colno}`
      : undefined,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  reportRendererError({
    source: "window.unhandledrejection",
    message:
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "Unhandled promise rejection",
    stack: reason instanceof Error ? reason.stack : undefined,
    detail: safeSerialize(reason),
  });
});

class RendererErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    reportRendererError({
      source: "react.error-boundary",
      message: error.message,
      stack: error.stack,
      detail: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[var(--bg-primary)] px-6 py-10">
          <div className="mx-auto max-w-2xl rounded-2xl border border-[rgba(185,28,28,0.16)] bg-white p-6 shadow-[0_10px_30px_rgba(31,45,28,0.08)]">
            <div className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--error)]">
              Renderer error
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">
              The app hit a screen-level error
            </h1>
            <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
              We logged the crash details to the app log so it is easier to trace. Please reload the
              window or restart the app.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function safeSerialize(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");
createRoot(rootEl).render(
  <React.StrictMode>
    <RendererErrorBoundary>
      <App />
    </RendererErrorBoundary>
  </React.StrictMode>
);
