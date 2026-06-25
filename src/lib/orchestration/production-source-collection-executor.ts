import {
  createAccountConfigSnapshot,
  resolveAccountRef,
  type AccountConfigSnapshot,
  type AccountRegistry
} from "../accounts/registry";
import type { AccountInitialPrompt } from "../accounts/account-prompt";
import { ApiError } from "../api/errors";
import { derivePublicXSearchQueriesFromPrompt } from "../context/source-queries";
import { collectAccountPublicXSourceBatch, type PublicXSourceCollectionResult } from "../context/source-collection";
import { buildSourceContext, recordSourceContextIngestion, type RecentPostInput, type SourceContextPackage } from "../context/source-ingestion";
import type { PublicXDataProvider } from "../providers/public-x";
import type { RuntimeRepository } from "../storage/repositories";
import { buildTopicRadar, recordTopicRadarSelection, type TopicRadarPackage } from "../topics/topic-radar";
import type { OnlineOperationContext, OnlineOperationExecutor, OnlineOperationExecutorResult } from "./online-runner";

export type ProductionSourceCollectionExecutorInput = {
  repo: RuntimeRepository;
  registry: AccountRegistry;
  accountKey: string;
  provider: PublicXDataProvider;
  loadPrompt: () => Promise<AccountInitialPrompt> | AccountInitialPrompt;
  recentPosts?: RecentPostInput[];
  configSnapshotId?: string;
  maxQueries?: number;
  perQueryLimit?: number;
  candidatesLimit?: number;
  duplicateThreshold?: number;
  materialsLimit?: number;
  recentPostsLimit?: number;
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
  const configSnapshot = createAccountConfigSnapshot({
    registry: input.registry,
    ref: { accountKey: input.accountKey },
    capturedAt: context.startedAt
  });
  const configSnapshotId = input.configSnapshotId ?? input.repo.saveConfigSnapshot(configSnapshot);
  const shouldLoadPromptForSource = account.enabled && account.data_sources.public_x.enabled;
  const promptForSource = shouldLoadPromptForSource ? await input.loadPrompt() : undefined;
  const sourceQueries = promptForSource ? derivePublicXSearchQueriesFromPrompt(promptForSource) : [];

  const sourceCollection = await collectAccountPublicXSourceBatch({
    repo: input.repo,
    account,
    provider: input.provider,
    traceId: context.traceId,
    runId: idsFor(context.traceId).sourceCollectionRunId,
    auditEventId: idsFor(context.traceId).sourceCollectionAuditEventId,
    configSnapshotId,
    collectedAt: context.startedAt,
    sourceQueries,
    maxQueries: input.maxQueries,
    perQueryLimit: input.perQueryLimit
  });

  if (sourceCollection.status === "skipped") {
    return summarizeSourceOnly(sourceCollection, configSnapshotId);
  }
  if (sourceCollection.materials.length === 0) {
    return summarizeEmptyCollection(sourceCollection, configSnapshotId);
  }

  const topicRadar = buildTopicRadar({
    account,
    configSnapshot,
    configSnapshotId,
    prompt: promptForSource ?? await input.loadPrompt(),
    materials: sourceCollection.materials,
    recentPosts: input.recentPosts ?? [],
    observedAt: context.startedAt,
    candidatesLimit: input.candidatesLimit,
    duplicateThreshold: input.duplicateThreshold
  });
  recordTopicRadarSelection({
    repo: input.repo,
    radar: topicRadar,
    runId: idsFor(context.traceId).topicRunId,
    auditEventId: idsFor(context.traceId).topicAuditEventId,
    traceId: context.traceId,
    startedAt: context.startedAt,
    finishedAt: context.startedAt,
    model: "topic-radar-production-v0",
    actorId: "production_run_once_topic_radar"
  });

  const sourceContext = buildSourceContext({
    account,
    topic: topicRadar.selectedTopic,
    materials: sourceCollection.materials,
    recentPosts: input.recentPosts ?? [],
    collectedAt: context.startedAt,
    materialsLimit: input.materialsLimit,
    recentPostsLimit: input.recentPostsLimit
  });
  recordSourceContextIngestion({
    repo: input.repo,
    sourceContext,
    runId: idsFor(context.traceId).sourceContextRunId,
    auditEventId: idsFor(context.traceId).sourceContextAuditEventId,
    traceId: context.traceId,
    startedAt: context.startedAt,
    finishedAt: context.startedAt,
    actorId: "production_run_once_source_ingestion"
  });

  return summarizeTopicAndContext(sourceCollection, topicRadar, sourceContext, configSnapshotId);
}

