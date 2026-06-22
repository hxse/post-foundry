import { isApiError } from "../lib/api/errors";
import { redactSecrets } from "../lib/api/redaction";
import { buildRuntimeHealthSnapshot } from "../lib/runtime/health";
import { RuntimeRepository } from "../lib/storage/repositories";
import { openRuntimeDatabase } from "../lib/storage/sqlite";

async function main(): Promise<void> {
  const db = openRuntimeDatabase();
  try {
    const repo = new RuntimeRepository(db);
    console.log(JSON.stringify(buildRuntimeHealthSnapshot(db, repo), null, 2));
  } finally {
    db.close();
  }
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
