import { connectDatabases } from "@gestaloka/server";
import { createApp } from "./app.js";
import { LlmClient, llmApiKey } from "@gestaloka/server/llm";
import { WorldAgent } from "@gestaloka/server/agent";
import { WorldBuilder } from "@gestaloka/server/build";
import { WorldConstruction } from "@gestaloka/server/construction";
import { WorldAccess } from "@gestaloka/server/access";
import { OryIdentity } from "@gestaloka/server/identity";
import { Operations } from "@gestaloka/server/operations";

const databases = connectDatabases();
let app: Awaited<ReturnType<typeof createApp>> | undefined;
databases.queue.on("error", (error) => console.error(error));
try {
  await databases.verify();
  const identity = process.env.ORY_KRATOS_PUBLIC_URL
    ? new OryIdentity(databases.postgres, process.env.ORY_KRATOS_PUBLIC_URL)
    : undefined;
  await identity?.setup();
  const operations =
    identity && process.env.OPERATIONS_TOKEN_SECRET
      ? new Operations(databases.postgres, process.env.OPERATIONS_TOKEN_SECRET)
      : undefined;
  await operations?.setup();
  let access: WorldAccess | undefined;
  if (llmApiKey() && operations) {
    await databases.queue.start();
    const model = new LlmClient(databases.postgres);
    access = new WorldAccess(
      new WorldConstruction(
        new WorldBuilder(
          databases.postgres,
          databases.graph,
          databases.checkpointer,
          model,
        ),
        new WorldAgent(
          databases.postgres,
          databases.graph,
          databases.checkpointer,
          model,
        ),
        databases.queue,
      ),
    );
    await access.setup();
  }
  app = await createApp(
    access,
    identity,
    process.env.ORY_HYDRA_ADMIN_URL,
    operations,
  );
  await app.listen({
    host: "127.0.0.1",
    port: Number(process.env.PORT ?? 3000),
  });
  console.log("API ready");
} catch (error) {
  await app?.close();
  await databases.queue.stop();
  await databases.close();
  throw error;
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void (async () => {
      await app?.close();
      await databases.queue.stop();
      await databases.close();
    })();
  });
}
