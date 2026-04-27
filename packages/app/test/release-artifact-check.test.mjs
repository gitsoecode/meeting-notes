import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";

import {
  ReleaseCheckError,
  assertEntitlementsPresent,
  checkManifest,
  listHelperExecutables,
  runChecks,
  sha512Base64,
} from "../scripts/check-release-artifacts.mjs";

// These tests cover the parser/check helpers and every failure path
// against fixtures. The real `codesign --verify` and
// `codesign -d --entitlements` subprocesses are NOT exercised here —
// they're covered by the actual `package:mac:sign` build, which runs
// the full script end-to-end against a freshly notarized bundle.
//
// Inject readEntitlements / verifySignature / readVersion to sidestep
// the live macOS subprocesses entirely.

const REQUIRED_MAIN = {
  "com.apple.security.device.audio-input": true,
  "com.apple.security.cs.allow-jit": true,
  "com.apple.security.cs.allow-unsigned-executable-memory": true,
  "com.apple.security.cs.disable-library-validation": true,
};
const REQUIRED_AUDIOTEE = { "com.apple.security.inherit": true };
const REQUIRED_HELPER = {
  "com.apple.security.inherit": true,
  "com.apple.security.cs.allow-jit": true,
  "com.apple.security.cs.allow-unsigned-executable-memory": true,
  "com.apple.security.cs.disable-library-validation": true,
};

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gistlist-rac-${randomBytes(4).toString("hex")}-`));
}

function writeBinaryFile(p, sizeBytes) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(sizeBytes, 0xab));
}

function sha512OnDisk(p) {
  return createHash("sha512").update(fs.readFileSync(p)).digest("base64");
}

/**
 * Build a fixture release tree under `root` that mimics what
 * package:mac:sign emits after notarize + manifest regen:
 *   release/mac-arm64/Gistlist.app/Contents/{Info.plist, MacOS/Gistlist, MacOS/audiotee}
 *   release/Gistlist-arm64.zip
 *   release/Gistlist-arm64.dmg
 *   release/latest-mac.yml
 *
 * Hashes/sizes in latest-mac.yml are computed from the actual fake
 * artifacts so the "happy path" check passes by construction.
 */
function buildFixture(root, { version = "0.1.4", productName = "Gistlist", arch = "arm64" } = {}) {
  const releaseDir = root;
  const macOutDir = path.join(releaseDir, `mac-${arch}`);
  const appPath = path.join(macOutDir, `${productName}.app`);
  const contentsDir = path.join(appPath, "Contents");
  const macOsDir = path.join(contentsDir, "MacOS");
  fs.mkdirSync(macOsDir, { recursive: true });

  // Info.plist as XML so parsePlistJson via plutil works in any environment.
  // We don't actually invoke plutil from this test — we inject readVersion —
  // but we still write the file so runChecks's existence check passes.
  fs.writeFileSync(
    path.join(contentsDir, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleShortVersionString</key><string>${version}</string>
</dict></plist>`
  );

  // Mach-O placeholders. Real test only cares that the path exists; the
  // entitlement-reading subprocess is injected.
  writeBinaryFile(path.join(macOsDir, productName), 16);
  writeBinaryFile(path.join(macOsDir, "audiotee"), 16);

  // Mirror electron-builder's helper layout so listHelperExecutables
  // finds them. Each helper has its own Contents/MacOS/<exe-name>.
  const helperVariants = ["", " (GPU)", " (Plugin)", " (Renderer)"];
  for (const variant of helperVariants) {
    const helperName = `${productName} Helper${variant}`;
    const helperMacOs = path.join(
      contentsDir,
      "Frameworks",
      `${helperName}.app`,
      "Contents",
      "MacOS"
    );
    fs.mkdirSync(helperMacOs, { recursive: true });
    writeBinaryFile(path.join(helperMacOs, helperName), 16);
  }

  // Updater artifacts — actual byte content drives the manifest hashes.
  const zipPath = path.join(releaseDir, `${productName}-${arch}.zip`);
  const dmgPath = path.join(releaseDir, `${productName}-${arch}.dmg`);
  writeBinaryFile(zipPath, 1024);
  writeBinaryFile(dmgPath, 2048);

  const zipMeta = { sha512: sha512OnDisk(zipPath), size: fs.statSync(zipPath).size };
  const dmgMeta = { sha512: sha512OnDisk(dmgPath), size: fs.statSync(dmgPath).size };

  const manifest = `version: ${version}
files:
  - url: ${productName}-${arch}.zip
    sha512: ${zipMeta.sha512}
    size: ${zipMeta.size}
  - url: ${productName}-${arch}.dmg
    sha512: ${dmgMeta.sha512}
    size: ${dmgMeta.size}
path: ${productName}-${arch}.zip
sha512: ${zipMeta.sha512}
releaseDate: '2026-04-27T12:00:00.000Z'
`;
  fs.writeFileSync(path.join(releaseDir, "latest-mac.yml"), manifest);

  return { releaseDir, appPath, manifestPath: path.join(releaseDir, "latest-mac.yml"), zipPath, dmgPath };
}

