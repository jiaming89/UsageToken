import { createRequire } from "node:module";

export type SqliteRow = Record<string, unknown>;

const require = createRequire(import.meta.url);

export async function queryRows(dbPath: string, sql: string, params: unknown[] = []): Promise<SqliteRow[]> {
  const better = loadBetterSqlite();
  if (better) {
    try {
      const db = new better(dbPath, { readonly: true, fileMustExist: true });
      try {
        return db.prepare(sql).all(...params) as SqliteRow[];
      } finally {
        db.close();
      }
    } catch {
      return [];
    }
  }

  try {
    const sqlite = await import("node:sqlite");
    const DatabaseSync = (sqlite as unknown as { DatabaseSync: new (path: string, options?: Record<string, unknown>) => NodeSqliteDb }).DatabaseSync;
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return db.prepare(sql).all(...params) as SqliteRow[];
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

function loadBetterSqlite(): BetterSqliteCtor | undefined {
  try {
    const loaded = require("better-sqlite3") as { default?: BetterSqliteCtor } | BetterSqliteCtor;
    return typeof loaded === "function" ? loaded : loaded.default;
  } catch {
    return undefined;
  }
}

interface BetterSqliteCtor {
  new (path: string, options?: Record<string, unknown>): {
    prepare(sql: string): { all(...params: unknown[]): unknown[] };
    close(): void;
  };
}

interface NodeSqliteDb {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
  close(): void;
}
