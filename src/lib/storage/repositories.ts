import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  AccountConfig,
  AccountConfigSnapshot,
  AccountKeyRenameAuditRecord,
  XIdentity
} from "../accounts/registry";
import { ApiError } from "../api/errors";
import type { RuntimeDatabase } from "./sqlite";

export type StoredAccount = {
  account_uuid: string;
  account_key: string;
  display_name: string;
  platform: string;
  language: string;
  enabled: 0 | 1;
  config_version: number;
  created_at: string;
  updated_at: string;
};

export type StoredJob = {
  id: string;
  account_uuid: string;
  kind: string;
  status: string;
  idempotency_key: string;
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type StoredApiCallAudit = {
  id: string;
  account_uuid: string;
  provider: string;
  operation: string;
  status: string;
  request_units: number;
  cost_usd: number | null;
  started_at: string;
  finished_at: string | null;
  metadata_json: string;
};

export type StoredAuditEvent = {
  id: string;
  account_uuid: string;
  event_type: string;
  subject_type: string;
  subject_id: string;
  actor_type: string;
  actor_id: string;
  trace_id: string;
  occurred_at: string;
  metadata_json: string;
};

export type StoredAiRun = {
  id: string;
  account_uuid: string;
  job_id: string | null;
  trace_id: string;
  purpose: string;
  model: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  input_hash: string;
  input_json: string;
  output_json: string | null;
  error: string | null;
};

export type StoredAiDecision = {
  id: string;
  account_uuid: string;
  ai_run_id: string;
  decision_type: string;
  outcome: string;
  confidence: number | null;
  requires_human_review: 0 | 1;
  rationale_json: string;
  created_at: string;
};

export type StoredAiAction = {
  id: string;
  account_uuid: string;
  ai_run_id: string | null;
  decision_id: string | null;
  action_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  input_json: string;
  output_json: string | null;
  error: string | null;
};

export type StoredEvidenceRef = {
  id: string;
  account_uuid: string;
  ai_run_id: string | null;
  decision_id: string | null;
  source_type: string;
  provider: string | null;
  source_ref: string;
  source_url: string | null;
  title: string | null;
  captured_at: string;
  metadata_json: string;
};

export type StoredHumanReview = {
  id: string;
  account_uuid: string;
  decision_id: string | null;
  action_id: string | null;
  channel: string;
  external_message_id: string | null;
  reviewer_actor: string;
  outcome: string;
  reviewed_at: string;
  note: string | null;
  payload_json: string;
};

export type CreateJobInput = {
  id: string;
  accountUuid: string;
  kind: string;
  status?: "queued" | "running" | "succeeded" | "failed" | "skipped";
  idempotencyKey: string;
  scheduledAt: string;
  now: string;
};

export type RecordApiCallAuditInput = {
  id: string;
  accountUuid: string;
  provider: string;
  operation: string;
  status: "succeeded" | "failed" | "skipped";
  requestUnits?: number;
  costUsd?: number;
  startedAt: string;
  finishedAt?: string;
  metadata?: Record<string, unknown>;
};

export type RecordAuditEventInput = {
  id: string;
  accountUuid: string;
  eventType: string;
  subjectType: string;
  subjectId: string;
  actorType: "ai" | "system" | "human" | "provider";
  actorId: string;
  traceId: string;
  occurredAt: string;
  metadata?: unknown;
};

export type RecordAiRunInput = {
  id: string;
  accountUuid: string;
  jobId?: string;
  traceId: string;
  purpose: string;
  model: string;
  status: "started" | "succeeded" | "failed" | "skipped";
  startedAt: string;
  finishedAt?: string;
  input: unknown;
  output?: unknown;
  error?: string;
};

export type RecordAiDecisionInput = {
  id: string;
  accountUuid: string;
  aiRunId: string;
  decisionType: string;
  outcome: "auto_post" | "human_review" | "reject" | "defer";
  confidence?: number;
  requiresHumanReview: boolean;
  rationale: unknown;
  createdAt: string;
};

export type RecordAiActionInput = {
  id: string;
  accountUuid: string;
  aiRunId?: string;
  decisionId?: string;
  actionType: string;
  status: "started" | "succeeded" | "failed" | "skipped";
  startedAt: string;
  finishedAt?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
};

export type RecordEvidenceRefInput = {
  id: string;
  accountUuid: string;
  aiRunId?: string;
  decisionId?: string;
  sourceType: "public_x_post" | "public_x_search" | "web_page" | "manual_note" | "runtime_snapshot";
  provider?: string;
  sourceRef: string;
  sourceUrl?: string;
  title?: string;
  capturedAt: string;
  metadata?: unknown;
};

export type RecordHumanReviewInput = {
  id: string;
  accountUuid: string;
  decisionId?: string;
  actionId?: string;
  channel: "telegram" | "local_cli" | "manual";
  externalMessageId?: string;
  reviewerActor: string;
  outcome: "approved" | "rejected" | "edited";
  reviewedAt: string;
  note?: string;
  payload?: unknown;
};

export class RuntimeRepository {
  constructor(private readonly db: RuntimeDatabase) {}

  transaction<T>(callback: () => T): T {
    this.db.exec("BEGIN;");
    try {
      const result = callback();
      this.db.exec("COMMIT;");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  upsertAccount(account: AccountConfig, now: string): void {
    this.db
      .prepare(
        `
INSERT INTO accounts (
  account_uuid, account_key, display_name, platform, language, enabled, config_version, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(account_uuid) DO UPDATE SET
  account_key = excluded.account_key,
  display_name = excluded.display_name,
  platform = excluded.platform,
  language = excluded.language,
  enabled = excluded.enabled,
  config_version = excluded.config_version,
  updated_at = excluded.updated_at
`
      )
      .run(
        account.account_uuid,
        account.account_key,
        account.display_name,
        account.platform,
        account.language,
        account.enabled ? 1 : 0,
        account.config_version,
        now,
        now
      );
  }

  upsertXIdentity(identity: XIdentity): void {
    this.db
      .prepare(
        `
INSERT INTO x_identities (account_uuid, x_user_id, x_handle, oauth_token_status, last_verified_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(account_uuid) DO UPDATE SET
  x_user_id = excluded.x_user_id,
  x_handle = excluded.x_handle,
  oauth_token_status = excluded.oauth_token_status,
  last_verified_at = excluded.last_verified_at
`
      )
      .run(
        identity.account_uuid,
        identity.x_user_id ?? null,
        identity.x_handle ?? null,
        identity.oauth_token_status,
        identity.last_verified_at ?? null
      );
  }

  saveConfigSnapshot(snapshot: AccountConfigSnapshot): string {
    const id = stableId({
      account_uuid: snapshot.account_uuid,
      config_hash: snapshot.config_hash,
      captured_at: snapshot.captured_at
    });
    this.db
      .prepare(
        `
INSERT INTO config_snapshots (
  id, account_uuid, account_key, config_version, config_hash, captured_at, payload_json
) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(account_uuid, config_hash, captured_at) DO NOTHING
`
      )
      .run(
        id,
        snapshot.account_uuid,
        snapshot.account_key,
        snapshot.config_version,
        snapshot.config_hash,
        snapshot.captured_at,
        JSON.stringify(snapshot.payload)
      );
    return id;
  }

  recordAccountKeyRename(record: AccountKeyRenameAuditRecord): string {
    const id = stableId(record);
    this.db
      .prepare(
        `
INSERT INTO account_key_history (id, account_uuid, previous_account_key, next_account_key, actor, at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO NOTHING
`
      )
      .run(id, record.account_uuid, record.previous_account_key, record.next_account_key, record.actor, record.at);
    return id;
  }

  createJob(input: CreateJobInput): void {
    const accountUuid = parseAccountUuid(input.accountUuid);
    this.requireAccountExists(accountUuid);
    this.db
      .prepare(
        `
INSERT INTO jobs (
  id, account_uuid, kind, status, idempotency_key, scheduled_at, attempts, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
`
      )
      .run(
        parseNonEmpty(input.id, "id"),
        accountUuid,
        parseNonEmpty(input.kind, "kind"),
        parseJobStatus(input.status ?? "queued"),
        parseNonEmpty(input.idempotencyKey, "idempotencyKey"),
        parseIsoDateTime(input.scheduledAt, "scheduledAt"),
        parseIsoDateTime(input.now, "now"),
        parseIsoDateTime(input.now, "now")
      );
  }

  recordApiCallAudit(input: RecordApiCallAuditInput): void {
    const accountUuid = parseAccountUuid(input.accountUuid);
    this.requireAccountExists(accountUuid);
    this.db
      .prepare(
        `
INSERT INTO api_call_audit (
  id, account_uuid, provider, operation, status, request_units, cost_usd, started_at, finished_at, metadata_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`
      )
      .run(
        parseNonEmpty(input.id, "id"),
        accountUuid,
        parseNonEmpty(input.provider, "provider"),
        parseNonEmpty(input.operation, "operation"),
        parseApiCallStatus(input.status),
        input.requestUnits ?? 1,
        input.costUsd ?? null,
        parseIsoDateTime(input.startedAt, "startedAt"),
        input.finishedAt ? parseIsoDateTime(input.finishedAt, "finishedAt") : null,
        JSON.stringify(input.metadata ?? {})
      );
  }

  recordAuditEvent(input: RecordAuditEventInput): void {
    const accountUuid = parseAccountUuid(input.accountUuid);
    this.requireAccountExists(accountUuid);
    const actorType = parseActorType(input.actorType);
    this.db
      .prepare(
        `
INSERT INTO audit_events (
  id, account_uuid, event_type, subject_type, subject_id, actor_type, actor_id, trace_id, occurred_at, metadata_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`
      )
      .run(
        parseNonEmpty(input.id, "id"),
        accountUuid,
        parseNonEmpty(input.eventType, "eventType"),
        parseNonEmpty(input.subjectType, "subjectType"),
        parseNonEmpty(input.subjectId, "subjectId"),
        actorType,
        parseNonEmpty(input.actorId, "actorId"),
        parseNonEmpty(input.traceId, "traceId"),
        parseIsoDateTime(input.occurredAt, "occurredAt"),
        jsonText(input.metadata ?? {}, "metadata")
      );
  }

  recordAiRun(input: RecordAiRunInput): void {
    const accountUuid = parseAccountUuid(input.accountUuid);
    this.requireAccountExists(accountUuid);
    if (input.jobId) {
      this.requireJobAccount(input.jobId, accountUuid);
    }

    this.db
      .prepare(
        `
INSERT INTO ai_runs (
  id, account_uuid, job_id, trace_id, purpose, model, status, started_at, finished_at,
  input_hash, input_json, output_json, error
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`
      )
      .run(
        parseNonEmpty(input.id, "id"),
        accountUuid,
        input.jobId ?? null,
        parseNonEmpty(input.traceId, "traceId"),
        parseNonEmpty(input.purpose, "purpose"),
        parseNonEmpty(input.model, "model"),
        parseRunStatus(input.status),
        parseIsoDateTime(input.startedAt, "startedAt"),
        input.finishedAt ? parseIsoDateTime(input.finishedAt, "finishedAt") : null,
        stableId(input.input),
        jsonText(input.input, "input"),
        input.output === undefined ? null : jsonText(input.output, "output"),
        input.error ?? null
      );
  }

  recordAiDecision(input: RecordAiDecisionInput): void {
    const accountUuid = parseAccountUuid(input.accountUuid);
    this.requireAccountExists(accountUuid);
    this.requireAiRunAccount(input.aiRunId, accountUuid);
    if (input.confidence !== undefined && (input.confidence < 0 || input.confidence > 1)) {
      throw auditLedgerError("confidence must be between 0 and 1");
    }

    this.db
      .prepare(
        `
INSERT INTO ai_decisions (
  id, account_uuid, ai_run_id, decision_type, outcome, confidence, requires_human_review, rationale_json, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`
      )
      .run(
        parseNonEmpty(input.id, "id"),
        accountUuid,
        parseNonEmpty(input.aiRunId, "aiRunId"),
        parseNonEmpty(input.decisionType, "decisionType"),
        parseDecisionOutcome(input.outcome),
        input.confidence ?? null,
        input.requiresHumanReview ? 1 : 0,
        jsonText(input.rationale, "rationale"),
        parseIsoDateTime(input.createdAt, "createdAt")
      );
  }

  recordAiAction(input: RecordAiActionInput): void {
    const accountUuid = parseAccountUuid(input.accountUuid);
    this.requireAccountExists(accountUuid);
    if (!input.aiRunId && !input.decisionId) {
      throw auditLedgerError("ai action must reference aiRunId or decisionId");
    }
    if (input.aiRunId) {
      this.requireAiRunAccount(input.aiRunId, accountUuid);
    }
    if (input.decisionId) {
      const decision = this.requireAiDecisionAccount(input.decisionId, accountUuid);
      if (input.aiRunId && decision.ai_run_id !== input.aiRunId) {
        throw auditLedgerError("decisionId belongs to a different aiRunId");
      }
    }

    this.db
      .prepare(
        `
INSERT INTO ai_actions (
  id, account_uuid, ai_run_id, decision_id, action_type, status, started_at, finished_at, input_json, output_json, error
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`
      )
      .run(
        parseNonEmpty(input.id, "id"),
        accountUuid,
        input.aiRunId ?? null,
        input.decisionId ?? null,
        parseNonEmpty(input.actionType, "actionType"),
        parseRunStatus(input.status),
        parseIsoDateTime(input.startedAt, "startedAt"),
        input.finishedAt ? parseIsoDateTime(input.finishedAt, "finishedAt") : null,
        jsonText(input.input ?? {}, "input"),
        input.output === undefined ? null : jsonText(input.output, "output"),
        input.error ?? null
      );
  }

  recordEvidenceRef(input: RecordEvidenceRefInput): void {
    const accountUuid = parseAccountUuid(input.accountUuid);
    this.requireAccountExists(accountUuid);
    if (!input.aiRunId && !input.decisionId) {
      throw auditLedgerError("evidence ref must reference aiRunId or decisionId");
    }
    if (input.aiRunId) {
      this.requireAiRunAccount(input.aiRunId, accountUuid);
    }
    if (input.decisionId) {
      const decision = this.requireAiDecisionAccount(input.decisionId, accountUuid);
      if (input.aiRunId && decision.ai_run_id !== input.aiRunId) {
        throw auditLedgerError("decisionId belongs to a different aiRunId");
      }
    }

    this.db
      .prepare(
        `
INSERT INTO evidence_refs (
  id, account_uuid, ai_run_id, decision_id, source_type, provider, source_ref, source_url,
  title, captured_at, metadata_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`
      )
      .run(
        parseNonEmpty(input.id, "id"),
        accountUuid,
        input.aiRunId ?? null,
        input.decisionId ?? null,
        parseEvidenceSourceType(input.sourceType),
        input.provider ?? null,
        parseNonEmpty(input.sourceRef, "sourceRef"),
        input.sourceUrl ?? null,
        input.title ?? null,
        parseIsoDateTime(input.capturedAt, "capturedAt"),
        jsonText(input.metadata ?? {}, "metadata")
      );
  }

  recordHumanReview(input: RecordHumanReviewInput): void {
    const accountUuid = parseAccountUuid(input.accountUuid);
    this.requireAccountExists(accountUuid);
    if (!input.decisionId && !input.actionId) {
      throw auditLedgerError("human review must reference decisionId or actionId");
    }
    let decision: Pick<StoredAiDecision, "account_uuid" | "ai_run_id"> | undefined;
    if (input.decisionId) {
      decision = this.requireAiDecisionAccount(input.decisionId, accountUuid);
    }
    if (input.actionId) {
      const action = this.requireAiActionAccount(input.actionId, accountUuid);
      if (input.decisionId && decision) {
        if (action.decision_id && action.decision_id !== input.decisionId) {
          throw auditLedgerError("actionId belongs to a different decisionId");
        }
        if (!action.decision_id && action.ai_run_id !== decision.ai_run_id) {
          throw auditLedgerError("actionId belongs to a different aiRunId");
        }
      }
    }

    this.db
      .prepare(
        `
INSERT INTO human_reviews (
  id, account_uuid, decision_id, action_id, channel, external_message_id, reviewer_actor,
  outcome, reviewed_at, note, payload_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`
      )
      .run(
        parseNonEmpty(input.id, "id"),
        accountUuid,
        input.decisionId ?? null,
        input.actionId ?? null,
        parseHumanReviewChannel(input.channel),
        input.externalMessageId ?? null,
        parseNonEmpty(input.reviewerActor, "reviewerActor"),
        parseHumanReviewOutcome(input.outcome),
        parseIsoDateTime(input.reviewedAt, "reviewedAt"),
        input.note ?? null,
        jsonText(input.payload ?? {}, "payload")
      );
  }

  listAccounts(): StoredAccount[] {
    return this.db.prepare("SELECT * FROM accounts ORDER BY account_key").all() as StoredAccount[];
  }

  getAccountByUuid(accountUuid: string): StoredAccount | undefined {
    return this.db.prepare("SELECT * FROM accounts WHERE account_uuid = ?").get(accountUuid) as StoredAccount | undefined;
  }

  listJobsForAccount(accountUuid: string): StoredJob[] {
    return this.db
      .prepare("SELECT * FROM jobs WHERE account_uuid = ? ORDER BY scheduled_at, id")
      .all(accountUuid) as StoredJob[];
  }

  listApiCallAuditForAccount(accountUuid: string): StoredApiCallAudit[] {
    return this.db
      .prepare("SELECT * FROM api_call_audit WHERE account_uuid = ? ORDER BY started_at, id")
      .all(accountUuid) as StoredApiCallAudit[];
  }

  listAuditEventsForAccount(accountUuid: string): StoredAuditEvent[] {
    return this.db
      .prepare("SELECT * FROM audit_events WHERE account_uuid = ? ORDER BY occurred_at, id")
      .all(accountUuid) as StoredAuditEvent[];
  }

  listAiRunsForAccount(accountUuid: string): StoredAiRun[] {
    return this.db.prepare("SELECT * FROM ai_runs WHERE account_uuid = ? ORDER BY started_at, id").all(accountUuid) as StoredAiRun[];
  }

  listAiDecisionsForAccount(accountUuid: string): StoredAiDecision[] {
    return this.db
      .prepare("SELECT * FROM ai_decisions WHERE account_uuid = ? ORDER BY created_at, id")
      .all(accountUuid) as StoredAiDecision[];
  }

  listAiActionsForAccount(accountUuid: string): StoredAiAction[] {
    return this.db
      .prepare("SELECT * FROM ai_actions WHERE account_uuid = ? ORDER BY started_at, id")
      .all(accountUuid) as StoredAiAction[];
  }

  listEvidenceRefsForAccount(accountUuid: string): StoredEvidenceRef[] {
    return this.db
      .prepare("SELECT * FROM evidence_refs WHERE account_uuid = ? ORDER BY captured_at, id")
      .all(accountUuid) as StoredEvidenceRef[];
  }

  listHumanReviewsForAccount(accountUuid: string): StoredHumanReview[] {
    return this.db
      .prepare("SELECT * FROM human_reviews WHERE account_uuid = ? ORDER BY reviewed_at, id")
      .all(accountUuid) as StoredHumanReview[];
  }

  countRows(
    tableName:
      | "accounts"
      | "jobs"
      | "api_call_audit"
      | "config_snapshots"
      | "audit_events"
      | "ai_runs"
      | "ai_decisions"
      | "ai_actions"
      | "evidence_refs"
      | "human_reviews"
  ): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
    return row.count;
  }

  private requireAccountExists(accountUuid: string): void {
    if (!this.getAccountByUuid(accountUuid)) {
      throw auditLedgerError(`account_uuid is missing in runtime storage: ${accountUuid}`);
    }
  }

  private requireJobAccount(jobId: string, accountUuid: string): void {
    const row = this.db.prepare("SELECT account_uuid FROM jobs WHERE id = ?").get(jobId) as { account_uuid: string } | undefined;
    if (!row) {
      throw auditLedgerError(`job_id is missing in runtime storage: ${jobId}`);
    }
    if (row.account_uuid !== accountUuid) {
      throw auditLedgerError("job_id belongs to a different account_uuid");
    }
  }

  private requireAiRunAccount(aiRunId: string, accountUuid: string): void {
    const row = this.db.prepare("SELECT account_uuid FROM ai_runs WHERE id = ?").get(aiRunId) as
      | { account_uuid: string }
      | undefined;
    if (!row) {
      throw auditLedgerError(`aiRunId is missing in runtime storage: ${aiRunId}`);
    }
    if (row.account_uuid !== accountUuid) {
      throw auditLedgerError("aiRunId belongs to a different account_uuid");
    }
  }

  private requireAiDecisionAccount(decisionId: string, accountUuid: string): Pick<StoredAiDecision, "account_uuid" | "ai_run_id"> {
    const row = this.db.prepare("SELECT account_uuid, ai_run_id FROM ai_decisions WHERE id = ?").get(decisionId) as
      | Pick<StoredAiDecision, "account_uuid" | "ai_run_id">
      | undefined;
    if (!row) {
      throw auditLedgerError(`decisionId is missing in runtime storage: ${decisionId}`);
    }
    if (row.account_uuid !== accountUuid) {
      throw auditLedgerError("decisionId belongs to a different account_uuid");
    }
    return row;
  }

  private requireAiActionAccount(
    actionId: string,
    accountUuid: string
  ): Pick<StoredAiAction, "account_uuid" | "decision_id" | "ai_run_id"> {
    const row = this.db.prepare("SELECT account_uuid, decision_id, ai_run_id FROM ai_actions WHERE id = ?").get(actionId) as
      | Pick<StoredAiAction, "account_uuid" | "decision_id" | "ai_run_id">
      | undefined;
    if (!row) {
      throw auditLedgerError(`actionId is missing in runtime storage: ${actionId}`);
    }
    if (row.account_uuid !== accountUuid) {
      throw auditLedgerError("actionId belongs to a different account_uuid");
    }
    return row;
  }
}

const accountUuidSchema = z.string().uuid();
const isoDateTimeSchema = z.string().datetime();
const nonEmptyStringSchema = z.string().trim().min(1);
const actorTypeSchema = z.enum(["ai", "system", "human", "provider"]);
const jobStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "skipped"]);
const apiCallStatusSchema = z.enum(["succeeded", "failed", "skipped"]);
const runStatusSchema = z.enum(["started", "succeeded", "failed", "skipped"]);
const decisionOutcomeSchema = z.enum(["auto_post", "human_review", "reject", "defer"]);
const evidenceSourceTypeSchema = z.enum(["public_x_post", "public_x_search", "web_page", "manual_note", "runtime_snapshot"]);
const humanReviewChannelSchema = z.enum(["telegram", "local_cli", "manual"]);
const humanReviewOutcomeSchema = z.enum(["approved", "rejected", "edited"]);

