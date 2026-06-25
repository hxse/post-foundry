import { createHash } from "node:crypto";
import { z } from "zod";
import type { AccountInitialPrompt } from "../accounts/account-prompt";
import type { AccountConfig, AccountConfigSnapshot } from "../accounts/registry";
import { ApiError } from "../api/errors";
import { findRealDebugPostTextViolation } from "../api/real-post-text-policy";
import type { PostingCandidate } from "../policy/automation";
import type { RecordEvidenceRefInput, RuntimeRepository } from "../storage/repositories";

export type CandidateTopic = {
  id: string;
  label: string;
  reason: string;
  keywords: string[];
};

export type DraftEvidenceSourceType = RecordEvidenceRefInput["sourceType"];

export type DraftEvidenceMaterial = {
  id: string;
  sourceType: DraftEvidenceSourceType;
  provider?: string;
  sourceRef: string;
  sourceUrl?: string;
  title?: string;
  summary: string;
  capturedAt: string;
};

export type RecentAccountPost = {
  id: string;
  text: string;
  postedAt: string;
  source: "local_ledger" | "public_x" | "manual";
};

export type DraftRunInputPackage = {
  kind: "ai_posting_draft_input_v1";
  account: {
    accountUuid: string;
    accountKey: string;
    configVersion: number;
    configHash: string;
    configSnapshotId?: string;
    language: string;
    topics: AccountConfig["topics"];
    style: AccountConfig["style"];
  };
  prompt: {
    source: AccountInitialPrompt["source"];
    promptSha256: string;
    promptPath?: string;
  };
  topic: CandidateTopic;
  materials: DraftEvidenceMaterial[];
  recentPosts: RecentAccountPost[];
  guardrails: {
    externalPostTextMode: "natural_plain_text";
    structuredInternalPayloadAllowed: true;
    forbidFormattedExternalPost: true;
    requireEvidenceIds: true;
    requireRecentDuplicateCheck: true;
    linkHandling: "links_route_to_human_review_downstream";
  };
};

export type AiPostingDraft = {
  id: string;
  accountUuid: string;
  accountKey: string;
  topicId: string;
  postText: string;
  urls: string[];
  topicTags: string[];
  evidenceIds: string[];
  internalNotes?: string;
};

export type DuplicateCheckResult = {
  status: "unique" | "duplicate";
  maxSimilarity: number;
  threshold: number;
  method: "none" | "normalized_exact" | "char_bigram_jaccard";
  matchedPost?: {
    id: string;
    textSha256: string;
    postedAt: string;
    source: RecentAccountPost["source"];
  };
};

export type DraftPostingGateReason = {
  code: "post_text_too_long" | "formatted_post_text" | "debug_post_text" | "stilted_post_text" | "recent_duplicate";
  message: string;
};

export type DraftPostingGate =
  | {
      status: "ready";
      candidate: PostingCandidate;
      duplicateCheck: DuplicateCheckResult;
    }
  | {
      status: "blocked";
      reasons: DraftPostingGateReason[];
      duplicateCheck: DuplicateCheckResult;
    };

export type RecordDraftRunInput = {
  repo: RuntimeRepository;
  inputPackage: DraftRunInputPackage;
  draft: AiPostingDraft;
  runId: string;
  auditEventId: string;
  traceId: string;
  startedAt: string;
  finishedAt: string;
  model?: string;
  actorId?: string;
};

const maxManualReviewPostTextLength = 25_000;
const defaultDuplicateThreshold = 0.72;
const nonEmptyStringSchema = z.string().trim().min(1);
const isoDateTimeSchema = z.string().datetime();
const evidenceSourceTypeSchema = z.enum(["public_x_post", "public_x_search", "web_page", "manual_note", "runtime_snapshot"]);
const recentPostSourceSchema = z.enum(["local_ledger", "public_x", "manual"]);
const urlPattern = /https?:\/\/[^\s)]+/gi;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const candidateTopicSchema = z
  .object({
    id: nonEmptyStringSchema,
    label: nonEmptyStringSchema,
    reason: nonEmptyStringSchema,
    keywords: z.array(nonEmptyStringSchema).default([])
  })
  .strict();

