import { createHash } from "node:crypto";
import { z } from "zod";
import { createAccountConfigSnapshot, resolveAccountRef, type AccountConfigSnapshot, type AccountRegistry } from "../accounts/registry";
import type { AccountInitialPrompt } from "../accounts/account-prompt";
import { ApiError } from "../api/errors";
import { collectAccountPublicXSourceBatch, type PublicXSourceCollectionResult } from "../context/source-collection";
import {
  buildSourceContext,
  createDraftInputPackageFromSourceContext,
  recordSourceContextIngestion,
  type RecentPostInput,
  type SourceContextPackage
} from "../context/source-ingestion";
import {
  evaluateDraftForPosting,
  parseAiPostingDraftOutput,
  recordDraftRun,
  type AiPostingDraft,
  type DraftPostingGate,
  type DraftRunInputPackage
} from "../drafts/ai-posting-pipeline";
import { buildAccountMemory, type AccountMemorySnapshot } from "../memory/account-memory";
import { deliverManualNotification, type ManualNotificationDeliveryResult, type TelegramNotificationSender } from "../notifications/manual-notification";
import { evaluateAutomationPolicy, type AutomationPolicyContext, type AutomationPolicyDecision, type PostingCandidate } from "../policy/automation";
import type { ProductionDraftGenerationResult, ProductionDraftGenerator } from "../llm/production-draft-generator";
import type { PublicXDataProvider } from "../providers/public-x";
import type { XPostInput, XPostOutput } from "../providers/x-official-publisher";
import type { RuntimeRepository, StoredAiAction, StoredAiDecision, StoredAiRun } from "../storage/repositories";
import { buildTopicRadar, recordTopicRadarSelection, type TopicRadarPackage } from "../topics/topic-radar";
import type { OnlineOperationContext, OnlineOperationExecutor, OnlineOperationExecutorResult } from "./online-runner";

export type ProductionAutoPoster = {
  createPost(input: XPostInput): Promise<XPostOutput>;
};

export type ProductionOperationExecutorInput = {
  repo: RuntimeRepository;
  registry: AccountRegistry;
  accountKey: string;
  publicXProvider: PublicXDataProvider;
  draftGenerator: ProductionDraftGenerator;
  autoPoster: ProductionAutoPoster;
  notificationSender: TelegramNotificationSender;
  loadPrompt: () => Promise<AccountInitialPrompt> | AccountInitialPrompt;
  recentPosts?: RecentPostInput[];
  configSnapshotId?: string;
  maxQueries?: number;
  perQueryLimit?: number;
  candidatesLimit?: number;
  duplicateThreshold?: number;
  materialsLimit?: number;
  recentPostsLimit?: number;
  memoryTraceLimit?: number;
};

export type ProductionOperationFinalAction =
  | { kind: "x_auto_post"; actionId: string; tweetId: string }
  | { kind: "telegram_notification"; actionId: string; delivery: ManualNotificationDeliveryResult }
  | { kind: "policy_terminal"; actionId: string; outcome: "reject" | "defer" }
  | { kind: "draft_blocked"; actionId: string };

export function createProductionOperationExecutor(input: ProductionOperationExecutorInput): OnlineOperationExecutor {
  return async (context) => runProductionOperation(input, context);
}

