import { isApiError } from "../lib/api/errors";
import { redactSecrets } from "../lib/api/redaction";
import {
  createSkippedOnlineOperationExecutor,
  defaultOnlineLoopIntervalSeconds,
  defaultOnlineLoopJitterSeconds,
  minimumOnlineLoopIntervalSeconds,
  defaultOnlineOperationLockPollIntervalMs,
  defaultOnlineOperationLockTtlSeconds,
  runOnlineOperationLoop
} from "../lib/orchestration/online-runner";

type CliArgs = {
  account?: string;
  intervalSeconds: number;
  jitterSeconds: number;
  sleepUtc?: string;
  maxIterations?: number;
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

  console.log("online run loop: starting");
  console.log(`account=${args.account}`);
  console.log(`interval_seconds=${args.intervalSeconds}`);
  console.log(`jitter_seconds=${args.jitterSeconds}`);
  console.log(`sleep_utc=${args.sleepUtc ?? "off"}`);

  const result = await runOnlineOperationLoop({
    accountKey: args.account,
    intervalSeconds: args.intervalSeconds,
    jitterSeconds: args.jitterSeconds,
    sleepUtc: args.sleepUtc,
    maxIterations: args.maxIterations,
    lockDir: args.lockDir,
    lockTtlSeconds: args.lockTtlSeconds,
    lockWaitTimeoutSeconds: args.lockWaitTimeoutSeconds,
    lockPollIntervalMs: args.lockPollIntervalMs,
    operation: createSkippedOnlineOperationExecutor(
      ".016 runner baseline is wired; real online operation executor is not connected yet"
    )
  });

  console.log("online run loop: stopped");
  console.log(`iterations=${result.iterations}`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    intervalSeconds: defaultOnlineLoopIntervalSeconds,
    jitterSeconds: defaultOnlineLoopJitterSeconds,
    lockTtlSeconds: defaultOnlineOperationLockTtlSeconds,
    lockPollIntervalMs: defaultOnlineOperationLockPollIntervalMs
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--account") {
      args.account = readValue(argv, ++index, "--account");
    } else if (arg === "--interval-seconds") {
      args.intervalSeconds = readMinimumInteger(argv, ++index, "--interval-seconds", minimumOnlineLoopIntervalSeconds);
    } else if (arg === "--jitter-seconds") {
      args.jitterSeconds = readNonNegativeInteger(argv, ++index, "--jitter-seconds");
    } else if (arg === "--sleep-utc") {
      args.sleepUtc = readValue(argv, ++index, "--sleep-utc");
    } else if (arg === "--max-iterations") {
      args.maxIterations = readPositiveInteger(argv, ++index, "--max-iterations");
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

function readMinimumInteger(argv: string[], index: number, flag: string, minimum: number): number {
  const value = Number(readValue(argv, index, flag));
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${flag} must be an integer >= ${minimum}`);
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
