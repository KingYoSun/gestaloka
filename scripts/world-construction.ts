import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { connectDatabases } from "@gestaloka/server";
import { DeepSeekClient } from "@gestaloka/server/llm";
import { WorldBuilder } from "@gestaloka/server/build";
import { WorldAgent } from "@gestaloka/server/agent";
import { WorldConstruction } from "@gestaloka/server/construction";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    id: { type: "string" },
    prompt: { type: "string" },
    duration: { type: "string" },
  },
});
const command = z
  .enum(["create", "show", "advance", "resume", "finish", "join"])
  .parse(positionals[0]);
const databases = connectDatabases();
databases.queue.on("error", (error) => console.error(error));
try {
  await databases.verify();
  await databases.queue.start();
  const model = new DeepSeekClient(databases.postgres);
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
  if (command === "create") {
    if (!values.prompt) throw new Error("--prompt <file> を指定してください");
    console.log(
      JSON.stringify({
        id: await construction.create(await readFile(values.prompt, "utf8")),
      }),
    );
  } else {
    const id = z.uuid().parse(values.id);
    if (command !== "show")
      await construction.command(
        id,
        command,
        values.duration === undefined ? undefined : Number(values.duration),
      );
    console.log(JSON.stringify(await construction.report(id), null, 2));
  }
} finally {
  await databases.queue.stop();
  await databases.close();
}