async function runProductionOperation(
  input: ProductionOperationExecutorInput,
  context: OnlineOperationContext
): Promise<OnlineOperationExecutorResult> {
  if (context.accountKey !== input.accountKey) {
    throw productionOperationError("executor accountKey does not match runner context", {
      inputAccountKey: input.accountKey,
      contextAccountKey: context.accountKey
    });
  }

  const ids = idsFor(context.traceId);
  const { account } = resolveAccountRef(input.registry, { accountKey: input.accountKey });
  seedRegistry(input.repo, input.registry, context.startedAt);
  const configSnapshot = createAccountConfigSnapshot({
    registry: input.registry,
    ref: { accountKey: input.accountKey },
    capturedAt: context.startedAt
  });
  const configSnapshotId = input.configSnapshotId ?? input.repo.saveConfigSnapshot(configSnapshot);

  const sourceCollection = await collectAccountPublicXSourceBatch({
    repo: input.repo,
    account,
    provider: input.publicXProvider,
    traceId: context.traceId,
    runId: ids.sourceCollectionRunId,
    auditEventId: ids.sourceCollectionAuditEventId,
    configSnapshotId,
    collectedAt: context.startedAt,
    maxQueries: input.maxQueries,
    perQueryLimit: input.perQueryLimit
  });

  if (sourceCollection.status === "skipped") {
    return summarizeSourceOnly(sourceCollection, configSnapshotId);
  }
  if (sourceCollection.materials.length === 0) {
    return summarizeEmptyCollection(sourceCollection, configSnapshotId);
  }

  const memory = buildAccountMemory({
    repo: input.repo,
    account,
    capturedAt: context.startedAt,
    traceLimit: input.memoryTraceLimit
  });
  const prompt = await input.loadPrompt();
  const recentPosts = input.recentPosts ?? buildRecentPostsFromLedger(input.repo, account.account_uuid, input.recentPostsLimit ?? 50);

  const topicRadar = buildTopicRadar({
    account,
    configSnapshot,
    configSnapshotId,
    prompt,
    materials: sourceCollection.materials,
    recentPosts,
    observedAt: context.startedAt,
    candidatesLimit: input.candidatesLimit,
    duplicateThreshold: input.duplicateThreshold
  });
  recordTopicRadarSelection({
    repo: input.repo,
    radar: topicRadar,
    runId: ids.topicRunId,
    auditEventId: ids.topicAuditEventId,
    traceId: context.traceId,
    startedAt: context.startedAt,
    finishedAt: context.startedAt,
    model: "topic-radar-production-v0",
    actorId: "production_operation_topic_radar"
  });

  const sourceContext = buildSourceContext({
    account,
    topic: topicRadar.selectedTopic,
    materials: sourceCollection.materials,
    recentPosts,
    collectedAt: context.startedAt,
    materialsLimit: input.materialsLimit,
    recentPostsLimit: input.recentPostsLimit
  });
  recordSourceContextIngestion({
    repo: input.repo,
    sourceContext,
    runId: ids.sourceContextRunId,
    auditEventId: ids.sourceContextAuditEventId,
    traceId: context.traceId,
    startedAt: context.startedAt,
    finishedAt: context.startedAt,
    actorId: "production_operation_source_ingestion"
  });

  const draftInput = createDraftInputPackageFromSourceContext({
    account,
    configSnapshot,
    configSnapshotId,
    prompt,
    sourceContext
  });
  const generation = await generateDraftWithLedger({
    repo: input.repo,
    generator: input.draftGenerator,
    inputPackage: draftInput,
    prompt,
    memory,
    runId: ids.draftRunId,
    auditEventId: ids.draftAuditEventId,
    apiAuditId: ids.llmApiAuditId,
    traceId: context.traceId,
    now: context.startedAt
  });
  const draft = parseGeneratedDraftWithLedger({
    repo: input.repo,
    inputPackage: draftInput,
    output: generation.output,
    runId: ids.draftRunId,
    auditEventId: ids.draftAuditEventId,
    traceId: context.traceId,
    now: context.startedAt,
    provider: input.draftGenerator.providerName,
    model: input.draftGenerator.model
  });
  recordDraftRun({
    repo: input.repo,
    inputPackage: draftInput,
    draft,
    runId: ids.draftRunId,
    auditEventId: ids.draftAuditEventId,
    traceId: context.traceId,
    startedAt: context.startedAt,
    finishedAt: context.startedAt,
    model: `${input.draftGenerator.providerName}:${input.draftGenerator.model}`,
    actorId: "production_operation_draft_generator"
  });

  const draftGate = evaluateDraftForPosting({
    draft,
    recentPosts: draftInput.recentPosts,
    duplicateThreshold: input.duplicateThreshold
  });
  if (draftGate.status === "blocked") {
    recordDraftGateBlockedAction({
      repo: input.repo,
      accountUuid: account.account_uuid,
      draftRunId: ids.draftRunId,
      actionId: ids.finalActionId,
      auditEventId: ids.finalActionAuditEventId,
      traceId: context.traceId,
      now: context.startedAt,
      reasons: draftGate.reasons.map((reason) => reason.code)
    });
    return summarizeCompleted({
      sourceCollection,
      topicRadar,
      sourceContext,
      memory,
      draft,
      draftGate,
      finalAction: { kind: "draft_blocked", actionId: ids.finalActionId },
      configSnapshotId
    });
  }

  const policyContext = buildProductionPolicyContext({
    repo: input.repo,
    accountUuid: account.account_uuid,
    evaluatedAt: context.startedAt
  });
  const policyDecision = evaluateAutomationPolicy({
    account,
    candidate: draftGate.candidate,
    context: policyContext
  });
  recordPolicyEvaluation({
    repo: input.repo,
    accountUuid: account.account_uuid,
    decision: policyDecision,
    candidate: draftGate.candidate,
    policyContext,
    runId: ids.policyRunId,
    decisionId: ids.policyDecisionId,
    auditEventId: ids.policyAuditEventId,
    traceId: context.traceId,
    now: context.startedAt
  });

  const finalAction = await executeProductionFinalAction({
    repo: input.repo,
    decision: policyDecision,
    candidate: draftGate.candidate,
    autoPoster: input.autoPoster,
    notificationSender: input.notificationSender,
    policyDecisionId: ids.policyDecisionId,
    actionId: ids.finalActionId,
    auditEventId: ids.finalActionAuditEventId,
    traceId: context.traceId,
    now: context.startedAt
  });

  return summarizeCompleted({
    sourceCollection,
    topicRadar,
    sourceContext,
    memory,
    draft,
    draftGate,
    policyDecision,
    finalAction,
    configSnapshotId
  });
}

