import { WorldAccess } from "@gestaloka/server/access";
import { createApp } from "../../apps/api/src/app.js";
import { fixtureRuntime } from "../support/provider.js";

const { databases, runtime } = await fixtureRuntime(),
  access = new WorldAccess(runtime);
await access.setup();
await databases.postgres.query(
  "CREATE TABLE IF NOT EXISTS e2e_subject(scope text NOT NULL,id uuid NOT NULL,PRIMARY KEY(scope,id))",
);
const session = access.session.bind(access);
access.session = async (token) => {
  const result = await session(token);
  await databases.postgres.query(
    "INSERT INTO e2e_subject(scope,id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [process.env.E2E_SCOPE, result.id],
  );
  return result;
};
const app = await createApp(access);
await app.listen({ host: "127.0.0.1", port: 3001 });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void (async () => {
      await app.close();
      await databases.queue.stop();
      await databases.close();
    })();
  });
