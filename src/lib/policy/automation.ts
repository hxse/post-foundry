import { z } from "zod";
import type { AccountConfig } from "../accounts/registry";
import { ApiError } from "../api/errors";
import type { RuntimeRepository } from "../storage/repositories";

export type AutomationPolicyOutcome = "auto_post" | "human_review" | "reject" | "defer";
export type AutomationPolicyRoute = "x_official_auto" | "telegram_human_gate" | "blocked" | "deferred";
export type AutomationPolicyReasonSeverity = "info" | "review" | "block";

export type AutomationPolicyReason = {
  code: string;
  severity: AutomationPolicyReasonSeverity;
  message: string;
};

export type AutomationPolicyCheck = {
  key: string;
  passed: boolean;
  detail: string;
};

export type PostingCandidate = {
  id: string;
  text: string;
  urls: string[];
  topicTags: string[];
  evidenceIds: string[];
};

export type AutomationPolicyContext = {
  evaluatedAt: string;
  postedTodayCount: number;
  lastPostedAt?: string;
};

export type AutomationPolicyDecision = {
  accountUuid: string;
  accountKey: string;
  candidateId: string;
  outcome: AutomationPolicyOutcome;
  route: AutomationPolicyRoute;
  requiresHumanReview: boolean;
  canAutoPost: boolean;
  hasLink: boolean;
  reasons: AutomationPolicyReason[];
  checks: AutomationPolicyCheck[];
  evaluatedAt: string;
};

export type EvaluateAutomationPolicyInput = {
  account: AccountConfig;
  candidate: unknown;
  context: unknown;
};

export type RecordAutomationPolicyDecisionInput = {
  repo: RuntimeRepository;
  decision: AutomationPolicyDecision;
  aiRunId: string;
  decisionId: string;
  auditEventId: string;
  traceId: string;
  createdAt: string;
  actorId?: string;
};

const maxPostTextLength = 280;
const hardBannedPhrasePatterns = [
  /postfoundry/i,
  /smoke\s+test/i,
  /\bdebug\b/i,
  /\btask\s+\d{8}[a-z]\b/i,
  /\btask\s+\d{8}[a-z]\.\d{3}\b/i
];
const urlPattern = /https?:\/\/[^\s)]+/gi;

const postingCandidateSchema = z
  .object({
    id: z.string().trim().min(1),
    text: z.string().trim().min(1),
    urls: z.array(z.string().url()).default([]),
    topicTags: z.array(z.string().trim().min(1)).default([]),
    evidenceIds: z.array(z.string().trim().min(1)).default([])
  })
  .strict();

const automationPolicyContextSchema = z
  .object({
    evaluatedAt: z.string().datetime(),
    postedTodayCount: z.number().int().nonnegative(),
    lastPostedAt: z.string().datetime().optional()
  })
  .strict();

