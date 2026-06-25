import { randomUUID } from "node:crypto";
import { ApiError, isApiError } from "../lib/api/errors";
import type { FetchLike } from "../lib/api/http";
import { redactSecrets, tokenFingerprint } from "../lib/api/redaction";
import { resolveAccountCredentials } from "../lib/api/secrets";
import { loadAccountInitialPrompt } from "../lib/accounts/account-prompt";
import { createAccountConfigSnapshot, loadAccountRegistryFromSecretsFile, resolveAccountRef } from "../lib/accounts/registry";
import { parseDebugOnlineSourceCollectionArgs } from "../lib/context/source-collection-debug-args";
import { collectAccountPublicXSourceBatch } from "../lib/context/source-collection";
import { derivePublicXSearchQueriesFromPrompt } from "../lib/context/source-queries";
import { TwitterApiIoPublicXAdapter } from "../lib/providers/twitterapi-io";
import { RuntimeRepository } from "../lib/storage/repositories";
import { openRuntimeDatabase } from "../lib/storage/sqlite";

async function main(): Promise<void> {
  const args = parseDebugOnlineSourceCollectionArgs(process.argv.slice(2));
  const registry = await loadAccountRegistryFromSecretsFile({ secretsPath: args.secretsFile });
  const resolution = resolveAccountRef(registry, { accountKey: args.account });
  const account = resolution.account;
  const prompt = await loadAccountInitialPrompt({ accountKey: args.account, secretsPath: args.secretsFile });
  const sourceQueries = derivePublicXSearchQueriesFromPrompt(prompt);

  console.log("source collection online debug");
  console.log(`account=${account.account_key}`);
  console.log(`secrets_file=${args.secretsFile ?? "default"}`);
  console.log(`provider=${account.data_sources.public_x.provider}`);
  console.log(`public_x_enabled=${String(account.data_sources.public_x.enabled)}`);
  console.log(`derived_source_queries=${sourceQueries.length}`);
  console.log(`max_requests=${args.maxRequests}`);
  console.log(`per_query_limit=${args.perQueryLimit}`);

  if (!args.collect) {
    console.log("collect: skipped, --collect was not supplied");
    return;
  }

  const credentials = await resolveAccountCredentials({ accountKey: args.account, secretsPath: args.secretsFile });
  console.log(`credentials: twitterapi.io=${tokenFingerprint(credentials.twitterApiIoApiKey)}`);

  const db = openRuntimeDatabase({ path: args.dbFile });
  try {
    const repo = new RuntimeRepository(db);
    const now = new Date().toISOString();
    for (const configuredAccount of registry.config.accounts) {
      repo.upsertAccount(configuredAccount, now);
    }
    for (const identity of registry.config.x_identities) {
      repo.upsertXIdentity(identity);
    }
    const configSnapshotId = repo.saveConfigSnapshot(
      createAccountConfigSnapshot({
        registry,
        ref: { accountKey: args.account },
        capturedAt: now
      })
    );
    const traceId = createTraceId(account.account_key, now);
    const runId = `${traceId}:source-collection-run`;
    const auditEventId = `${traceId}:source-collection-event`;
    const provider = new TwitterApiIoPublicXAdapter({
      apiKey: credentials.twitterApiIoApiKey,
      fetcher: buildDebugFetcher(process.env)
    });

    const result = await collectAccountPublicXSourceBatch({
      repo,
      account,
      provider,
      traceId,
      runId,
      auditEventId,
      configSnapshotId,
      collectedAt: now,
      sourceQueries,
      maxQueries: args.maxRequests,
      perQueryLimit: args.perQueryLimit
    });

    console.log("source collection: ok");
    console.log(`db_file=${args.dbFile ?? "default"}`);
    console.log(`trace_id=${traceId}`);
    console.log(`run_id=${runId}`);
    console.log(`status=${result.status}`);
    console.log(`queries=${result.queries.length}`);
    console.log(`request_units=${result.requestUnits}`);
    console.log(`raw_count=${result.rawCount}`);
    console.log(`materials=${result.materials.length}`);
    console.log(`duplicates=${result.duplicateMaterialCount}`);
    if (result.skippedReason) {
      console.log(`skipped_reason=${result.skippedReason}`);
    }
  } finally {
    db.close();
  }
}

function createTraceId(accountKey: string, collectedAt: string): string {
  return `trace-source-collection-${accountKey}-${collectedAt.replace(/[^0-9TZ]/g, "")}-${randomUUID()}`;
}

function buildDebugFetcher(env: NodeJS.ProcessEnv): FetchLike | undefined {
  const timeoutMs = resolveDebugTimeoutMs(env);
  if (!timeoutMs) {
    return undefined;
  }

  return async (input, init) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  };
}

function resolveDebugTimeoutMs(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env.POST_FOUNDRY_SOURCE_DEBUG_TIMEOUT_MS;
  if (!raw) {
    return undefined;
  }

  const timeoutMs = Number(raw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new ApiError({
      code: "invalid_request",
      provider: "local",
      stage: "source_debug_timeout",
      message: "POST_FOUNDRY_SOURCE_DEBUG_TIMEOUT_MS must be a positive integer"
    });
  }

  return timeoutMs;
}

main().catch((error: unknown) => {
  if (isApiError(error)) {
    console.error(`ERROR ${error.code}`);
    console.error(`provider: ${error.provider}`);
    console.error(`stage: ${error.stage}`);
    if (error.status) {
      console.error(`status: ${error.status}`);
    }
    console.error(`reason: ${redactSecrets(error.message)}`);
    process.exitCode = 1;
    return;
  }

  console.error(redactSecrets(String(error)));
  process.exitCode = 1;
});
