import { createHash } from "node:crypto";
import { z } from "zod";
import type { AccountConfig } from "../accounts/registry";
import { ApiError } from "../api/errors";
import type { PublicXDataProvider } from "../providers/public-x";
import type { RuntimeRepository } from "../storage/repositories";
import { collectTwitterApiIoSearchMaterials } from "./source-adapters";
import type { SourceMaterialInput } from "./source-ingestion";

export type PublicXSourceCollectionStatus = "succeeded" | "skipped";
export type PublicXSourceCollectionSkipReason =
  | "account_disabled"
  | "public_x_disabled"
  | "no_search_keywords"
  | "public_x_request_cap_reached";

export type PublicXSourceCollectionInput = {
  repo: RuntimeRepository;
  account: AccountConfig;
  provider: PublicXDataProvider;
  traceId: string;
  runId: string;
  auditEventId: string;
  collectedAt: string;
  configSnapshotId?: string;
  maxQueries?: number;
  perQueryLimit?: number;
};

export type PublicXSourceCollectionResult = {
  kind: "public_x_source_collection_v1";
  accountUuid: string;
  accountKey: string;
  provider: "twitterapi.io";
  status: PublicXSourceCollectionStatus;
  skippedReason?: PublicXSourceCollectionSkipReason;
  queries: string[];
  apiAuditIds: string[];
  requestUnits: number;
  rawCount: number;
  duplicateMaterialCount: number;
  materials: SourceMaterialInput[];
};

const nonEmptyStringSchema = z.string().trim().min(1);
const isoDateTimeSchema = z.string().datetime();
const positiveIntegerSchema = z.number().int().positive();
const defaultMaxQueries = 3;
const defaultPerQueryLimit = 5;

export async function collectAccountPublicXSourceBatch(input: PublicXSourceCollectionInput): Promise<PublicXSourceCollectionResult> {
  const parsed = parseInput(input);
  const skipReason = getSkipReason(parsed.account, parsed.publicXRequestsThisMonth);
  if (skipReason) {
    const result: PublicXSourceCollectionResult = {
      kind: "public_x_source_collection_v1",
      accountUuid: parsed.account.account_uuid,
      accountKey: parsed.account.account_key,
      provider: "twitterapi.io",
      status: "skipped",
      skippedReason: skipReason,
      queries: [],
      apiAuditIds: [],
      requestUnits: 0,
      rawCount: 0,
      duplicateMaterialCount: 0,
      materials: []
    };
    recordCollectionLedger({ ...parsed, result });
    return result;
  }

  const remainingRequests = parsed.account.data_sources.public_x.monthly_request_cap - parsed.publicXRequestsThisMonth;
  const queries = uniqueStrings(parsed.account.data_sources.public_x.search_keywords).slice(
    0,
    Math.min(parsed.maxQueries, remainingRequests)
  );

  if (queries.length === 0) {
    const result: PublicXSourceCollectionResult = {
      kind: "public_x_source_collection_v1",
      accountUuid: parsed.account.account_uuid,
      accountKey: parsed.account.account_key,
      provider: "twitterapi.io",
      status: "skipped",
      skippedReason: "public_x_request_cap_reached",
      queries: [],
      apiAuditIds: [],
      requestUnits: 0,
      rawCount: 0,
      duplicateMaterialCount: 0,
      materials: []
    };
    recordCollectionLedger({ ...parsed, result });
    return result;
  }

  const apiAuditIds: string[] = [];
  const materials: SourceMaterialInput[] = [];
  const seenMaterialIds = new Set<string>();
  let rawCount = 0;
  let duplicateMaterialCount = 0;

  try {
    for (const [index, query] of queries.entries()) {
      const apiAuditId = `${parsed.runId}:api:${index + 1}`;
      apiAuditIds.push(apiAuditId);
      const adapterResult = await collectTwitterApiIoSearchMaterials({
        accountUuid: parsed.account.account_uuid,
        provider: parsed.provider,
        query,
        limit: parsed.perQueryLimit,
        topicTags: sourceTopicTags(parsed.account, query),
        collectedAt: parsed.collectedAt,
        repo: parsed.repo,
        apiAuditId,
        startedAt: parsed.collectedAt,
        finishedAt: parsed.collectedAt
      });
      rawCount += Number(adapterResult.apiAudit.metadata?.raw_count ?? 0);
      for (const material of adapterResult.materials) {
        if (seenMaterialIds.has(material.id)) {
          duplicateMaterialCount += 1;
          continue;
        }
        seenMaterialIds.add(material.id);
        materials.push(material);
      }
    }
  } catch (error) {
    tryRecordFailedCollectionLedger({ ...parsed, queries, apiAuditIds, error });
    throw error;
  }

  const result: PublicXSourceCollectionResult = {
    kind: "public_x_source_collection_v1",
    accountUuid: parsed.account.account_uuid,
    accountKey: parsed.account.account_key,
    provider: "twitterapi.io",
    status: "succeeded",
    queries,
    apiAuditIds,
    requestUnits: apiAuditIds.length,
    rawCount,
    duplicateMaterialCount,
    materials
  };
  recordCollectionLedger({ ...parsed, result });
  return result;
}

