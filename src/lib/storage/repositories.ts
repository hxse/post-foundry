import { createHash } from "node:crypto";
import type {
  AccountConfig,
  AccountConfigSnapshot,
  AccountKeyRenameAuditRecord,
  XIdentity
} from "../accounts/registry";
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

export class RuntimeRepository {
  constructor(private readonly db: RuntimeDatabase) {}

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
    this.db
      .prepare(
        `
INSERT INTO jobs (
  id, account_uuid, kind, status, idempotency_key, scheduled_at, attempts, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
`
      )
      .run(
        input.id,
        input.accountUuid,
        input.kind,
        input.status ?? "queued",
        input.idempotencyKey,
        input.scheduledAt,
        input.now,
        input.now
      );
  }

  recordApiCallAudit(input: RecordApiCallAuditInput): void {
    this.db
      .prepare(
        `
INSERT INTO api_call_audit (
  id, account_uuid, provider, operation, status, request_units, cost_usd, started_at, finished_at, metadata_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`
      )
      .run(
        input.id,
        input.accountUuid,
        input.provider,
        input.operation,
        input.status,
        input.requestUnits ?? 1,
        input.costUsd ?? null,
        input.startedAt,
        input.finishedAt ?? null,
        JSON.stringify(input.metadata ?? {})
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

  countRows(tableName: "accounts" | "jobs" | "api_call_audit" | "config_snapshots"): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
    return row.count;
  }
}

function stableId(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
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