const evidenceMaterialSchema = z
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
  .strict();

const recentAccountPostSchema = z
  .object({
    id: nonEmptyStringSchema,
    text: nonEmptyStringSchema,
    postedAt: isoDateTimeSchema,
    source: recentPostSourceSchema
  })
  .strict();

const writableDraftRunInputPackageSchema = z.object({
  kind: z.literal("ai_posting_draft_input_v1"),
  account: z.object({
    accountUuid: z.string().uuid(),
    accountKey: nonEmptyStringSchema,
    configVersion: z.number().int().positive(),
    configHash: sha256Schema,
    configSnapshotId: nonEmptyStringSchema.optional(),
    language: nonEmptyStringSchema,
    topics: z.object({
      include: z.array(nonEmptyStringSchema).min(1),
      exclude: z.array(nonEmptyStringSchema).default([])
    }),
    style: z.object({
      voice: nonEmptyStringSchema,
      rules: z.array(nonEmptyStringSchema).default([]),
      banned_phrases: z.array(nonEmptyStringSchema).default([])
    })
  }),
  prompt: z.object({
    source: z.enum(["inline", "file"]),
    promptSha256: sha256Schema,
    promptPath: nonEmptyStringSchema.optional()
  }),
  topic: z.object({
    id: nonEmptyStringSchema,
    label: nonEmptyStringSchema,
    reason: nonEmptyStringSchema,
    keywords: z.array(nonEmptyStringSchema).default([])
  }),
  materials: z.array(evidenceMaterialSchema).min(1),
  recentPosts: z.array(recentAccountPostSchema),
  guardrails: z.object({
    externalPostTextMode: z.literal("natural_plain_text"),
    structuredInternalPayloadAllowed: z.literal(true),
    forbidFormattedExternalPost: z.literal(true),
    requireEvidenceIds: z.literal(true),
    requireRecentDuplicateCheck: z.literal(true),
    linkHandling: z.literal("links_route_to_human_review_downstream")
  })
});

const aiPostingDraftOutputSchema = z
  .object({
    draft_id: nonEmptyStringSchema,
    post_text: nonEmptyStringSchema.max(maxManualReviewPostTextLength),
    urls: z.array(z.string().url()).default([]),
    topic_tags: z.array(nonEmptyStringSchema).min(1),
    evidence_ids: z.array(nonEmptyStringSchema).min(1),
    internal_notes: z.string().trim().optional()
  })
  .strict();

export function createDraftRunInputPackage(input: {
  account: AccountConfig;
  configSnapshot: AccountConfigSnapshot;
  configSnapshotId?: string;
  prompt: AccountInitialPrompt;
  topic: CandidateTopic;
  materials: DraftEvidenceMaterial[];
  recentPosts: RecentAccountPost[];
}): DraftRunInputPackage {
  if (input.configSnapshot.account_uuid !== input.account.account_uuid) {
    throw pipelineError("config snapshot belongs to a different account");
  }
  if (input.configSnapshot.account_key !== input.account.account_key) {
    throw pipelineError("config snapshot account_key differs from account");
  }
  if (input.prompt.accountKey !== input.account.account_key) {
    throw pipelineError("initial prompt belongs to a different account_key");
  }

  const parsedTopic = parseWithSchema(candidateTopicSchema, input.topic, "candidate topic is invalid");
  const topic: CandidateTopic = {
    ...parsedTopic,
    keywords: parsedTopic.keywords ?? []
  };
  const materials = parseWithSchema(z.array(evidenceMaterialSchema).min(1), input.materials, "draft materials are invalid");
  assertUnique(materials.map((material) => material.id), "material id");
  const recentPosts = parseWithSchema(z.array(recentAccountPostSchema), input.recentPosts, "recent account posts are invalid");
  const accountTopics = accountTopicsForDraft(input.account, topic);

  return {
    kind: "ai_posting_draft_input_v1",
    account: {
      accountUuid: input.account.account_uuid,
      accountKey: input.account.account_key,
      configVersion: input.account.config_version,
      configHash: input.configSnapshot.config_hash,
      configSnapshotId: input.configSnapshotId,
      language: input.account.language,
      topics: accountTopics,
      style: input.account.style
    },
    prompt: {
      source: input.prompt.source,
      promptSha256: input.prompt.promptSha256,
      promptPath: input.prompt.promptPath
    },
    topic: {
      ...topic,
      keywords: topic.keywords ?? []
    },
    materials,
    recentPosts,
    guardrails: {
      externalPostTextMode: "natural_plain_text",
      structuredInternalPayloadAllowed: true,
      forbidFormattedExternalPost: true,
      requireEvidenceIds: true,
      requireRecentDuplicateCheck: true,
      linkHandling: "links_route_to_human_review_downstream"
    }
  };
}

