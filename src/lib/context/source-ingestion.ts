import { createHash } from "node:crypto";
import { z } from "zod";
import type { AccountInitialPrompt } from "../accounts/account-prompt";
import type { AccountConfig, AccountConfigSnapshot } from "../accounts/registry";
import { ApiError } from "../api/errors";
import {
  createDraftRunInputPackage,
  type CandidateTopic,
  type DraftEvidenceMaterial,
  type DraftEvidenceSourceType,
  type DraftRunInputPackage,
  type RecentAccountPost
} from "../drafts/ai-posting-pipeline";
import type { RuntimeRepository } from "../storage/repositories";

export type SourceEngagementMetrics = {
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  quoteCount?: number;
  bookmarkCount?: number;
  viewCount?: number;
};

export type SourceMaterialInput = {
  id: string;
  accountUuid?: string;
  sourceType: DraftEvidenceSourceType;
  provider?: string;
  sourceRef: string;
  sourceUrl?: string;
  title?: string;
  text?: string;
  summary?: string;
  capturedAt: string;
  topicTags?: string[];
  authorHandle?: string;
  engagement?: SourceEngagementMetrics;
};

export type RecentPostInput = RecentAccountPost & {
  accountUuid?: string;
};

export type SourceContextPackage = {
  kind: "source_context_v1";
  accountUuid: string;
  accountKey: string;
  topic: CandidateTopic;
  collectedAt: string;
  materials: DraftEvidenceMaterial[];
  materialScores: Record<string, number>;
  recentPosts: RecentAccountPost[];
};

export type BuildSourceContextInput = {
  account: AccountConfig;
  topic: CandidateTopic;
  materials: SourceMaterialInput[];
  recentPosts: RecentPostInput[];
  collectedAt: string;
  materialsLimit?: number;
  recentPostsLimit?: number;
};

export type RecordSourceContextIngestionInput = {
  repo: RuntimeRepository;
  sourceContext: SourceContextPackage;
  runId: string;
  auditEventId: string;
  traceId: string;
  startedAt: string;
  finishedAt: string;
  actorId?: string;
};

const defaultMaterialsLimit = 12;
const defaultRecentPostsLimit = 50;
const maxSummaryLength = 320;
const nonEmptyStringSchema = z.string().trim().min(1);
const isoDateTimeSchema = z.string().datetime();
const positiveIntegerSchema = z.number().int().positive();
const evidenceSourceTypeSchema = z.enum(["public_x_post", "public_x_search", "web_page", "manual_note", "runtime_snapshot"]);
const recentPostSourceSchema = z.enum(["local_ledger", "public_x", "manual"]);

const candidateTopicSchema = z
  .object({
    id: nonEmptyStringSchema,
    label: nonEmptyStringSchema,
    reason: nonEmptyStringSchema,
    keywords: z.array(nonEmptyStringSchema).default([])
  })
  .strict();

const engagementSchema = z
  .object({
    likeCount: z.number().int().nonnegative().default(0),
    repostCount: z.number().int().nonnegative().default(0),
    replyCount: z.number().int().nonnegative().default(0),
    quoteCount: z.number().int().nonnegative().default(0),
    bookmarkCount: z.number().int().nonnegative().default(0),
    viewCount: z.number().int().nonnegative().default(0)
  })
  .strict();

const sourceMaterialInputSchema = z
  .object({
    id: nonEmptyStringSchema,
    accountUuid: z.string().uuid().optional(),
    sourceType: evidenceSourceTypeSchema,
    provider: nonEmptyStringSchema.optional(),
    sourceRef: nonEmptyStringSchema,
    sourceUrl: z.string().url().optional(),
    title: nonEmptyStringSchema.optional(),
    text: nonEmptyStringSchema.optional(),
    summary: nonEmptyStringSchema.optional(),
    capturedAt: isoDateTimeSchema,
    topicTags: z.array(nonEmptyStringSchema).default([]),
    authorHandle: nonEmptyStringSchema.optional(),
    engagement: engagementSchema.optional()
  })
  .strict()
  .superRefine((material, context) => {
    if (!material.summary && !material.text) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "source material must include summary or text"
      });
    }
  });

const recentPostInputSchema = z
  .object({
    id: nonEmptyStringSchema,
    accountUuid: z.string().uuid().optional(),
    text: nonEmptyStringSchema,
    postedAt: isoDateTimeSchema,
    source: recentPostSourceSchema
  })
  .strict();

