import { createHash } from "node:crypto";
import { z } from "zod";
import type { AccountConfig } from "../accounts/registry";
import { ApiError } from "../api/errors";
import type {
  RuntimeRepository,
  StoredAiAction,
  StoredAiDecision,
  StoredAiRun,
  StoredAuditEvent,
  StoredEvidenceRef
} from "../storage/repositories";

export type AccountMemoryOutcomeCounts = {
  autoPost: number;
  humanReview: number;
  reject: number;
  defer: number;
  draftBlocked: number;
};

export type AccountMemoryPerformanceMetrics = {
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  quoteCount?: number;
  bookmarkCount?: number;
  viewCount?: number;
};

export type AccountMemoryPerformanceSnapshot = {
  readbackStatus: "confirmed" | "not_found" | "failed";
  tweetId?: string;
  provider?: string;
  capturedAt?: string;
  textMatchesCandidate?: boolean;
  metrics?: AccountMemoryPerformanceMetrics;
};

export type AccountMemoryTraceSummary = {
  traceId: string;
  startedAt: string;
  eventTypes: string[];
  selectedTopic?: {
    id: string;
    label: string;
    keywords: string[];
  };
  draft?: {
    id: string;
    textSha256?: string;
    topicTags: string[];
    evidenceIds: string[];
  };
  policy?: {
    decisionId?: string;
    outcome: "auto_post" | "human_review" | "reject" | "defer";
    route?: string;
    reasonCodes: string[];
  };
  finalAction?: {
    actionId: string;
    actionType: string;
    status: string;
  };
  performance?: AccountMemoryPerformanceSnapshot;
  evidenceIds: string[];
};

export type AccountTopicMemory = {
  topicId: string;
  label: string;
  selectedCount: number;
  outcomes: AccountMemoryOutcomeCounts;
  recentTraceIds: string[];
};

export type AccountLifetimeTopicStats = {
  topicId: string;
  label: string;
  selectedCount: number;
  outcomes: AccountMemoryOutcomeCounts;
};

export type AccountLifetimeStats = {
  traceCount: number;
  outcomeCounts: AccountMemoryOutcomeCounts;
  actionCounts: Record<string, number>;
  topTopics: AccountLifetimeTopicStats[];
};

export type AccountMemorySnapshot = {
  kind: "account_memory_v1";
  accountUuid: string;
  accountKey: string;
  capturedAt: string;
  source: {
    runCount: number;
    decisionCount: number;
    actionCount: number;
    evidenceCount: number;
    eventCount: number;
  };
  promptSha256s: string[];
  outcomeCounts: AccountMemoryOutcomeCounts;
  actionCounts: Record<string, number>;
  topicMemory: AccountTopicMemory[];
  lifetimeStats: AccountLifetimeStats;
  traceSummaries: AccountMemoryTraceSummary[];
  nextRunHints: string[];
  guardrails: {
    accountScoped: true;
    ledgerDerived: true;
    offlineOnly: true;
    promptPlaintextForbidden: true;
  };
};

export type AccountReflection = {
  kind: "account_reflection_v1";
  accountUuid: string;
  accountKey: string;
  reflectedAt: string;
  memorySha256: string;
  summary: {
    traceCount: number;
    topTopics: string[];
    outcomeCounts: AccountMemoryOutcomeCounts;
  };
  lessons: string[];
  avoidRepeating: string[];
  nextRunHints: string[];
};

export type BuildAccountMemoryInput = {
  repo: RuntimeRepository;
  account: AccountConfig;
  capturedAt: string;
  traceLimit?: number;
};

export type CreateAccountReflectionInput = {
  memory: AccountMemorySnapshot;
  reflectedAt: string;
};

export type RecordAccountReflectionInput = {
  repo: RuntimeRepository;
  memory: AccountMemorySnapshot;
  reflection: AccountReflection;
  runId: string;
  auditEventId: string;
  traceId: string;
  startedAt: string;
  finishedAt: string;
  actorId?: string;
};

