import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..", "..");

const requiredBinaries = [
  {
    name: "ollama",
    file: path.join(appRoot, "resources", "bin", "ollama"),
    setup:
      "Download the universal macOS binary into packages/app/resources/bin/ollama and mark it executable before packaging.",
  },
  {
    name: "audiotee",
    file: path.join(repoRoot, "node_modules", "audiotee", "bin", "audiotee"),
    setup:
      "Install the audiotee npm package (`npm install`) so the binary at node_modules/audiotee/bin/audiotee exists. electron-builder copies it to Contents/MacOS/audiotee; the afterSign hook re-signs it with com.apple.security.inherit so it shares the parent app's TCC responsibility (without this, system audio capture silently records zeros).",
  },
  {
    name: "audiotee-inherit entitlements",
    file: path.join(appRoot, "resources", "audiotee-inherit.entitlements"),
    setup:
      "The entitlements plist lives at packages/app/resources/audiotee-inherit.entitlements. It should be checked into git.",
  },
  {
    name: "mic-capture",
    file: path.join(appRoot, "resources", "bin", "mic-capture"),
    setup:
      "The native microphone capture helper is built from packages/app/native/mic-capture.swift. Run `npm run build:mic-capture` (or a full `npm run build`) before packaging. Without it the engine falls back to ffmpeg's AVFoundation demuxer, which drops ~10–12% of samples on USB mics.",
  },
  {
    name: "Gistlist.mcpb",
    file: path.join(repoRoot, "packages", "mcp-server", "dist", "Gistlist.mcpb"),
    setup:
      "Run `npm run build:mcp --workspace @gistlist/app` (which runs `npm run pack:mcpb --workspace @gistlist/mcp-server`) to produce the Claude Desktop extension bundle. Without it, the in-app 'Install Gistlist for Claude Desktop' button has nothing to open.",
  },
];

const missing = [];

for (const binary of requiredBinaries) {
  try {
    // Executables need X_OK; data files (entitlements plist, .mcpb archive)
    // just need to exist and be readable.
    const needsExecute =
      !binary.name.endsWith("entitlements") && !binary.file.endsWith(".mcpb");
    const mode = needsExecute ? fs.constants.X_OK : fs.constants.R_OK;
    fs.accessSync(binary.file, mode);
  } catch {
    missing.push(binary);
  }
}

if (missing.length > 0) {
  console.error("Bundled binary preflight failed.\n");
  for (const binary of missing) {
    console.error(`- Missing executable: ${binary.name}`);
    console.error(`  Expected at: ${binary.file}`);
    console.error(`  ${binary.setup}\n`);
  }
  process.exit(1);
}

console.log("Bundled binary preflight passed.");