async function generateDraftWithLedger(input: {
  repo: RuntimeRepository;
  generator: ProductionDraftGenerator;
  inputPackage: Parameters<ProductionDraftGenerator["generateDraft"]>[0]["inputPackage"];
  prompt: AccountInitialPrompt;
  memory: AccountMemorySnapshot;
  runId: string;
  auditEventId: string;
  apiAuditId: string;
  traceId: string;
  now: string;
}): Promise<ProductionDraftGenerationResult> {
  try {
    const generation = await input.generator.generateDraft({
      inputPackage: input.inputPackage,
      prompt: input.prompt,
      memory: input.memory,
      requestedAt: input.now
    });
    input.repo.recordApiCallAudit({
      id: input.apiAuditId,
      accountUuid: input.inputPackage.account.accountUuid,
      provider: input.generator.providerName,
      operation: "llm_draft_generation",
      status: "succeeded",
      requestUnits: 1,
      startedAt: input.now,
      finishedAt: input.now,
      metadata: {
        model: input.generator.model,
        provider_response_id: generation.providerResponseId,
        input_tokens: generation.usage?.inputTokens,
        output_tokens: generation.usage?.outputTokens
      }
    });
    return generation;
  } catch (error) {
    input.repo.transaction(() => {
      input.repo.recordApiCallAudit({
        id: input.apiAuditId,
        accountUuid: input.inputPackage.account.accountUuid,
        provider: input.generator.providerName,
        operation: "llm_draft_generation",
        status: "failed",
        requestUnits: 1,
        startedAt: input.now,
        finishedAt: input.now,
        metadata: {
          model: input.generator.model,
          error: errorMessage(error)
        }
      });
      input.repo.recordAiRun({
        id: input.runId,
        accountUuid: input.inputPackage.account.accountUuid,
        traceId: input.traceId,
        purpose: "ai_posting_draft",
        model: `${input.generator.providerName}:${input.generator.model}`,
        status: "failed",
        startedAt: input.now,
        finishedAt: input.now,
        input: input.inputPackage,
        error: errorMessage(error)
      });
      input.repo.recordAuditEvent({
        id: input.auditEventId,
        accountUuid: input.inputPackage.account.accountUuid,
        eventType: "ai_draft_failed",
        subjectType: "ai_run",
        subjectId: input.runId,
        actorType: "ai",
        actorId: "production_operation_draft_generator",
        traceId: input.traceId,
        occurredAt: input.now,
        metadata: {
          provider: input.generator.providerName,
          model: input.generator.model,
          error: errorMessage(error)
        }
      });
    });
    throw error;
  }
}

