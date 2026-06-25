import { createHash } from "node:crypto";
import { z } from "zod";
import type { AccountInitialPrompt } from "../accounts/account-prompt";
import type { AccountConfig, AccountConfigSnapshot } from "../accounts/registry";
import { ApiError } from "../api/errors";
import type { CandidateTopic, DraftEvidenceMaterial, DraftEvidenceSourceType, RecentAccountPost } from "../drafts/ai-posting-pipeline";
import { derivePublicXSearchQueriesFromPrompt } from "../context/source-queries";
import type { RecentPostInput, SourceEngagementMetrics, SourceMaterialInput } from "../context/source-ingestion";
import type { RuntimeRepository } from "../storage/repositories";

export type TopicRadarCandidateStatus = "eligible" | "suppressed_recent_duplicate";

export type TopicRadarCandidate = {
  topic: CandidateTopic;
  status: TopicRadarCandidateStatus;
  score: number;
  rawScore: number;
  recentSimilarity: number;
  materialIds: string[];
  signals: {
    materialCount: number;
    publicXPostCount: number;
    webPageCount: number;
    manualNoteCount: number;
    engagementScore: number;
    freshnessScore: number;
    accountTopicMatches: string[];
    topMaterialId: string;
  };
};

export type TopicRadarPackage = {
  kind: "topic_radar_v1";
  accountUuid: string;
  accountKey: string;
  observedAt: string;
  account: {
    configVersion: number;
    configHash: string;
    configSnapshotId?: string;
    language: string;
    topics: AccountConfig["topics"];
  };
  prompt: {
    source: AccountInitialPrompt["source"];
    promptSha256: string;
    promptPath?: string;
  };
  materials: DraftEvidenceMaterial[];
  materialScores: Record<string, number>;
  recentPosts: RecentAccountPost[];
  candidates: TopicRadarCandidate[];
  selectedTopic: CandidateTopic;
  selection: {
    selectedTopicId: string;
    rationale: string;
    discarded: Array<{
      topicId: string;
      status: TopicRadarCandidateStatus;
      reason: string;
    }>;
  };
  guardrails: {
    noOnlineCalls: true;
    accountScoped: true;
    promptPlaintextForbidden: true;
    selectBeforeSourceContext: true;
    requireRecentDuplicateAvoidance: true;
  };
};

export type BuildTopicRadarInput = {
  account: AccountConfig;
  configSnapshot: AccountConfigSnapshot;
  configSnapshotId?: string;
  prompt: AccountInitialPrompt;
  materials: SourceMaterialInput[];
  recentPosts: RecentPostInput[];
  observedAt: string;
  candidatesLimit?: number;
  duplicateThreshold?: number;
};

export type RecordTopicRadarSelectionInput = {
  repo: RuntimeRepository;
  radar: TopicRadarPackage;
  runId: string;
  auditEventId: string;
  traceId: string;
  startedAt: string;
  finishedAt: string;
  model?: string;
  actorId?: string;
};

type ParsedSourceMaterial = Omit<z.infer<typeof sourceMaterialInputSchema>, "topicTags" | "engagement"> & {
  topicTags: string[];
  engagement?: SourceEngagementMetrics;
};

type MaterialScore = {
  material: ParsedSourceMaterial;
  score: number;
  engagementScore: number;
  freshnessScore: number;
  accountTopicMatches: string[];
};

type CandidateGroup = {
  key: string;
  parts: string[];
  accountTopicMatches: Set<string>;
  materials: Map<string, MaterialScore>;
};

const defaultCandidatesLimit = 8;
const defaultDuplicateThreshold = 0.62;
const maxSummaryLength = 320;
const nonEmptyStringSchema = z.string().trim().min(1);
const isoDateTimeSchema = z.string().datetime();
const positiveIntegerSchema = z.number().int().positive();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const evidenceSourceTypeSchema = z.enum(["public_x_post", "public_x_search", "web_page", "manual_note", "runtime_snapshot"]);
const recentPostSourceSchema = z.enum(["local_ledger", "public_x", "manual"]);
const urlPattern = /https?:\/\/[^\s)]+/gi;

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
    accountUuid: z.string().uuid(),
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
    accountUuid: z.string().uuid(),
    text: nonEmptyStringSchema,
    postedAt: isoDateTimeSchema,
    source: recentPostSourceSchema
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

