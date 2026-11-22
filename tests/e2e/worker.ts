import { fixtureRuntime } from "../support/provider.js";
import { BotPlay } from "@gestaloka/server/play";
import { WorldScenes } from "@gestaloka/server/scene";
import { WorldPlayers } from "@gestaloka/server/players";
const { databases, runtime } = await fixtureRuntime();
await runtime.work();
const scenes = new WorldScenes(runtime);
await scenes.setup();
const play = new BotPlay(runtime);
await play.setup();
const timer = setInterval(() => {
  void play.expire().catch(console.error);
  void play.deliverArrivals().catch(console.error);
}, 1000);
timer.unref();
const players = new WorldPlayers(runtime);
await players.setup();
await players.work();
console.log("E2E worker ready");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void (async () => {
      clearInterval(timer);
      await databases.queue.stop();
      await databases.close();
    })();
  });
