import { resolve } from "node:path";
import {
  defaultOnlineLoopIntervalSeconds,
  defaultOnlineLoopJitterSeconds,
  defaultOnlineOperationLockPollIntervalMs,
  defaultOnlineOperationLockTtlSeconds,
  minimumOnlineLoopIntervalSeconds
} from "./online-runner";

export type ProductionSourceCollectionArgs = {
  configFile: string;
  secretsFile?: string;
  dbFile?: string;
  sourceMaxQueries: number;
  sourcePerQueryLimit: number;
};

export type ProductionOnlineRunOnceArgs = ProductionSourceCollectionArgs & {
  account: string;
  lockDir?: string;
  lockTtlSeconds: number;
  lockWaitTimeoutSeconds?: number;
  lockPollIntervalMs: number;
};

export type ProductionOnlineRunLoopArgs = ProductionOnlineRunOnceArgs & {
  intervalSeconds: number;
  jitterSeconds: number;
  sleepUtc?: string;
  maxIterations?: number;
};

const exampleConfigFile = "config/accounts.example.json";

export function parseProductionOnlineRunOnceArgs(argv: string[]): ProductionOnlineRunOnceArgs {
  const args: Partial<ProductionOnlineRunOnceArgs> = defaultProductionArgs();
  parseCommonArgs(argv, args);
  return finalizeRunOnceArgs(args);
}

export function parseProductionOnlineRunLoopArgs(argv: string[]): ProductionOnlineRunLoopArgs {
  const args: Partial<ProductionOnlineRunLoopArgs> = {
    ...defaultProductionArgs(),
    intervalSeconds: defaultOnlineLoopIntervalSeconds,
    jitterSeconds: defaultOnlineLoopJitterSeconds
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--interval-seconds") {
      args.intervalSeconds = readMinimumInteger(argv, ++index, "--interval-seconds", minimumOnlineLoopIntervalSeconds);
    } else if (arg === "--jitter-seconds") {
      args.jitterSeconds = readNonNegativeInteger(argv, ++index, "--jitter-seconds");
    } else if (arg === "--sleep-utc") {
      args.sleepUtc = readValue(argv, ++index, "--sleep-utc");
    } else if (arg === "--max-iterations") {
      args.maxIterations = readPositiveInteger(argv, ++index, "--max-iterations");
    } else {
      index = parseCommonArg(argv, index, args);
    }
  }

  return {
    ...finalizeRunOnceArgs(args),
    intervalSeconds: args.intervalSeconds ?? defaultOnlineLoopIntervalSeconds,
    jitterSeconds: args.jitterSeconds ?? defaultOnlineLoopJitterSeconds,
    sleepUtc: args.sleepUtc,
    maxIterations: args.maxIterations
  };
}

function defaultProductionArgs(): Partial<ProductionOnlineRunOnceArgs> {
  return {
    sourceMaxQueries: 3,
    sourcePerQueryLimit: 5,
    lockTtlSeconds: defaultOnlineOperationLockTtlSeconds,
    lockPollIntervalMs: defaultOnlineOperationLockPollIntervalMs
  };
}

function parseCommonArgs(argv: string[], args: Partial<ProductionOnlineRunOnceArgs>): void {
  for (let index = 0; index < argv.length; index += 1) {
    index = parseCommonArg(argv, index, args);
  }
}

function parseCommonArg(argv: string[], index: number, args: Partial<ProductionOnlineRunOnceArgs>): number {
  const arg = argv[index];
  if (arg === "--account") {
    args.account = readValue(argv, index + 1, "--account");
    return index + 1;
  }
  if (arg === "--config-file") {
    args.configFile = readValue(argv, index + 1, "--config-file");
    return index + 1;
  }
  if (arg === "--secrets-file") {
    args.secretsFile = readValue(argv, index + 1, "--secrets-file");
    return index + 1;
  }
  if (arg === "--db-file") {
    args.dbFile = readValue(argv, index + 1, "--db-file");
    return index + 1;
  }
  if (arg === "--source-max-queries") {
    args.sourceMaxQueries = readBoundedPositiveInteger(argv, index + 1, "--source-max-queries", 10);
    return index + 1;
  }
  if (arg === "--source-per-query-limit") {
    args.sourcePerQueryLimit = readBoundedPositiveInteger(argv, index + 1, "--source-per-query-limit", 10);
    return index + 1;
  }
  if (arg === "--lock-dir") {
    args.lockDir = readValue(argv, index + 1, "--lock-dir");
    return index + 1;
  }
  if (arg === "--lock-ttl-seconds") {
    args.lockTtlSeconds = readPositiveInteger(argv, index + 1, "--lock-ttl-seconds");
    return index + 1;
  }
  if (arg === "--lock-wait-timeout-seconds") {
    args.lockWaitTimeoutSeconds = readNonNegativeInteger(argv, index + 1, "--lock-wait-timeout-seconds");
    return index + 1;
  }
  if (arg === "--lock-poll-interval-ms") {
    args.lockPollIntervalMs = readPositiveInteger(argv, index + 1, "--lock-poll-interval-ms");
    return index + 1;
  }
  throw new Error(`Unknown argument: ${arg}`);
}

function finalizeRunOnceArgs(args: Partial<ProductionOnlineRunOnceArgs>): ProductionOnlineRunOnceArgs {
  if (!args.account) {
    throw new Error("--account is required");
  }
  if (!args.configFile) {
    throw new Error("--config-file is required for production online runs");
  }
  if (isExampleConfigFile(args.configFile)) {
    throw new Error("--config-file must not be config/accounts.example.json for production online runs");
  }
  return {
    account: args.account,
    configFile: args.configFile,
    secretsFile: args.secretsFile,
    dbFile: args.dbFile,
    sourceMaxQueries: args.sourceMaxQueries ?? 3,
    sourcePerQueryLimit: args.sourcePerQueryLimit ?? 5,
    lockDir: args.lockDir,
    lockTtlSeconds: args.lockTtlSeconds ?? defaultOnlineOperationLockTtlSeconds,
    lockWaitTimeoutSeconds: args.lockWaitTimeoutSeconds,
    lockPollIntervalMs: args.lockPollIntervalMs ?? defaultOnlineOperationLockPollIntervalMs
  };
}

function isExampleConfigFile(value: string): boolean {
  return resolve(value) === resolve(exampleConfigFile);
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

function readBoundedPositiveInteger(argv: string[], index: number, flag: string, maximum: number): number {
  const value = readPositiveInteger(argv, index, flag);
  if (value > maximum) {
    throw new Error(`${flag} must be an integer <= ${maximum}`);
  }
  return value;
}