function parseGeneratedDraftWithLedger(input: {
  repo: RuntimeRepository;
  inputPackage: DraftRunInputPackage;
  output: unknown;
  runId: string;
  auditEventId: string;
  traceId: string;
  now: string;
  provider: string;
  model: string;
}): AiPostingDraft {
  try {
    return parseAiPostingDraftOutput({
      inputPackage: input.inputPackage,
      output: input.output
    });
  } catch (error) {
    input.repo.transaction(() => {
      input.repo.recordAiRun({
        id: input.runId,
        accountUuid: input.inputPackage.account.accountUuid,
        traceId: input.traceId,
        purpose: "ai_posting_draft",
        model: `${input.provider}:${input.model}`,
        status: "failed",
        startedAt: input.now,
        finishedAt: input.now,
        input: input.inputPackage,
        error: errorMessage(error)
      });
      input.repo.recordAuditEvent({
        id: input.auditEventId,
        accountUuid: input.inputPackage.account.accountUuid,
        eventType: "ai_draft_failed",
        subjectType: "ai_run",
        subjectId: input.runId,
        actorType: "ai",
        actorId: "production_operation_draft_generator",
        traceId: input.traceId,
        occurredAt: input.now,
        metadata: {
          provider: input.provider,
          model: input.model,
          failure_stage: "draft_parse",
          error: errorMessage(error)
        }
      });
    });
    throw error;
  }
}

async function executeProductionFinalAction(input: {
  repo: RuntimeRepository;
  decision: AutomationPolicyDecision;
  candidate: PostingCandidate;
  autoPoster: ProductionAutoPoster;
  notificationSender: TelegramNotificationSender;
  policyDecisionId: string;
  actionId: string;
  auditEventId: string;
  traceId: string;
  now: string;
}): Promise<ProductionOperationFinalAction> {
  if (input.decision.outcome === "auto_post") {
    const posted = await createXPostWithLedger(input);
    return {
      kind: "x_auto_post",
      actionId: input.actionId,
      tweetId: posted.tweetId
    };
  }

  if (input.decision.outcome === "human_review") {
    const delivery = await deliverManualNotification({
      repo: input.repo,
      sender: input.notificationSender,
      decision: input.decision,
      candidate: input.candidate,
      policyDecisionId: input.policyDecisionId,
      actionId: input.actionId,
      auditEventId: input.auditEventId,
      traceId: input.traceId,
      now: input.now
    });
    return {
      kind: "telegram_notification",
      actionId: input.actionId,
      delivery
    };
  }

  recordPolicyTerminalAction(input);
  return {
    kind: "policy_terminal",
    actionId: input.actionId,
    outcome: input.decision.outcome
  };
}

