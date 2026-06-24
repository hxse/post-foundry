import { createHash } from "node:crypto";
import { z } from "zod";
import type { AccountMemorySnapshot } from "../memory/account-memory";
import { ApiError } from "../api/errors";
import {
  parseAiPostingDraftOutput,
  type AiPostingDraft,
  type DraftRunInputPackage
} from "../drafts/ai-posting-pipeline";
import type { RuntimeRepository } from "../storage/repositories";

export type DraftLlmMemoryContext = {
  memorySha256: string;
  capturedAt: string;
  outcomeCounts: AccountMemorySnapshot["outcomeCounts"];
  lifetimeStats: AccountMemorySnapshot["lifetimeStats"];
  topicMemory: Array<{
    topicId: string;
    label: string;
    selectedCount: number;
  }>;
  recentTraceHints: Array<{
    traceId: string;
    selectedTopicLabel?: string;
    policyOutcome?: string;
    finalActionType?: string;
  }>;
  nextRunHints: string[];
};

export type DraftLlmRequest = {
  kind: "llm_draft_request_v1";
  requestedAt: string;
  account: {
    accountUuid: string;
    accountKey: string;
    language: string;
    configVersion: number;
    configHash: string;
    configSnapshotId?: string;
    topics: DraftRunInputPackage["account"]["topics"];
    style: DraftRunInputPackage["account"]["style"];
  };
  prompt: {
    source: DraftRunInputPackage["prompt"]["source"];
    promptSha256: string;
    promptPath?: string;
  };
  topic: DraftRunInputPackage["topic"];
  materials: DraftRunInputPackage["materials"];
  recentPosts: DraftRunInputPackage["recentPosts"];
  memory?: DraftLlmMemoryContext;
  guardrails: {
    outputSchema: "ai_posting_draft_output_v1";
    externalPostTextMode: "natural_plain_text";
    forbidPromptPlaintext: true;
    forbidFormattedExternalPost: true;
    requireEvidenceIds: true;
    linksRouteToHumanReviewDownstream: true;
    offlineOnly: true;
  };
};

export type DraftLlmProviderResult = {
  output: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
  };
};

export type OfflineDraftLlmProvider = {
  provider: string;
  model: string;
  mode: "offline_fixture";
  generateDraft(request: DraftLlmRequest): Promise<DraftLlmProviderResult>;
};

export type DraftLlmAdapterResult = {
  provider: {
    provider: string;
    model: string;
    mode: OfflineDraftLlmProvider["mode"];
  };
  request: DraftLlmRequest;
  rawOutputSha256: string;
  usage?: DraftLlmProviderResult["usage"];
  draft: AiPostingDraft;
};

export type BuildDraftLlmRequestInput = {
  inputPackage: DraftRunInputPackage;
  memory?: AccountMemorySnapshot;
  requestedAt: string;
};

export type RunOfflineDraftLlmAdapterInput = BuildDraftLlmRequestInput & {
  provider: OfflineDraftLlmProvider;
};

export type RecordDraftLlmAdapterRunInput = {
  repo: RuntimeRepository;
  result: DraftLlmAdapterResult;
  runId: string;
  auditEventId: string;
  traceId: string;
  startedAt: string;
  finishedAt: string;
  actorId?: string;
};

const nonEmptyStringSchema = z.string().trim().min(1);
const isoDateTimeSchema = z.string().datetime();
const sha256Schema = z.string().length(64).refine((value) => Array.from(value).every((char) => /[a-f0-9]/.test(char)));
const outcomeCountsSchema = z
  .object({
    autoPost: z.number().int().nonnegative(),
    humanReview: z.number().int().nonnegative(),
    reject: z.number().int().nonnegative(),
    defer: z.number().int().nonnegative(),
    draftBlocked: z.number().int().nonnegative()
  })
  .strict();
