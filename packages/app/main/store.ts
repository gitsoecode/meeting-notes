import { getDb } from "./db/connection.js";
import { SqliteRunStore } from "./db/sqlite-run-store.js";

let store: SqliteRunStore | null = null;

export function getStore(): SqliteRunStore {
  if (store) return store;
  store = new SqliteRunStore(getDb());
  return store;
}