const candidateTopicSchema = z
  .object({
    id: nonEmptyStringSchema,
    label: nonEmptyStringSchema,
    reason: nonEmptyStringSchema,
    keywords: z.array(nonEmptyStringSchema).default([])
  })
  .strict();

const draftEvidenceMaterialSchema = z
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

const topicRadarCandidateSchema = z
  .object({
    topic: candidateTopicSchema,
    status: z.enum(["eligible", "suppressed_recent_duplicate"]),
    score: z.number(),
    rawScore: z.number().nonnegative(),
    recentSimilarity: z.number().min(0).max(1),
    materialIds: z.array(nonEmptyStringSchema).min(1),
    signals: z
      .object({
        materialCount: z.number().int().positive(),
        publicXPostCount: z.number().int().nonnegative(),
        webPageCount: z.number().int().nonnegative(),
        manualNoteCount: z.number().int().nonnegative(),
        engagementScore: z.number().nonnegative(),
        freshnessScore: z.number().nonnegative(),
        accountTopicMatches: z.array(nonEmptyStringSchema).min(1),
        topMaterialId: nonEmptyStringSchema
      })
      .strict()
  })
  .strict();

const topicRadarPackageSchema = z
  .object({
    kind: z.literal("topic_radar_v1"),
    accountUuid: z.string().uuid(),
    accountKey: nonEmptyStringSchema,
    observedAt: isoDateTimeSchema,
    account: z
      .object({
        configVersion: z.number().int().positive(),
        configHash: sha256Schema,
        configSnapshotId: nonEmptyStringSchema.optional(),
        language: nonEmptyStringSchema,
        topics: z
          .object({
            include: z.array(nonEmptyStringSchema).min(1),
            exclude: z.array(nonEmptyStringSchema).default([])
          })
          .strict()
      })
      .strict(),
    prompt: z
      .object({
        source: z.enum(["inline", "file"]),
        promptSha256: sha256Schema,
        promptPath: nonEmptyStringSchema.optional()
      })
      .strict(),
    materials: z.array(draftEvidenceMaterialSchema).min(1),
    materialScores: z.record(z.number().nonnegative()),
    recentPosts: z.array(recentAccountPostSchema),
    candidates: z.array(topicRadarCandidateSchema).min(1),
    selectedTopic: candidateTopicSchema,
    selection: z
      .object({
        selectedTopicId: nonEmptyStringSchema,
        rationale: nonEmptyStringSchema,
        discarded: z.array(
          z
            .object({
              topicId: nonEmptyStringSchema,
              status: z.enum(["eligible", "suppressed_recent_duplicate"]),
              reason: nonEmptyStringSchema
            })
            .strict()
        )
      })
      .strict(),
    guardrails: z
      .object({
        noOnlineCalls: z.literal(true),
        accountScoped: z.literal(true),
        promptPlaintextForbidden: z.literal(true),
        selectBeforeSourceContext: z.literal(true),
        requireRecentDuplicateAvoidance: z.literal(true)
      })
      .strict()
  })
  .strict();