const lifetimeStatsSchema = z
  .object({
    traceCount: z.number().int().nonnegative(),
    outcomeCounts: outcomeCountsSchema,
    actionCounts: z.record(z.number().int().nonnegative()),
    topTopics: z
      .array(
        z
          .object({
            topicId: nonEmptyStringSchema,
            label: nonEmptyStringSchema,
            selectedCount: z.number().int().positive(),
            outcomes: outcomeCountsSchema
          })
          .strict()
      )
      .max(20)
  })
  .strict();
const compactIdentifierSchema = nonEmptyStringSchema.max(128).refine(isCompactIdentifier);
const usageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    costUsd: z.number().nonnegative().optional()
  })
  .strict();
const draftResultSchema = z
  .object({
    id: compactIdentifierSchema,
    accountUuid: z.string().uuid(),
    accountKey: nonEmptyStringSchema,
    topicId: nonEmptyStringSchema,
    postText: nonEmptyStringSchema.max(25_000),
    urls: z.array(z.string().trim().url()),
    topicTags: z.array(compactIdentifierSchema).min(1),
    evidenceIds: z.array(compactIdentifierSchema).min(1),
    internalNotes: z.string().trim().max(2_000).optional()
  })
  .strict();

const draftLlmRequestSchema = z
  .object({
    kind: z.literal("llm_draft_request_v1"),
    requestedAt: isoDateTimeSchema,
    account: z
      .object({
        accountUuid: z.string().uuid(),
        accountKey: nonEmptyStringSchema,
        language: nonEmptyStringSchema,
        configVersion: z.number().int().positive(),
        configHash: sha256Schema,
        configSnapshotId: nonEmptyStringSchema.optional(),
        topics: z.object({
          include: z.array(nonEmptyStringSchema).min(1),
          exclude: z.array(nonEmptyStringSchema)
        }),
        style: z.object({
          voice: nonEmptyStringSchema,
          rules: z.array(nonEmptyStringSchema),
          banned_phrases: z.array(nonEmptyStringSchema)
        })
      })
      .strict(),
    prompt: z
      .object({
        source: z.enum(["inline", "file"]),
        promptSha256: sha256Schema,
        promptPath: nonEmptyStringSchema.optional()
      })
      .strict(),
    topic: z
      .object({
        id: nonEmptyStringSchema,
        label: nonEmptyStringSchema,
        reason: nonEmptyStringSchema,
        keywords: z.array(nonEmptyStringSchema)
      })
      .strict(),
    materials: z.array(
      z
        .object({
          id: nonEmptyStringSchema,
          sourceType: z.enum(["public_x_post", "public_x_search", "web_page", "manual_note", "runtime_snapshot"]),
          provider: nonEmptyStringSchema.optional(),
          sourceRef: nonEmptyStringSchema,
          sourceUrl: z.string().url().optional(),
          title: nonEmptyStringSchema.optional(),
          summary: nonEmptyStringSchema,
          capturedAt: isoDateTimeSchema
        })
        .strict()
    ),
    recentPosts: z.array(
      z
        .object({
          id: nonEmptyStringSchema,
          text: nonEmptyStringSchema,
          postedAt: isoDateTimeSchema,
          source: z.enum(["local_ledger", "public_x", "manual"])
        })
        .strict()
    ),
    memory: z
      .object({
        memorySha256: sha256Schema,
        capturedAt: isoDateTimeSchema,
        outcomeCounts: outcomeCountsSchema,
        lifetimeStats: lifetimeStatsSchema,
        topicMemory: z.array(
          z
            .object({
              topicId: nonEmptyStringSchema,
              label: nonEmptyStringSchema,
              selectedCount: z.number().int().positive()
            })
            .strict()
        ),
        recentTraceHints: z.array(
          z
            .object({
              traceId: nonEmptyStringSchema,
              selectedTopicLabel: nonEmptyStringSchema.optional(),
              policyOutcome: nonEmptyStringSchema.optional(),
              finalActionType: nonEmptyStringSchema.optional()
            })
            .strict()
        ),
        nextRunHints: z.array(nonEmptyStringSchema)
      })
      .strict()
      .optional(),
    guardrails: z
      .object({
        outputSchema: z.literal("ai_posting_draft_output_v1"),
        externalPostTextMode: z.literal("natural_plain_text"),
        forbidPromptPlaintext: z.literal(true),
        forbidFormattedExternalPost: z.literal(true),
        requireEvidenceIds: z.literal(true),
        linksRouteToHumanReviewDownstream: z.literal(true),
        offlineOnly: z.literal(true)
      })
      .strict()
  })
  .strict();