function parseInput(input: PublicXSourceCollectionInput): Required<Pick<PublicXSourceCollectionInput, "repo" | "account" | "provider" | "traceId" | "runId" | "auditEventId" | "collectedAt">> & {
  configSnapshotId?: string;
  maxQueries: number;
  perQueryLimit: number;
  publicXRequestsThisMonth: number;
} {
  const traceId = parseNonEmpty(input.traceId, "traceId");
  const runId = parseNonEmpty(input.runId, "runId");
  const auditEventId = parseNonEmpty(input.auditEventId, "auditEventId");
  const collectedAt = parseIsoDateTime(input.collectedAt, "collectedAt");
  const maxQueries = parsePositiveInteger(input.maxQueries ?? defaultMaxQueries, "maxQueries");
  const perQueryLimit = parsePositiveInteger(input.perQueryLimit ?? defaultPerQueryLimit, "perQueryLimit");
  const publicXRequestsThisMonth = readMonthlyPublicXRequestUnits(input.repo, input.account.account_uuid, collectedAt);
  if (maxQueries > 10) {
    throw sourceCollectionError("maxQueries must be <= 10");
  }
  if (perQueryLimit > 10) {
    throw sourceCollectionError("perQueryLimit must be <= 10");
  }
  if (input.configSnapshotId !== undefined) {
    parseNonEmpty(input.configSnapshotId, "configSnapshotId");
  }

  return {
    repo: input.repo,
    account: input.account,
    provider: input.provider,
    traceId,
    runId,
    auditEventId,
    collectedAt,
    configSnapshotId: input.configSnapshotId,
    maxQueries,
    perQueryLimit,
    publicXRequestsThisMonth
  };
}

function readMonthlyPublicXRequestUnits(repo: RuntimeRepository, accountUuid: string, collectedAt: string): number {
  const month = monthWindowUtc(collectedAt);
  return repo
    .listApiCallAuditForAccount(accountUuid)
    .filter((row) => {
      const startedAt = Date.parse(row.started_at);
      return (
        row.provider === "twitterapi.io" &&
        row.operation === "public_x_search" &&
        startedAt >= month.startMs &&
        startedAt < month.endMs
      );
    })
    .reduce((sum, row) => sum + Number(row.request_units ?? 0), 0);
}

function monthWindowUtc(value: string): { startMs: number; endMs: number } {
  const date = new Date(value);
  const startMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const endMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return { startMs, endMs };
}

function getSkipReason(account: AccountConfig, publicXRequestsThisMonth: number): PublicXSourceCollectionSkipReason | undefined {
  if (!account.enabled) {
    return "account_disabled";
  }
  if (!account.data_sources.public_x.enabled) {
    return "public_x_disabled";
  }
  if (account.data_sources.public_x.search_keywords.length === 0) {
    return "no_search_keywords";
  }
  if (publicXRequestsThisMonth >= account.data_sources.public_x.monthly_request_cap) {
    return "public_x_request_cap_reached";
  }
  return undefined;
}

function recordCollectionLedger(input: {
  repo: RuntimeRepository;
  account: AccountConfig;
  traceId: string;
  runId: string;
  auditEventId: string;
  collectedAt: string;
  configSnapshotId?: string;
  maxQueries: number;
  perQueryLimit: number;
  publicXRequestsThisMonth: number;
  result: PublicXSourceCollectionResult;
}): void {
  const materialHashes = Object.fromEntries(input.result.materials.map((material) => [material.id, materialTextHash(material)]));
  input.repo.transaction(() => {
    input.repo.recordAiRun({
      id: input.runId,
      accountUuid: input.account.account_uuid,
      traceId: input.traceId,
      purpose: "public_x_source_collection",
      model: "source-collection-v0",
      status: input.result.status,
      startedAt: input.collectedAt,
      finishedAt: input.collectedAt,
      input: {
        kind: "public_x_source_collection_input_v1",
        account_uuid: input.account.account_uuid,
        account_key: input.account.account_key,
        provider: "twitterapi.io",
        configured_keywords: input.account.data_sources.public_x.search_keywords,
        max_queries: input.maxQueries,
        per_query_limit: input.perQueryLimit,
        monthly_request_cap: input.account.data_sources.public_x.monthly_request_cap,
        public_x_requests_this_month: input.publicXRequestsThisMonth,
        config_snapshot_id: input.configSnapshotId
      },
      output: {
        status: input.result.status,
        skipped_reason: input.result.skippedReason,
        queries: input.result.queries,
        api_audit_ids: input.result.apiAuditIds,
        request_units: input.result.requestUnits,
        raw_count: input.result.rawCount,
        material_count: input.result.materials.length,
        duplicate_material_count: input.result.duplicateMaterialCount,
        material_ids: input.result.materials.map((material) => material.id),
        material_text_sha256: materialHashes
      }
    });

    for (const material of input.result.materials) {
      input.repo.recordEvidenceRef({
        id: `${input.runId}:${material.id}`,
        accountUuid: input.account.account_uuid,
        aiRunId: input.runId,
        sourceType: material.sourceType,
        provider: material.provider,
        sourceRef: material.sourceRef,
        sourceUrl: material.sourceUrl,
        title: material.title,
        capturedAt: material.capturedAt,
        metadata: {
          material_id: material.id,
          source_collection_run_id: input.runId,
          topic_tags: material.topicTags,
          text_sha256: materialHashes[material.id],
          author_handle: material.authorHandle,
          engagement: material.engagement
        }
      });
    }

    input.repo.recordAuditEvent({
      id: input.auditEventId,
      accountUuid: input.account.account_uuid,
      eventType: input.result.status === "skipped" ? "public_x_source_collection_skipped" : "public_x_source_collection_collected",
      subjectType: "ai_run",
      subjectId: input.runId,
      actorType: "system",
      actorId: "source_collection_v0",
      traceId: input.traceId,
      occurredAt: input.collectedAt,
      metadata: {
        provider: "twitterapi.io",
        status: input.result.status,
        skipped_reason: input.result.skippedReason,
        query_count: input.result.queries.length,
        material_count: input.result.materials.length,
        request_units: input.result.requestUnits,
        api_audit_ids: input.result.apiAuditIds
      }
    });
  });
}

