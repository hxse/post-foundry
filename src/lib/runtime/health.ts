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
    audit_events: number;
    ai_runs: number;
    ai_decisions: number;
    ai_actions: number;
    evidence_refs: number;
    human_reviews: number;
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
      config_snapshots: repo.countRows("config_snapshots"),
      audit_events: repo.countRows("audit_events"),
      ai_runs: repo.countRows("ai_runs"),
      ai_decisions: repo.countRows("ai_decisions"),
      ai_actions: repo.countRows("ai_actions"),
      evidence_refs: repo.countRows("evidence_refs"),
      human_reviews: repo.countRows("human_reviews")
    }
  };
}
