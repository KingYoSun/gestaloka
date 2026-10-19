import { connectDatabases } from "@gestaloka/server";

const databases = connectDatabases();
databases.queue.on("error", (error) => console.error(error));
try {
  await databases.verify();
  await databases.checkpointer.setup();
  await databases.queue.start();
  console.log("Worker infrastructure ready");
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
