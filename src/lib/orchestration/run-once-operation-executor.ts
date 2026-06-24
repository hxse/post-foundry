import { createHash } from "node:crypto";
import accountsExample from "../../../config/accounts.example.json";
import type { AccountInitialPrompt } from "../accounts/account-prompt";
import {
  createAccountConfigSnapshot,
  parseAccountRegistryConfig,
  resolveAccountRef,
  type AccountConfig,
  type AccountRegistry
} from "../accounts/registry";
import { ApiError } from "../api/errors";
import type { RecentPostInput, SourceMaterialInput } from "../context/source-ingestion";
import type { TelegramSendMessageInput } from "../providers/telegram-notifier";
import type { AutomationPolicyContext } from "../policy/automation";
import type { RuntimeRepository } from "../storage/repositories";
import {
  runOfflineOrchestration,
  type OfflineOrchestrationResult,
  type OfflineTelegramNotificationSender
} from "./offline-run";
import type { OnlineOperationContext, OnlineOperationExecutor, OnlineOperationExecutorResult } from "./online-runner";

export type FixtureRunOnceOperationMode = "auto_post" | "human_review_link" | "draft_blocked" | "reject";

export type FixtureRunOnceOperationExecutorInput = {
  repo: RuntimeRepository;
  accountKey: string;
  mode?: FixtureRunOnceOperationMode;
  now?: string;
  configSnapshotId?: string;
};

export const fixtureRunOncePromptText = "OFFLINE FIXTURE PROMPT: 关注 AI 产品化、开源工具和长期主义表达。";

const defaultNow = "2026-06-24T03:00:00.000Z";

export function createFixtureRunOnceOperationExecutor(input: FixtureRunOnceOperationExecutorInput): OnlineOperationExecutor {
  const mode = input.mode ?? "auto_post";
  return async (context) => runFixtureOperation(input, context, mode);
}

async function runFixtureOperation(
  input: FixtureRunOnceOperationExecutorInput,
  context: OnlineOperationContext,
  mode: FixtureRunOnceOperationMode
): Promise<OnlineOperationExecutorResult> {
  if (context.accountKey !== input.accountKey) {
    throw executorError("executor accountKey does not match runner context", {
      inputAccountKey: input.accountKey,
      contextAccountKey: context.accountKey
    });
  }

  const now = input.now ?? context.startedAt ?? defaultNow;
  const { registry, account } = seedFixtureRegistry(input.repo, input.accountKey, now);
  const snapshot = createAccountConfigSnapshot({
    registry,
    ref: { accountKey: input.accountKey },
    capturedAt: now
  });
  const sender = createOfflineNotificationSender();
  const orchestration = await runOfflineOrchestration({
    repo: input.repo,
    account,
    configSnapshot: snapshot,
    configSnapshotId: input.configSnapshotId ?? `${context.traceId}:config-snapshot`,
    prompt: createInitialPrompt(account.account_key),
    materials: createFixtureSourceMaterials(account),
    recentPosts: createFixtureRecentPosts(account),
    draftOutput: createFixtureDraftOutput(mode, context.traceId),
    policyContext: createFixturePolicyContext(now),
    notificationSender: sender,
    runIdPrefix: context.traceId,
    traceId: context.traceId,
    now
  });

  return summarizeOrchestration(orchestration, sender);
}

function seedFixtureRegistry(
  repo: RuntimeRepository,
  accountKey: string,
  now: string
): {
  registry: AccountRegistry;
  account: AccountConfig;
} {
  const config = JSON.parse(JSON.stringify(accountsExample)) as typeof accountsExample;
  const rawAccount = config.accounts.find((candidate) => candidate.account_key === accountKey);
  if (!rawAccount) {
    throw executorError(`missing account fixture: ${accountKey}`);
  }
  rawAccount.posting.real_posting_enabled = true;

  const registry = parseAccountRegistryConfig(config);
  for (const account of registry.config.accounts) {
    repo.upsertAccount(account, now);
  }
  for (const identity of registry.config.x_identities) {
    repo.upsertXIdentity(identity);
  }

  return {
    registry,
    account: resolveAccountRef(registry, { accountKey }).account
  };
}

function createInitialPrompt(accountKey: string): AccountInitialPrompt {
  return {
    accountKey,
    source: "inline",
    prompt: fixtureRunOncePromptText,
    promptSha256: sha256(fixtureRunOncePromptText)
  };
}