function accountTopicsForDraft(account: AccountConfig, topic: CandidateTopic): AccountConfig["topics"] {
  const include = account.topics.include.length > 0 ? account.topics.include : [topic.label, ...(topic.keywords ?? [])];
  return {
    include: uniqueStrings(include),
    exclude: account.topics.exclude
  };
}

export function parseAiPostingDraftOutput(input: {
  output: unknown;
  inputPackage: DraftRunInputPackage;
}): AiPostingDraft {
  const parsed = parseWithSchema(aiPostingDraftOutputSchema, input.output, "AI posting draft output is invalid");
  const knownEvidenceIds = new Set(input.inputPackage.materials.map((material) => material.id));
  const unknownEvidenceId = parsed.evidence_ids.find((id) => !knownEvidenceIds.has(id));
  if (unknownEvidenceId) {
    throw pipelineError(`draft references unknown evidence id: ${unknownEvidenceId}`);
  }

  return {
    id: parsed.draft_id,
    accountUuid: input.inputPackage.account.accountUuid,
    accountKey: input.inputPackage.account.accountKey,
    topicId: input.inputPackage.topic.id,
    postText: parsed.post_text,
    urls: uniqueStrings([...(parsed.urls ?? []), ...extractUrls(parsed.post_text)]),
    topicTags: uniqueStrings(parsed.topic_tags),
    evidenceIds: uniqueStrings(parsed.evidence_ids),
    internalNotes: parsed.internal_notes || undefined
  };
}

export function evaluateDraftForPosting(input: {
  draft: AiPostingDraft;
  recentPosts: RecentAccountPost[];
  duplicateThreshold?: number;
}): DraftPostingGate {
  const recentPosts = parseWithSchema(z.array(recentAccountPostSchema), input.recentPosts, "recent account posts are invalid");
  const styleViolations = findExternalPostTextViolations(input.draft.postText);
  const duplicateCheck = checkRecentPostDuplication({
    postText: input.draft.postText,
    recentPosts,
    threshold: input.duplicateThreshold
  });
  const reasons: DraftPostingGateReason[] = [
    ...styleViolations,
    ...(duplicateCheck.status === "duplicate"
      ? [
          {
            code: "recent_duplicate" as const,
            message: `draft is too similar to recent post: ${duplicateCheck.matchedPost?.id ?? "unknown"}`
          }
        ]
      : [])
  ];

  if (reasons.length > 0) {
    return {
      status: "blocked",
      reasons,
      duplicateCheck
    };
  }

  return {
    status: "ready",
    candidate: {
      id: input.draft.id,
      text: input.draft.postText,
      urls: input.draft.urls,
      topicTags: input.draft.topicTags,
      evidenceIds: input.draft.evidenceIds
    },
    duplicateCheck
  };
}

export function checkRecentPostDuplication(input: {
  postText: string;
  recentPosts: RecentAccountPost[];
  threshold?: number;
}): DuplicateCheckResult {
  const threshold = input.threshold ?? defaultDuplicateThreshold;
  const normalizedDraft = normalizeForSimilarity(input.postText);
  if (!normalizedDraft) {
    return {
      status: "unique",
      maxSimilarity: 0,
      threshold,
      method: "none"
    };
  }

  let best: DuplicateCheckResult = {
    status: "unique",
    maxSimilarity: 0,
    threshold,
    method: "none"
  };

  for (const post of input.recentPosts) {
    const normalizedPost = normalizeForSimilarity(post.text);
    if (!normalizedPost) {
      continue;
    }

    const exact = normalizedDraft === normalizedPost;
    const similarity = exact ? 1 : jaccard(charBigrams(normalizedDraft), charBigrams(normalizedPost));
    if (similarity > best.maxSimilarity) {
      best = {
        status: exact || similarity >= threshold ? "duplicate" : "unique",
        maxSimilarity: similarity,
        threshold,
        method: exact ? "normalized_exact" : "char_bigram_jaccard",
        matchedPost: {
          id: post.id,
          textSha256: sha256(post.text),
          postedAt: post.postedAt,
          source: post.source
        }
      };
    }
  }

  if (best.status === "unique") {
    return {
      status: "unique",
      maxSimilarity: best.maxSimilarity,
      threshold,
      method: best.method
    };
  }

  return best;
}

