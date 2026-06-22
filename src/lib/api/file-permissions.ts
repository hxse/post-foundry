import { chmod } from "node:fs/promises";

export async function restrictOwnerReadWrite(path: string): Promise<void> {
  await chmod(path, 0o600);
}