type MutableTraceSummary = AccountMemoryTraceSummary & {
  runIds: string[];
};

const defaultTraceLimit = 20;
const defaultLifetimeTopTopicsLimit = 20;
const nonEmptyStringSchema = z.string().trim().min(1);
const isoDateTimeSchema = z.string().datetime();
const positiveIntegerSchema = z.number().int().positive();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const outcomeSchema = z.enum(["auto_post", "human_review", "reject", "defer"]);

const outcomeCountsSchema = z
  .object({
    autoPost: z.number().int().nonnegative(),
    humanReview: z.number().int().nonnegative(),
    reject: z.number().int().nonnegative(),
    defer: z.number().int().nonnegative(),
    draftBlocked: z.number().int().nonnegative()
  })
  .strict();

const traceSummarySchema = z
  .object({
    traceId: nonEmptyStringSchema,
    startedAt: isoDateTimeSchema,
    eventTypes: z.array(nonEmptyStringSchema),
    selectedTopic: z
      .object({
        id: nonEmptyStringSchema,
        label: nonEmptyStringSchema,
        keywords: z.array(nonEmptyStringSchema).default([])
      })
      .strict()
      .optional(),
    draft: z
      .object({
        id: nonEmptyStringSchema,
        textSha256: sha256Schema.optional(),
        topicTags: z.array(nonEmptyStringSchema).default([]),
        evidenceIds: z.array(nonEmptyStringSchema).default([])
      })
      .strict()
      .optional(),
    policy: z
      .object({
        decisionId: nonEmptyStringSchema.optional(),
        outcome: outcomeSchema,
        route: nonEmptyStringSchema.optional(),
        reasonCodes: z.array(nonEmptyStringSchema).default([])
      })
      .strict()
      .optional(),
    finalAction: z
      .object({
        actionId: nonEmptyStringSchema,
        actionType: nonEmptyStringSchema,
        status: nonEmptyStringSchema
      })
      .strict()
      .optional(),
    performance: z
      .object({
        readbackStatus: z.enum(["confirmed", "not_found", "failed"]),
        tweetId: nonEmptyStringSchema.optional(),
        provider: nonEmptyStringSchema.optional(),
        capturedAt: isoDateTimeSchema.optional(),
        textMatchesCandidate: z.boolean().optional(),
        metrics: z
          .object({
            likeCount: z.number().int().nonnegative().optional(),
            repostCount: z.number().int().nonnegative().optional(),
            replyCount: z.number().int().nonnegative().optional(),
            quoteCount: z.number().int().nonnegative().optional(),
            bookmarkCount: z.number().int().nonnegative().optional(),
            viewCount: z.number().int().nonnegative().optional()
          })
          .strict()
          .optional()
      })
      .strict()
      .optional(),
    evidenceIds: z.array(nonEmptyStringSchema)
  })
  .strict();

const memorySnapshotSchema = z
  .object({
    kind: z.literal("account_memory_v1"),
    accountUuid: z.string().uuid(),
    accountKey: nonEmptyStringSchema,
    capturedAt: isoDateTimeSchema,
    source: z
      .object({
        runCount: z.number().int().nonnegative(),
        decisionCount: z.number().int().nonnegative(),
        actionCount: z.number().int().nonnegative(),
        evidenceCount: z.number().int().nonnegative(),
        eventCount: z.number().int().nonnegative()
      })
      .strict(),
    promptSha256s: z.array(sha256Schema),
    outcomeCounts: outcomeCountsSchema,
    actionCounts: z.record(z.number().int().nonnegative()),
    topicMemory: z.array(
      z
        .object({
          topicId: nonEmptyStringSchema,
          label: nonEmptyStringSchema,
          selectedCount: z.number().int().positive(),
          outcomes: outcomeCountsSchema,
          recentTraceIds: z.array(nonEmptyStringSchema)
        })
        .strict()
    ),
    lifetimeStats: z
      .object({
        traceCount: z.number().int().nonnegative(),
        outcomeCounts: outcomeCountsSchema,
        actionCounts: z.record(z.number().int().nonnegative()),
        topTopics: z.array(
          z
            .object({
              topicId: nonEmptyStringSchema,
              label: nonEmptyStringSchema,
              selectedCount: z.number().int().positive(),
              outcomes: outcomeCountsSchema
            })
            .strict()
        ).max(defaultLifetimeTopTopicsLimit)
      })
      .strict(),
    traceSummaries: z.array(traceSummarySchema),
    nextRunHints: z.array(nonEmptyStringSchema),
    guardrails: z
      .object({
        accountScoped: z.literal(true),
        ledgerDerived: z.literal(true),
        offlineOnly: z.literal(true),
        promptPlaintextForbidden: z.literal(true)
      })
      .strict()
  })
  .strict();

