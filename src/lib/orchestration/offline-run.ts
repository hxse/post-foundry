import { z } from "zod";
import type { AccountInitialPrompt } from "../accounts/account-prompt";
import type { AccountConfig, AccountConfigSnapshot } from "../accounts/registry";
import { ApiError } from "../api/errors";
import { buildSourceContext, createDraftInputPackageFromSourceContext, recordSourceContextIngestion, type RecentPostInput, type SourceContextPackage, type SourceMaterialInput } from "../context/source-ingestion";
import { evaluateDraftForPosting, parseAiPostingDraftOutput, recordDraftRun, type AiPostingDraft, type DraftPostingGate, type DraftRunInputPackage } from "../drafts/ai-posting-pipeline";
import { deliverManualNotification, type ManualNotificationDeliveryResult, type TelegramNotificationSender } from "../notifications/manual-notification";
import { evaluateAutomationPolicy, type AutomationPolicyContext, type AutomationPolicyDecision, type PostingCandidate } from "../policy/automation";
import type { RuntimeRepository } from "../storage/repositories";
import { buildTopicRadar, recordTopicRadarSelection, type TopicRadarPackage } from "../topics/topic-radar";

export type OfflineTelegramNotificationSender = TelegramNotificationSender & {
  mode: "offline_fake";
};

export type OfflineOrchestrationInput = {
  repo: RuntimeRepository;
  account: AccountConfig;
  configSnapshot: AccountConfigSnapshot;
  configSnapshotId?: string;
  prompt: AccountInitialPrompt;
  materials: SourceMaterialInput[];
  recentPosts: RecentPostInput[];
  draftOutput: unknown;
  policyContext: AutomationPolicyContext;
  notificationSender: OfflineTelegramNotificationSender;
  runIdPrefix: string;
  traceId: string;
  now: string;
};

export type OfflineOrchestrationIds = {
  topicRunId: string;
  topicAuditEventId: string;
  sourceRunId: string;
  sourceAuditEventId: string;
  draftRunId: string;
  draftAuditEventId: string;
  policyRunId: string;
  policyDecisionId: string;
  policyAuditEventId: string;
  finalActionId: string;
  finalActionAuditEventId: string;
};

export type OfflineOrchestrationFinalAction =
  | {
      kind: "auto_post_planned";
      actionId: string;
    }
  | {
      kind: "telegram_notification";
      actionId: string;
      delivery: ManualNotificationDeliveryResult;
    }
  | {
      kind: "policy_terminal";
      actionId: string;
      outcome: "reject" | "defer";
    }
  | {
      kind: "draft_blocked";
      actionId: string;
    };

export type OfflineOrchestrationResult = {
  traceId: string;
  ids: OfflineOrchestrationIds;
  topicRadar: TopicRadarPackage;
  sourceContext: SourceContextPackage;
  draftInput: DraftRunInputPackage;
  draft: AiPostingDraft;
  draftGate: DraftPostingGate;
  policyDecision?: AutomationPolicyDecision;
  finalAction: OfflineOrchestrationFinalAction;
};

const nonEmptyStringSchema = z.string().trim().min(1);
const isoDateTimeSchema = z.string().datetime();

export async function runOfflineOrchestration(input: OfflineOrchestrationInput): Promise<OfflineOrchestrationResult> {
  const runIdPrefix = parseNonEmpty(input.runIdPrefix, "runIdPrefix");
  const traceId = parseNonEmpty(input.traceId, "traceId");
  const now = parseIsoDateTime(input.now, "now");
  const ids = buildIds(runIdPrefix);

  const topicRadar = buildTopicRadar({
    account: input.account,
    configSnapshot: input.configSnapshot,
    configSnapshotId: input.configSnapshotId,
    prompt: input.prompt,
    materials: input.materials,
    recentPosts: input.recentPosts,
    observedAt: now
  });
  recordTopicRadarSelection({
    repo: input.repo,
    radar: topicRadar,
    runId: ids.topicRunId,
    auditEventId: ids.topicAuditEventId,
    traceId,
    startedAt: now,
    finishedAt: now
  });

  const sourceContext = buildSourceContext({
    account: input.account,
    topic: topicRadar.selectedTopic,
    materials: input.materials,
    recentPosts: input.recentPosts,
    collectedAt: now
  });
  recordSourceContextIngestion({
    repo: input.repo,
    sourceContext,
    runId: ids.sourceRunId,
    auditEventId: ids.sourceAuditEventId,
    traceId,
    startedAt: now,
    finishedAt: now
  });

  const draftInput = createDraftInputPackageFromSourceContext({
    account: input.account,
    configSnapshot: input.configSnapshot,
    configSnapshotId: input.configSnapshotId,
    prompt: input.prompt,
    sourceContext
  });
  const draft = parseAiPostingDraftOutput({
    inputPackage: draftInput,
    output: input.draftOutput
  });
  recordDraftRun({
    repo: input.repo,
    inputPackage: draftInput,
    draft,
    runId: ids.draftRunId,
    auditEventId: ids.draftAuditEventId,
    traceId,
    startedAt: now,
    finishedAt: now,
    model: "offline-fixture-draft-v0"
  });

  const draftGate = evaluateDraftForPosting({
    draft,
    recentPosts: draftInput.recentPosts
  });
  if (draftGate.status === "blocked") {
    recordDraftGateBlockedAction({
      repo: input.repo,
      accountUuid: input.account.account_uuid,
      draftRunId: ids.draftRunId,
      actionId: ids.finalActionId,
      auditEventId: ids.finalActionAuditEventId,
      traceId,
      now,
      reasons: draftGate.reasons.map((reason) => reason.code)
    });
    return {
      traceId,
      ids,
      topicRadar,
      sourceContext,
      draftInput,
      draft,
      draftGate,
      finalAction: {
        kind: "draft_blocked",
        actionId: ids.finalActionId
      }
    };
  }

  const candidate = draftGate.candidate;
  const policyDecision = evaluateAutomationPolicy({
    account: input.account,
    candidate,
    context: input.policyContext
  });
  recordPolicyEvaluation({
    repo: input.repo,
    accountUuid: input.account.account_uuid,
    decision: policyDecision,
    candidate,
    policyContext: input.policyContext,
    runId: ids.policyRunId,
    decisionId: ids.policyDecisionId,
    auditEventId: ids.policyAuditEventId,
    traceId,
    now
  });

  const finalAction = await executeOfflineFinalAction({
    repo: input.repo,
    decision: policyDecision,
    candidate,
    notificationSender: input.notificationSender,
    policyDecisionId: ids.policyDecisionId,
    actionId: ids.finalActionId,
    auditEventId: ids.finalActionAuditEventId,
    traceId,
    now
  });

  return {
    traceId,
    ids,
    topicRadar,
    sourceContext,
    draftInput,
    draft,
    draftGate,
    policyDecision,
    finalAction
  };
}

