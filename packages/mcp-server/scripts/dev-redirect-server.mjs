#!/usr/bin/env node
/**
 * Local stand-in for https://gistlist.app/open during development.
 *
 * Claude Desktop sanitizes non-http URL schemes out of rendered markdown,
 * so citation links have to look like `https://gistlist.app/open?m=...`
 * even though the actual handler is a local Electron app. The marketing
 * site hosts an HTML page at that URL which bounces to `gistlist://`.
 *
 * Until that page is deployed, run this script to serve the same HTML
 * from http://localhost:3939/open, then set `GISTLIST_OPEN_URL_BASE`
 * when installing the dev MCP. End-to-end clicks in Claude Desktop will
 * route through localhost → gistlist:// → the installed Gistlist app.
 *
 * Usage:
 *   node scripts/dev-redirect-server.mjs            # defaults to port 3939
 *   PORT=4000 node scripts/dev-redirect-server.mjs  # custom port
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const HTML_PATH = path.join(REPO_ROOT, "docs/website/open-redirect.html");
const PORT = Number(process.env.PORT) || 3939;

const html = readFileSync(HTML_PATH, "utf-8");

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname === "/open" || url.pathname === "/open/") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(html);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found — use /open?m=<run_id>&t=<ms>\n");
});

// Bind to loopback only — this is a dev helper, not a public service.
server.listen(PORT, "127.0.0.1", () => {
  console.log(`[dev-redirect] serving ${HTML_PATH}`);
  console.log(`[dev-redirect] http://localhost:${PORT}/open  (GISTLIST_OPEN_URL_BASE)`);
  console.log(`[dev-redirect] ctrl-c to stop`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
