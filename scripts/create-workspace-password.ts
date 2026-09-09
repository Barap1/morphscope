import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createPasswordHash } from "../apps/web/src/lib/workspace-auth-core.js";

const readline = createInterface({ input, output });
try {
  const password = await readline.question("Workspace password (input is visible): ");
  if (!password) throw new Error("A non-empty password is required");
  console.log(`MORPHSCOPE_WORKSPACE_PASSWORD_HASH=${createPasswordHash(password)}`);
} finally {
  readline.close();
}
