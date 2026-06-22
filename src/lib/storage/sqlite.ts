import { DatabaseSync } from "node:sqlite";
import { ensureRuntimeDatabaseDirectory, resolveRuntimeDatabasePath, type RuntimeStorageEnv } from "./config";
import { migrationTableSql, runtimeMigrations } from "./migrations";

export type RuntimeDatabase = DatabaseSync;

export type RuntimeMigrationStatus = {
  applied: string[];
  skipped: string[];
};

export function openRuntimeDatabase(params: {
  path?: string;
  env?: RuntimeStorageEnv;
  applyMigrations?: boolean;
  now?: () => Date;
} = {}): RuntimeDatabase {
  const path = params.path ?? resolveRuntimeDatabasePath(params.env);
  ensureRuntimeDatabaseDirectory(path);
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");

  if (params.applyMigrations ?? true) {
    applyRuntimeMigrations(db, params.now);
  }

  return db;
}

export function applyRuntimeMigrations(db: RuntimeDatabase, now: () => Date = () => new Date()): RuntimeMigrationStatus {
  db.exec(migrationTableSql);

  const appliedIds = readAppliedMigrationIds(db);
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of runtimeMigrations) {
    if (appliedIds.has(migration.id)) {
      skipped.push(migration.id);
      continue;
    }

    db.exec("BEGIN;");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(migration.id, now().toISOString());
      db.exec("COMMIT;");
      applied.push(migration.id);
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  }

  return { applied, skipped };
}

export function readAppliedMigrationIds(db: RuntimeDatabase): Set<string> {
  const rows = db.prepare("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

export function listRuntimeTables(db: RuntimeDatabase): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}
