import {
  RuntimeMonitor,
  InspectionWorker,
  connectDatabases,
} from "@gestaloka/server";
import { LlmClient } from "@gestaloka/server/llm";
import { WorldBuilder } from "@gestaloka/server/build";
import { WorldAgent } from "@gestaloka/server/agent";
import { WorldConstruction } from "@gestaloka/server/construction";
import { BotPlay } from "@gestaloka/server/play";
import { WorldScenes } from "@gestaloka/server/scene";
import { WorldPlayers } from "@gestaloka/server/players";

const databases = connectDatabases();
databases.queue.on("error", (error) => console.error(error));
let monitor: RuntimeMonitor | undefined;
try {
  await databases.verify();
  await databases.checkpointer.setup();
  await databases.queue.start();
  const model = await LlmClient.create(databases.postgres, {
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
  const scenes = new WorldScenes(construction);
  await scenes.setup();
  await construction.work();
  const play = new BotPlay(construction);
  await play.setup();
  let playing = false;
  const tickPlay = async () => {
    if (playing) return;
    playing = true;
    try {
      await play.expire();
      await play.tickNpcs();
    } finally {
      playing = false;
    }
  };
  const playTimer = setInterval(() => {
    void tickPlay().catch(console.error);
  }, 1000);
  playTimer.unref();
  const players = new WorldPlayers(construction);
  await players.setup();
  await players.work();
  await new InspectionWorker(
    databases.postgres,
    databases.queue,
    process.env.OPERATIONS_TOKEN_SECRET!,
  ).work();
  await RuntimeMonitor.setup(databases.postgres);
  monitor = new RuntimeMonitor(
    databases.postgres,
    databases.graph,
    process.env.OPERATIONS_TOKEN_SECRET!,
  );
  monitor.start();
  console.log("World construction worker ready");
} catch (error) {
  await databases.queue.stop();
  await databases.close();
  throw error;
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void Promise.all([databases.queue.stop(), monitor?.stop()]).then(() =>
      databases.close(),
    );
  });
}
