import { buildRuntimeHealthSnapshot } from "../lib/runtime/health";
import { RuntimeRepository } from "../lib/storage/repositories";
import { openRuntimeDatabase } from "../lib/storage/sqlite";

export function load() {
  const db = openRuntimeDatabase();
  try {
    const repo = new RuntimeRepository(db);
    return {
      health: buildRuntimeHealthSnapshot(db, repo),
      accounts: repo.listAccounts()
    };
  } finally {
    db.close();
  }
}