function tryRecordFailedCollectionLedger(input: {
  repo: RuntimeRepository;
  account: AccountConfig;
  traceId: string;
  runId: string;
  auditEventId: string;
  collectedAt: string;
  configSnapshotId?: string;
  maxQueries: number;
  perQueryLimit: number;
  publicXRequestsThisMonth: number;
  queries: string[];
  apiAuditIds: string[];
  error: unknown;
}): void {
  try {
    input.repo.transaction(() => {
      input.repo.recordAiRun({
        id: input.runId,
        accountUuid: input.account.account_uuid,
        traceId: input.traceId,
        purpose: "public_x_source_collection",
        model: "source-collection-v0",
        status: "failed",
        startedAt: input.collectedAt,
        finishedAt: input.collectedAt,
        input: {
          kind: "public_x_source_collection_input_v1",
          account_uuid: input.account.account_uuid,
          account_key: input.account.account_key,
          provider: "twitterapi.io",
          configured_keywords: input.account.data_sources.public_x.search_keywords,
          max_queries: input.maxQueries,
          per_query_limit: input.perQueryLimit,
          monthly_request_cap: input.account.data_sources.public_x.monthly_request_cap,
          public_x_requests_this_month: input.publicXRequestsThisMonth,
          config_snapshot_id: input.configSnapshotId
        },
        output: {
          status: "failed",
          queries: input.queries,
          api_audit_ids: input.apiAuditIds
        },
        error: describeErrorText(input.error)
      });
      input.repo.recordAuditEvent({
        id: input.auditEventId,
        accountUuid: input.account.account_uuid,
        eventType: "public_x_source_collection_failed",
        subjectType: "ai_run",
        subjectId: input.runId,
        actorType: "system",
        actorId: "source_collection_v0",
        traceId: input.traceId,
        occurredAt: input.collectedAt,
        metadata: {
          provider: "twitterapi.io",
          status: "failed",
          queries: input.queries,
          api_audit_ids: input.apiAuditIds,
          error: describeError(input.error)
        }
      });
    });
  } catch {
    // Keep the original provider/adapter error as the surfaced failure.
  }
}

function sourceTopicTags(account: AccountConfig, query: string): string[] {
  return uniqueStrings([query, ...account.topics.include]);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function materialTextHash(material: SourceMaterialInput): string {
  return sha256([material.text, material.summary, material.title].filter(Boolean).join("\n"));
}

function describeErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.provider}:${error.stage}:${error.code}`;
  }
  if (error instanceof Error) {
    return `${error.name}:${error.message}`;
  }
  return String(error);
}

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof ApiError) {
    return {
      name: error.name,
      code: error.code,
      provider: error.provider,
      stage: error.stage,
      status: error.status
    };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }
  return {
    value: String(error)
  };
}

function parseNonEmpty(value: string, field: string): string {
  const parsed = nonEmptyStringSchema.safeParse(value);
  if (!parsed.success) {
    throw sourceCollectionError(`${field} must be non-empty`);
  }
  return parsed.data;
}

function parseIsoDateTime(value: string, field: string): string {
  const parsed = isoDateTimeSchema.safeParse(value);
  if (!parsed.success) {
    throw sourceCollectionError(`${field} must be an ISO datetime`);
  }
  return parsed.data;
}

function parsePositiveInteger(value: number, field: string): number {
  const parsed = positiveIntegerSchema.safeParse(value);
  if (!parsed.success) {
    throw sourceCollectionError(`${field} must be a positive integer`);
  }
  return parsed.data;
}

function sourceCollectionError(message: string): ApiError {
  return new ApiError({
    code: "invalid_request",
    provider: "local",
    stage: "source_collection",
    message
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
