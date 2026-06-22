import type { RuntimeRepository } from "../storage/repositories";
import { listRuntimeTables, readAppliedMigrationIds, type RuntimeDatabase } from "../storage/sqlite";

export type RuntimeHealthSnapshot = {
  status: "ok";
  database: {
    applied_migrations: string[];
    tables: string[];
  };
  counts: {
    accounts: number;
    jobs: number;
    api_call_audit: number;
    config_snapshots: number;
  };
};

export function buildRuntimeHealthSnapshot(db: RuntimeDatabase, repo: RuntimeRepository): RuntimeHealthSnapshot {
  return {
    status: "ok",
    database: {
      applied_migrations: [...readAppliedMigrationIds(db)].sort(),
      tables: listRuntimeTables(db)
    },
    counts: {
      accounts: repo.countRows("accounts"),
      jobs: repo.countRows("jobs"),
      api_call_audit: repo.countRows("api_call_audit"),
      config_snapshots: repo.countRows("config_snapshots")
    }
  };
}
