import { connectDatabases } from "@gestaloka/server";
import { LlmClient } from "@gestaloka/server/llm";
import { WorldBuilder } from "@gestaloka/server/build";
import { WorldAgent } from "@gestaloka/server/agent";
import { WorldConstruction } from "@gestaloka/server/construction";

const databases = connectDatabases();
databases.queue.on("error", (error) => console.error(error));
try {
  await databases.verify();
  await databases.checkpointer.setup();
  await databases.queue.start();
  const model = new LlmClient(databases.postgres, {
    ...process.env,
    LLM_MAX_OUTPUT_TOKENS: process.env.LLM_MAX_OUTPUT_TOKENS ?? "65536",
  });
  const construction = new WorldConstruction(
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
  );
  await construction.setup();
  await construction.work();
  console.log("World construction worker ready");
} catch (error) {
  await databases.queue.stop();
  await databases.close();
  throw error;
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void databases.queue.stop().then(() => databases.close());
  });
}
