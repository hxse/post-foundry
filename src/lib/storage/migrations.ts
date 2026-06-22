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
  }
];
