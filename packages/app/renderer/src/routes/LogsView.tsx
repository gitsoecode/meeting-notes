import { useEffect, useState } from "react";
import { api } from "../ipc-client";
import type { RunSummary } from "../../../shared/ipc";

type LogSource = { kind: "app" } | { kind: "run"; runFolder: string };

export function LogsView() {
  const [source, setSource] = useState<LogSource>({ kind: "app" });
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [content, setContent] = useState("");
  const [follow, setFollow] = useState(true);
  const [appPath, setAppPath] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.runs.list().then(setRuns).catch(() => {});
    api.logs.appPath().then(setAppPath).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const text =
          source.kind === "app"
            ? await api.logs.tailApp(400)
            : await api.logs.tailRun(source.runFolder, 400);
        if (!cancelled) setContent(text);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    load();
    if (!follow) return;
    const id = window.setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [source, follow]);

  return (
    <>
      <h1 className="section-title">Logs</h1>
      <p className="section-subtitle">
        {source.kind === "app"
          ? appPath || "~/.meeting-notes/app.log"
          : "Run log for selected meeting"}
      </p>

      <div className="row" style={{ marginBottom: 16 }}>
        <button
          className={source.kind === "app" ? "primary" : ""}
          onClick={() => setSource({ kind: "app" })}
        >
          App log
        </button>
        <select
          value={source.kind === "run" ? source.runFolder : ""}
          onChange={(e) => {
            if (e.target.value) setSource({ kind: "run", runFolder: e.target.value });
          }}
        >
          <option value="">Select a meeting…</option>
          {runs.map((r) => (
            <option key={r.folder_path} value={r.folder_path}>
              {r.title} — {new Date(r.started || r.date).toLocaleString()}
            </option>
          ))}
        </select>
        <div className="checkbox-row">
          <input
            type="checkbox"
            id="follow"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />
          <label htmlFor="follow" style={{ marginBottom: 0 }}>Follow</label>
        </div>
      </div>

      {error && <div className="muted" style={{ color: "var(--danger)" }}>{error}</div>}
      <pre className="log-view">{content || "(empty)"}</pre>
    </>
  );
}