export function buildTopicRadar(input: BuildTopicRadarInput): TopicRadarPackage {
  assertSnapshotMatchesAccount(input.account, input.configSnapshot);
  assertPromptMatchesAccount(input.account, input.prompt);
  const observedAt = parseIsoDateTime(input.observedAt, "observedAt");
  const candidatesLimit = parseOptionalPositiveInteger(input.candidatesLimit, "candidatesLimit") ?? defaultCandidatesLimit;
  const duplicateThreshold = parseDuplicateThreshold(input.duplicateThreshold);
  const observedAtMs = Date.parse(observedAt);
  const parsedMaterials = parseWithSchema(z.array(sourceMaterialInputSchema).min(1), input.materials, "topic radar materials are invalid").map(
    (material): ParsedSourceMaterial => ({
      ...material,
      topicTags: material.topicTags ?? [],
      engagement: material.engagement
    })
  );
  const recentPosts = parseWithSchema(z.array(recentPostInputSchema), input.recentPosts, "recent account posts are invalid");
  const accountTopics = accountTopicsForRadar(input.account, input.prompt);
  assertUnique(parsedMaterials.map((material) => material.id), "source material id");
  assertUnique(recentPosts.map((post) => post.id), "recent post id");

  for (const material of parsedMaterials) {
    assertAccountScope(material.accountUuid, input.account.account_uuid, "source material");
  }
  for (const post of recentPosts) {
    assertAccountScope(post.accountUuid, input.account.account_uuid, "recent post");
  }

  const groups = new Map<string, CandidateGroup>();
  const materialScoreById = new Map<string, number>();
  for (const material of parsedMaterials) {
    if (matchesExcludedTopic(input.account, material)) {
      continue;
    }

    const accountTopicMatches = accountTopics.include.filter((topic) => materialMatchesTopic(material, topic));
    if (accountTopicMatches.length === 0) {
      continue;
    }

    const materialScore = scoreMaterial({
      account: input.account,
      material,
      accountTopicMatches,
      observedAtMs
    });
    materialScoreById.set(material.id, Math.max(materialScoreById.get(material.id) ?? 0, materialScore.score));

    for (const accountTopic of accountTopicMatches) {
      const parts = candidatePartsForMaterial({
        accountTopic,
        account: input.account,
        material
      });
      const key = parts.map(normaliseTopicText).join("|");
      const group = groups.get(key) ?? {
        key,
        parts,
        accountTopicMatches: new Set<string>(),
        materials: new Map<string, MaterialScore>()
      };
      group.accountTopicMatches.add(accountTopic);
      group.materials.set(material.id, materialScore);
      groups.set(key, group);
    }
  }

  if (groups.size === 0) {
    throw topicRadarError("topic radar found no account-scoped topic candidates");
  }

  const candidates = [...groups.values()]
    .map((group) =>
      buildCandidateFromGroup({
        account: input.account,
        group,
        recentPosts,
        duplicateThreshold
      })
    )
    .sort(compareCandidates)
    .slice(0, candidatesLimit);
  const selected = candidates.find((candidate) => candidate.status === "eligible");
  if (!selected) {
    throw topicRadarError("topic radar found no eligible topic after recent duplicate filtering");
  }

  const materialIds = uniqueStrings(candidates.flatMap((candidate) => candidate.materialIds));
  const materialScores: Record<string, number> = {};
  const materials = materialIds
    .map((id) => {
      const material = parsedMaterials.find((candidate) => candidate.id === id);
      if (!material) {
        throw topicRadarError(`candidate references unknown material: ${id}`);
      }
      materialScores[id] = roundScore(materialScoreById.get(id) ?? 0);
      return toDraftEvidenceMaterial(material);
    })
    .sort((left, right) => (materialScores[right.id] ?? 0) - (materialScores[left.id] ?? 0) || left.id.localeCompare(right.id));

  return sanitizeTopicRadar({
    kind: "topic_radar_v1",
    accountUuid: input.account.account_uuid,
    accountKey: input.account.account_key,
    observedAt,
    account: {
      configVersion: input.account.config_version,
      configHash: input.configSnapshot.config_hash,
      configSnapshotId: input.configSnapshotId,
      language: input.account.language,
      topics: accountTopics
    },
    prompt: {
      source: input.prompt.source,
      promptSha256: input.prompt.promptSha256,
      promptPath: input.prompt.promptPath
    },
    materials,
    materialScores,
    recentPosts: recentPosts
      .sort((left, right) => Date.parse(right.postedAt) - Date.parse(left.postedAt) || left.id.localeCompare(right.id))
      .map((post) => ({
        id: post.id,
        text: post.text,
        postedAt: post.postedAt,
        source: post.source
      })),
    candidates,
    selectedTopic: selected.topic,
    selection: {
      selectedTopicId: selected.topic.id,
      rationale: `Selected ${selected.topic.label} because it has the strongest eligible score (${selected.score}).`,
      discarded: candidates
        .filter((candidate) => candidate.topic.id !== selected.topic.id)
        .map((candidate) => ({
          topicId: candidate.topic.id,
          status: candidate.status,
          reason:
            candidate.status === "suppressed_recent_duplicate"
              ? `suppressed by recent duplicate similarity ${candidate.recentSimilarity}`
              : `ranked below selected topic with score ${candidate.score}`
        }))
    },
    guardrails: {
      noOnlineCalls: true,
      accountScoped: true,
      promptPlaintextForbidden: true,
      selectBeforeSourceContext: true,
      requireRecentDuplicateAvoidance: true
    }
  });
}

