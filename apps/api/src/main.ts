import { connectDatabases } from "@gestaloka/server";
import { createApp } from "./app.js";
import { DeepSeekClient } from "@gestaloka/server/llm";
import { WorldAgent } from "@gestaloka/server/agent";
import { WorldBuilder } from "@gestaloka/server/build";
import { WorldConstruction } from "@gestaloka/server/construction";
import { WorldAccess } from "@gestaloka/server/access";

const databases = connectDatabases();
let app: Awaited<ReturnType<typeof createApp>> | undefined;
databases.queue.on("error", (error) => console.error(error));
try {
  await databases.verify();
  let access: WorldAccess | undefined;
  if (process.env.DEEPSEEK_API_KEY) {
    await databases.queue.start();
    const model = new DeepSeekClient(databases.postgres);
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
  app = await createApp(access);
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
