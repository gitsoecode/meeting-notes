import { ulid } from "ulid";
import type { ChatMessage, ChatThread, StoredCitation } from "@gistlist/engine";
import { getDb } from "../db/connection.js";

export function listThreads(): ChatThread[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT thread_id, title, created_at, updated_at, model_id FROM chat_threads ORDER BY updated_at DESC"
    )
    .all() as Array<{
    thread_id: string;
    title: string;
    created_at: string;
    updated_at: string;
    model_id: string | null;
  }>;
  return rows;
}

export function getThread(threadId: string): ChatThread | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT thread_id, title, created_at, updated_at, model_id FROM chat_threads WHERE thread_id = ?"
    )
    .get(threadId) as {
    thread_id: string;
    title: string;
    created_at: string;
    updated_at: string;
    model_id: string | null;
  } | undefined;
  return row ?? null;
}

export function createThread(opts: { title?: string; modelId?: string | null } = {}): ChatThread {
  const db = getDb();
  const now = new Date().toISOString();
  const thread: ChatThread = {
    thread_id: ulid(),
    title: opts.title ?? "New thread",
    created_at: now,
    updated_at: now,
    model_id: opts.modelId ?? null,
  };
  db.prepare(
    `INSERT INTO chat_threads (thread_id, title, created_at, updated_at, model_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    thread.thread_id,
    thread.title,
    thread.created_at,
    thread.updated_at,
    thread.model_id
  );
  return thread;
}

export function renameThread(threadId: string, title: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE chat_threads SET title = ?, updated_at = ? WHERE thread_id = ?"
  ).run(title, new Date().toISOString(), threadId);
}

export function setThreadModel(threadId: string, modelId: string | null): void {
  const db = getDb();
  db.prepare(
    "UPDATE chat_threads SET model_id = ?, updated_at = ? WHERE thread_id = ?"
  ).run(modelId, new Date().toISOString(), threadId);
}

export function deleteThread(threadId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM chat_threads WHERE thread_id = ?").run(threadId);
}

export function listMessages(threadId: string): ChatMessage[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT message_id, thread_id, role, content, citations, created_at
       FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC`
    )
    .all(threadId) as Array<{
    message_id: string;
    thread_id: string;
    role: string;
    content: string;
    citations: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    message_id: r.message_id,
    thread_id: r.thread_id,
    role: r.role as "user" | "assistant",
    content: r.content,
    citations: r.citations ? (JSON.parse(r.citations) as StoredCitation[]) : [],
    created_at: r.created_at,
  }));
}

export function addMessage(
  threadId: string,
  role: "user" | "assistant",
  content: string,
  citations: StoredCitation[] = []
): ChatMessage {
  const db = getDb();
  const now = new Date().toISOString();
  const msg: ChatMessage = {
    message_id: ulid(),
    thread_id: threadId,
    role,
    content,
    citations,
    created_at: now,
  };
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO chat_messages (message_id, thread_id, role, content, citations, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      msg.message_id,
      threadId,
      role,
      content,
      citations.length > 0 ? JSON.stringify(citations) : null,
      now
    );
    db.prepare("UPDATE chat_threads SET updated_at = ? WHERE thread_id = ?").run(
      now,
      threadId
    );
  });
  tx();
  return msg;
}
