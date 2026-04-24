#!/usr/bin/env node
/**
 * Writes a `gistlist-dev` MCP entry into Claude Desktop's config pointing at
 * this repo's `dist/server.js`, spawned via the repo's Electron binary with
 * `ELECTRON_RUN_AS_NODE=1`. The packaged app's "Install" button does the
 * same thing pointing at its bundled resources instead — see
 * packages/app/main/integrations.ts.
 *
 * Using the repo's Electron (not system node) guarantees the same ABI that
 * better-sqlite3 was rebuilt for, so native module loading works without the
 * prebuild swap machinery the old .mcpb bundler needed.
 *
 * Idempotent: re-running overwrites an existing `gistlist-dev` entry.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLAUDE_CONFIG_PATH,
  LEGACY_MCPB_DIR,
  readConfig,
  removeLegacyMcpb,
  writeConfig,
} from "./_claude-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(PKG_ROOT, "../..");

const SERVER_JS = path.join(PKG_ROOT, "dist/server.js");
const ELECTRON_BIN = path.join(
  REPO_ROOT,
  "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
);

function die(msg) {
  console.error(`[install-claude-dev] ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(SERVER_JS)) {
  die(
    `${SERVER_JS} is missing. Run \`npm run build --workspace @gistlist/mcp-server\` first.`
  );
}
if (!fs.existsSync(ELECTRON_BIN)) {
  die(
    `Electron binary not found at ${ELECTRON_BIN}. ` +
      `Run \`npm install\` at the repo root to fetch it.`
  );
}

const config = readConfig();
config.mcpServers = config.mcpServers ?? {};

const existed = Object.prototype.hasOwnProperty.call(
  config.mcpServers,
  "gistlist-dev"
);

config.mcpServers["gistlist-dev"] = {
  command: ELECTRON_BIN,
  args: [SERVER_JS],
  env: {
    ELECTRON_RUN_AS_NODE: "1",
    GISTLIST_CONFIG_DIR: path.join(os.homedir(), ".gistlist"),
    OLLAMA_BASE_URL: "http://127.0.0.1:11434",
  },
};

writeConfig(config);

const removedLegacy = removeLegacyMcpb();

console.log(
  `[install-claude-dev] ${existed ? "updated" : "added"} "gistlist-dev" entry in ${CLAUDE_CONFIG_PATH}`
);
if (removedLegacy) {
  console.log(
    `[install-claude-dev] removed legacy .mcpb install at ${LEGACY_MCPB_DIR}`
  );
}
console.log(
  `[install-claude-dev] restart Claude Desktop, then ask it "list my recent meetings" to test.`
);
