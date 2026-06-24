import { resolve } from "node:path";

export type DebugOnlineSourceCollectionArgs = {
  account: string;
  collect: boolean;
  configFile: string;
  configFileExplicit: boolean;
  secretsFile?: string;
  dbFile?: string;
  maxQueries: number;
  perQueryLimit: number;
};

export const defaultDebugOnlineSourceCollectionConfigFile = "config/accounts.example.json";

export function parseDebugOnlineSourceCollectionArgs(argv: string[]): DebugOnlineSourceCollectionArgs {
  const args: Partial<DebugOnlineSourceCollectionArgs> & Pick<DebugOnlineSourceCollectionArgs, "collect" | "configFile" | "configFileExplicit" | "maxQueries" | "perQueryLimit"> = {
    collect: false,
    configFile: defaultDebugOnlineSourceCollectionConfigFile,
    configFileExplicit: false,
    maxQueries: 3,
    perQueryLimit: 5
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--account") {
      args.account = readValue(argv, ++index, "--account");
    } else if (arg === "--collect") {
      args.collect = true;
    } else if (arg === "--config-file") {
      args.configFile = readValue(argv, ++index, "--config-file");
      args.configFileExplicit = true;
    } else if (arg === "--secrets-file") {
      args.secretsFile = readValue(argv, ++index, "--secrets-file");
    } else if (arg === "--db-file") {
      args.dbFile = readValue(argv, ++index, "--db-file");
    } else if (arg === "--max-queries") {
      args.maxQueries = readBoundedPositiveInteger(argv, ++index, "--max-queries", 10);
    } else if (arg === "--per-query-limit") {
      args.perQueryLimit = readBoundedPositiveInteger(argv, ++index, "--per-query-limit", 10);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.account) {
    throw new Error("--account is required");
  }
  if (args.collect && !args.configFileExplicit) {
    throw new Error("--config-file is required when --collect is supplied; do not collect with config/accounts.example.json");
  }
  if (args.collect && isExampleConfigFile(args.configFile)) {
    throw new Error("--config-file must not be config/accounts.example.json when --collect is supplied");
  }

  return {
    account: args.account,
    collect: args.collect,
    configFile: args.configFile,
    configFileExplicit: args.configFileExplicit,
    secretsFile: args.secretsFile,
    dbFile: args.dbFile,
    maxQueries: args.maxQueries,
    perQueryLimit: args.perQueryLimit
  };
}

function isExampleConfigFile(value: string): boolean {
  return resolve(value) === resolve(defaultDebugOnlineSourceCollectionConfigFile);
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
