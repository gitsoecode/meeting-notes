/**
 * Integration test: spin up the MCP server with an in-memory linked
 * transport, drive it from a real MCP Client, and assert the three tools
 * + meeting:// resources behave correctly against an in-memory SQLite DB
 * seeded with a tiny corpus.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const { Client } = await import(
  new URL(
    "../../../node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js",
    import.meta.url
  ).href
);
const { McpServer } = await import(
  new URL(
    "../../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js",
    import.meta.url
  ).href
);
const { InMemoryTransport } = await import(
  new URL(
    "../../../node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js",
    import.meta.url
  ).href
);

const { registerTools } = await import(
  new URL("../dist/tools.js", import.meta.url).href
);
const { registerResources } = await import(
  new URL("../dist/resources.js", import.meta.url).href
);

// Minimal test schema mirroring what retrieve.ts touches.
const SCHEMA = `
CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  folder_path TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  date TEXT NOT NULL,
  started TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'complete',
  source_mode TEXT NOT NULL DEFAULT 'both',
  duration_minutes REAL,
  asr_provider TEXT NOT NULL DEFAULT '',
  llm_provider TEXT NOT NULL DEFAULT '',
  scheduled_time TEXT,
  selected_prompts TEXT,
  updated_at TEXT
);
CREATE TABLE participants (
  participant_id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT,
  last_name TEXT,
  email TEXT UNIQUE
);
CREATE TABLE run_participants (
  run_id TEXT NOT NULL,
  participant_id INTEGER NOT NULL,
  PRIMARY KEY (run_id, participant_id)
);
CREATE TABLE chat_chunks (
  chunk_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  speaker TEXT,
  start_ms INTEGER,
  end_ms INTEGER,
  text TEXT NOT NULL,
  seekable INTEGER NOT NULL DEFAULT 0
);
CREATE VIRTUAL TABLE chat_chunks_fts USING fts5(text, tokenize='porter unicode61');
CREATE TRIGGER chat_chunks_fts_insert AFTER INSERT ON chat_chunks BEGIN
  INSERT INTO chat_chunks_fts(rowid, text) VALUES (NEW.chunk_id, NEW.text);
END;
`;

function makeFixture() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gistlist-mcp-test-"));
  const runFolder = path.join(tmpRoot, "RUN_LAUREN");
  fs.mkdirSync(runFolder, { recursive: true });
  // index.md is required by the path guard (mirrors the app's canonical
  // resolveRunFolderPath, which refuses to operate on folders without one).
  fs.writeFileSync(
    path.join(runFolder, "index.md"),
    "---\ntitle: Catch up with Lauren\n---\n"
  );
  fs.writeFileSync(
    path.join(runFolder, "transcript.md"),
    "## Transcript\n\n[00:00] Me: Pricing strategy talk.\n[00:30] Lauren: We should discount further.\n"
  );
  fs.writeFileSync(
    path.join(runFolder, "summary.md"),
    "Pricing discussion with Lauren about deeper discounts."
  );
  fs.writeFileSync(
    path.join(runFolder, "notes.md"),
    "Action: send revised pricing deck to Lauren."
  );

  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  db.prepare(
    `INSERT INTO runs (run_id, folder_path, title, date, started, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    "RUN_LAUREN",
    runFolder,
    "Catch up with Lauren",
    "2026-04-15",
    "2026-04-15T15:00:00Z",
    "2026-04-15T16:00:00Z"
  );
  const ins = db
    .prepare(
      `INSERT INTO participants (first_name, last_name, email) VALUES (?, ?, ?)`
    )
    .run("Lauren", "Dai", "lauren@example.com");
  db.prepare(
    `INSERT INTO run_participants (run_id, participant_id) VALUES (?, ?)`
  ).run("RUN_LAUREN", ins.lastInsertRowid);
  db.prepare(
    `INSERT INTO chat_chunks (run_id, kind, speaker, start_ms, end_ms, text, seekable)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "RUN_LAUREN",
    "transcript",
    "me",
    0,
    30_000,
    "Pricing strategy talk with Lauren about deeper discounts.",
    1
  );
  return { db, runsRoot: tmpRoot };
}

async function makeServerClientPair(fixture) {
  const server = new McpServer(
    { name: "gistlist-test", version: "0.0.0" },
    { capabilities: { tools: {}, resources: { listChanged: true } } }
  );
  registerTools(server, {
    db: fixture.db,
    isVecAvailable: () => false,
    ollamaBaseUrl: "http://127.0.0.1:11434",
    runsRoot: fixture.runsRoot,
  });
  const { stopPolling } = registerResources(server, {
    db: fixture.db,
    runsRoot: fixture.runsRoot,
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server, stopPolling };
}

test("MCP: list_recent_meetings returns the seeded meeting with a click-through link", async () => {
  const fixture = makeFixture();
  const { client, server, stopPolling } = await makeServerClientPair(fixture);
  try {
    const res = await client.callTool({ name: "list_recent_meetings", arguments: {} });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.meetings.length, 1);
    assert.equal(payload.meetings[0].run_id, "RUN_LAUREN");
    assert.equal(payload.meetings[0].title, "Catch up with Lauren");
    // tools.ts intentionally emits a single `link` field (markdown) instead
    // of `resource_uri` so Claude Desktop renders it as a clickable
    // citation. See the comment at packages/mcp-server/src/tools.ts:318.
    assert.match(
      payload.meetings[0].link,
      /^\[.+\]\(https?:\/\/.+m=RUN_LAUREN/
    );
  } finally {
    stopPolling();
    await server.close();
  }
});

test("MCP: search_meetings returns FTS hits with thin snippet + click-through link", async () => {
  const fixture = makeFixture();
  const { client, server, stopPolling } = await makeServerClientPair(fixture);
  try {
    const res = await client.callTool({
      name: "search_meetings",
      arguments: { query: "pricing", limit: 5 },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.retrieval_mode, "fts_only");
    assert.ok(payload.results.length >= 1, "expect at least one pricing hit");
    const hit = payload.results[0];
    assert.equal(hit.run_id, "RUN_LAUREN");
    // Markdown link with the run_id encoded in the query string. Same
    // single-field design as list_recent_meetings.
    assert.match(hit.link, /^\[.+\]\(https?:\/\/.+m=RUN_LAUREN/);
    assert.ok(hit.snippet.length > 0 && hit.snippet.length <= 700);
  } finally {
    stopPolling();
    await server.close();
  }
});

test("MCP: get_meeting returns the assembled body with notes → transcript → summary order", async () => {
  const fixture = makeFixture();
  const { client, server, stopPolling } = await makeServerClientPair(fixture);
  try {
    const res = await client.callTool({
      name: "get_meeting",
      arguments: { run_id: "RUN_LAUREN" },
    });
    const text = res.content[0].text;
    assert.match(text, /^# Catch up with Lauren — 2026-04-15/);
    // Notes appear before transcript before summary.
    const notesIdx = text.indexOf("## Notes (user-authored)");
    const transcriptIdx = text.indexOf("## Transcript (raw)");
    const summaryIdx = text.indexOf("## Auto-generated summary");
    assert.ok(notesIdx > 0, "notes section present");
    assert.ok(transcriptIdx > notesIdx, "transcript after notes");
    assert.ok(summaryIdx > transcriptIdx, "summary after transcript");
    assert.match(text, /Generated by the local summarization model/);
    // Structured content mirrors the body.
    assert.ok(res.structuredContent);
    assert.equal(res.structuredContent.run_id, "RUN_LAUREN");
    assert.deepEqual(
      res.structuredContent.sections_included.sort(),
      ["notes", "summary", "transcript"]
    );
  } finally {
    stopPolling();
    await server.close();
  }
});

test("MCP: get_meeting honors the sections argument", async () => {
  const fixture = makeFixture();
  const { client, server, stopPolling } = await makeServerClientPair(fixture);
  try {
    const res = await client.callTool({
      name: "get_meeting",
      arguments: { run_id: "RUN_LAUREN", sections: ["transcript"] },
    });
    const text = res.content[0].text;
    assert.match(text, /## Transcript \(raw\)/);
    assert.equal(text.includes("## Notes (user-authored)"), false);
    assert.equal(text.includes("## Auto-generated summary"), false);
  } finally {
    stopPolling();
    await server.close();
  }
});

test("MCP: get_meeting returns isError for unknown run_id", async () => {
  const fixture = makeFixture();
  const { client, server, stopPolling } = await makeServerClientPair(fixture);
  try {
    const res = await client.callTool({
      name: "get_meeting",
      arguments: { run_id: "NOPE" },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /No meeting found/);
  } finally {
    stopPolling();
    await server.close();
  }
});

test("MCP: meeting:// resources list and read", async () => {
  const fixture = makeFixture();
  const { client, server, stopPolling } = await makeServerClientPair(fixture);
  try {
    const list = await client.listResources();
    assert.ok(list.resources.length >= 1);
    const lauren = list.resources.find((r) => r.uri === "meeting://RUN_LAUREN");
    assert.ok(lauren, "Lauren resource present in list");
    assert.equal(lauren.mimeType, "text/markdown");

    const read = await client.readResource({ uri: "meeting://RUN_LAUREN" });
    assert.equal(read.contents[0].mimeType, "text/markdown");
    assert.match(read.contents[0].text, /Catch up with Lauren/);
  } finally {
    stopPolling();
    await server.close();
  }
});

test("MCP: get_meeting refuses run folders outside the configured runs root", async () => {
  const fixture = makeFixture();
  // Insert a second run pointing OUTSIDE the runsRoot — simulates a stale
  // DB entry or a malicious record. The path-validation guard must refuse.
  const outsideFolder = fs.mkdtempSync(path.join(os.tmpdir(), "gistlist-outside-"));
  fs.writeFileSync(path.join(outsideFolder, "index.md"), "---\n---\n");
  fs.writeFileSync(path.join(outsideFolder, "transcript.md"), "leak");
  fixture.db
    .prepare(
      `INSERT INTO runs (run_id, folder_path, title, date, started, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      "RUN_OUTSIDE",
      outsideFolder,
      "Outside",
      "2026-04-16",
      "2026-04-16T15:00:00Z",
      "2026-04-16T16:00:00Z"
    );

  const { client, server, stopPolling } = await makeServerClientPair(fixture);
  try {
    const res = await client.callTool({
      name: "get_meeting",
      arguments: { run_id: "RUN_OUTSIDE" },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /outside the configured runs root/);
  } finally {
    stopPolling();
    await server.close();
  }
});
