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

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    accountUuid: text("account_uuid").notNull(),
    eventType: text("event_type").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    traceId: text("trace_id").notNull(),
    occurredAt: text("occurred_at").notNull(),
    metadataJson: text("metadata_json").notNull()
  },
  (table) => [
    index("audit_events_account_uuid_idx").on(table.accountUuid),
    index("audit_events_trace_id_idx").on(table.traceId),
    index("audit_events_occurred_at_idx").on(table.occurredAt)
  ]
);

export const aiRuns = sqliteTable(
  "ai_runs",
  {
    id: text("id").primaryKey(),
    accountUuid: text("account_uuid").notNull(),
    jobId: text("job_id"),
    traceId: text("trace_id").notNull(),
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    inputHash: text("input_hash").notNull(),
    inputJson: text("input_json").notNull(),
    outputJson: text("output_json"),
    error: text("error")
  },
  (table) => [
    index("ai_runs_account_uuid_idx").on(table.accountUuid),
    index("ai_runs_trace_id_idx").on(table.traceId)
  ]
);

export const aiDecisions = sqliteTable(
  "ai_decisions",
  {
    id: text("id").primaryKey(),
    accountUuid: text("account_uuid").notNull(),
    aiRunId: text("ai_run_id").notNull(),
    decisionType: text("decision_type").notNull(),
    outcome: text("outcome").notNull(),
    confidence: real("confidence"),
    requiresHumanReview: integer("requires_human_review", { mode: "boolean" }).notNull(),
    rationaleJson: text("rationale_json").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    index("ai_decisions_account_uuid_idx").on(table.accountUuid),
    index("ai_decisions_ai_run_id_idx").on(table.aiRunId)
  ]
);

export const aiActions = sqliteTable(
  "ai_actions",
  {
    id: text("id").primaryKey(),
    accountUuid: text("account_uuid").notNull(),
    aiRunId: text("ai_run_id"),
    decisionId: text("decision_id"),
    actionType: text("action_type").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    inputJson: text("input_json").notNull(),
    outputJson: text("output_json"),
    error: text("error")
  },
  (table) => [
    index("ai_actions_account_uuid_idx").on(table.accountUuid),
    index("ai_actions_ai_run_id_idx").on(table.aiRunId),
    index("ai_actions_decision_id_idx").on(table.decisionId)
  ]
);

export const evidenceRefs = sqliteTable(
  "evidence_refs",
  {
    id: text("id").primaryKey(),
    accountUuid: text("account_uuid").notNull(),
    aiRunId: text("ai_run_id"),
    decisionId: text("decision_id"),
    sourceType: text("source_type").notNull(),
    provider: text("provider"),
    sourceRef: text("source_ref").notNull(),
    sourceUrl: text("source_url"),
    title: text("title"),
    capturedAt: text("captured_at").notNull(),
    metadataJson: text("metadata_json").notNull()
  },
  (table) => [
    index("evidence_refs_account_uuid_idx").on(table.accountUuid),
    index("evidence_refs_ai_run_id_idx").on(table.aiRunId),
    index("evidence_refs_decision_id_idx").on(table.decisionId)
  ]
);

export const humanReviews = sqliteTable(
  "human_reviews",
  {
    id: text("id").primaryKey(),
    accountUuid: text("account_uuid").notNull(),
    decisionId: text("decision_id"),
    actionId: text("action_id"),
    channel: text("channel").notNull(),
    externalMessageId: text("external_message_id"),
    reviewerActor: text("reviewer_actor").notNull(),
    outcome: text("outcome").notNull(),
    reviewedAt: text("reviewed_at").notNull(),
    note: text("note"),
    payloadJson: text("payload_json").notNull()
  },
  (table) => [
    index("human_reviews_account_uuid_idx").on(table.accountUuid),
    index("human_reviews_decision_id_idx").on(table.decisionId),
    index("human_reviews_action_id_idx").on(table.actionId)
  ]
);

export const runtimeSchema = {
  schemaMigrations,
  accounts,
  accountKeyHistory,
  xIdentities,
  configSnapshots,
  jobs,
  apiCallAudit,
  auditEvents,
  aiRuns,
  aiDecisions,
  aiActions,
  evidenceRefs,
  humanReviews
};

export type RuntimeSchema = typeof runtimeSchema;