export function evaluateAutomationPolicy(input: EvaluateAutomationPolicyInput): AutomationPolicyDecision {
  const candidate = parsePostingCandidate(input.candidate);
  const context = parseAutomationPolicyContext(input.context);
  const reasons: AutomationPolicyReason[] = [];
  const checks: AutomationPolicyCheck[] = [];
  const urls = uniqueStrings([...candidate.urls, ...extractUrls(candidate.text)]);
  const hasLink = urls.length > 0;

  addCheck(checks, "account_enabled", input.account.enabled, "account must be enabled");
  if (!input.account.enabled) {
    addReason(reasons, "account_disabled", "block", "account is disabled");
  }

  addCheck(checks, "text_length", candidate.text.length <= maxPostTextLength, "post text must fit automatic X plain-text limit");
  if (candidate.text.length > maxPostTextLength) {
    addReason(
      reasons,
      "long_post_requires_human_review",
      "review",
      `post text exceeds ${maxPostTextLength} characters and must use Telegram human gate`
    );
  }

  const bannedPhrase = findBannedPhrase(candidate.text, input.account.style.banned_phrases);
  addCheck(checks, "banned_phrases", !bannedPhrase, "post text must not contain banned or debug phrases");
  if (bannedPhrase) {
    addReason(reasons, "banned_phrase", "block", `post text contains banned phrase: ${bannedPhrase}`);
  }

  const topicMatch = matchAccountTopics(input.account, candidate);
  addCheck(checks, "topic_exclusion", topicMatch.excluded.length === 0, "candidate must not match excluded topics");
  if (topicMatch.excluded.length > 0) {
    addReason(reasons, "excluded_topic", "block", `candidate matches excluded topic: ${topicMatch.excluded.join(", ")}`);
  }

  addCheck(checks, "topic_inclusion", topicMatch.included.length > 0, "candidate must match at least one account topic");
  if (topicMatch.included.length === 0) {
    addReason(reasons, "missing_included_topic", "block", "candidate does not match account topics");
  }

  addCheck(checks, "link_gate", !hasLink, "posts containing links must go through human review");
  if (hasLink) {
    addReason(reasons, "link_requires_human_review", "review", "candidate contains a link and must use Telegram human gate");
  }

  addCheck(checks, "account_approval_policy", !input.account.posting.require_approval, "account must allow automatic posting");
  if (input.account.posting.require_approval) {
    addReason(reasons, "account_requires_human_review", "review", "account posting policy requires approval");
  }

  addCheck(checks, "real_posting_enabled", input.account.posting.real_posting_enabled, "real posting must be enabled");
  if (!input.account.posting.real_posting_enabled) {
    addReason(reasons, "real_posting_disabled", "block", "account real posting is disabled");
  }

  addCheck(checks, "daily_max", context.postedTodayCount < input.account.posting.daily_max, "daily maximum must not be exhausted");
  if (context.postedTodayCount >= input.account.posting.daily_max) {
    addReason(reasons, "daily_max_reached", "block", "account daily post limit has been reached");
  }

  const cooldownRemainingMinutes = getCooldownRemainingMinutes(input.account, context);
  addCheck(checks, "cooldown", cooldownRemainingMinutes <= 0, "cooldown must have elapsed");
  if (cooldownRemainingMinutes > 0) {
    addReason(reasons, "cooldown_active", "block", `cooldown still has ${cooldownRemainingMinutes} minutes remaining`);
  }


  const outcome = chooseOutcome(reasons);
  const route = chooseRoute(outcome);

  return {
    accountUuid: input.account.account_uuid,
    accountKey: input.account.account_key,
    candidateId: candidate.id,
    outcome,
    route,
    requiresHumanReview: outcome === "human_review",
    canAutoPost: outcome === "auto_post",
    hasLink,
    reasons: reasons.length > 0 ? reasons : [{ code: "policy_passed", severity: "info", message: "candidate passed automation policy" }],
    checks,
    evaluatedAt: context.evaluatedAt
  };
}

export function recordAutomationPolicyDecision(input: RecordAutomationPolicyDecisionInput): void {
  input.repo.transaction(() => {
    input.repo.recordAiDecision({
      id: input.decisionId,
      accountUuid: input.decision.accountUuid,
      aiRunId: input.aiRunId,
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
      createdAt: input.createdAt
    });
    input.repo.recordAuditEvent({
      id: input.auditEventId,
      accountUuid: input.decision.accountUuid,
      eventType: "automation_policy_decided",
      subjectType: "ai_decision",
      subjectId: input.decisionId,
      actorType: "system",
      actorId: input.actorId ?? "automation_policy_engine",
      traceId: input.traceId,
      occurredAt: input.createdAt,
      metadata: {
        candidate_id: input.decision.candidateId,
        outcome: input.decision.outcome,
        route: input.decision.route,
        requires_human_review: input.decision.requiresHumanReview
      }
    });
  });
}

function parsePostingCandidate(input: unknown): PostingCandidate {
  const parsed = postingCandidateSchema.safeParse(input);
  if (!parsed.success) {
    throw automationPolicyError("posting candidate is invalid", parsed.error.flatten());
  }

  return parsed.data;
}

