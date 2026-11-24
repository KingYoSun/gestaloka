import { connectDatabases } from "@gestaloka/server";
import { fixtureRuntime } from "../support/provider.js";
import { BotPlay } from "@gestaloka/server/play";
import { WorldScenes } from "@gestaloka/server/scene";
import { WorldPlayers } from "@gestaloka/server/players";
import cleanupDatabase from "./teardown.js";

export default async function setupWorker() {
  const databases = connectDatabases();
  async function stopAndClean() {
    try {
      await databases.queue.stop();
    } finally {
      await databases.close();
    }
    await cleanupDatabase();
  }
  try {
    const { runtime } = await fixtureRuntime(undefined, undefined, databases);
    const scenes = new WorldScenes(runtime);
    const play = new BotPlay(runtime);
    const players = new WorldPlayers(runtime);
    await scenes.setup();
    await play.setup();
    await players.setup();
    await runtime.work();
    await players.work();

    let tick: Promise<unknown> | undefined;
    const timer = setInterval(() => {
      tick ??= Promise.all([
        play.expire().catch(console.error),
        play.deliverArrivals().catch(console.error),
      ]).finally(() => {
        tick = undefined;
      });
    }, 1000);
    timer.unref();

    // Playwrightはこの関数の完了を待つ。検証用DBはワーカーを止めてから片付ける。
    return async () => {
      clearInterval(timer);
      await Promise.all([
        tick,
        databases.queue.offWork(runtime.queueName),
        databases.queue.offWork(players.queueName),
      ]);
      await stopAndClean();
    };
  } catch (error) {
    await stopAndClean();
    throw error;
  }
}
