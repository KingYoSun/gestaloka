import { fixtureRuntime } from "../support/provider.js";
const { databases, runtime } = await fixtureRuntime();
await runtime.work();
console.log("E2E worker ready");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void (async () => {
      await databases.queue.stop();
      await databases.close();
    })();
  });