const reflectionSchema = z
  .object({
    kind: z.literal("account_reflection_v1"),
    accountUuid: z.string().uuid(),
    accountKey: nonEmptyStringSchema,
    reflectedAt: isoDateTimeSchema,
    memorySha256: sha256Schema,
    summary: z
      .object({
        traceCount: z.number().int().nonnegative(),
        topTopics: z.array(nonEmptyStringSchema),
        outcomeCounts: outcomeCountsSchema
      })
      .strict(),
    lessons: z.array(nonEmptyStringSchema),
    avoidRepeating: z.array(nonEmptyStringSchema),
    nextRunHints: z.array(nonEmptyStringSchema)
  })
  .strict();

export function buildAccountMemory(input: BuildAccountMemoryInput): AccountMemorySnapshot {
  const capturedAt = parseIsoDateTime(input.capturedAt, "capturedAt");
  const traceLimit = parseOptionalPositiveInteger(input.traceLimit, "traceLimit") ?? defaultTraceLimit;
  const runs = input.repo.listAiRunsForAccount(input.account.account_uuid);
  const decisions = input.repo.listAiDecisionsForAccount(input.account.account_uuid);
  const actions = input.repo.listAiActionsForAccount(input.account.account_uuid);
  const evidenceRefs = input.repo.listEvidenceRefsForAccount(input.account.account_uuid);
  const events = input.repo.listAuditEventsForAccount(input.account.account_uuid);

  const runsById = new Map(runs.map((run) => [run.id, run]));
  const decisionsById = new Map(decisions.map((decision) => [decision.id, decision]));
  const traces = new Map<string, MutableTraceSummary>();
  const promptSha256s = new Set<string>();

  for (const run of runs) {
    const trace = ensureTrace(traces, run.trace_id, run.started_at);
    trace.runIds.push(run.id);
    collectPromptHashes(promptSha256s, parseJson(run.input_json));
    collectRunMemory(trace, run);
  }

  for (const decision of decisions) {
    const run = runsById.get(decision.ai_run_id);
    if (!run) {
      continue;
    }
    const trace = ensureTrace(traces, run.trace_id, run.started_at);
    collectDecisionMemory(trace, decision);
  }

  for (const action of actions) {
    const traceId = traceIdForAction(action, decisionsById, runsById);
    if (!traceId) {
      continue;
    }
    const trace = ensureTrace(traces, traceId, action.started_at);
    collectActionMemory(trace, action);
  }

  for (const evidence of evidenceRefs) {
    const traceId = traceIdForEvidence(evidence, decisionsById, runsById);
    if (!traceId) {
      continue;
    }
    const trace = ensureTrace(traces, traceId, evidence.captured_at);
    trace.evidenceIds = uniqueStrings([...trace.evidenceIds, evidence.id]);
  }

  for (const event of events) {
    const trace = ensureTrace(traces, event.trace_id, event.occurred_at);
    trace.eventTypes = uniqueStrings([...trace.eventTypes, event.event_type]);
    collectEventMemory(trace, event);
  }

  const allTraceSummaries = [...traces.values()]
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt) || left.traceId.localeCompare(right.traceId))
    .map(stripMutableTrace);
  const traceSummaries = allTraceSummaries.slice(0, traceLimit);

  const memory = sanitizeMemory({
    kind: "account_memory_v1",
    accountUuid: input.account.account_uuid,
    accountKey: input.account.account_key,
    capturedAt,
    source: {
      runCount: runs.length,
      decisionCount: decisions.length,
      actionCount: actions.length,
      evidenceCount: evidenceRefs.length,
      eventCount: events.length
    },
    promptSha256s: [...promptSha256s].sort(),
    outcomeCounts: countOutcomes(traceSummaries),
    actionCounts: countActions(traceSummaries),
    topicMemory: buildTopicMemory(traceSummaries),
    lifetimeStats: buildLifetimeStats(allTraceSummaries),
    traceSummaries,
    nextRunHints: buildNextRunHints(traceSummaries),
    guardrails: {
      accountScoped: true,
      ledgerDerived: true,
      offlineOnly: true,
      promptPlaintextForbidden: true
    }
  });
  return memory;
}

