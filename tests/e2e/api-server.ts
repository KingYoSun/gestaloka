import { WorldAccess } from "@gestaloka/server/access";
import { createApp } from "../../apps/api/src/app.js";
import { fixtureRuntime } from "../support/provider.js";
import { fixtureAuth } from "../support/auth.js";

const { databases, runtime } = await fixtureRuntime();
await databases.postgres.query(
  "CREATE TABLE IF NOT EXISTS e2e_subject(scope text NOT NULL,id uuid NOT NULL,PRIMARY KEY(scope,id))",
);
const auth = await fixtureAuth(databases.postgres, async (token) => {
  const id = token.slice("test_ory=".length);
  if (!/^[a-f0-9-]{36}$/.test(id)) return;
  const row = (
    await databases.postgres.query<{ ory_id: string }>(
      "SELECT i.ory_id FROM app_identity i JOIN e2e_subject s ON s.id=i.id WHERE i.id=$1 AND s.scope=$2",
      [id, process.env.E2E_SCOPE],
    )
  ).rows[0];
  return row ? { ory: row.ory_id, session: id } : undefined;
});
const access = new WorldAccess(runtime);
await access.setup();
const app = await createApp(access, auth.identity, undefined, auth.operations);
await app.listen({ host: "127.0.0.1", port: 3001 });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void (async () => {
      await app.close();
      await databases.queue.stop();
      await databases.close();
    })();
  });
