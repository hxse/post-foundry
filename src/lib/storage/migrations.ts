export type RuntimeMigration = {
  id: string;
  sql: string;
};

export const migrationTableSql = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL
);
`;

export const runtimeMigrations: RuntimeMigration[] = [
  {
    id: "0001_runtime_storage_baseline",
    sql: `
CREATE TABLE IF NOT EXISTS accounts (
  account_uuid TEXT PRIMARY KEY NOT NULL,
  account_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  language TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  config_version INTEGER NOT NULL CHECK (config_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_key_history (
  id TEXT PRIMARY KEY NOT NULL,
  account_uuid TEXT NOT NULL,
  previous_account_key TEXT NOT NULL,
  next_account_key TEXT NOT NULL,
  actor TEXT NOT NULL,
  at TEXT NOT NULL,
  FOREIGN KEY (account_uuid) REFERENCES accounts(account_uuid)
);
CREATE INDEX IF NOT EXISTS account_key_history_account_uuid_idx ON account_key_history(account_uuid);

CREATE TABLE IF NOT EXISTS x_identities (
  account_uuid TEXT PRIMARY KEY NOT NULL,
  x_user_id TEXT,
  x_handle TEXT,
  oauth_token_status TEXT NOT NULL,
  last_verified_at TEXT,
  FOREIGN KEY (account_uuid) REFERENCES accounts(account_uuid)
);

CREATE TABLE IF NOT EXISTS config_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  account_uuid TEXT NOT NULL,
  account_key TEXT NOT NULL,
  config_version INTEGER NOT NULL,
  config_hash TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (account_uuid) REFERENCES accounts(account_uuid),
  UNIQUE (account_uuid, config_hash, captured_at)
);
CREATE INDEX IF NOT EXISTS config_snapshots_account_uuid_idx ON config_snapshots(account_uuid);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY NOT NULL,
  account_uuid TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (account_uuid) REFERENCES accounts(account_uuid),
  UNIQUE (account_uuid, idempotency_key)
);
CREATE INDEX IF NOT EXISTS jobs_account_uuid_idx ON jobs(account_uuid);

CREATE TABLE IF NOT EXISTS api_call_audit (
  id TEXT PRIMARY KEY NOT NULL,
  account_uuid TEXT NOT NULL,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  request_units INTEGER NOT NULL DEFAULT 1 CHECK (request_units >= 0),
  cost_usd REAL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY (account_uuid) REFERENCES accounts(account_uuid)
);
CREATE INDEX IF NOT EXISTS api_call_audit_account_uuid_idx ON api_call_audit(account_uuid);
`
  },
  {
    id: "0002_audit_event_ledger_baseline",
    sql: `
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  account_uuid TEXT NOT NULL,
  event_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY (account_uuid) REFERENCES accounts(account_uuid)
);
CREATE INDEX IF NOT EXISTS audit_events_account_uuid_idx ON audit_events(account_uuid);
CREATE INDEX IF NOT EXISTS audit_events_trace_id_idx ON audit_events(trace_id);
CREATE INDEX IF NOT EXISTS audit_events_occurred_at_idx ON audit_events(occurred_at);

CREATE TABLE IF NOT EXISTS ai_runs (
  id TEXT PRIMARY KEY NOT NULL,
  account_uuid TEXT NOT NULL,
  job_id TEXT,
  trace_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  input_hash TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT,
  error TEXT,
  FOREIGN KEY (account_uuid) REFERENCES accounts(account_uuid),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE INDEX IF NOT EXISTS ai_runs_account_uuid_idx ON ai_runs(account_uuid);
CREATE INDEX IF NOT EXISTS ai_runs_trace_id_idx ON ai_runs(trace_id);

CREATE TABLE IF NOT EXISTS ai_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  account_uuid TEXT NOT NULL,
  ai_run_id TEXT NOT NULL,
  decision_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  requires_human_review INTEGER NOT NULL CHECK (requires_human_review IN (0, 1)),
  rationale_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (account_uuid) REFERENCES accounts(account_uuid),
  FOREIGN KEY (ai_run_id) REFERENCES ai_runs(id)
);
CREATE INDEX IF NOT EXISTS ai_decisions_account_uuid_idx ON ai_decisions(account_uuid);
CREATE INDEX IF NOT EXISTS ai_decisions_ai_run_id_idx ON ai_decisions(ai_run_id);

CREATE TABLE IF NOT EXISTS ai_actions (
  id TEXT PRIMARY KEY NOT NULL,
  account_uuid TEXT NOT NULL,
  ai_run_id TEXT,
  decision_id TEXT,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  input_json TEXT NOT NULL,
  output_json TEXT,
  error TEXT,
  FOREIGN KEY (account_uuid) REFERENCES accounts(account_uuid),
  FOREIGN KEY (ai_run_id) REFERENCES ai_runs(id),
  FOREIGN KEY (decision_id) REFERENCES ai_decisions(id),
  CHECK (ai_run_id IS NOT NULL OR decision_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ai_actions_account_uuid_idx ON ai_actions(account_uuid);
CREATE INDEX IF NOT EXISTS ai_actions_ai_run_id_idx ON ai_actions(ai_run_id);
CREATE INDEX IF NOT EXISTS ai_actions_decision_id_idx ON ai_actions(decision_id);

CREATE TABLE IF NOT EXISTS evidence_refs (
  id TEXT PRIMARY KEY NOT NULL,
  account_uuid TEXT NOT NULL,
  ai_run_id TEXT,
  decision_id TEXT,
  source_type TEXT NOT NULL,
  provider TEXT,
  source_ref TEXT NOT NULL,
  source_url TEXT,
  title TEXT,
  captured_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY (account_uuid) REFERENCES accounts(account_uuid),
  FOREIGN KEY (ai_run_id) REFERENCES ai_runs(id),
  FOREIGN KEY (decision_id) REFERENCES ai_decisions(id),
  CHECK (ai_run_id IS NOT NULL OR decision_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS evidence_refs_account_uuid_idx ON evidence_refs(account_uuid);
CREATE INDEX IF NOT EXISTS evidence_refs_ai_run_id_idx ON evidence_refs(ai_run_id);
CREATE INDEX IF NOT EXISTS evidence_refs_decision_id_idx ON evidence_refs(decision_id);

CREATE TABLE IF NOT EXISTS human_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  account_uuid TEXT NOT NULL,
  decision_id TEXT,
  action_id TEXT,
  channel TEXT NOT NULL,
  external_message_id TEXT,
  reviewer_actor TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  note TEXT,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (account_uuid) REFERENCES accounts(account_uuid),
  FOREIGN KEY (decision_id) REFERENCES ai_decisions(id),
  FOREIGN KEY (action_id) REFERENCES ai_actions(id),
  CHECK (decision_id IS NOT NULL OR action_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS human_reviews_account_uuid_idx ON human_reviews(account_uuid);
CREATE INDEX IF NOT EXISTS human_reviews_decision_id_idx ON human_reviews(decision_id);
CREATE INDEX IF NOT EXISTS human_reviews_action_id_idx ON human_reviews(action_id);
`
  }
];