export function createAccountReflection(input: CreateAccountReflectionInput): AccountReflection {
  const memory = sanitizeMemory(input.memory);
  const reflectedAt = parseIsoDateTime(input.reflectedAt, "reflectedAt");
  const topTopics = memory.topicMemory.slice(0, 3).map((topic) => topic.label);
  const lessons = buildLessons(memory);
  const avoidRepeating = memory.traceSummaries
    .filter((trace) => trace.selectedTopic)
    .slice(0, 5)
    .map((trace) => trace.selectedTopic?.label)
    .filter((label): label is string => Boolean(label));

  return sanitizeReflection({
    kind: "account_reflection_v1",
    accountUuid: memory.accountUuid,
    accountKey: memory.accountKey,
    reflectedAt,
    memorySha256: stableHash(memory),
    summary: {
      traceCount: memory.traceSummaries.length,
      topTopics,
      outcomeCounts: memory.outcomeCounts
    },
    lessons,
    avoidRepeating: uniqueStrings(avoidRepeating),
    nextRunHints: memory.nextRunHints
  });
}

export function recordAccountReflection(input: RecordAccountReflectionInput): void {
  const memory = sanitizeMemory(input.memory);
  const reflection = sanitizeReflection(input.reflection);
  if (memory.accountUuid !== reflection.accountUuid || memory.accountKey !== reflection.accountKey) {
    throw accountMemoryError("reflection belongs to a different account memory");
  }
  if (reflection.memorySha256 !== stableHash(memory)) {
    throw accountMemoryError("reflection memory hash does not match memory snapshot");
  }
  const expectedReflection = createAccountReflection({
    memory,
    reflectedAt: reflection.reflectedAt
  });
  if (stableHash(reflection) !== stableHash(expectedReflection)) {
    throw accountMemoryError("reflection does not match deterministic account memory output");
  }

  input.repo.transaction(() => {
    input.repo.recordAiRun({
      id: input.runId,
      accountUuid: memory.accountUuid,
      traceId: input.traceId,
      purpose: "account_memory_reflection",
      model: "account-memory-offline-v0",
      status: "succeeded",
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      input: {
        memory
      },
      output: {
        reflection
      }
    });

    for (const trace of memory.traceSummaries.slice(0, 10)) {
      input.repo.recordEvidenceRef({
        id: `${input.runId}:trace:${trace.traceId}`,
        accountUuid: memory.accountUuid,
        aiRunId: input.runId,
        sourceType: "runtime_snapshot",
        provider: "local_runtime",
        sourceRef: `trace:${trace.traceId}`,
        title: trace.selectedTopic?.label ?? trace.finalAction?.actionType ?? "account memory trace",
        capturedAt: memory.capturedAt,
        metadata: {
          trace_id: trace.traceId,
          selected_topic: trace.selectedTopic,
          policy: trace.policy,
          final_action: trace.finalAction
        }
      });
    }

    input.repo.recordAuditEvent({
      id: input.auditEventId,
      accountUuid: memory.accountUuid,
      eventType: "account_memory_reflected",
      subjectType: "ai_run",
      subjectId: input.runId,
      actorType: "ai",
      actorId: input.actorId ?? "account_memory",
      traceId: input.traceId,
      occurredAt: input.finishedAt,
      metadata: {
        memory_sha256: reflection.memorySha256,
        trace_count: memory.traceSummaries.length,
        top_topics: reflection.summary.topTopics,
        outcome_counts: reflection.summary.outcomeCounts
      }
    });
  });
}

