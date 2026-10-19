import { connectDatabases } from "@gestaloka/server";
import { createApp } from "./app.js";

const databases = connectDatabases();
const app = await createApp();
try {
  await databases.verify();
  await app.listen({
    host: "127.0.0.1",
    port: Number(process.env.PORT ?? 3000),
  });
  console.log("API ready");
} catch (error) {
  await Promise.all([app.close(), databases.close()]);
  throw error;
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void Promise.all([app.close(), databases.close()]);
  });
}