function buildIds(prefix: string): OfflineOrchestrationIds {
  return {
    topicRunId: `${prefix}:topic-run`,
    topicAuditEventId: `${prefix}:topic-event`,
    sourceRunId: `${prefix}:source-run`,
    sourceAuditEventId: `${prefix}:source-event`,
    draftRunId: `${prefix}:draft-run`,
    draftAuditEventId: `${prefix}:draft-event`,
    policyRunId: `${prefix}:policy-run`,
    policyDecisionId: `${prefix}:policy-decision`,
    policyAuditEventId: `${prefix}:policy-event`,
    finalActionId: `${prefix}:final-action`,
    finalActionAuditEventId: `${prefix}:final-action-event`
  };
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
      actorId: "offline_orchestration_policy",
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

async function executeOfflineFinalAction(input: {
  repo: RuntimeRepository;
  decision: AutomationPolicyDecision;
  candidate: PostingCandidate;
  notificationSender: OfflineTelegramNotificationSender;
  policyDecisionId: string;
  actionId: string;
  auditEventId: string;
  traceId: string;
  now: string;
}): Promise<OfflineOrchestrationFinalAction> {
  if (input.decision.outcome === "auto_post") {
    recordOfflineAutoPostPlanned(input);
    return {
      kind: "auto_post_planned",
      actionId: input.actionId
    };
  }

  if (input.decision.outcome === "human_review") {
    assertOfflineNotificationSender(input.notificationSender);
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

function assertOfflineNotificationSender(sender: OfflineTelegramNotificationSender): void {
  if (sender.mode !== "offline_fake") {
    throw offlineOrchestrationError("offline orchestration requires an offline fake Telegram sender");
  }
}

function recordOfflineAutoPostPlanned(input: {
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
      actionType: "x_official_auto_post_planned",
      status: "skipped",
      startedAt: input.now,
      finishedAt: input.now,
      input: {
        candidate: input.candidate,
        policy_outcome: input.decision.outcome,
        policy_route: input.decision.route
      },
      output: {
        offline_only: true,
        real_x_post_created: false
      }
    });
    input.repo.recordAuditEvent({
      id: input.auditEventId,
      accountUuid: input.decision.accountUuid,
      eventType: "offline_auto_post_planned",
      subjectType: "ai_action",
      subjectId: input.actionId,
      actorType: "system",
      actorId: "offline_orchestration",
      traceId: input.traceId,
      occurredAt: input.now,
      metadata: {
        candidate_id: input.candidate.id,
        policy_decision_id: input.policyDecisionId,
        offline_only: true
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
        offline_only: true
      }
    });
    input.repo.recordAuditEvent({
      id: input.auditEventId,
      accountUuid: input.decision.accountUuid,
      eventType: "offline_policy_terminal",
      subjectType: "ai_action",
      subjectId: input.actionId,
      actorType: "system",
      actorId: "offline_orchestration",
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
      actorId: "offline_orchestration",
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

function parseNonEmpty(value: string, field: string): string {
  const parsed = nonEmptyStringSchema.safeParse(value);
  if (!parsed.success) {
    throw offlineOrchestrationError(`${field} must be non-empty`);
  }
  return parsed.data;
}

function parseIsoDateTime(value: string, field: string): string {
  const parsed = isoDateTimeSchema.safeParse(value);
  if (!parsed.success) {
    throw offlineOrchestrationError(`${field} must be an ISO datetime`);
  }
  return parsed.data;
}

function offlineOrchestrationError(message: string, details?: unknown): ApiError {
  return new ApiError({
    code: "invalid_request",
    provider: "local",
    stage: "offline_orchestration",
    message,
    details
  });
}