export function recordTopicRadarSelection(input: RecordTopicRadarSelectionInput): void {
  const radar = sanitizeTopicRadar(input.radar);
  const materialsById = new Map(radar.materials.map((material) => [material.id, material]));
  input.repo.transaction(() => {
    input.repo.recordAiRun({
      id: input.runId,
      accountUuid: radar.accountUuid,
      traceId: input.traceId,
      purpose: "topic_radar_selection",
      model: input.model ?? "topic-radar-offline-v0",
      status: "succeeded",
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      input: {
        kind: "topic_radar_input_v1",
        account_uuid: radar.accountUuid,
        account_key: radar.accountKey,
        config_version: radar.account.configVersion,
        config_hash: radar.account.configHash,
        config_snapshot_id: radar.account.configSnapshotId,
        prompt_source: radar.prompt.source,
        prompt_sha256: radar.prompt.promptSha256,
        prompt_path: radar.prompt.promptPath,
        observed_at: radar.observedAt,
        material_ids: radar.materials.map((material) => material.id),
        recent_post_hashes: Object.fromEntries(radar.recentPosts.map((post) => [post.id, sha256(post.text)])),
        guardrails: radar.guardrails
      },
      output: {
        radar_hash: stableHash(radar),
        selected_topic: radar.selectedTopic,
        candidates: radar.candidates.map((candidate) => ({
          topic_id: candidate.topic.id,
          label: candidate.topic.label,
          status: candidate.status,
          score: candidate.score,
          raw_score: candidate.rawScore,
          recent_similarity: candidate.recentSimilarity,
          material_ids: candidate.materialIds,
          signals: candidate.signals
        })),
        material_scores: radar.materialScores
      }
    });

    for (const material of radar.materials) {
      input.repo.recordEvidenceRef({
        id: `${input.runId}:${material.id}`,
        accountUuid: radar.accountUuid,
        aiRunId: input.runId,
        sourceType: material.sourceType,
        provider: material.provider,
        sourceRef: material.sourceRef,
        sourceUrl: material.sourceUrl,
        title: material.title,
        capturedAt: material.capturedAt,
        metadata: {
          material_id: material.id,
          selected_topic_id: radar.selectedTopic.id,
          summary: material.summary,
          score: radar.materialScores[material.id] ?? 0
        }
      });
    }

    input.repo.recordAuditEvent({
      id: input.auditEventId,
      accountUuid: radar.accountUuid,
      eventType: "topic_selected",
      subjectType: "ai_run",
      subjectId: input.runId,
      actorType: "ai",
      actorId: input.actorId ?? "topic_radar",
      traceId: input.traceId,
      occurredAt: input.finishedAt,
      metadata: {
        selected_topic_id: radar.selectedTopic.id,
        selected_topic_label: radar.selectedTopic.label,
        radar_hash: stableHash(radar),
        prompt_sha256: radar.prompt.promptSha256,
        candidate_count: radar.candidates.length,
        material_count: radar.materials.length
      }
    });
  });
}