function collectRunMemory(trace: MutableTraceSummary, run: StoredAiRun): void {
  const output = parseJson(run.output_json);
  if (run.purpose === "topic_radar_selection") {
    const selectedTopic = readSelectedTopic(output);
    if (selectedTopic) {
      trace.selectedTopic = selectedTopic;
    }
  }
  if (run.purpose === "ai_posting_draft") {
    const record = asRecord(output);
    trace.draft = {
      id: stringValue(record.draft_id) ?? run.id,
      textSha256: stringValue(record.post_text_sha256),
      topicTags: stringArray(record.topic_tags),
      evidenceIds: stringArray(record.evidence_ids)
    };
  }
  if (run.purpose === "automation_policy") {
    const record = asRecord(output);
    const outcome = parseOutcomeValue(record.outcome);
    if (outcome) {
      trace.policy = {
        ...trace.policy,
        outcome,
        route: stringValue(record.route),
        reasonCodes: reasonCodes(record.reasons)
      };
    }
  }
}

function collectDecisionMemory(trace: MutableTraceSummary, decision: StoredAiDecision): void {
  const outcome = parseOutcomeValue(decision.outcome);
  if (!outcome) {
    return;
  }
  const rationale = asRecord(parseJson(decision.rationale_json));
  trace.policy = {
    decisionId: decision.id,
    outcome,
    route: stringValue(rationale.route) ?? trace.policy?.route,
    reasonCodes: reasonCodes(rationale.reasons) || trace.policy?.reasonCodes || []
  };
}

function collectActionMemory(trace: MutableTraceSummary, action: StoredAiAction): void {
  if (!isFinalActionType(action.action_type)) {
    return;
  }
  trace.finalAction = {
    actionId: action.id,
    actionType: action.action_type,
    status: action.status
  };
  if (action.action_type === "draft_gate_blocked") {
    trace.policy = undefined;
  }
}

function collectEventMemory(trace: MutableTraceSummary, event: StoredAuditEvent): void {
  const metadata = asRecord(parseJson(event.metadata_json));
  if (event.event_type === "topic_selected") {
    const id = stringValue(metadata.selected_topic_id);
    const label = stringValue(metadata.selected_topic_label);
    if (id && label && !trace.selectedTopic) {
      trace.selectedTopic = {
        id,
        label,
        keywords: []
      };
    }
    return;
  }

  const performance = readReadbackPerformance(event.event_type, metadata, event.occurred_at, event.actor_id);
  if (performance) {
    trace.performance = performance;
  }
}

function readReadbackPerformance(
  eventType: string,
  metadata: Record<string, unknown>,
  occurredAt: string,
  actorId: string
): AccountMemoryPerformanceSnapshot | undefined {
  if (eventType !== "x_post_readback_confirmed" && eventType !== "x_post_readback_not_found" && eventType !== "x_post_readback_failed") {
    return undefined;
  }
  const metrics = asRecord(metadata.metrics);
  return {
    readbackStatus: readbackStatusFromEventType(eventType),
    tweetId: stringValue(metadata.tweet_id),
    provider: actorId,
    capturedAt: occurredAt,
    textMatchesCandidate: booleanValue(metadata.text_matches_candidate),
    metrics: {
      likeCount: nonNegativeIntegerValue(metrics.likeCount),
      repostCount: nonNegativeIntegerValue(metrics.repostCount),
      replyCount: nonNegativeIntegerValue(metrics.replyCount),
      quoteCount: nonNegativeIntegerValue(metrics.quoteCount),
      bookmarkCount: nonNegativeIntegerValue(metrics.bookmarkCount),
      viewCount: nonNegativeIntegerValue(metrics.viewCount)
    }
  };
}