const draftLlmAdapterResultSchema = z
  .object({
    provider: z
      .object({
        provider: compactIdentifierSchema,
        model: compactIdentifierSchema,
        mode: z.literal("offline_fixture")
      })
      .strict(),
    request: draftLlmRequestSchema,
    rawOutputSha256: sha256Schema,
    usage: usageSchema.optional(),
    draft: draftResultSchema
  })
  .strict();

export function buildDraftLlmRequest(input: BuildDraftLlmRequestInput): DraftLlmRequest {
  const requestedAt = parseIsoDateTime(input.requestedAt, "requestedAt");
  const memory = input.memory ? compactMemory(input.inputPackage, input.memory) : undefined;
  return parseWithSchema(
    draftLlmRequestSchema,
    {
      kind: "llm_draft_request_v1",
      requestedAt,
      account: {
        accountUuid: input.inputPackage.account.accountUuid,
        accountKey: input.inputPackage.account.accountKey,
        language: input.inputPackage.account.language,
        configVersion: input.inputPackage.account.configVersion,
        configHash: input.inputPackage.account.configHash,
        configSnapshotId: input.inputPackage.account.configSnapshotId,
        topics: input.inputPackage.account.topics,
        style: input.inputPackage.account.style
      },
      prompt: input.inputPackage.prompt,
      topic: input.inputPackage.topic,
      materials: input.inputPackage.materials,
      recentPosts: input.inputPackage.recentPosts,
      memory,
      guardrails: {
        outputSchema: "ai_posting_draft_output_v1",
        externalPostTextMode: "natural_plain_text",
        forbidPromptPlaintext: true,
        forbidFormattedExternalPost: true,
        requireEvidenceIds: true,
        linksRouteToHumanReviewDownstream: true,
        offlineOnly: true
      }
    },
    "draft LLM request is invalid"
  );
}

export async function runOfflineDraftLlmAdapter(input: RunOfflineDraftLlmAdapterInput): Promise<DraftLlmAdapterResult> {
  assertOfflineProvider(input.provider);
  const request = buildDraftLlmRequest(input);
  const providerResult = await input.provider.generateDraft(request);
  const draft = parseAiPostingDraftOutput({
    inputPackage: input.inputPackage,
    output: providerResult.output
  });
  return {
    provider: {
      provider: input.provider.provider,
      model: input.provider.model,
      mode: input.provider.mode
    },
    request,
    rawOutputSha256: stableHash(providerResult.output),
    usage: providerResult.usage,
    draft
  };
}