function buildCandidateFromGroup(input: {
  account: AccountConfig;
  group: CandidateGroup;
  recentPosts: RecentAccountPost[];
  duplicateThreshold: number;
}): TopicRadarCandidate {
  const materials = [...input.group.materials.values()].sort((left, right) => right.score - left.score || left.material.id.localeCompare(right.material.id));
  const topMaterial = materials[0];
  if (!topMaterial) {
    throw topicRadarError(`topic group has no materials: ${input.group.key}`);
  }

  const label = input.group.parts.map(displayTopicTerm).join(" ");
  const keywords = uniqueStrings([
    ...input.group.parts,
    ...materials.flatMap((item) => item.material.topicTags),
    ...input.group.accountTopicMatches
  ]).slice(0, 12);
  const candidateText = [label, ...keywords, ...materials.slice(0, 3).map((item) => item.material.summary ?? item.material.text ?? "")].join(" ");
  const recentSimilarity = roundScore(maxRecentSimilarity(candidateText, input.recentPosts));
  const rawScore = roundScore(materials.reduce((total, item) => total + item.score, 0) + diversityBonus(materials));
  const status: TopicRadarCandidateStatus = recentSimilarity >= input.duplicateThreshold ? "suppressed_recent_duplicate" : "eligible";
  const score = roundScore(rawScore - recentSimilarity * 10);

  return {
    topic: {
      id: `topic-${sha256(`${input.account.account_uuid}:${input.group.key}`).slice(0, 12)}`,
      label,
      reason: `${materials.length} materials support this topic; strongest signal: ${materialTitle(topMaterial.material)}.`,
      keywords
    },
    status,
    score,
    rawScore,
    recentSimilarity,
    materialIds: materials.map((item) => item.material.id),
    signals: {
      materialCount: materials.length,
      publicXPostCount: countBySourceType(materials, "public_x_post"),
      webPageCount: countBySourceType(materials, "web_page"),
      manualNoteCount: countBySourceType(materials, "manual_note"),
      engagementScore: roundScore(materials.reduce((total, item) => total + item.engagementScore, 0)),
      freshnessScore: roundScore(materials.reduce((total, item) => total + item.freshnessScore, 0)),
      accountTopicMatches: [...input.group.accountTopicMatches],
      topMaterialId: topMaterial.material.id
    }
  };
}

function accountTopicsForRadar(account: AccountConfig, prompt: AccountInitialPrompt): AccountConfig["topics"] {
  const promptTopics = derivePublicXSearchQueriesFromPrompt(prompt, { maxQueries: 10 });
  const include = account.topics.include.length > 0 ? account.topics.include : promptTopics;
  return {
    include: uniqueStrings(include),
    exclude: account.topics.exclude
  };
}

function candidatePartsForMaterial(input: {
  accountTopic: string;
  account: AccountConfig;
  material: ParsedSourceMaterial;
}): string[] {
  const secondaryTags = input.material.topicTags
    .filter((tag) => !topicEquals(tag, input.accountTopic))
    .filter((tag) => !input.account.topics.exclude.some((excluded) => materialTermMatches(tag, excluded)))
    .slice(0, 2);
  return uniqueStrings([input.accountTopic, ...secondaryTags]).slice(0, 3);
}

function scoreMaterial(input: {
  account: AccountConfig;
  material: ParsedSourceMaterial;
  accountTopicMatches: string[];
  observedAtMs: number;
}): MaterialScore {
  const engagementScore = engagementScoreFor(input.material.engagement);
  const freshnessScore = freshnessScoreFor(input.material.capturedAt, input.observedAtMs);
  const score =
    sourceTypeWeight(input.material.sourceType) +
    input.accountTopicMatches.length * 4 +
    input.material.topicTags.length * 0.35 +
    engagementScore +
    freshnessScore;
  return {
    material: input.material,
    score,
    engagementScore,
    freshnessScore,
    accountTopicMatches: input.accountTopicMatches
  };
}

