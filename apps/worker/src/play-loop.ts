import { createServer, type Socket } from "node:net";
import { once } from "node:events";
import { unlink } from "node:fs/promises";
import type { BotPlay } from "@gestaloka/server/play";
import { workerSocket } from "./deployment.js";

// The deployer holds its connection until Compose finishes. Disconnecting before
// readiness cancels the drain without cancelling the outstanding model request.
export async function startPlayLoop(
  play: Pick<BotPlay, "expire" | "tickNpcs">,
  path = workerSocket(process.pid),
) {
  const holds = new Set<Socket>();
  let stopping = false;
  let active: Promise<void> | undefined;
  const paused = () => stopping || holds.size > 0;
  const server = createServer((socket) => {
    holds.add(socket);
    socket.on("error", () => socket.destroy());
    socket.on("close", () => holds.delete(socket));
    socket.resume();
    void Promise.resolve(active).then(
      () => {
        if (!socket.destroyed) socket.write("ready\n");
      },
      () => socket.destroy(),
    );
  });
  if (process.platform !== "win32")
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  server.listen(path);
  await once(server, "listening");
  const timer = setInterval(() => {
    if (paused() || active) return;
    active = play.expire().then(() => play.tickNpcs(undefined, paused));
    void active.catch(console.error).finally(() => {
      active = undefined;
    });
  }, 1000);
  timer.unref();
  return async () => {
    stopping = true;
    clearInterval(timer);
    server.close();
    await active?.catch(() => {});
    for (const socket of holds) socket.destroy();
  };
}
