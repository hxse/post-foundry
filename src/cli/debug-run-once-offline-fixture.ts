import { randomUUID } from "node:crypto";
import { isApiError } from "../lib/api/errors";
import { redactSecrets } from "../lib/api/redaction";
import { parseDebugRunOnceOfflineFixtureArgs } from "../lib/orchestration/offline-fixture-debug-args";
import { createFixtureRunOnceOperationExecutor } from "../lib/orchestration/run-once-operation-executor";
import { RuntimeRepository } from "../lib/storage/repositories";
import { openRuntimeDatabase } from "../lib/storage/sqlite";

async function main(): Promise<void> {
  const args = parseDebugRunOnceOfflineFixtureArgs(process.argv.slice(2));
  const startedAt = args.now ?? new Date().toISOString();
  const traceId = args.traceId ?? createTraceId(args.account, startedAt);
  const db = openRuntimeDatabase({ path: args.dbFile });
  try {
    const repo = new RuntimeRepository(db);
    const executor = createFixtureRunOnceOperationExecutor({
      repo,
      accountKey: args.account,
      mode: args.mode,
      now: startedAt
    });
    const result = await executor({
      accountKey: args.account,
      traceId,
      entrypoint: "run-once-online",
      startedAt
    });

    console.log("offline fixture run once: ok");
    console.log(`account=${args.account}`);
    console.log(`db_file=${args.dbFile}`);
    console.log(`trace_id=${traceId}`);
    console.log(`mode=${args.mode}`);
    console.log(`outcome=${result.outcome}`);
    console.log(`final_action=${result.finalAction ?? "none"}`);
    console.log(`offline_only=${String(result.summary?.offline_only ?? "unknown")}`);
    if (result.summary?.policy_outcome) {
      console.log(`policy_outcome=${String(result.summary.policy_outcome)}`);
    }
  } finally {
    db.close();
  }
}

function createTraceId(accountKey: string, startedAt: string): string {
  return `trace-offline-fixture-${accountKey}-${startedAt.replace(/[^0-9TZ]/g, "")}-${randomUUID()}`;
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