type ParsedSourceMaterial = Omit<z.infer<typeof sourceMaterialInputSchema>, "topicTags" | "engagement"> & {
  topicTags: string[];
  engagement?: SourceEngagementMetrics;
};

export function buildSourceContext(input: BuildSourceContextInput): SourceContextPackage {
  const collectedAt = parseIsoDateTime(input.collectedAt, "collectedAt");
  const materialsLimit = parseOptionalPositiveInteger(input.materialsLimit, "materialsLimit") ?? defaultMaterialsLimit;
  const recentPostsLimit = parseOptionalPositiveInteger(input.recentPostsLimit, "recentPostsLimit") ?? defaultRecentPostsLimit;
  const parsedTopic = parseWithSchema(candidateTopicSchema, input.topic, "source topic is invalid");
  const topic: CandidateTopic = {
    ...parsedTopic,
    keywords: parsedTopic.keywords ?? []
  };
  const materials = parseWithSchema(z.array(sourceMaterialInputSchema).min(1), input.materials, "source materials are invalid").map(
    (material): ParsedSourceMaterial => ({
      ...material,
      topicTags: material.topicTags ?? [],
      engagement: material.engagement
    })
  );
  const recentPosts = parseWithSchema(z.array(recentPostInputSchema), input.recentPosts, "recent account posts are invalid");
  assertUnique(materials.map((material) => material.id), "source material id");
  assertUnique(recentPosts.map((post) => post.id), "recent post id");

  for (const material of materials) {
    assertAccountScope(material.accountUuid, input.account.account_uuid, "source material");
  }
  for (const post of recentPosts) {
    assertAccountScope(post.accountUuid, input.account.account_uuid, "recent post");
  }

  const relevantMaterials = materials
    .filter((material) => !matchesExcludedTopic(input.account, material))
    .map((material) => {
      const draftMaterial = toDraftEvidenceMaterial(material);
      return {
        material: draftMaterial,
        score: scoreMaterial({
          account: input.account,
          topic,
          material
        })
      };
    })
    .sort((left, right) => right.score - left.score || Date.parse(right.material.capturedAt) - Date.parse(left.material.capturedAt) || left.material.id.localeCompare(right.material.id))
    .slice(0, materialsLimit);

  if (relevantMaterials.length === 0) {
    throw sourceIngestionError("source context must include at least one material after account filters");
  }

  const materialScores: Record<string, number> = {};
  for (const item of relevantMaterials) {
    materialScores[item.material.id] = roundScore(item.score);
  }

  return {
    kind: "source_context_v1",
    accountUuid: input.account.account_uuid,
    accountKey: input.account.account_key,
    topic,
    collectedAt,
    materials: relevantMaterials.map((item) => item.material),
    materialScores,
    recentPosts: recentPosts
      .sort((left, right) => Date.parse(right.postedAt) - Date.parse(left.postedAt) || left.id.localeCompare(right.id))
      .slice(0, recentPostsLimit)
      .map((post) => ({
        id: post.id,
        text: post.text,
        postedAt: post.postedAt,
        source: post.source
      }))
  };
}

export function createDraftInputPackageFromSourceContext(input: {
  account: AccountConfig;
  configSnapshot: AccountConfigSnapshot;
  configSnapshotId?: string;
  prompt: AccountInitialPrompt;
  sourceContext: SourceContextPackage;
}): DraftRunInputPackage {
  if (input.sourceContext.accountUuid !== input.account.account_uuid) {
    throw sourceIngestionError("source context belongs to a different account_uuid");
  }
  if (input.sourceContext.accountKey !== input.account.account_key) {
    throw sourceIngestionError("source context belongs to a different account_key");
  }

  return createDraftRunInputPackage({
    account: input.account,
    configSnapshot: input.configSnapshot,
    configSnapshotId: input.configSnapshotId,
    prompt: input.prompt,
    topic: input.sourceContext.topic,
    materials: input.sourceContext.materials,
    recentPosts: input.sourceContext.recentPosts
  });
}

