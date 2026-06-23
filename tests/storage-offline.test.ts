import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import accountsExample from "../config/accounts.example.json";
import {
  createAccountConfigSnapshot,
  parseAccountRegistryConfig,
  renameAccountKey,
  resolveAccountRef
} from "../src/lib/accounts/registry";
import { buildRuntimeHealthSnapshot } from "../src/lib/runtime/health";
import { RuntimeRepository } from "../src/lib/storage/repositories";
import { applyRuntimeMigrations, listRuntimeTables } from "../src/lib/storage/sqlite";

const now = "2026-06-22T12:00:00.000Z";

describe("runtime storage baseline", () => {
  it("applies runtime migrations to SQLite", () => {
    const db = openTestDb();
    try {
      const result = applyRuntimeMigrations(db, () => new Date(now));
      const second = applyRuntimeMigrations(db, () => new Date(now));

      expect(result.applied).toEqual(["0001_runtime_storage_baseline", "0002_audit_event_ledger_baseline"]);
      expect(second.skipped).toEqual(["0001_runtime_storage_baseline", "0002_audit_event_ledger_baseline"]);
      expect(listRuntimeTables(db)).toEqual([
        "account_key_history",
        "accounts",
        "ai_actions",
        "ai_decisions",
        "ai_runs",
        "api_call_audit",
        "audit_events",
        "config_snapshots",
        "evidence_refs",
        "human_reviews",
        "jobs",
        "schema_migrations",
        "x_identities"
      ]);
    } finally {
      db.close();
    }
  });

  it("persists account registry rows, identities, snapshots, and rename audit by account_uuid", () => {
    const db = openMigratedTestDb();
    try {
      const repo = new RuntimeRepository(db);
      const registry = parseAccountRegistryConfig(accountsExample);
      const zh = resolveAccountRef(registry, { accountKey: "zh-tech" });

      repo.upsertAccount(zh.account, now);
      repo.upsertXIdentity(zh.xIdentity!);
      const snapshotId = repo.saveConfigSnapshot(
        createAccountConfigSnapshot({
          registry,
          ref: { accountKey: "zh-tech" },
          capturedAt: now
        })
      );

      const renamed = renameAccountKey({
        registry,
        accountUuid: zh.account.account_uuid,
        nextAccountKey: "cn-ai-finance",
        actor: "operator",
        at: "2026-06-22T12:30:00.000Z"
      });
      const renamedAccount = resolveAccountRef(renamed.registry, { accountKey: "cn-ai-finance" }).account;
      repo.upsertAccount(renamedAccount, "2026-06-22T12:30:00.000Z");
      const auditId = repo.recordAccountKeyRename(renamed.auditRecord);

      expect(snapshotId).toHaveLength(64);
      expect(auditId).toHaveLength(64);
      expect(repo.getAccountByUuid(zh.account.account_uuid)).toMatchObject({
        account_uuid: zh.account.account_uuid,
        account_key: "cn-ai-finance",
        config_version: 2
      });

      const history = db.prepare("SELECT * FROM account_key_history WHERE account_uuid = ?").all(zh.account.account_uuid);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        previous_account_key: "zh-tech",
        next_account_key: "cn-ai-finance"
      });
    } finally {
      db.close();
    }
  });

  it("keeps jobs and API audit rows isolated by explicit account_uuid", () => {
    const db = openMigratedTestDb();
    try {
      const repo = new RuntimeRepository(db);
      const registry = parseAccountRegistryConfig(accountsExample);
      for (const account of registry.config.accounts) {
        repo.upsertAccount(account, now);
      }

      const zh = resolveAccountRef(registry, { accountKey: "zh-tech" }).account;
      const en = resolveAccountRef(registry, { accountKey: "en-tech" }).account;

      repo.createJob({
        id: "job-zh-1",
        accountUuid: zh.account_uuid,
        kind: "workflow-fetch-public-data",
        idempotencyKey: "fetch:2026-06-22",
        scheduledAt: now,
        now
      });
      repo.createJob({
        id: "job-en-1",
        accountUuid: en.account_uuid,
        kind: "workflow-fetch-public-data",
        idempotencyKey: "fetch:2026-06-22",
        scheduledAt: now,
        now
      });
      repo.recordApiCallAudit({
        id: "audit-zh-1",
        accountUuid: zh.account_uuid,
        provider: "twitterapi.io",
        operation: "search",
        status: "succeeded",
        requestUnits: 1,
        startedAt: now,
        metadata: { query: "AI" }
      });

      expect(repo.listJobsForAccount(zh.account_uuid).map((job) => job.id)).toEqual(["job-zh-1"]);
      expect(repo.listJobsForAccount(en.account_uuid).map((job) => job.id)).toEqual(["job-en-1"]);
      expect(repo.listApiCallAuditForAccount(zh.account_uuid)).toHaveLength(1);
      expect(repo.listApiCallAuditForAccount(en.account_uuid)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("reports runtime health from migrated SQLite", () => {
    const db = openMigratedTestDb();
    try {
      const repo = new RuntimeRepository(db);
      const health = buildRuntimeHealthSnapshot(db, repo);

      expect(health.status).toBe("ok");
      expect(health.database.applied_migrations).toEqual([
        "0001_runtime_storage_baseline",
        "0002_audit_event_ledger_baseline"
      ]);
      expect(health.database.tables).toContain("accounts");
      expect(health.counts).toEqual({
        accounts: 0,
        jobs: 0,
        api_call_audit: 0,
        config_snapshots: 0,
        audit_events: 0,
        ai_runs: 0,
        ai_decisions: 0,
        ai_actions: 0,
        evidence_refs: 0,
        human_reviews: 0
      });
    } finally {
      db.close();
    }
  });
});

function openTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

function openMigratedTestDb(): DatabaseSync {
  const db = openTestDb();
  applyRuntimeMigrations(db, () => new Date(now));
  return db;
}