function sanitizeTopicRadar(radar: TopicRadarPackage): TopicRadarPackage {
  const parsed = parseWithSchema(topicRadarPackageSchema, radar, "topic radar package is invalid");
  assertUnique(parsed.materials.map((material) => material.id), "topic radar material id");
  assertUnique(parsed.candidates.map((candidate) => candidate.topic.id), "topic candidate id");
  assertMaterialScoresMatch(parsed.materials.map((material) => material.id), parsed.materialScores);
  const materialIds = new Set(parsed.materials.map((material) => material.id));
  for (const candidate of parsed.candidates) {
    for (const materialId of candidate.materialIds) {
      if (!materialIds.has(materialId)) {
        throw topicRadarError(`topic candidate references unknown material: ${materialId}`);
      }
    }
    if (!candidate.materialIds.includes(candidate.signals.topMaterialId)) {
      throw topicRadarError(`topic candidate top material is not referenced: ${candidate.signals.topMaterialId}`);
    }
  }

  if (parsed.selection.selectedTopicId !== parsed.selectedTopic.id) {
    throw topicRadarError("topic selection id differs from selected topic");
  }
  const selectedCandidate = parsed.candidates.find((candidate) => candidate.topic.id === parsed.selectedTopic.id);
  if (!selectedCandidate) {
    throw topicRadarError("selected topic is missing from candidates");
  }
  if (selectedCandidate.status !== "eligible") {
    throw topicRadarError("selected topic must be eligible");
  }
  if (!topicsEqual(parsed.selectedTopic, selectedCandidate.topic)) {
    throw topicRadarError("selected topic differs from selected candidate topic");
  }

  return {
    kind: parsed.kind,
    accountUuid: parsed.accountUuid,
    accountKey: parsed.accountKey,
    observedAt: parsed.observedAt,
    account: {
      configVersion: parsed.account.configVersion,
      configHash: parsed.account.configHash,
      configSnapshotId: parsed.account.configSnapshotId,
      language: parsed.account.language,
      topics: {
        include: parsed.account.topics.include,
        exclude: parsed.account.topics.exclude ?? []
      }
    },
    prompt: parsed.prompt,
    materials: parsed.materials,
    materialScores: parsed.materialScores,
    recentPosts: parsed.recentPosts,
    candidates: parsed.candidates.map((candidate) => ({
      ...candidate,
      topic: {
        ...candidate.topic,
        keywords: candidate.topic.keywords ?? []
      }
    })),
    selectedTopic: {
      ...parsed.selectedTopic,
      keywords: parsed.selectedTopic.keywords ?? []
    },
    selection: parsed.selection,
    guardrails: parsed.guardrails
  };
}

function compareCandidates(left: TopicRadarCandidate, right: TopicRadarCandidate): number {
  const statusDelta = statusWeight(right.status) - statusWeight(left.status);
  if (statusDelta !== 0) {
    return statusDelta;
  }
  return right.score - left.score || right.rawScore - left.rawScore || left.topic.id.localeCompare(right.topic.id);
}

function statusWeight(status: TopicRadarCandidateStatus): number {
  return status === "eligible" ? 1 : 0;
}