function readbackStatusFromEventType(eventType: string): AccountMemoryPerformanceSnapshot["readbackStatus"] {
  if (eventType === "x_post_readback_confirmed") {
    return "confirmed";
  }
  if (eventType === "x_post_readback_failed") {
    return "failed";
  }
  return "not_found";
}

function ensureTrace(traces: Map<string, MutableTraceSummary>, traceId: string, startedAt: string): MutableTraceSummary {
  const existing = traces.get(traceId);
  if (existing) {
    if (Date.parse(startedAt) < Date.parse(existing.startedAt)) {
      existing.startedAt = startedAt;
    }
    return existing;
  }
  const trace: MutableTraceSummary = {
    traceId,
    startedAt,
    eventTypes: [],
    evidenceIds: [],
    runIds: []
  };
  traces.set(traceId, trace);
  return trace;
}

function traceIdForAction(
  action: StoredAiAction,
  decisionsById: Map<string, StoredAiDecision>,
  runsById: Map<string, StoredAiRun>
): string | undefined {
  if (action.ai_run_id) {
    return runsById.get(action.ai_run_id)?.trace_id;
  }
  if (action.decision_id) {
    const decision = decisionsById.get(action.decision_id);
    return decision ? runsById.get(decision.ai_run_id)?.trace_id : undefined;
  }
  return undefined;
}

function traceIdForEvidence(
  evidence: StoredEvidenceRef,
  decisionsById: Map<string, StoredAiDecision>,
  runsById: Map<string, StoredAiRun>
): string | undefined {
  if (evidence.ai_run_id) {
    return runsById.get(evidence.ai_run_id)?.trace_id;
  }
  if (evidence.decision_id) {
    const decision = decisionsById.get(evidence.decision_id);
    return decision ? runsById.get(decision.ai_run_id)?.trace_id : undefined;
  }
  return undefined;
}

function readSelectedTopic(output: unknown): AccountMemoryTraceSummary["selectedTopic"] | undefined {
  const record = asRecord(output);
  const selectedTopic = asRecord(record.selected_topic);
  if (selectedTopic) {
    const id = stringValue(selectedTopic.id);
    const label = stringValue(selectedTopic.label);
    if (id && label) {
      return {
        id,
        label,
        keywords: stringArray(selectedTopic.keywords)
      };
    }
  }
  const topic = asRecord(record.selectedTopic);
  if (topic) {
    const id = stringValue(topic.id);
    const label = stringValue(topic.label);
    if (id && label) {
      return {
        id,
        label,
        keywords: stringArray(topic.keywords)
      };
    }
  }
  return undefined;
}

function countOutcomes(traces: AccountMemoryTraceSummary[]): AccountMemoryOutcomeCounts {
  const counts = emptyOutcomeCounts();
  for (const trace of traces) {
    if (trace.finalAction?.actionType === "draft_gate_blocked") {
      counts.draftBlocked += 1;
      continue;
    }
    if (trace.policy?.outcome === "auto_post") {
      counts.autoPost += 1;
    } else if (trace.policy?.outcome === "human_review") {
      counts.humanReview += 1;
    } else if (trace.policy?.outcome === "reject") {
      counts.reject += 1;
    } else if (trace.policy?.outcome === "defer") {
      counts.defer += 1;
    }
  }
  return counts;
}

function countActions(traces: AccountMemoryTraceSummary[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const trace of traces) {
    if (!trace.finalAction) {
      continue;
    }
    counts[trace.finalAction.actionType] = (counts[trace.finalAction.actionType] ?? 0) + 1;
  }
  return counts;
}

