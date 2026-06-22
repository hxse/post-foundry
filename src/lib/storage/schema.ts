import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const schemaMigrations = sqliteTable("schema_migrations", {
  id: text("id").primaryKey(),
  appliedAt: text("applied_at").notNull()
});

export const accounts = sqliteTable(
  "accounts",
  {
    accountUuid: text("account_uuid").primaryKey(),
    accountKey: text("account_key").notNull(),
    displayName: text("display_name").notNull(),
    platform: text("platform").notNull(),
    language: text("language").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    configVersion: integer("config_version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [uniqueIndex("accounts_account_key_unique").on(table.accountKey)]
);

export const accountKeyHistory = sqliteTable(
  "account_key_history",
  {
    id: text("id").primaryKey(),
    accountUuid: text("account_uuid").notNull(),
    previousAccountKey: text("previous_account_key").notNull(),
    nextAccountKey: text("next_account_key").notNull(),
    actor: text("actor").notNull(),
    at: text("at").notNull()
  },
  (table) => [index("account_key_history_account_uuid_idx").on(table.accountUuid)]
);

export const xIdentities = sqliteTable("x_identities", {
  accountUuid: text("account_uuid").primaryKey(),
  xUserId: text("x_user_id"),
  xHandle: text("x_handle"),
  oauthTokenStatus: text("oauth_token_status").notNull(),
  lastVerifiedAt: text("last_verified_at")
});

export const configSnapshots = sqliteTable(
  "config_snapshots",
  {
    id: text("id").primaryKey(),
    accountUuid: text("account_uuid").notNull(),
    accountKey: text("account_key").notNull(),
    configVersion: integer("config_version").notNull(),
    configHash: text("config_hash").notNull(),
    capturedAt: text("captured_at").notNull(),
    payloadJson: text("payload_json").notNull()
  },
  (table) => [
    index("config_snapshots_account_uuid_idx").on(table.accountUuid),
    uniqueIndex("config_snapshots_unique_capture").on(table.accountUuid, table.configHash, table.capturedAt)
  ]
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    accountUuid: text("account_uuid").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    scheduledAt: text("scheduled_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    attempts: integer("attempts").notNull(),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    index("jobs_account_uuid_idx").on(table.accountUuid),
    uniqueIndex("jobs_account_idempotency_unique").on(table.accountUuid, table.idempotencyKey)
  ]
);

export const apiCallAudit = sqliteTable(
  "api_call_audit",
  {
    id: text("id").primaryKey(),
    accountUuid: text("account_uuid").notNull(),
    provider: text("provider").notNull(),
    operation: text("operation").notNull(),
    status: text("status").notNull(),
    requestUnits: integer("request_units").notNull(),
    costUsd: real("cost_usd"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    metadataJson: text("metadata_json").notNull()
  },
  (table) => [index("api_call_audit_account_uuid_idx").on(table.accountUuid)]
);

export const runtimeSchema = {
  schemaMigrations,
  accounts,
  accountKeyHistory,
  xIdentities,
  configSnapshots,
  jobs,
  apiCallAudit
};

export type RuntimeSchema = typeof runtimeSchema;