function makePkgJson(root, version = "0.1.4") {
  const p = path.join(root, "package.json");
  fs.writeFileSync(
    p,
    JSON.stringify({ version, build: { productName: "Gistlist" } }, null, 2)
  );
  return p;
}

function defaultReadEntitlements(bin) {
  if (bin.endsWith("/audiotee")) return { ...REQUIRED_AUDIOTEE };
  if (bin.includes("/Frameworks/") && bin.includes("Helper"))
    return { ...REQUIRED_HELPER };
  return { ...REQUIRED_MAIN };
}

function runWithInjections(root, overrides = {}) {
  return runChecks({
    releaseDir: root,
    arch: "arm64",
    pkgJsonPath: makePkgJson(root, overrides.pkgVersion ?? "0.1.4"),
    readEntitlements: overrides.readEntitlements ?? defaultReadEntitlements,
    verifySignature: overrides.verifySignature ?? (() => {}),
    readVersion: overrides.readVersion ?? (() => "0.1.4"),
  });
}

test("assertEntitlementsPresent: passes when all keys are true", () => {
  assertEntitlementsPresent({ a: true, b: true }, ["a", "b"], "test");
});

test("assertEntitlementsPresent: fails on missing key", () => {
  assert.throws(
    () => assertEntitlementsPresent({ a: true }, ["a", "missing"], "test"),
    (err) =>
      err instanceof ReleaseCheckError &&
      /missing: missing/.test(err.message) &&
      /\[test\]/.test(err.message)
  );
});

test("assertEntitlementsPresent: fails on key set to false", () => {
  assert.throws(
    () => assertEntitlementsPresent({ a: true, b: false }, ["a", "b"], "test"),
    (err) => err instanceof ReleaseCheckError && /not-true: b=false/.test(err.message)
  );
});

test("assertEntitlementsPresent: fails on non-object payload", () => {
  assert.throws(
    () => assertEntitlementsPresent(null, ["x"], "test"),
    (err) => err instanceof ReleaseCheckError
  );
});

test("checkManifest: passes for a self-consistent manifest", () => {
  const root = tmpdir();
  const fx = buildFixture(root);
  const text = fs.readFileSync(fx.manifestPath, "utf8");
  checkManifest(text, root, "0.1.4");
});

test("checkManifest: fails when top-level version drifts", () => {
  const root = tmpdir();
  const fx = buildFixture(root);
  const text = fs.readFileSync(fx.manifestPath, "utf8");
  assert.throws(
    () => checkManifest(text, root, "0.1.5"),
    (err) => err instanceof ReleaseCheckError && /top-level version mismatch/.test(err.message)
  );
});

test("checkManifest: fails when an artifact size drifts", () => {
  const root = tmpdir();
  const fx = buildFixture(root);
  fs.appendFileSync(fx.zipPath, Buffer.from("extra"));
  const text = fs.readFileSync(fx.manifestPath, "utf8");
  assert.throws(
    () => checkManifest(text, root, "0.1.4"),
    (err) => err instanceof ReleaseCheckError && /size mismatch.*\.zip/s.test(err.message)
  );
});

