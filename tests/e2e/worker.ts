import { fixtureRuntime } from "../support/provider.js";
import { WorldScenes } from "@gestaloka/server/scene";
import { WorldPlayers } from "@gestaloka/server/players";
const { databases, runtime } = await fixtureRuntime();
await runtime.work();
const scenes = new WorldScenes(runtime);
await scenes.setup();
await scenes.work();
const players = new WorldPlayers(runtime);
await players.setup();
await players.work();
console.log("E2E worker ready");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void (async () => {
      await databases.queue.stop();
      await databases.close();
    })();
  });