function buildTopicMemory(traces: AccountMemoryTraceSummary[]): AccountTopicMemory[] {
  const topics = new Map<string, AccountTopicMemory>();
  for (const trace of traces) {
    if (!trace.selectedTopic) {
      continue;
    }
    const existing =
      topics.get(trace.selectedTopic.id) ??
      ({
        topicId: trace.selectedTopic.id,
        label: trace.selectedTopic.label,
        selectedCount: 0,
        outcomes: emptyOutcomeCounts(),
        recentTraceIds: []
      } satisfies AccountTopicMemory);
    existing.selectedCount += 1;
    existing.recentTraceIds = uniqueStrings([...existing.recentTraceIds, trace.traceId]).slice(0, 5);
    if (trace.finalAction?.actionType === "draft_gate_blocked") {
      existing.outcomes.draftBlocked += 1;
    } else if (trace.policy?.outcome === "auto_post") {
      existing.outcomes.autoPost += 1;
    } else if (trace.policy?.outcome === "human_review") {
      existing.outcomes.humanReview += 1;
    } else if (trace.policy?.outcome === "reject") {
      existing.outcomes.reject += 1;
    } else if (trace.policy?.outcome === "defer") {
      existing.outcomes.defer += 1;
    }
    topics.set(trace.selectedTopic.id, existing);
  }
  return [...topics.values()].sort(
    (left, right) => right.selectedCount - left.selectedCount || left.label.localeCompare(right.label)
  );
}

function buildLifetimeStats(traces: AccountMemoryTraceSummary[]): AccountLifetimeStats {
  return {
    traceCount: traces.length,
    outcomeCounts: countOutcomes(traces),
    actionCounts: countActions(traces),
    topTopics: buildTopicMemory(traces)
      .slice(0, defaultLifetimeTopTopicsLimit)
      .map((topic) => ({
        topicId: topic.topicId,
        label: topic.label,
        selectedCount: topic.selectedCount,
        outcomes: topic.outcomes
      }))
  };
}

function buildNextRunHints(traces: AccountMemoryTraceSummary[]): string[] {
  const hints: string[] = [];
  const outcomeCounts = countOutcomes(traces);
  const latestTopics = uniqueStrings(
    traces
      .filter((trace) => trace.selectedTopic)
      .slice(0, 5)
      .map((trace) => trace.selectedTopic?.label)
      .filter((label): label is string => Boolean(label))
  );
  if (latestTopics.length > 0) {
    hints.push(`avoid repeating recent selected topics: ${latestTopics.join(", ")}`);
  }
  if (outcomeCounts.humanReview > 0) {
    hints.push("review link or long-form candidates before automatic publishing");
  }
  if (outcomeCounts.reject > 0 || outcomeCounts.draftBlocked > 0) {
    hints.push("prefer natural plain text inside account topics before policy evaluation");
  }
  if (outcomeCounts.autoPost > 0) {
    hints.push("short no-link posts can continue through the automatic branch when policy passes");
  }
  if (traces.some((trace) => trace.performance?.readbackStatus === "confirmed")) {
    hints.push("compare confirmed post metrics before repeating topic formats");
  }
  return hints.length > 0 ? hints : ["collect more ledger history before changing account strategy"];
}

function buildLessons(memory: AccountMemorySnapshot): string[] {
  const lessons: string[] = [];
  const topTopic = memory.topicMemory[0];
  if (topTopic) {
    lessons.push(`recent runs most often selected ${topTopic.label}`);
  }
  if (memory.outcomeCounts.humanReview > 0) {
    lessons.push("linked or long candidates need human handling before publication");
  }
  if (memory.outcomeCounts.reject > 0 || memory.outcomeCounts.draftBlocked > 0) {
    lessons.push("blocked candidates should be treated as style and boundary feedback");
  }
  if (memory.outcomeCounts.autoPost > 0) {
    lessons.push("at least one short no-link candidate reached the automatic branch offline");
  }
  if (memory.traceSummaries.some((trace) => trace.performance?.readbackStatus === "confirmed")) {
    lessons.push("published post readbacks can guide future topic and style choices");
  }
  return lessons.length > 0 ? lessons : ["memory has too little history for strong account lessons"];
}

