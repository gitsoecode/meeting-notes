import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");

const requiredBinaries = [
  {
    name: "ollama",
    file: path.join(appRoot, "resources", "bin", "ollama"),
    setup:
      "Download the universal macOS binary into packages/app/resources/bin/ollama and mark it executable before packaging.",
  },
];

const missing = [];

for (const binary of requiredBinaries) {
  try {
    fs.accessSync(binary.file, fs.constants.X_OK);
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
