import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

export const defaultRuntimeDatabasePath = "data/post-foundry.sqlite";

export type RuntimeStorageEnv = Partial<Record<string, string | undefined>>;

export function resolveRuntimeDatabasePath(env: RuntimeStorageEnv = process.env): string {
  return env.POST_FOUNDRY_DB_FILE ?? defaultRuntimeDatabasePath;
}

export function ensureRuntimeDatabaseDirectory(databasePath: string): void {
  if (databasePath === ":memory:") {
    return;
  }

  mkdirSync(dirname(resolve(databasePath)), { recursive: true });
}