async function createXPostWithLedger(input: {
  repo: RuntimeRepository;
  decision: AutomationPolicyDecision;
  candidate: PostingCandidate;
  autoPoster: ProductionAutoPoster;
  policyDecisionId: string;
  actionId: string;
  auditEventId: string;
  traceId: string;
  now: string;
}): Promise<Extract<XPostOutput, { status: "posted" }>> {
  try {
    const result = await input.autoPoster.createPost({
      accountKey: input.decision.accountKey,
      text: input.candidate.text,
      dryRun: false
    });
    if (result.status !== "posted") {
      throw productionOperationError("production auto poster returned dry_run for auto_post branch");
    }
    input.repo.transaction(() => {
      input.repo.recordAiAction({
        id: input.actionId,
        accountUuid: input.decision.accountUuid,
        decisionId: input.policyDecisionId,
        actionType: "x_official_auto_post",
        status: "succeeded",
        startedAt: input.now,
        finishedAt: input.now,
        input: {
          candidate_id: input.candidate.id,
          post_text_sha256: sha256(input.candidate.text),
          policy_outcome: input.decision.outcome,
          policy_route: input.decision.route
        },
        output: {
          tweet_id: result.tweetId,
          text_length: result.textLength
        }
      });
      input.repo.recordAuditEvent({
        id: input.auditEventId,
        accountUuid: input.decision.accountUuid,
        eventType: "x_official_auto_post_created",
        subjectType: "ai_action",
        subjectId: input.actionId,
        actorType: "system",
        actorId: "production_operation",
        traceId: input.traceId,
        occurredAt: input.now,
        metadata: {
          candidate_id: input.candidate.id,
          policy_decision_id: input.policyDecisionId,
          tweet_id: result.tweetId,
          post_text_sha256: sha256(input.candidate.text)
        }
      });
    });
    return result;
  } catch (error) {
    recordXPostFailedAction({
      ...input,
      error: errorMessage(error)
    });
    throw error;
  }
}

function recordPolicyEvaluation(input: {
  repo: RuntimeRepository;
  accountUuid: string;
  decision: AutomationPolicyDecision;
  candidate: PostingCandidate;
  policyContext: AutomationPolicyContext;
  runId: string;
  decisionId: string;
  auditEventId: string;
  traceId: string;
  now: string;
}): void {
  input.repo.transaction(() => {
    input.repo.recordAiRun({
      id: input.runId,
      accountUuid: input.accountUuid,
      traceId: input.traceId,
      purpose: "automation_policy",
      model: "policy-engine-v0",
      status: "succeeded",
      startedAt: input.now,
      finishedAt: input.now,
      input: {
        candidate: input.candidate,
        policy_context: input.policyContext
      },
      output: {
        candidate_id: input.decision.candidateId,
        outcome: input.decision.outcome,
        route: input.decision.route,
        requires_human_review: input.decision.requiresHumanReview,
        reasons: input.decision.reasons,
        checks: input.decision.checks
      }
    });
    input.repo.recordAiDecision({
      id: input.decisionId,
      accountUuid: input.decision.accountUuid,
      aiRunId: input.runId,
      decisionType: "automation_policy",
      outcome: input.decision.outcome,
      confidence: confidenceForOutcome(input.decision.outcome),
      requiresHumanReview: input.decision.requiresHumanReview,
      rationale: {
        candidate_id: input.decision.candidateId,
        route: input.decision.route,
        has_link: input.decision.hasLink,
        reasons: input.decision.reasons,
        checks: input.decision.checks
      },
      createdAt: input.now
    });
    input.repo.recordAuditEvent({
      id: input.auditEventId,
      accountUuid: input.decision.accountUuid,
      eventType: "automation_policy_decided",
      subjectType: "ai_decision",
      subjectId: input.decisionId,
      actorType: "system",
      actorId: "production_operation_policy",
      traceId: input.traceId,
      occurredAt: input.now,
      metadata: {
        candidate_id: input.decision.candidateId,
        outcome: input.decision.outcome,
        route: input.decision.route,
        requires_human_review: input.decision.requiresHumanReview
      }
    });
  });
}