export function recordDraftLlmAdapterRun(input: RecordDraftLlmAdapterRunInput): void {
  const result = parseWithSchema(draftLlmAdapterResultSchema, input.result, "draft LLM adapter result is invalid");
  const request = result.request;
  assertDraftMatchesRequest(request, result.draft);
  input.repo.transaction(() => {
    input.repo.recordAiRun({
      id: input.runId,
      accountUuid: request.account.accountUuid,
      traceId: input.traceId,
      purpose: "llm_draft_generation",
      model: result.provider.model,
      status: "succeeded",
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      input: {
        provider: result.provider,
        request
      },
      output: {
        draft_id: result.draft.id,
        topic_id: result.draft.topicId,
        post_text_sha256: sha256(result.draft.postText),
        urls: result.draft.urls,
        topic_tags: result.draft.topicTags,
        evidence_ids: result.draft.evidenceIds,
        raw_output_sha256: result.rawOutputSha256,
        usage: result.usage
      }
    });
    input.repo.recordAuditEvent({
      id: input.auditEventId,
      accountUuid: request.account.accountUuid,
      eventType: "llm_draft_generated",
      subjectType: "ai_run",
      subjectId: input.runId,
      actorType: "ai",
      actorId: input.actorId ?? "llm_draft_adapter",
      traceId: input.traceId,
      occurredAt: input.finishedAt,
      metadata: {
        provider: result.provider.provider,
        model: result.provider.model,
        mode: result.provider.mode,
        draft_id: result.draft.id,
        topic_id: result.draft.topicId,
        post_text_sha256: sha256(result.draft.postText),
        raw_output_sha256: result.rawOutputSha256
      }
    });
  });
}

function assertDraftMatchesRequest(request: DraftLlmRequest, draft: AiPostingDraft): void {
  if (draft.accountUuid !== request.account.accountUuid || draft.accountKey !== request.account.accountKey) {
    throw draftLlmAdapterError("draft result belongs to a different account");
  }
  if (draft.topicId !== request.topic.id) {
    throw draftLlmAdapterError("draft result belongs to a different topic");
  }
  const knownEvidenceIds = new Set(request.materials.map((material) => material.id));
  const unknownEvidenceId = draft.evidenceIds.find((evidenceId) => !knownEvidenceIds.has(evidenceId));
  if (unknownEvidenceId) {
    throw draftLlmAdapterError("draft result references unknown evidence id: " + unknownEvidenceId);
  }
}

function isCompactIdentifier(value: string): boolean {
  return Array.from(value).every((char) => /[A-Za-z0-9._:-]/.test(char));
}

function compactMemory(inputPackage: DraftRunInputPackage, memory: AccountMemorySnapshot): DraftLlmMemoryContext {
  if (memory.accountUuid !== inputPackage.account.accountUuid || memory.accountKey !== inputPackage.account.accountKey) {
    throw draftLlmAdapterError("account memory belongs to a different account");
  }
  return {
    memorySha256: stableHash(memory),
    capturedAt: memory.capturedAt,
    outcomeCounts: memory.outcomeCounts,
    lifetimeStats: memory.lifetimeStats,
    topicMemory: memory.topicMemory.slice(0, 5).map((topic) => ({
      topicId: topic.topicId,
      label: topic.label,
      selectedCount: topic.selectedCount
    })),
    recentTraceHints: memory.traceSummaries.slice(0, 5).map((trace) => ({
      traceId: trace.traceId,
      selectedTopicLabel: trace.selectedTopic?.label,
      policyOutcome: trace.policy?.outcome,
      finalActionType: trace.finalAction?.actionType
    })),
    nextRunHints: memory.nextRunHints.slice(0, 10)
  };
}

function assertOfflineProvider(provider: OfflineDraftLlmProvider): void {
  if (provider.mode !== "offline_fixture") {
    throw draftLlmAdapterError("draft LLM adapter only accepts offline fixture providers in this baseline");
  }
}

function parseIsoDateTime(value: string, field: string): string {
  const parsed = isoDateTimeSchema.safeParse(value);
  if (!parsed.success) {
    throw draftLlmAdapterError(`${field} must be an ISO datetime`);
  }
  return parsed.data;
}

function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw draftLlmAdapterError(message, parsed.error.flatten());
  }
  return parsed.data;
}

function stableHash(value: unknown): string {
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function draftLlmAdapterError(message: string, details?: unknown): ApiError {
  return new ApiError({
    code: "invalid_request",
    provider: "local",
    stage: "llm_draft_adapter",
    message,
    details
  });
}