test("checkManifest: fails when sha512 drifts even if size matches", () => {
  const root = tmpdir();
  const fx = buildFixture(root);
  // Overwrite same-length bytes — size unchanged, hash changed.
  const len = fs.statSync(fx.zipPath).size;
  fs.writeFileSync(fx.zipPath, Buffer.alloc(len, 0x00));
  const text = fs.readFileSync(fx.manifestPath, "utf8");
  assert.throws(
    () => checkManifest(text, root, "0.1.4"),
    (err) => err instanceof ReleaseCheckError && /sha512 mismatch.*\.zip/s.test(err.message)
  );
});

test("checkManifest: fails when a manifest-listed artifact is missing on disk", () => {
  const root = tmpdir();
  const fx = buildFixture(root);
  fs.unlinkSync(fx.dmgPath);
  const text = fs.readFileSync(fx.manifestPath, "utf8");
  assert.throws(
    () => checkManifest(text, root, "0.1.4"),
    (err) => err instanceof ReleaseCheckError && /does not exist on disk.*\.dmg/s.test(err.message)
  );
});

test("checkManifest: fails on totally unparseable yaml", () => {
  const root = tmpdir();
  buildFixture(root);
  // YAML parser is lenient, so use something obviously invalid:
  // a value with an unterminated quoted scalar.
  assert.throws(
    () => checkManifest('files:\n  - url: "unterminated\n', root, "0.1.4"),
    (err) => err instanceof ReleaseCheckError
  );
});

test("sha512Base64: matches createHash directly", () => {
  const root = tmpdir();
  const f = path.join(root, "x");
  fs.writeFileSync(f, "hello");
  const expected = createHash("sha512").update(Buffer.from("hello")).digest("base64");
  assert.equal(sha512Base64(f), expected);
});

test("runChecks: happy path with all injected helpers passing", () => {
  const root = tmpdir();
  buildFixture(root);
  const report = runWithInjections(root);
  assert.equal(report.version, "0.1.4");
  assert.equal(report.productName, "Gistlist");
  assert.equal(report.arch, "arm64");
});

test("runChecks: fails when Info.plist version drifts from package.json", () => {
  const root = tmpdir();
  buildFixture(root);
  assert.throws(
    () =>
      runWithInjections(root, {
        readVersion: () => "0.1.3",
      }),
    (err) =>
      err instanceof ReleaseCheckError && /CFBundleShortVersionString mismatch/.test(err.message)
  );
});

test("runChecks: fails when main app entitlement is missing", () => {
  const root = tmpdir();
  buildFixture(root);
  assert.throws(
    () =>
      runWithInjections(root, {
        readEntitlements: (bin) =>
          bin.endsWith("/audiotee")
            ? { ...REQUIRED_AUDIOTEE }
            : {
                "com.apple.security.cs.allow-jit": true,
                "com.apple.security.cs.allow-unsigned-executable-memory": true,
                "com.apple.security.cs.disable-library-validation": true,
              },
      }),
    (err) =>
      err instanceof ReleaseCheckError &&
      /\[main-app\]/.test(err.message) &&
      /com\.apple\.security\.device\.audio-input/.test(err.message)
  );
});

test("runChecks: fails when audiotee inherit entitlement is missing", () => {
  const root = tmpdir();
  buildFixture(root);
  assert.throws(
    () =>
      runWithInjections(root, {
        readEntitlements: (bin) =>
          bin.endsWith("/audiotee") ? {} : { ...REQUIRED_MAIN },
      }),
    (err) =>
      err instanceof ReleaseCheckError &&
      /\[audiotee\]/.test(err.message) &&
      /com\.apple\.security\.inherit/.test(err.message)
  );
});

test("runChecks: fails when codesign --verify fails", () => {
  const root = tmpdir();
  buildFixture(root);
  assert.throws(
    () =>
      runWithInjections(root, {
        verifySignature: () => {
          throw new ReleaseCheckError("[codesign] simulated failure");
        },
      }),
    (err) => err instanceof ReleaseCheckError && /\[codesign\]/.test(err.message)
  );
});

test("runChecks: fails when manifest hash drifts (end-to-end via runChecks)", () => {
  const root = tmpdir();
  const fx = buildFixture(root);
  // Mutate the zip after the manifest was written.
  fs.writeFileSync(fx.zipPath, Buffer.alloc(fs.statSync(fx.zipPath).size, 0x00));
  assert.throws(
    () => runWithInjections(root),
    (err) => err instanceof ReleaseCheckError && /sha512 mismatch/.test(err.message)
  );
});