function recordPolicyTerminalAction(input: {
  repo: RuntimeRepository;
  decision: AutomationPolicyDecision;
  candidate: PostingCandidate;
  policyDecisionId: string;
  actionId: string;
  auditEventId: string;
  traceId: string;
  now: string;
}): void {
  input.repo.transaction(() => {
    input.repo.recordAiAction({
      id: input.actionId,
      accountUuid: input.decision.accountUuid,
      decisionId: input.policyDecisionId,
      actionType: "policy_terminal_noop",
      status: "skipped",
      startedAt: input.now,
      finishedAt: input.now,
      input: {
        candidate_id: input.candidate.id,
        policy_outcome: input.decision.outcome,
        policy_route: input.decision.route
      },
      output: {
        online: true
      }
    });
    input.repo.recordAuditEvent({
      id: input.auditEventId,
      accountUuid: input.decision.accountUuid,
      eventType: "production_policy_terminal",
      subjectType: "ai_action",
      subjectId: input.actionId,
      actorType: "system",
      actorId: "production_operation",
      traceId: input.traceId,
      occurredAt: input.now,
      metadata: {
        candidate_id: input.candidate.id,
        policy_decision_id: input.policyDecisionId,
        outcome: input.decision.outcome,
        route: input.decision.route
      }
    });
  });
}

function recordDraftGateBlockedAction(input: {
  repo: RuntimeRepository;
  accountUuid: string;
  draftRunId: string;
  actionId: string;
  auditEventId: string;
  traceId: string;
  now: string;
  reasons: string[];
}): void {
  input.repo.transaction(() => {
    input.repo.recordAiAction({
      id: input.actionId,
      accountUuid: input.accountUuid,
      aiRunId: input.draftRunId,
      actionType: "draft_gate_blocked",
      status: "skipped",
      startedAt: input.now,
      finishedAt: input.now,
      input: {
        draft_run_id: input.draftRunId,
        reasons: input.reasons
      },
      output: {
        policy_evaluated: false
      }
    });
    input.repo.recordAuditEvent({
      id: input.auditEventId,
      accountUuid: input.accountUuid,
      eventType: "draft_gate_blocked",
      subjectType: "ai_action",
      subjectId: input.actionId,
      actorType: "system",
      actorId: "production_operation",
      traceId: input.traceId,
      occurredAt: input.now,
      metadata: {
        draft_run_id: input.draftRunId,
        reasons: input.reasons,
        policy_evaluated: false
      }
    });
  });
}

function recordXPostFailedAction(input: {
  repo: RuntimeRepository;
  decision: AutomationPolicyDecision;
  candidate: PostingCandidate;
  policyDecisionId: string;
  actionId: string;
  auditEventId: string;
  traceId: string;
  now: string;
  error: string;
}): void {
  input.repo.transaction(() => {
    input.repo.recordAiAction({
      id: input.actionId,
      accountUuid: input.decision.accountUuid,
      decisionId: input.policyDecisionId,
      actionType: "x_official_auto_post",
      status: "failed",
      startedAt: input.now,
      finishedAt: input.now,
      input: {
        candidate_id: input.candidate.id,
        post_text_sha256: sha256(input.candidate.text),
        policy_outcome: input.decision.outcome,
        policy_route: input.decision.route
      },
      error: input.error
    });
    input.repo.recordAuditEvent({
      id: input.auditEventId,
      accountUuid: input.decision.accountUuid,
      eventType: "x_official_auto_post_failed",
      subjectType: "ai_action",
      subjectId: input.actionId,
      actorType: "system",
      actorId: "production_operation",
      traceId: input.traceId,
      occurredAt: input.now,
      metadata: {
        candidate_id: input.candidate.id,
        policy_decision_id: input.policyDecisionId,
        post_text_sha256: sha256(input.candidate.text),
        error: input.error
      }
    });
  });
}