function topicsEqual(
  left: {
    id: string;
    label: string;
    reason: string;
    keywords?: string[];
  },
  right: {
    id: string;
    label: string;
    reason: string;
    keywords?: string[];
  }
): boolean {
  return (
    left.id === right.id &&
    left.label === right.label &&
    left.reason === right.reason &&
    JSON.stringify(left.keywords ?? []) === JSON.stringify(right.keywords ?? [])
  );
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

function matchesExcludedTopic(account: AccountConfig, material: ParsedSourceMaterial): boolean {
  const text = materialTopicText(material);
  return account.topics.exclude.some((topic) => matchesTopicText(text, normaliseTopicText(topic)));
}

function materialMatchesTopic(material: ParsedSourceMaterial, topic: string): boolean {
  return material.topicTags.some((tag) => topicEquals(tag, topic)) || matchesTopicText(materialTopicText(material), normaliseTopicText(topic));
}

function materialTermMatches(value: string, topic: string): boolean {
  return matchesTopicText(normaliseTopicText(value), normaliseTopicText(topic));
}

function materialTopicText(material: ParsedSourceMaterial): string {
  return normaliseTopicText([material.title, material.summary, material.text, material.sourceRef, ...(material.topicTags ?? [])].filter(Boolean).join(" "));
}

function topicEquals(left: string, right: string): boolean {
  return normaliseTopicText(left) === normaliseTopicText(right);
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

function normaliseTopicText(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").trim();
}

function displayTopicTerm(value: string): string {
  return value.replace(/[_-]+/g, " ").trim();
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

function engagementScoreFor(engagement: SourceEngagementMetrics | undefined): number {
  if (!engagement) {
    return 0;
  }
  return Math.log1p(
    (engagement.likeCount ?? 0) +
      (engagement.repostCount ?? 0) * 2 +
      (engagement.replyCount ?? 0) +
      (engagement.quoteCount ?? 0) * 1.5 +
      (engagement.bookmarkCount ?? 0) * 2 +
      (engagement.viewCount ?? 0) / 1000
  );
}

function freshnessScoreFor(capturedAt: string, observedAtMs: number): number {
  const ageDays = Math.max(0, (observedAtMs - Date.parse(capturedAt)) / 86_400_000);
  return Math.max(0, 1 - ageDays / 14) * 2;
}

function diversityBonus(materials: MaterialScore[]): number {
  const sourceTypes = new Set(materials.map((item) => item.material.sourceType)).size;
  const providers = new Set(materials.map((item) => item.material.provider).filter(Boolean)).size;
  return sourceTypes * 0.4 + providers * 0.2;
}

function countBySourceType(materials: MaterialScore[], sourceType: DraftEvidenceSourceType): number {
  return materials.filter((item) => item.material.sourceType === sourceType).length;
}

function materialTitle(material: ParsedSourceMaterial): string {
  return material.title ?? trimSummary(material.summary ?? material.text ?? material.id);
}

function maxRecentSimilarity(candidateText: string, recentPosts: RecentAccountPost[]): number {
  const candidate = normalizeForSimilarity(candidateText);
  if (!candidate) {
    return 0;
  }

  let maxSimilarity = 0;
  for (const post of recentPosts) {
    const recent = normalizeForSimilarity(post.text);
    if (!recent) {
      continue;
    }
    maxSimilarity = Math.max(maxSimilarity, jaccard(charBigrams(candidate), charBigrams(recent)));
  }
  return maxSimilarity;
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

function trimSummary(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= maxSummaryLength ? trimmed : `${trimmed.slice(0, maxSummaryLength - 3)}...`;
}

function assertSnapshotMatchesAccount(account: AccountConfig, snapshot: AccountConfigSnapshot): void {
  if (snapshot.account_uuid !== account.account_uuid) {
    throw topicRadarError("config snapshot belongs to a different account");
  }
  if (snapshot.account_key !== account.account_key) {
    throw topicRadarError("config snapshot account_key differs from account");
  }
}

function assertPromptMatchesAccount(account: AccountConfig, prompt: AccountInitialPrompt): void {
  if (prompt.accountKey !== account.account_key) {
    throw topicRadarError("initial prompt belongs to a different account_key");
  }
}

function assertAccountScope(accountUuid: string | undefined, expectedAccountUuid: string, label: string): void {
  if (accountUuid && accountUuid !== expectedAccountUuid) {
    throw topicRadarError(`${label} belongs to a different account_uuid`);
  }
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw topicRadarError(`duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function assertMaterialScoresMatch(materialIds: string[], materialScores: Record<string, number>): void {
  const materialIdSet = new Set(materialIds);
  const scoreKeys = Object.keys(materialScores);
  const missingScore = materialIds.find((id) => !(id in materialScores));
  if (missingScore) {
    throw topicRadarError(`material score is missing for material: ${missingScore}`);
  }

  const extraScore = scoreKeys.find((id) => !materialIdSet.has(id));
  if (extraScore) {
    throw topicRadarError(`material score references unknown material: ${extraScore}`);
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
    throw topicRadarError(`${field} must be an ISO datetime`);
  }

  return parsed.data;
}

function parseOptionalPositiveInteger(value: number | undefined, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = positiveIntegerSchema.safeParse(value);
  if (!parsed.success) {
    throw topicRadarError(`${field} must be a positive integer`);
  }

  return parsed.data;
}

function parseDuplicateThreshold(value: number | undefined): number {
  if (value === undefined) {
    return defaultDuplicateThreshold;
  }
  const parsed = z.number().min(0).max(1).safeParse(value);
  if (!parsed.success) {
    throw topicRadarError("duplicateThreshold must be between 0 and 1");
  }
  return parsed.data;
}

function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw topicRadarError(message, parsed.error.flatten());
  }
  return parsed.data;
}

function stableHash(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function topicRadarError(message: string, details?: unknown): ApiError {
  return new ApiError({
    code: "invalid_request",
    provider: "local",
    stage: "topic_radar",
    message,
    details
  });
}
