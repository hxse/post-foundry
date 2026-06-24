import type { FixtureRunOnceOperationMode } from "./run-once-operation-executor";

export type DebugRunOnceOfflineFixtureArgs = {
  account: string;
  dbFile: string;
  mode: FixtureRunOnceOperationMode;
  traceId?: string;
  now?: string;
};

const fixtureModes = new Set<FixtureRunOnceOperationMode>(["auto_post", "human_review_link", "draft_blocked", "reject"]);

export function parseDebugRunOnceOfflineFixtureArgs(argv: string[]): DebugRunOnceOfflineFixtureArgs {
  const args: Partial<DebugRunOnceOfflineFixtureArgs> & Pick<DebugRunOnceOfflineFixtureArgs, "mode"> = {
    mode: "auto_post"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--account") {
      args.account = readValue(argv, ++index, "--account");
    } else if (arg === "--db-file") {
      args.dbFile = readValue(argv, ++index, "--db-file");
    } else if (arg === "--mode") {
      args.mode = readMode(argv, ++index, "--mode");
    } else if (arg === "--trace-id") {
      args.traceId = readValue(argv, ++index, "--trace-id");
    } else if (arg === "--now") {
      args.now = readValue(argv, ++index, "--now");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.account) {
    throw new Error("--account is required");
  }
  if (!args.dbFile) {
    throw new Error("--db-file is required for offline fixture debug runs");
  }

  return {
    account: args.account,
    dbFile: args.dbFile,
    mode: args.mode,
    traceId: args.traceId,
    now: args.now
  };
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function readMode(argv: string[], index: number, flag: string): FixtureRunOnceOperationMode {
  const value = readValue(argv, index, flag);
  if (!fixtureModes.has(value as FixtureRunOnceOperationMode)) {
    throw new Error(`${flag} must be one of: ${Array.from(fixtureModes).join(", ")}`);
  }
  return value as FixtureRunOnceOperationMode;
}