function parseAutomationPolicyContext(input: unknown): AutomationPolicyContext {
  const parsed = automationPolicyContextSchema.safeParse(input);
  if (!parsed.success) {
    throw automationPolicyError("automation policy context is invalid", parsed.error.flatten());
  }

  return parsed.data;
}

function findBannedPhrase(text: string, configuredPhrases: string[]): string | undefined {
  const lowerText = text.toLowerCase();
  const configured = configuredPhrases.find((phrase) => lowerText.includes(phrase.toLowerCase()));
  if (configured) {
    return configured;
  }

  const hardPattern = hardBannedPhrasePatterns.find((pattern) => pattern.test(text));
  return hardPattern?.source;
}

function matchAccountTopics(
  account: AccountConfig,
  candidate: PostingCandidate
): {
  included: string[];
  excluded: string[];
} {
  const text = normaliseTopicToken(candidate.text);
  const tags = new Set(candidate.topicTags.map(normaliseTopicToken));
  const matchesTopic = (topic: string) => {
    const token = normaliseTopicToken(topic);
    return tags.has(token) || matchesTopicText(text, token);
  };

  return {
    included: account.topics.include.filter(matchesTopic),
    excluded: account.topics.exclude.filter(matchesTopic)
  };
}

function normaliseTopicToken(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").trim();
}

function matchesTopicText(normalisedText: string, normalisedTopic: string): boolean {
  if (!normalisedTopic) {
    return false;
  }

  if (isAsciiTopic(normalisedTopic)) {
    const phrasePattern = normalisedTopic.split(/\s+/).map(escapeRegExp).join("[\\s_-]+");
    return new RegExp(`(^|[^a-z0-9])${phrasePattern}($|[^a-z0-9])`, "i").test(normalisedText);
  }

  return normalisedText.includes(normalisedTopic);
}

function isAsciiTopic(value: string): boolean {
  return /^[a-z0-9\s]+$/.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractUrls(text: string): string[] {
  return text.match(urlPattern) ?? [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function getCooldownRemainingMinutes(account: AccountConfig, context: AutomationPolicyContext): number {
  if (!context.lastPostedAt || account.posting.cooldown_minutes <= 0) {
    return 0;
  }

  const evaluatedAtMs = Date.parse(context.evaluatedAt);
  const lastPostedAtMs = Date.parse(context.lastPostedAt);
  const elapsedMinutes = Math.floor((evaluatedAtMs - lastPostedAtMs) / 60_000);
  return Math.max(0, account.posting.cooldown_minutes - elapsedMinutes);
}


function chooseOutcome(reasons: AutomationPolicyReason[]): AutomationPolicyOutcome {
  if (reasons.some((reason) => reason.severity === "block")) {
    const onlyOperationalBlocks = reasons
      .filter((reason) => reason.severity === "block")
      .every((reason) =>
        [
          "real_posting_disabled",
          "daily_max_reached",
          "cooldown_active"
        ].includes(reason.code)
      );
    return onlyOperationalBlocks ? "defer" : "reject";
  }

  if (reasons.some((reason) => reason.severity === "review")) {
    return "human_review";
  }

  return "auto_post";
}

function chooseRoute(outcome: AutomationPolicyOutcome): AutomationPolicyRoute {
  if (outcome === "auto_post") {
    return "x_official_auto";
  }
  if (outcome === "human_review") {
    return "telegram_human_gate";
  }
  if (outcome === "defer") {
    return "deferred";
  }
  return "blocked";
}

function confidenceForOutcome(outcome: AutomationPolicyOutcome): number {
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

function addReason(
  reasons: AutomationPolicyReason[],
  code: string,
  severity: AutomationPolicyReasonSeverity,
  message: string
): void {
  reasons.push({ code, severity, message });
}

function addCheck(checks: AutomationPolicyCheck[], key: string, passed: boolean, detail: string): void {
  checks.push({ key, passed, detail });
}

function automationPolicyError(message: string, details?: unknown): ApiError {
  return new ApiError({
    code: "invalid_request",
    provider: "local",
    stage: "automation_policy",
    message,
    details
  });
}