export function recordDraftRun(input: RecordDraftRunInput): void {
  const inputPackage = sanitizeWritableDraftRunInputPackage(input.inputPackage);
  if (input.draft.accountUuid !== inputPackage.account.accountUuid) {
    throw pipelineError("draft belongs to a different account_uuid");
  }
  if (input.draft.accountKey !== inputPackage.account.accountKey) {
    throw pipelineError("draft belongs to a different account_key");
  }
  if (input.draft.topicId !== inputPackage.topic.id) {
    throw pipelineError("draft belongs to a different topic");
  }

  const materialsById = new Map(inputPackage.materials.map((material) => [material.id, material]));
  for (const evidenceId of input.draft.evidenceIds) {
    if (!materialsById.has(evidenceId)) {
      throw pipelineError(`draft references unknown evidence id: ${evidenceId}`);
    }
  }

  input.repo.transaction(() => {
    input.repo.recordAiRun({
      id: input.runId,
      accountUuid: inputPackage.account.accountUuid,
      traceId: input.traceId,
      purpose: "ai_posting_draft",
      model: input.model ?? "draft-pipeline-offline-v0",
      status: "succeeded",
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      input: inputPackage,
      output: {
        draft_id: input.draft.id,
        topic_id: input.draft.topicId,
        post_text: input.draft.postText,
        post_text_sha256: sha256(input.draft.postText),
        urls: input.draft.urls,
        topic_tags: input.draft.topicTags,
        evidence_ids: input.draft.evidenceIds,
        internal_notes: input.draft.internalNotes
      }
    });

    for (const evidenceId of input.draft.evidenceIds) {
      const material = materialsById.get(evidenceId);
      if (!material) {
        throw pipelineError(`draft references unknown evidence id: ${evidenceId}`);
      }
      input.repo.recordEvidenceRef({
        id: `${input.runId}:${material.id}`,
        accountUuid: inputPackage.account.accountUuid,
        aiRunId: input.runId,
        sourceType: material.sourceType,
        provider: material.provider,
        sourceRef: material.sourceRef,
        sourceUrl: material.sourceUrl,
        title: material.title,
        capturedAt: material.capturedAt,
        metadata: {
          material_id: material.id,
          topic_id: inputPackage.topic.id,
          summary: material.summary,
          used_by_draft_id: input.draft.id
        }
      });
    }

    input.repo.recordAuditEvent({
      id: input.auditEventId,
      accountUuid: inputPackage.account.accountUuid,
      eventType: "ai_draft_created",
      subjectType: "ai_run",
      subjectId: input.runId,
      actorType: "ai",
      actorId: input.actorId ?? "ai_posting_pipeline",
      traceId: input.traceId,
      occurredAt: input.finishedAt,
      metadata: {
        draft_id: input.draft.id,
        topic_id: input.draft.topicId,
        post_text_sha256: sha256(input.draft.postText),
        evidence_ids: input.draft.evidenceIds,
        account_config_hash: inputPackage.account.configHash,
        prompt_sha256: inputPackage.prompt.promptSha256
      }
    });
  });
}

