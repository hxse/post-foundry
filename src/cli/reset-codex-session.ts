import { isApiError } from "../lib/api/errors";
import { redactSecrets } from "../lib/api/redaction";
import { resetCodexSession } from "../lib/providers/codex-draft-generator";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await resetCodexSession({ accountKey: args.account, sessionDir: args.codexSessionDir });
  console.log("codex_session_reset=ok");
  console.log("account=" + args.account);
  console.log("removed=" + String(result.removed));
  console.log("path=" + result.path);
}

type ResetCodexSessionArgs = {
  account: string;
  codexSessionDir?: string;
};

function parseArgs(argv: string[]): ResetCodexSessionArgs {
  const args: Partial<ResetCodexSessionArgs> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--account") {
      args.account = readValue(argv, index + 1, "--account");
      index += 1;
      continue;
    }
    if (arg === "--codex-session-dir") {
      args.codexSessionDir = readValue(argv, index + 1, "--codex-session-dir");
      index += 1;
      continue;
    }
    throw new Error("Unknown argument: " + arg);
  }
  if (!args.account) {
    throw new Error("--account is required");
  }
  return { account: args.account, codexSessionDir: args.codexSessionDir };
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) {
    throw new Error(flag + " requires a value");
  }
  return value;
}

main().catch((error: unknown) => {
  if (isApiError(error)) {
    console.error("ERROR " + error.code);
    console.error("provider: " + error.provider);
    console.error("stage: " + error.stage);
    console.error("reason: " + redactSecrets(error.message));
    process.exitCode = 1;
    return;
  }

  console.error(redactSecrets(String(error)));
  process.exitCode = 1;
});
