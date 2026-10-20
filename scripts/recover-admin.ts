import { randomUUID } from "node:crypto";
import { connectDatabases } from "@gestaloka/server";
import { Operations } from "@gestaloka/server/operations";

const [userId, reason, requestId = randomUUID()] = process.argv.slice(2);
if (!userId || !reason)
  throw new Error(
    'Usage: pnpm ops:recover-admin <app-user-id> "reason" [request-id]',
  );
const databases = connectDatabases();
try {
  const operations = new Operations(
    databases.postgres,
    process.env.OPERATIONS_TOKEN_SECRET ?? "",
  );
  console.log(
    JSON.stringify({
      requestId,
      result: await operations.recover(userId, requestId, reason),
    }),
  );
} finally {
  await databases.close();
}