function stableId(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function parseAccountUuid(value: string): string {
  const parsed = accountUuidSchema.safeParse(value);
  if (!parsed.success) {
    throw auditLedgerError("accountUuid must be a UUID");
  }

  return parsed.data;
}

function parseIsoDateTime(value: string, field: string): string {
  const parsed = isoDateTimeSchema.safeParse(value);
  if (!parsed.success) {
    throw auditLedgerError(`${field} must be an ISO datetime`);
  }

  return parsed.data;
}

function parseNonEmpty(value: string, field: string): string {
  const parsed = nonEmptyStringSchema.safeParse(value);
  if (!parsed.success) {
    throw auditLedgerError(`${field} must be non-empty`);
  }

  return parsed.data;
}

function parseActorType(value: unknown): z.infer<typeof actorTypeSchema> {
  return parseEnum(actorTypeSchema, value, "actorType");
}

function parseJobStatus(value: unknown): z.infer<typeof jobStatusSchema> {
  return parseEnum(jobStatusSchema, value, "status");
}

function parseApiCallStatus(value: unknown): z.infer<typeof apiCallStatusSchema> {
  return parseEnum(apiCallStatusSchema, value, "status");
}

function parseRunStatus(value: unknown): z.infer<typeof runStatusSchema> {
  return parseEnum(runStatusSchema, value, "status");
}

function parseDecisionOutcome(value: unknown): z.infer<typeof decisionOutcomeSchema> {
  return parseEnum(decisionOutcomeSchema, value, "outcome");
}

function parseEvidenceSourceType(value: unknown): z.infer<typeof evidenceSourceTypeSchema> {
  return parseEnum(evidenceSourceTypeSchema, value, "sourceType");
}

function parseHumanReviewChannel(value: unknown): z.infer<typeof humanReviewChannelSchema> {
  return parseEnum(humanReviewChannelSchema, value, "channel");
}

function parseHumanReviewOutcome(value: unknown): z.infer<typeof humanReviewOutcomeSchema> {
  return parseEnum(humanReviewOutcomeSchema, value, "outcome");
}

function parseEnum<T extends z.ZodEnum<[string, ...string[]]>>(schema: T, value: unknown, field: string): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw auditLedgerError(`${field} is invalid`, parsed.error.flatten());
  }

  return parsed.data;
}

function jsonText(value: unknown, field: string): string {
  try {
    return JSON.stringify(value);
  } catch (error) {
    throw auditLedgerError(`${field} must be JSON serializable`, error);
  }
}

function auditLedgerError(message: string, details?: unknown): ApiError {
  return new ApiError({
    code: "invalid_request",
    provider: "local",
    stage: "audit_ledger",
    message,
    details
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
