import { ApiError } from "../api/errors";
import type { AutomationPolicyDecision, AutomationPolicyReason, PostingCandidate } from "../policy/automation";
import type { TelegramSendMessageInput, TelegramSentMessage } from "../providers/telegram-notifier";
import type { RuntimeRepository } from "../storage/repositories";

export type ManualNotificationCandidate = Pick<PostingCandidate, "id" | "text" | "urls" | "evidenceIds">;

export type ManualNotificationPlan =
  | {
      shouldNotify: true;
      reason: "manual_review_required";
      text: string;
    }
  | {
      shouldNotify: false;
      reason: "policy_not_notifiable";
    };

export type TelegramNotificationSender = {
  sendMessage(input: TelegramSendMessageInput): Promise<TelegramSentMessage>;
};

export type DeliverManualNotificationInput = {
  repo: RuntimeRepository;
  sender: TelegramNotificationSender;
  decision: AutomationPolicyDecision;
  candidate: ManualNotificationCandidate;
  policyDecisionId: string;
  actionId: string;
  auditEventId: string;
  traceId: string;
  now: string;
};

export type ManualNotificationDeliveryResult =
  | {
      status: "sent";
      messageId: number;
    }
  | {
      status: "skipped";
      reason: "policy_not_notifiable" | "already_notified";
    }
  | {
      status: "failed";
      error: string;
    };

const maxTelegramNotificationLength = 4096;
const urlPattern = /https?:\/\/[^\s)]+/gi;

export function planManualNotification(params: {
  decision: AutomationPolicyDecision;
  candidate: ManualNotificationCandidate;
}): ManualNotificationPlan {
  if (params.decision.outcome !== "human_review" || params.decision.route !== "telegram_human_gate") {
    return {
      shouldNotify: false,
      reason: "policy_not_notifiable"
    };
  }

  return {
    shouldNotify: true,
    reason: "manual_review_required",
    text: buildManualNotificationText(params.decision, params.candidate)
  };
}

export async function deliverManualNotification(input: DeliverManualNotificationInput): Promise<ManualNotificationDeliveryResult> {
  const plan = planManualNotification({
    decision: input.decision,
    candidate: input.candidate
  });
  if (!plan.shouldNotify) {
    return {
      status: "skipped",
      reason: plan.reason
    };
  }
  if (hasSuccessfulTelegramNotification(input.repo, input.decision.accountUuid, input.policyDecisionId)) {
    return {
      status: "skipped",
      reason: "already_notified"
    };
  }

  try {
    const sent = await input.sender.sendMessage({
      text: plan.text,
      disableWebPagePreview: true
    });
    recordTelegramNotificationAction(input, {
      status: "succeeded",
      sent
    });
    return {
      status: "sent",
      messageId: sent.messageId
    };
  } catch (error) {
    const message = errorMessage(error);
    recordTelegramNotificationAction(input, {
      status: "failed",
      error: message
    });
    return {
      status: "failed",
      error: message
    };
  }
}

function buildManualNotificationText(decision: AutomationPolicyDecision, candidate: ManualNotificationCandidate): string {
  const urls = uniqueStrings([...candidate.urls, ...extractUrls(candidate.text)]);
  const reviewReasons = decision.reasons.filter((reason) => reason.severity === "review");
  const reasonLines = (reviewReasons.length > 0 ? reviewReasons : decision.reasons).map(formatReason);
  const lines = [
    "人工处理通知",
    `账号: ${decision.accountKey}`,
    `候选: ${candidate.id}`,
    `决策: ${decision.outcome} / ${decision.route}`,
    "",
    "原因:",
    ...reasonLines.map((line) => `- ${line}`),
    "",
    "候选帖:",
    candidate.text,
    "",
    "链接:",
    ...(urls.length > 0 ? urls.map((url) => `- ${url}`) : ["- none"]),
    "",
    "证据:",
    ...(candidate.evidenceIds.length > 0 ? candidate.evidenceIds.map((id) => `- ${id}`) : ["- none"]),
    "",
    "处理提示: 这条不会自动发布，请你人工处理。"
  ];
  const text = lines.join("\n");
  if (text.length <= maxTelegramNotificationLength) {
    return text;
  }

  const available = Math.max(0, maxTelegramNotificationLength - (text.length - candidate.text.length) - 20);
  return lines.map((line) => (line === candidate.text ? `${candidate.text.slice(0, available)}...` : line)).join("\n");
}

function formatReason(reason: AutomationPolicyReason): string {
  return `${reason.code}: ${reason.message}`;
}

function recordTelegramNotificationAction(
  input: DeliverManualNotificationInput,
  result:
    | {
        status: "succeeded";
        sent: TelegramSentMessage;
      }
    | {
        status: "failed";
        error: string;
      }
): void {
  input.repo.transaction(() => {
    input.repo.recordAiAction({
      id: input.actionId,
      accountUuid: input.decision.accountUuid,
      decisionId: input.policyDecisionId,
      actionType: result.status === "succeeded" ? "telegram_notification_sent" : "telegram_notification_failed",
      status: result.status,
      startedAt: input.now,
      finishedAt: input.now,
      input: {
        candidate_id: input.candidate.id,
        policy_outcome: input.decision.outcome,
        policy_route: input.decision.route
      },
      output:
        result.status === "succeeded"
          ? {
              message_id: result.sent.messageId,
              chat_id: result.sent.chatId
            }
          : undefined,
      error: result.status === "failed" ? result.error : undefined
    });
    input.repo.recordAuditEvent({
      id: input.auditEventId,
      accountUuid: input.decision.accountUuid,
      eventType: result.status === "succeeded" ? "telegram_notification_delivered" : "telegram_notification_failed",
      subjectType: "ai_action",
      subjectId: input.actionId,
      actorType: "system",
      actorId: "manual_notification_workflow",
      traceId: input.traceId,
      occurredAt: input.now,
      metadata: {
        candidate_id: input.candidate.id,
        policy_decision_id: input.policyDecisionId,
        policy_outcome: input.decision.outcome,
        policy_route: input.decision.route
      }
    });
  });
}

function hasSuccessfulTelegramNotification(repo: RuntimeRepository, accountUuid: string, policyDecisionId: string): boolean {
  return repo
    .listAiActionsForAccount(accountUuid)
    .some(
      (action) =>
        action.decision_id === policyDecisionId &&
        action.action_type === "telegram_notification_sent" &&
        action.status === "succeeded"
    );
}

function extractUrls(text: string): string[] {
  return text.match(urlPattern) ?? [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
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
