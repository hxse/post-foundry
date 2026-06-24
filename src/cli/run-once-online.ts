import { isApiError } from "../lib/api/errors";
import { redactSecrets } from "../lib/api/redaction";
import {
  createSkippedOnlineOperationExecutor,
  runOnlineOperationOnce,
  defaultOnlineOperationLockPollIntervalMs,
  defaultOnlineOperationLockTtlSeconds
} from "../lib/orchestration/online-runner";

type CliArgs = {
  account?: string;
  lockDir?: string;
  lockTtlSeconds: number;
  lockWaitTimeoutSeconds?: number;
  lockPollIntervalMs: number;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.account) {
    throw new Error("--account is required");
  }

  const result = await runOnlineOperationOnce({
    accountKey: args.account,
    lockDir: args.lockDir,
    lockTtlSeconds: args.lockTtlSeconds,
    lockWaitTimeoutSeconds: args.lockWaitTimeoutSeconds,
    lockPollIntervalMs: args.lockPollIntervalMs,
    operation: createSkippedOnlineOperationExecutor("production operation executor is not wired yet")
  });

  console.log("online run once: ok");
  console.log(`account=${result.accountKey}`);
  console.log(`trace_id=${result.traceId}`);
  console.log(`outcome=${result.outcome}`);
  console.log(`final_action=${result.finalAction ?? "none"}`);
  if (result.summary?.reason) {
    console.log(`reason=${String(result.summary.reason)}`);
  }
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    lockTtlSeconds: defaultOnlineOperationLockTtlSeconds,
    lockPollIntervalMs: defaultOnlineOperationLockPollIntervalMs
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--account") {
      args.account = readValue(argv, ++index, "--account");
    } else if (arg === "--lock-dir") {
      args.lockDir = readValue(argv, ++index, "--lock-dir");
    } else if (arg === "--lock-ttl-seconds") {
      args.lockTtlSeconds = readPositiveInteger(argv, ++index, "--lock-ttl-seconds");
    } else if (arg === "--lock-wait-timeout-seconds") {
      args.lockWaitTimeoutSeconds = readNonNegativeInteger(argv, ++index, "--lock-wait-timeout-seconds");
    } else if (arg === "--lock-poll-interval-ms") {
      args.lockPollIntervalMs = readPositiveInteger(argv, ++index, "--lock-poll-interval-ms");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function readPositiveInteger(argv: string[], index: number, flag: string): number {
  const value = Number(readValue(argv, index, flag));
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

function readNonNegativeInteger(argv: string[], index: number, flag: string): number {
  const value = Number(readValue(argv, index, flag));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return value;
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
