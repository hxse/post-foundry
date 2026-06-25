export type DebugOnlineSourceCollectionArgs = {
  account: string;
  collect: boolean;
  secretsFile?: string;
  dbFile?: string;
  maxRequests: number;
  perQueryLimit: number;
};


export function parseDebugOnlineSourceCollectionArgs(argv: string[]): DebugOnlineSourceCollectionArgs {
  const args: Partial<DebugOnlineSourceCollectionArgs> & Pick<DebugOnlineSourceCollectionArgs, "collect" | "maxRequests" | "perQueryLimit"> = {
    collect: false,
    maxRequests: 10,
    perQueryLimit: 5
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--account") {
      args.account = readValue(argv, ++index, "--account");
    } else if (arg === "--collect") {
      args.collect = true;
    } else if (arg === "--secrets-file") {
      args.secretsFile = readValue(argv, ++index, "--secrets-file");
    } else if (arg === "--db-file") {
      args.dbFile = readValue(argv, ++index, "--db-file");
    } else if (arg === "--max-requests") {
      args.maxRequests = readBoundedPositiveInteger(argv, ++index, "--max-requests", 10);
    } else if (arg === "--per-query-limit") {
      args.perQueryLimit = readBoundedPositiveInteger(argv, ++index, "--per-query-limit", 10);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.account) {
    throw new Error("--account is required");
  }
  return {
    account: args.account,
    collect: args.collect,
    secretsFile: args.secretsFile,
    dbFile: args.dbFile,
    maxRequests: args.maxRequests,
    perQueryLimit: args.perQueryLimit
  };
}


function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function readBoundedPositiveInteger(argv: string[], index: number, flag: string, maximum: number): number {
  const value = Number(readValue(argv, index, flag));
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  if (value > maximum) {
    throw new Error(`${flag} must be an integer <= ${maximum}`);
  }
  return value;
}
