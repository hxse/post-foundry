import {
  createAccountConfigSnapshot,
  resolveAccountRef,
  type AccountRegistry
} from "../accounts/registry";
import { ApiError } from "../api/errors";
import { collectAccountPublicXSourceBatch, type PublicXSourceCollectionResult } from "../context/source-collection";
import type { PublicXDataProvider } from "../providers/public-x";
import type { RuntimeRepository } from "../storage/repositories";
import type { OnlineOperationContext, OnlineOperationExecutor, OnlineOperationExecutorResult } from "./online-runner";

export type ProductionSourceCollectionExecutorInput = {
  repo: RuntimeRepository;
  registry: AccountRegistry;
  accountKey: string;
  provider: PublicXDataProvider;
  configSnapshotId?: string;
  maxQueries?: number;
  perQueryLimit?: number;
};

export function createProductionSourceCollectionExecutor(input: ProductionSourceCollectionExecutorInput): OnlineOperationExecutor {
  return async (context) => runProductionSourceCollection(input, context);
}

async function runProductionSourceCollection(
  input: ProductionSourceCollectionExecutorInput,
  context: OnlineOperationContext
): Promise<OnlineOperationExecutorResult> {
  if (context.accountKey !== input.accountKey) {
    throw executorError("executor accountKey does not match runner context", {
      inputAccountKey: input.accountKey,
      contextAccountKey: context.accountKey
    });
  }

  const { account } = resolveAccountRef(input.registry, { accountKey: input.accountKey });
  seedRegistry(input.repo, input.registry, context.startedAt);
  const configSnapshotId =
    input.configSnapshotId ??
    input.repo.saveConfigSnapshot(
      createAccountConfigSnapshot({
        registry: input.registry,
        ref: { accountKey: input.accountKey },
        capturedAt: context.startedAt
      })
    );

  const result = await collectAccountPublicXSourceBatch({
    repo: input.repo,
    account,
    provider: input.provider,
    traceId: context.traceId,
    runId: `${context.traceId}:source-collection-run`,
    auditEventId: `${context.traceId}:source-collection-event`,
    configSnapshotId,
    collectedAt: context.startedAt,
    maxQueries: input.maxQueries,
    perQueryLimit: input.perQueryLimit
  });

  return summarizeCollection(result, configSnapshotId);
}

function seedRegistry(repo: RuntimeRepository, registry: AccountRegistry, now: string): void {
  for (const account of registry.config.accounts) {
    repo.upsertAccount(account, now);
  }
  for (const identity of registry.config.x_identities) {
    repo.upsertXIdentity(identity);
  }
}

function summarizeCollection(result: PublicXSourceCollectionResult, configSnapshotId: string): OnlineOperationExecutorResult {
  const skipped = result.status === "skipped";
  return {
    outcome: skipped ? "skipped" : "completed",
    finalAction: skipped ? "source_collection_skipped" : "source_collection_collected",
    summary: {
      executor: "production_source_collection_v1",
      online: true,
      provider: "twitterapi.io",
      source_collection_status: result.status,
      skipped_reason: result.skippedReason,
      query_count: result.queries.length,
      request_units: result.requestUnits,
      raw_count: result.rawCount,
      material_count: result.materials.length,
      duplicate_material_count: result.duplicateMaterialCount,
      api_audit_ids: result.apiAuditIds,
      config_snapshot_id: configSnapshotId
    }
  };
}

function executorError(message: string, details?: unknown): ApiError {
  return new ApiError({
    code: "invalid_request",
    provider: "local",
    stage: "production_source_collection_executor",
    message,
    details
  });
}