function createFixtureSourceMaterials(account: AccountConfig): SourceMaterialInput[] {
  return [
    {
      id: "material-ai-agent-x",
      accountUuid: account.account_uuid,
      sourceType: "public_x_post",
      provider: "twitterapi.io",
      sourceRef: "tweet:ai-agent-workflow",
      title: "High engagement X post about AI agent workflows",
      text: "AI agent workflow is becoming a visible topic among builders because teams want repeatable judgement.",
      capturedAt: "2026-06-24T02:45:00.000Z",
      topicTags: ["AI", "agent_workflow"],
      authorHandle: "example_builder",
      engagement: {
        likeCount: 900,
        repostCount: 130,
        replyCount: 40,
        bookmarkCount: 160,
        viewCount: 120_000
      }
    },
    {
      id: "material-ai-agent-web",
      accountUuid: account.account_uuid,
      sourceType: "web_page",
      provider: "web_news_fixture",
      sourceRef: "article:ai-agent-workflow",
      sourceUrl: "https://example.com/ai-agent-workflow",
      title: "AI agent workflow article",
      summary: "A source that verifies why agent workflows need durable memory and replayable decisions.",
      capturedAt: "2026-06-24T02:40:00.000Z",
      topicTags: ["AI", "agent_workflow"]
    },
    {
      id: "material-open-source-devtools",
      accountUuid: account.account_uuid,
      sourceType: "public_x_post",
      provider: "twitterapi.io",
      sourceRef: "tweet:open-source-devtools",
      title: "Open source devtools release",
      text: "An open_source devtools project is getting attention because it makes local automation easier to audit.",
      capturedAt: "2026-06-24T02:35:00.000Z",
      topicTags: ["open_source", "devtools"],
      engagement: {
        likeCount: 300,
        repostCount: 50,
        replyCount: 12,
        bookmarkCount: 60,
        viewCount: 40_000
      }
    }
  ];
}

function createFixtureRecentPosts(account: AccountConfig): RecentPostInput[] {
  return [
    {
      id: "recent-1",
      accountUuid: account.account_uuid,
      text: "很多开源项目的优势，不只是免费，而是让团队能看见工具背后的取舍。",
      postedAt: "2026-06-23T16:00:00.000Z",
      source: "local_ledger"
    },
    {
      id: "recent-2",
      accountUuid: account.account_uuid,
      text: "越是想让系统自动化，越要先把人工判断写清楚。",
      postedAt: "2026-06-23T10:00:00.000Z",
      source: "local_ledger"
    }
  ];
}

function createFixtureDraftOutput(mode: FixtureRunOnceOperationMode, traceId: string): unknown {
  if (mode === "human_review_link") {
    return {
      draft_id: `${traceId}:draft-link`,
      post_text: "AI 工作流的讨论可以看这份资料：https://example.com/ai-agent-workflow",
      urls: ["https://example.com/ai-agent-workflow"],
      topic_tags: ["AI", "agent_workflow"],
      evidence_ids: ["material-ai-agent-web"]
    };
  }

  if (mode === "draft_blocked") {
    return {
      draft_id: `${traceId}:draft-blocked`,
      post_text: "结论：\n- AI 工作流需要记录判断\n- 再复盘结果",
      topic_tags: ["AI"],
      evidence_ids: ["material-ai-agent-x"]
    };
  }

  if (mode === "reject") {
    return {
      draft_id: `${traceId}:draft-reject`,
      post_text: "politics 话题不应该混进这个账号。",
      topic_tags: ["politics"],
      evidence_ids: ["material-ai-agent-x"]
    };
  }

  return {
    draft_id: `${traceId}:draft-auto`,
    post_text: "AI 产品能不能长期有用，常常取决于它有没有把一次判断变成下一次可以复用的流程。",
    topic_tags: ["AI", "agent_workflow"],
    evidence_ids: ["material-ai-agent-x"],
    internal_notes: "offline fixture draft"
  };
}

function createFixturePolicyContext(now: string): AutomationPolicyContext {
  return {
    evaluatedAt: now,
    postedTodayCount: 0,
    lastPostedAt: "2026-06-23T20:00:00.000Z",
    monthlyXDataSpendUsd: 1,
    monthlyLlmSpendUsd: 1,
    publicXRequestsThisMonth: 10,
    estimatedXDataSpendUsd: 0,
    estimatedLlmSpendUsd: 0.01,
    estimatedPublicXRequests: 0
  };
}

function createOfflineNotificationSender(): OfflineTelegramNotificationSender & {
  messages: TelegramSendMessageInput[];
} {
  const messages: TelegramSendMessageInput[] = [];
  return {
    mode: "offline_fake",
    messages,
    sendMessage: async (input) => {
      messages.push(input);
      return {
        messageId: 9000 + messages.length,
        chatId: "offline-channel"
      };
    }
  };
}

function summarizeOrchestration(
  orchestration: OfflineOrchestrationResult,
  sender: ReturnType<typeof createOfflineNotificationSender>
): OnlineOperationExecutorResult {
  return {
    outcome: "completed",
    finalAction: orchestration.finalAction.kind,
    summary: {
      executor: "fixture_run_once_operation_v1",
      offline_only: true,
      topic_id: orchestration.topicRadar.selectedTopic.id,
      draft_gate_status: orchestration.draftGate.status,
      policy_outcome: orchestration.policyDecision?.outcome ?? "not_evaluated",
      policy_route: orchestration.policyDecision?.route ?? "not_evaluated",
      notification_count: sender.messages.length,
      ledger_trace_id: orchestration.traceId
    }
  };
}

function executorError(message: string, details?: unknown): ApiError {
  return new ApiError({
    code: "invalid_request",
    provider: "local",
    stage: "run_once_operation_executor",
    message,
    details
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