test("runChecks: fails when expected paths are missing", () => {
  const root = tmpdir();
  const fx = buildFixture(root);
  fs.rmSync(fx.appPath, { recursive: true, force: true });
  assert.throws(
    () => runWithInjections(root),
    (err) => err instanceof ReleaseCheckError && /expected path missing/.test(err.message)
  );
});

test("listHelperExecutables: finds all four helper exes in fixture", () => {
  const root = tmpdir();
  const fx = buildFixture(root);
  const exes = listHelperExecutables(
    path.join(fx.appPath, "Contents", "Frameworks"),
    "Gistlist"
  );
  assert.equal(exes.length, 4);
  // Lexical sort: " " (0x20) < "." (0x2E), so the parenthesized variants
  // sort before the bare "Gistlist Helper.app".
  assert.match(exes[0], /Gistlist Helper \(GPU\)\.app\/Contents\/MacOS\/Gistlist Helper \(GPU\)$/);
  assert.match(exes[1], /Gistlist Helper \(Plugin\)\.app\/Contents\/MacOS\/Gistlist Helper \(Plugin\)$/);
  assert.match(exes[2], /Gistlist Helper \(Renderer\)\.app\/Contents\/MacOS\/Gistlist Helper \(Renderer\)$/);
  assert.match(exes[3], /Gistlist Helper\.app\/Contents\/MacOS\/Gistlist Helper$/);
});

test("listHelperExecutables: returns empty when Frameworks dir missing", () => {
  const root = tmpdir();
  const exes = listHelperExecutables(path.join(root, "nonexistent"), "Gistlist");
  assert.deepEqual(exes, []);
});

test("runChecks: fails when a helper missing JIT entitlement (the v0.1.4 fingerprint)", () => {
  const root = tmpdir();
  buildFixture(root);
  // Simulate v0.1.4's actual bug: helpers have only `inherit`, no JIT.
  assert.throws(
    () =>
      runWithInjections(root, {
        readEntitlements: (bin) => {
          if (bin.endsWith("/audiotee")) return { ...REQUIRED_AUDIOTEE };
          if (bin.includes("/Frameworks/") && bin.includes("Helper")) {
            return { "com.apple.security.inherit": true };
          }
          return { ...REQUIRED_MAIN };
        },
      }),
    (err) =>
      err instanceof ReleaseCheckError &&
      /\[helper:Gistlist Helper/.test(err.message) &&
      /com\.apple\.security\.cs\.allow-jit/.test(err.message)
  );
});

test("runChecks: fails when a helper missing inherit entitlement", () => {
  const root = tmpdir();
  buildFixture(root);
  assert.throws(
    () =>
      runWithInjections(root, {
        readEntitlements: (bin) => {
          if (bin.endsWith("/audiotee")) return { ...REQUIRED_AUDIOTEE };
          if (bin.includes("/Frameworks/") && bin.includes("Helper")) {
            // JIT trio but no inherit — TCC scope wouldn't propagate.
            return {
              "com.apple.security.cs.allow-jit": true,
              "com.apple.security.cs.allow-unsigned-executable-memory": true,
              "com.apple.security.cs.disable-library-validation": true,
            };
          }
          return { ...REQUIRED_MAIN };
        },
      }),
    (err) =>
      err instanceof ReleaseCheckError &&
      /\[helper:Gistlist Helper/.test(err.message) &&
      /com\.apple\.security\.inherit/.test(err.message)
  );
});

test("runChecks: fails when no helpers found at all (bundle layout regression)", () => {
  const root = tmpdir();
  const fx = buildFixture(root);
  fs.rmSync(path.join(fx.appPath, "Contents", "Frameworks"), {
    recursive: true,
    force: true,
  });
  assert.throws(
    () => runWithInjections(root),
    (err) => err instanceof ReleaseCheckError && /no Gistlist Helper.*\.app/.test(err.message)
  );
});

test("runChecks: happy path returns helperCount", () => {
  const root = tmpdir();
  buildFixture(root);
  const report = runWithInjections(root);
  assert.equal(report.helperCount, 4);
});