function findExternalPostTextViolations(text: string): DraftPostingGateReason[] {
  const reasons: DraftPostingGateReason[] = [];
  if (text.length > maxManualReviewPostTextLength) {
    reasons.push({
      code: "post_text_too_long",
      message: `external X post_text must not exceed ${maxManualReviewPostTextLength} characters before human review`
    });
  }

  const formattedPattern = /(^|\n)\s*(#{1,6}\s+|[-*]\s+|\d+[.)]\s+|>\s+)|```|\*\*|(^|\n)\s*(标题|摘要|正文|结论|观点[一二三四五六七八九十\d]*|理由)\s*[:：]/u;
  if (formattedPattern.test(text)) {
    reasons.push({
      code: "formatted_post_text",
      message: "external X post_text must be natural plain text, not a formatted report"
    });
  }

  const debugViolation = findRealDebugPostTextViolation(text);
  if (debugViolation) {
    reasons.push({
      code: "debug_post_text",
      message: debugViolation
    });
  }

  const stiltedViolation = findStiltedPostTextViolation(text);
  if (stiltedViolation) {
    reasons.push({
      code: "stilted_post_text",
      message: stiltedViolation
    });
  }

  return reasons;
}

function findStiltedPostTextViolation(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, " ").trim();
  const reportTemplatePatterns = [
    /最容易被(?:想成|理解成|看成).{0,30}(?:其实|本质上)?更像/u,
    /时间表.{0,16}(?:看着|看起来|听起来)远.{0,24}(?:并不|不算|没那么)宽裕/u,
    /(?:不是|不只是).{0,24}而是.{0,28}(?:工程问题|资产盘点|系统工程|节奏问题)/u
  ];
  const reportTemplateHits = reportTemplatePatterns.filter((pattern) => pattern.test(normalized)).length;
  if (reportTemplateHits > 0) {
    return "external X post_text sounds like a report or consulting summary; rewrite as a shorter human observation";
  }

  const formalTerms = [
    "迁移",
    "资产盘点",
    "供应商",
    "时间表",
    "政府和大企业",
    "企业 IT",
    "长期保密",
    "攻防假设",
    "系统工程",
    "工程问题",
    "节奏变了"
  ];
  const formalHitCount = formalTerms.filter((term) => normalized.includes(term)).length;
  if (formalHitCount >= 4) {
    return "external X post_text is too formal for automatic posting; rewrite with fewer report-like nouns";
  }

  return undefined;
}

function sanitizeWritableDraftRunInputPackage(inputPackage: DraftRunInputPackage): DraftRunInputPackage {
  const parsed = parseWithSchema(
    writableDraftRunInputPackageSchema,
    inputPackage,
    "draft run input package is invalid"
  );

  return {
    kind: parsed.kind,
    account: {
      accountUuid: parsed.account.accountUuid,
      accountKey: parsed.account.accountKey,
      configVersion: parsed.account.configVersion,
      configHash: parsed.account.configHash,
      configSnapshotId: parsed.account.configSnapshotId,
      language: parsed.account.language,
      topics: {
        include: parsed.account.topics.include,
        exclude: parsed.account.topics.exclude ?? []
      },
      style: {
        voice: parsed.account.style.voice,
        rules: parsed.account.style.rules ?? [],
        banned_phrases: parsed.account.style.banned_phrases ?? []
      }
    },
    prompt: {
      source: parsed.prompt.source,
      promptSha256: parsed.prompt.promptSha256,
      promptPath: parsed.prompt.promptPath
    },
    topic: {
      ...parsed.topic,
      keywords: parsed.topic.keywords ?? []
    },
    materials: parsed.materials,
    recentPosts: parsed.recentPosts,
    guardrails: parsed.guardrails
  };
}

function normalizeForSimilarity(text: string): string {
  return text
    .replace(urlPattern, "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\p{P}\p{S}\s]/gu, "");
}

function charBigrams(value: string): Set<string> {
  if (value.length <= 1) {
    return new Set(value ? [value] : []);
  }

  const grams = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    grams.add(value.slice(index, index + 2));
  }
  return grams;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 1;
  }
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) {
      intersection += 1;
    }
  }
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function extractUrls(text: string): string[] {
  return [...text.matchAll(urlPattern)].map((match) => match[0]);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw pipelineError(`duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw pipelineError(message, parsed.error.flatten());
  }
  return parsed.data;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function pipelineError(message: string, details?: unknown): ApiError {
  return new ApiError({
    code: "invalid_request",
    provider: "local",
    stage: "ai_posting_pipeline",
    message,
    details
  });
}
