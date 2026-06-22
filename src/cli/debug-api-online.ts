import { ApiError, isApiError } from "../lib/api/errors";
import type { FetchLike } from "../lib/api/http";
import { redactSecrets, tokenFingerprint } from "../lib/api/redaction";
import { findRealDebugPostTextViolation } from "../lib/api/real-post-text-policy";
import { resolveAccountCredentials } from "../lib/api/secrets";
import { TwitterApiIoPublicXAdapter } from "../lib/providers/twitterapi-io";
import { XOfficialPublisherClient } from "../lib/providers/x-official-publisher";

type CliArgs = {
  account?: string;
  allowRealPost: boolean;
  postText?: string;
  query: string;
  limit: number;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.account) {
    throw new Error("--account is required");
  }

  const postText = args.postText ?? process.env.X_DEBUG_POST_TEXT;
  const realPostPreflightError = getRealPostPreflightError(args, postText);
  if (realPostPreflightError) {
    console.log("ERROR real_post_not_allowed");
    console.log(`reason: ${realPostPreflightError}`);
    process.exitCode = 1;
    return;
  }

  const fetcher = buildDebugFetcher(process.env);
  const credentials = await resolveAccountCredentials({ accountKey: args.account });
  console.log(`credentials: twitterapi.io=${status(credentials.twitterApiIoApiKey)}, x_official=${tokenFingerprint(credentials.xOfficialAccessToken)}`);

  const publicX = new TwitterApiIoPublicXAdapter({
    apiKey: credentials.twitterApiIoApiKey,
    fetcher
  });
  const publisher = new XOfficialPublisherClient({
    accessToken: credentials.xOfficialAccessToken,
    fetcher
  });

  const searchOutput = await publicX.searchPosts({
    query: args.query,
    limit: args.limit
  });
  console.log(`twitterapi.io search smoke: ok, posts <= ${args.limit}, received=${searchOutput.posts.length}, raw=${searchOutput.rawCount}`);

  await publisher.verifyAccessToken();
  console.log("x auth smoke: ok");

  const dryRun = await publisher.createPost({
    accountKey: credentials.accountKey,
    text: postText ?? "PostFoundry dry-run smoke.",
    dryRun: true
  });
  console.log(`x post dry-run: ok, textLength=${dryRun.textLength}`);

  if (!args.allowRealPost) {
    console.log("real post: skipped, --allow-real-post was not supplied");
    return;
  }

  const realPostText = postText ?? "";
  const posted = await publisher.createPost({
    accountKey: credentials.accountKey,
    text: realPostText,
    dryRun: false
  });
  if (posted.status === "posted") {
    console.log(`real post: ok, tweet id=${posted.tweetId}`);
    await verifyThirdPartyReadback(publicX, posted.tweetId);
  }
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    allowRealPost: false,
    query: "AI",
    limit: 10
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--account") {
      args.account = readValue(argv, ++index, "--account");
    } else if (arg === "--allow-real-post") {
      args.allowRealPost = true;
    } else if (arg === "--post-text") {
      args.postText = readValue(argv, ++index, "--post-text");
    } else if (arg === "--query") {
      args.query = readValue(argv, ++index, "--query");
    } else if (arg === "--limit") {
      args.limit = Number(readValue(argv, ++index, "--limit"));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function getRealPostPreflightError(args: Pick<CliArgs, "allowRealPost">, postText: string | undefined): string | undefined {
  if (!args.allowRealPost) {
    return undefined;
  }

  return findRealDebugPostTextViolation(postText ?? "");
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function status(value: string | undefined): string {
  return value ? "configured" : "missing";
}

async function verifyThirdPartyReadback(publicX: TwitterApiIoPublicXAdapter, tweetId: string): Promise<void> {
  try {
    const post = await publicX.getPostById(tweetId);
    if (!post) {
      console.warn(`WARN third-party readback: tweet id ${tweetId} not found yet`);
      console.warn("residual_risk: TwitterAPI.io may not have indexed the new post yet; do not use x.com/browser fallback");
      return;
    }

    console.log(
      `third-party readback: ok, tweet id=${post.id}, author=${post.authorHandle ?? "unknown"}, createdAt=${post.createdAt ?? "unknown"}, textLength=${post.text.length}`
    );
  } catch (error: unknown) {
    if (isApiError(error)) {
      console.warn(`WARN third-party readback: ${error.code}`);
      console.warn(`provider: ${error.provider}`);
      console.warn(`stage: ${error.stage}`);
      if (error.status) {
        console.warn(`status: ${error.status}`);
      }
      if (error.retryHint) {
        console.warn(`retry_hint: ${error.retryHint}`);
      }
      console.warn(`reason: ${redactSecrets(error.message)}`);
      console.warn("residual_risk: real post succeeded but third-party API readback was not confirmed; do not use x.com/browser fallback");
      return;
    }

    console.warn(`WARN third-party readback: ${redactSecrets(String(error))}`);
    console.warn("residual_risk: real post succeeded but third-party API readback was not confirmed; do not use x.com/browser fallback");
  }
}

function buildDebugFetcher(env: NodeJS.ProcessEnv): FetchLike | undefined {
  const timeoutMs = resolveDebugTimeoutMs(env);
  if (!timeoutMs) {
    return undefined;
  }

  return async (input, init) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  };
}

function resolveDebugTimeoutMs(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env.POST_FOUNDRY_API_DEBUG_TIMEOUT_MS;
  if (!raw) {
    return undefined;
  }

  const timeoutMs = Number(raw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new ApiError({
      code: "invalid_request",
      provider: "local",
      stage: "debug_timeout",
      message: "POST_FOUNDRY_API_DEBUG_TIMEOUT_MS must be a positive integer"
    });
  }

  return timeoutMs;
}

main().catch((error: unknown) => {
  if (isApiError(error)) {
    console.error(`ERROR ${error.code}`);
    console.error(`provider: ${error.provider}`);
    console.error(`stage: ${error.stage}`);
    console.error(`reason: ${redactSecrets(error.message)}`);
    process.exitCode = 1;
    return;
  }

  console.error(redactSecrets(String(error)));
  process.exitCode = 1;
});