function buildProductionPolicyContext(input: {
  repo: RuntimeRepository;
  accountUuid: string;
  evaluatedAt: string;
}): AutomationPolicyContext {
  const apiAudits = input.repo.listApiCallAuditForAccount(input.accountUuid);
  const actions = input.repo.listAiActionsForAccount(input.accountUuid);
  const monthPrefix = input.evaluatedAt.slice(0, 7);
  const todayPrefix = input.evaluatedAt.slice(0, 10);
  const monthly = apiAudits.filter((audit) => audit.started_at.startsWith(monthPrefix) && audit.status === "succeeded");
  const postedActions = actions.filter((action) => action.action_type === "x_official_auto_post" && action.status === "succeeded");
  const postedToday = postedActions.filter((action) => action.started_at.startsWith(todayPrefix));
  const lastPostedAt = postedActions.map((action) => action.finished_at ?? action.started_at).sort().at(-1);

  return {
    evaluatedAt: input.evaluatedAt,
    postedTodayCount: postedToday.length,
    lastPostedAt,
    publicXRequestsThisMonth: monthly
      .filter((audit) => audit.provider === "twitterapi.io" && audit.operation === "public_x_search")
      .reduce((sum, audit) => sum + audit.request_units, 0),
    estimatedPublicXRequests: 0
  };
}

function buildRecentPostsFromLedger(repo: RuntimeRepository, accountUuid: string, limit: number): RecentPostInput[] {
  const runs = repo.listAiRunsForAccount(accountUuid);
  const decisions = repo.listAiDecisionsForAccount(accountUuid);
  const actions = repo.listAiActionsForAccount(accountUuid);
  const policyRunsByDecisionId = new Map(decisions.map((decision) => [decision.id, decision.ai_run_id]));
  const runsById = new Map(runs.map((run) => [run.id, run]));
  const postedTraceIds = new Set(
    actions
      .filter((action) => action.action_type === "x_official_auto_post" && action.status === "succeeded")
      .map((action) => traceIdForAction(action, policyRunsByDecisionId, runsById))
      .filter((traceId): traceId is string => Boolean(traceId))
  );

  return runs
    .filter((run) => run.purpose === "ai_posting_draft" && run.status === "succeeded" && postedTraceIds.has(run.trace_id))
    .map((run): RecentPostInput | undefined => {
      const output = parseJsonObject(run.output_json);
      const text = stringValue(output.post_text);
      if (!text) {
        return undefined;
      }
      return {
        id: stringValue(output.draft_id) ?? run.id,
        accountUuid,
        text,
        postedAt: run.finished_at ?? run.started_at,
        source: "local_ledger"
      };
    })
    .filter((post): post is RecentPostInput => Boolean(post))
    .sort((left, right) => Date.parse(right.postedAt) - Date.parse(left.postedAt) || left.id.localeCompare(right.id))
    .slice(0, limit);
}

function summarizeCompleted(input: {
  sourceCollection: PublicXSourceCollectionResult;
  topicRadar: TopicRadarPackage;
  sourceContext: SourceContextPackage;
  memory: AccountMemorySnapshot;
  draft: AiPostingDraft;
  draftGate: DraftPostingGate;
  policyDecision?: AutomationPolicyDecision;
  finalAction: ProductionOperationFinalAction;
  configSnapshotId: string;
}): OnlineOperationExecutorResult {
  return {
    outcome: outcomeForFinalAction(input.finalAction),
    finalAction: finalActionLabel(input.finalAction),
    summary: {
      executor: "production_operation_v0",
      online: true,
      provider: "twitterapi.io",
      source_collection_status: input.sourceCollection.status,
      query_count: input.sourceCollection.queries.length,
      request_units: input.sourceCollection.requestUnits,
      raw_count: input.sourceCollection.rawCount,
      material_count: input.sourceCollection.materials.length,
      duplicate_material_count: input.sourceCollection.duplicateMaterialCount,
      api_audit_ids: input.sourceCollection.apiAuditIds,
      selected_topic_id: input.topicRadar.selectedTopic.id,
      selected_topic_label: input.topicRadar.selectedTopic.label,
      candidate_count: input.topicRadar.candidates.length,
      source_context_material_count: input.sourceContext.materials.length,
      recent_post_count: input.sourceContext.recentPosts.length,
      memory_trace_count: input.memory.traceSummaries.length,
      draft_id: input.draft.id,
      draft_gate_status: input.draftGate.status,
      policy_outcome: input.policyDecision?.outcome,
      policy_route: input.policyDecision?.route,
      final_action_kind: input.finalAction.kind,
      tweet_id: input.finalAction.kind === "x_auto_post" ? input.finalAction.tweetId : undefined,
      telegram_delivery_status: input.finalAction.kind === "telegram_notification" ? input.finalAction.delivery.status : undefined,
      config_snapshot_id: input.configSnapshotId
    }
  };
}