export function recordSourceContextIngestion(input: RecordSourceContextIngestionInput): void {
  const sourceContext = sanitizeSourceContext(input.sourceContext);
  input.repo.transaction(() => {
    input.repo.recordAiRun({
      id: input.runId,
      accountUuid: sourceContext.accountUuid,
      traceId: input.traceId,
      purpose: "source_context_ingestion",
      model: "source-ingestion-offline-v0",
      status: "succeeded",
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      input: {
        kind: "source_context_ingestion_input_v1",
        account_uuid: sourceContext.accountUuid,
        account_key: sourceContext.accountKey,
        topic: sourceContext.topic,
        collected_at: sourceContext.collectedAt,
        material_ids: sourceContext.materials.map((material) => material.id),
        recent_post_ids: sourceContext.recentPosts.map((post) => post.id)
      },
      output: {
        context_hash: stableHash(sourceContext),
        material_count: sourceContext.materials.length,
        recent_post_count: sourceContext.recentPosts.length,
        material_scores: sourceContext.materialScores,
        recent_post_hashes: Object.fromEntries(sourceContext.recentPosts.map((post) => [post.id, sha256(post.text)]))
      }
    });

    for (const material of sourceContext.materials) {
      input.repo.recordEvidenceRef({
        id: `${input.runId}:${material.id}`,
        accountUuid: sourceContext.accountUuid,
        aiRunId: input.runId,
        sourceType: material.sourceType,
        provider: material.provider,
        sourceRef: material.sourceRef,
        sourceUrl: material.sourceUrl,
        title: material.title,
        capturedAt: material.capturedAt,
        metadata: {
          material_id: material.id,
          topic_id: sourceContext.topic.id,
          summary: material.summary,
          score: sourceContext.materialScores[material.id] ?? 0
        }
      });
    }

    input.repo.recordAuditEvent({
      id: input.auditEventId,
      accountUuid: sourceContext.accountUuid,
      eventType: "source_context_built",
      subjectType: "ai_run",
      subjectId: input.runId,
      actorType: "system",
      actorId: input.actorId ?? "source_ingestion",
      traceId: input.traceId,
      occurredAt: input.finishedAt,
      metadata: {
        topic_id: sourceContext.topic.id,
        context_hash: stableHash(sourceContext),
        material_count: sourceContext.materials.length,
        recent_post_count: sourceContext.recentPosts.length
      }
    });
  });
}

function sanitizeSourceContext(sourceContext: SourceContextPackage): SourceContextPackage {
  const parsed = parseWithSchema(
    z
      .object({
        kind: z.literal("source_context_v1"),
        accountUuid: z.string().uuid(),
        accountKey: nonEmptyStringSchema,
        topic: candidateTopicSchema,
        collectedAt: isoDateTimeSchema,
        materials: z.array(
          z
            .object({
              id: nonEmptyStringSchema,
              sourceType: evidenceSourceTypeSchema,
              provider: nonEmptyStringSchema.optional(),
              sourceRef: nonEmptyStringSchema,
              sourceUrl: z.string().url().optional(),
              title: nonEmptyStringSchema.optional(),
              summary: nonEmptyStringSchema,
              capturedAt: isoDateTimeSchema
            })
            .strict()
        ),
        materialScores: z.record(z.number().nonnegative()),
        recentPosts: z.array(
          z
            .object({
              id: nonEmptyStringSchema,
              text: nonEmptyStringSchema,
              postedAt: isoDateTimeSchema,
              source: recentPostSourceSchema
            })
            .strict()
        )
      })
      .strict(),
    sourceContext,
    "source context package is invalid"
  );

  assertUnique(parsed.materials.map((material) => material.id), "source material id");
  assertUnique(parsed.recentPosts.map((post) => post.id), "recent post id");
  assertMaterialScoresMatch(parsed.materials.map((material) => material.id), parsed.materialScores);
  return {
    kind: parsed.kind,
    accountUuid: parsed.accountUuid,
    accountKey: parsed.accountKey,
    topic: {
      ...parsed.topic,
      keywords: parsed.topic.keywords ?? []
    },
    collectedAt: parsed.collectedAt,
    materials: parsed.materials,
    materialScores: parsed.materialScores,
    recentPosts: parsed.recentPosts
  };
}

function toDraftEvidenceMaterial(material: ParsedSourceMaterial): DraftEvidenceMaterial {
  return {
    id: material.id,
    sourceType: material.sourceType,
    provider: material.provider,
    sourceRef: material.sourceRef,
    sourceUrl: material.sourceUrl,
    title: material.title,
    summary: trimSummary(material.summary ?? material.text ?? ""),
    capturedAt: material.capturedAt
  };
}