function seedRegistry(repo: RuntimeRepository, registry: AccountRegistry, now: string): void {
  for (const account of registry.config.accounts) {
    repo.upsertAccount(account, now);
  }
  for (const identity of registry.config.x_identities) {
    repo.upsertXIdentity(identity);
  }
}

function idsFor(traceId: string): {
  sourceCollectionRunId: string;
  sourceCollectionAuditEventId: string;
  topicRunId: string;
  topicAuditEventId: string;
  sourceContextRunId: string;
  sourceContextAuditEventId: string;
} {
  return {
    sourceCollectionRunId: `${traceId}:source-collection-run`,
    sourceCollectionAuditEventId: `${traceId}:source-collection-event`,
    topicRunId: `${traceId}:topic-run`,
    topicAuditEventId: `${traceId}:topic-event`,
    sourceContextRunId: `${traceId}:source-context-run`,
    sourceContextAuditEventId: `${traceId}:source-context-event`
  };
}

function summarizeTopicAndContext(
  sourceCollection: PublicXSourceCollectionResult,
  topicRadar: TopicRadarPackage,
  sourceContext: SourceContextPackage,
  configSnapshotId: string
): OnlineOperationExecutorResult {
  return {
    outcome: "completed",
    finalAction: "topic_selected",
    summary: {
      executor: "production_run_once_source_context_topic_v1",
      online: true,
      provider: "twitterapi.io",
      source_collection_status: sourceCollection.status,
      query_count: sourceCollection.queries.length,
      request_units: sourceCollection.requestUnits,
      raw_count: sourceCollection.rawCount,
      material_count: sourceCollection.materials.length,
      duplicate_material_count: sourceCollection.duplicateMaterialCount,
      api_audit_ids: sourceCollection.apiAuditIds,
      selected_topic_id: topicRadar.selectedTopic.id,
      selected_topic_label: topicRadar.selectedTopic.label,
      candidate_count: topicRadar.candidates.length,
      source_context_material_count: sourceContext.materials.length,
      recent_post_count: sourceContext.recentPosts.length,
      config_snapshot_id: configSnapshotId
    }
  };
}

function summarizeSourceOnly(sourceCollection: PublicXSourceCollectionResult, configSnapshotId: string): OnlineOperationExecutorResult {
  return {
    outcome: "skipped",
    finalAction: "source_collection_skipped",
    summary: {
      executor: "production_run_once_source_context_topic_v1",
      online: true,
      provider: "twitterapi.io",
      source_collection_status: sourceCollection.status,
      skipped_reason: sourceCollection.skippedReason,
      query_count: sourceCollection.queries.length,
      request_units: sourceCollection.requestUnits,
      raw_count: sourceCollection.rawCount,
      material_count: sourceCollection.materials.length,
      duplicate_material_count: sourceCollection.duplicateMaterialCount,
      api_audit_ids: sourceCollection.apiAuditIds,
      config_snapshot_id: configSnapshotId
    }
  };
}

function summarizeEmptyCollection(sourceCollection: PublicXSourceCollectionResult, configSnapshotId: string): OnlineOperationExecutorResult {
  return {
    outcome: "skipped",
    finalAction: "source_collection_empty",
    summary: {
      executor: "production_run_once_source_context_topic_v1",
      online: true,
      provider: "twitterapi.io",
      source_collection_status: sourceCollection.status,
      skipped_reason: "no_source_materials",
      query_count: sourceCollection.queries.length,
      request_units: sourceCollection.requestUnits,
      raw_count: sourceCollection.rawCount,
      material_count: 0,
      duplicate_material_count: sourceCollection.duplicateMaterialCount,
      api_audit_ids: sourceCollection.apiAuditIds,
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