function stripMutableTrace(trace: MutableTraceSummary): AccountMemoryTraceSummary {
  return {
    traceId: trace.traceId,
    startedAt: trace.startedAt,
    eventTypes: trace.eventTypes,
    selectedTopic: trace.selectedTopic,
    draft: trace.draft,
    policy: trace.policy,
    finalAction: trace.finalAction,
    performance: trace.performance,
    evidenceIds: trace.evidenceIds
  };
}

function sanitizeMemory(memory: AccountMemorySnapshot): AccountMemorySnapshot {
  const parsed = parseWithSchema(memorySnapshotSchema, memory, "account memory snapshot is invalid");
  assertUnique(parsed.traceSummaries.map((trace) => trace.traceId), "trace id");
  return {
    ...parsed,
    traceSummaries: parsed.traceSummaries.map((trace) => ({
      ...trace,
      selectedTopic: trace.selectedTopic
        ? {
            ...trace.selectedTopic,
            keywords: trace.selectedTopic.keywords ?? []
          }
        : undefined,
      draft: trace.draft
        ? {
            ...trace.draft,
            topicTags: trace.draft.topicTags ?? [],
            evidenceIds: trace.draft.evidenceIds ?? []
          }
        : undefined,
      policy: trace.policy
        ? {
            ...trace.policy,
            reasonCodes: trace.policy.reasonCodes ?? []
          }
        : undefined,
      performance: trace.performance
        ? {
            ...trace.performance,
            metrics: trace.performance.metrics ?? {}
          }
        : undefined
    }))
  };
}

function sanitizeReflection(reflection: AccountReflection): AccountReflection {
  return parseWithSchema(reflectionSchema, reflection, "account reflection is invalid");
}

function collectPromptHashes(output: Set<string>, value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPromptHashes(output, item);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if ((key === "promptSha256" || key === "prompt_sha256") && typeof child === "string" && sha256Schema.safeParse(child).success) {
      output.add(child);
    }
    collectPromptHashes(output, child);
  }
}

function reasonCodes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => stringValue(asRecord(item)?.code)).filter((code): code is string => Boolean(code));
}

function parseOutcomeValue(value: unknown): z.infer<typeof outcomeSchema> | undefined {
  const parsed = outcomeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function isFinalActionType(actionType: string): boolean {
  return [
    "x_official_auto_post",
    "x_official_auto_post_planned",
    "telegram_notification_sent",
    "telegram_notification_failed",
    "policy_terminal_noop",
    "draft_gate_blocked"
  ].includes(actionType);
}

function emptyOutcomeCounts(): AccountMemoryOutcomeCounts {
  return {
    autoPost: 0,
    humanReview: 0,
    reject: 0,
    defer: 0,
    draftBlocked: 0
  };
}

function parseJson(value: string | null): unknown {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function nonNegativeIntegerValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw accountMemoryError(`duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function parseIsoDateTime(value: string, field: string): string {
  const parsed = isoDateTimeSchema.safeParse(value);
  if (!parsed.success) {
    throw accountMemoryError(`${field} must be an ISO datetime`);
  }
  return parsed.data;
}

function parseOptionalPositiveInteger(value: number | undefined, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = positiveIntegerSchema.safeParse(value);
  if (!parsed.success) {
    throw accountMemoryError(`${field} must be a positive integer`);
  }
  return parsed.data;
}

function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw accountMemoryError(message, parsed.error.flatten());
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

function accountMemoryError(message: string, details?: unknown): ApiError {
  return new ApiError({
    code: "invalid_request",
    provider: "local",
    stage: "account_memory",
    message,
    details
  });
}