function scoreMaterial(input: {
  account: AccountConfig;
  topic: CandidateTopic;
  material: ParsedSourceMaterial;
}): number {
  const { account, topic, material } = input;
  const text = normaliseTopicText(
    [
      material.title,
      material.summary,
      material.text,
      material.sourceRef,
      ...(material.topicTags ?? [])
    ]
      .filter(Boolean)
      .join(" ")
  );
  const topicTerms = uniqueStrings([topic.label, ...(topic.keywords ?? []), ...account.topics.include]);
  const matchedTopicTerms = topicTerms.filter((term) => matchesTopicText(text, normaliseTopicText(term))).length;
  const engagement = material.engagement;
  const engagementScore = Math.log1p(
    (engagement?.likeCount ?? 0) +
      (engagement?.repostCount ?? 0) * 2 +
      (engagement?.replyCount ?? 0) +
      (engagement?.quoteCount ?? 0) * 1.5 +
      (engagement?.bookmarkCount ?? 0) * 2 +
      (engagement?.viewCount ?? 0) / 1000
  );
  const sourceWeight = sourceTypeWeight(material.sourceType);
  const freshnessScore = Date.parse(material.capturedAt) / 86_400_000_000_000;
  return sourceWeight + matchedTopicTerms * 4 + engagementScore + freshnessScore;
}

function matchesExcludedTopic(account: AccountConfig, material: ParsedSourceMaterial): boolean {
  const text = normaliseTopicText([material.title, material.summary, material.text, ...(material.topicTags ?? [])].filter(Boolean).join(" "));
  return account.topics.exclude.some((topic) => matchesTopicText(text, normaliseTopicText(topic)));
}

function sourceTypeWeight(sourceType: DraftEvidenceSourceType): number {
  if (sourceType === "web_page") {
    return 4;
  }
  if (sourceType === "public_x_post") {
    return 3;
  }
  if (sourceType === "manual_note") {
    return 2.5;
  }
  if (sourceType === "public_x_search") {
    return 2;
  }
  return 1;
}

function trimSummary(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= maxSummaryLength ? trimmed : `${trimmed.slice(0, maxSummaryLength - 1)}…`;
}

function normaliseTopicText(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").trim();
}

function matchesTopicText(normalisedText: string, normalisedTopic: string): boolean {
  if (!normalisedTopic) {
    return false;
  }

  if (/^[a-z0-9\s]+$/.test(normalisedTopic)) {
    const phrasePattern = normalisedTopic.split(/\s+/).map(escapeRegExp).join("[\\s_-]+");
    return new RegExp(`(^|[^a-z0-9])${phrasePattern}($|[^a-z0-9])`, "i").test(normalisedText);
  }

  return normalisedText.includes(normalisedTopic);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertAccountScope(accountUuid: string | undefined, expectedAccountUuid: string, label: string): void {
  if (accountUuid && accountUuid !== expectedAccountUuid) {
    throw sourceIngestionError(`${label} belongs to a different account_uuid`);
  }
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw sourceIngestionError(`duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function parseIsoDateTime(value: string, field: string): string {
  const parsed = isoDateTimeSchema.safeParse(value);
  if (!parsed.success) {
    throw sourceIngestionError(`${field} must be an ISO datetime`);
  }

  return parsed.data;
}

function parseOptionalPositiveInteger(value: number | undefined, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = positiveIntegerSchema.safeParse(value);
  if (!parsed.success) {
    throw sourceIngestionError(`${field} must be a positive integer`);
  }

  return parsed.data;
}

function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw sourceIngestionError(message, parsed.error.flatten());
  }
  return parsed.data;
}

function assertMaterialScoresMatch(materialIds: string[], materialScores: Record<string, number>): void {
  const materialIdSet = new Set(materialIds);
  const scoreKeys = Object.keys(materialScores);
  const missingScore = materialIds.find((id) => !(id in materialScores));
  if (missingScore) {
    throw sourceIngestionError(`material score is missing for material: ${missingScore}`);
  }

  const extraScore = scoreKeys.find((id) => !materialIdSet.has(id));
  if (extraScore) {
    throw sourceIngestionError(`material score references unknown material: ${extraScore}`);
  }
}

function stableHash(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceIngestionError(message: string, details?: unknown): ApiError {
  return new ApiError({
    code: "invalid_request",
    provider: "local",
    stage: "source_ingestion",
    message,
    details
  });
}
