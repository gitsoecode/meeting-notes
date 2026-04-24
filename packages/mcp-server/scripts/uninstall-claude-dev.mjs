#!/usr/bin/env node
/**
 * Removes the `gistlist-dev` entry from Claude Desktop's config. Safe to run
 * if the entry doesn't exist — prints a note and exits 0.
 */
import { CLAUDE_CONFIG_PATH, readConfig, writeConfig } from "./_claude-config.mjs";

const config = readConfig();
if (!config.mcpServers || !config.mcpServers["gistlist-dev"]) {
  console.log(
    `[uninstall-claude-dev] no "gistlist-dev" entry to remove in ${CLAUDE_CONFIG_PATH}.`
  );
  process.exit(0);
}

delete config.mcpServers["gistlist-dev"];
if (Object.keys(config.mcpServers).length === 0) {
  delete config.mcpServers;
}
writeConfig(config);

console.log(
  `[uninstall-claude-dev] removed "gistlist-dev" entry from ${CLAUDE_CONFIG_PATH}. Restart Claude Desktop to drop the server.`
);