function summarizeSourceOnly(sourceCollection: PublicXSourceCollectionResult, configSnapshotId: string): OnlineOperationExecutorResult {
  return {
    outcome: "skipped",
    finalAction: "source_collection_skipped",
    summary: {
      executor: "production_operation_v0",
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
      executor: "production_operation_v0",
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

function idsFor(traceId: string) {
  return {
    sourceCollectionRunId: `${traceId}:source-collection-run`,
    sourceCollectionAuditEventId: `${traceId}:source-collection-event`,
    topicRunId: `${traceId}:topic-run`,
    topicAuditEventId: `${traceId}:topic-event`,
    sourceContextRunId: `${traceId}:source-context-run`,
    sourceContextAuditEventId: `${traceId}:source-context-event`,
    llmApiAuditId: `${traceId}:llm-api-audit`,
    draftRunId: `${traceId}:draft-run`,
    draftAuditEventId: `${traceId}:draft-event`,
    policyRunId: `${traceId}:policy-run`,
    policyDecisionId: `${traceId}:policy-decision`,
    policyAuditEventId: `${traceId}:policy-event`,
    finalActionId: `${traceId}:final-action`,
    finalActionAuditEventId: `${traceId}:final-action-event`
  };
}

function seedRegistry(repo: RuntimeRepository, registry: AccountRegistry, now: string): void {
  for (const account of registry.config.accounts) {
    repo.upsertAccount(account, now);
  }
  for (const identity of registry.config.x_identities) {
    repo.upsertXIdentity(identity);
  }
}

function traceIdForAction(action: StoredAiAction, policyRunsByDecisionId: Map<string, string>, runsById: Map<string, StoredAiRun>): string | undefined {
  if (action.ai_run_id) {
    return runsById.get(action.ai_run_id)?.trace_id;
  }
  if (action.decision_id) {
    return runsById.get(policyRunsByDecisionId.get(action.decision_id) ?? "")?.trace_id;
  }
  return undefined;
}

function outcomeForFinalAction(finalAction: ProductionOperationFinalAction): "completed" | "skipped" | "failed" {
  if (finalAction.kind === "telegram_notification" && finalAction.delivery.status === "failed") {
    return "failed";
  }
  if (finalAction.kind === "policy_terminal" || finalAction.kind === "draft_blocked") {
    return "skipped";
  }
  return "completed";
}

function finalActionLabel(finalAction: ProductionOperationFinalAction): string {
  if (finalAction.kind === "x_auto_post") {
    return "x_official_auto_post";
  }
  if (finalAction.kind === "telegram_notification") {
    return finalAction.delivery.status === "sent" ? "telegram_notification_sent" : `telegram_notification_${finalAction.delivery.status}`;
  }
  if (finalAction.kind === "draft_blocked") {
    return "draft_gate_blocked";
  }
  return "policy_terminal_noop";
}

function confidenceForOutcome(outcome: AutomationPolicyDecision["outcome"]): number {
  if (outcome === "auto_post") {
    return 0.9;
  }
  if (outcome === "human_review") {
    return 0.86;
  }
  if (outcome === "defer") {
    return 0.75;
  }
  return 0.7;
}


function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | undefined {
  const parsed = z.string().trim().min(1).safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.code}:${error.stage}:${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function productionOperationError(message: string, details?: unknown): ApiError {
  return new ApiError({
    code: "invalid_request",
    provider: "local",
    stage: "production_operation_executor",
    message,
    details
  });
}
