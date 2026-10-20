import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { ConstructionDuration, WORLD_DAY_MS } from "@gestaloka/contracts";
import { connectDatabases } from "@gestaloka/server";
import { LlmClient } from "@gestaloka/server/llm";
import { WorldBuilder } from "@gestaloka/server/build";
import { WorldAgent } from "@gestaloka/server/agent";
import { WorldConstruction } from "@gestaloka/server/construction";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    id: { type: "string" },
    prompt: { type: "string" },
    days: { type: "string" },
    action: { type: "string" },
  },
});
const command = z
  .enum(["create", "show", "advance", "resume", "finish", "act"])
  .parse(positionals[0]);
const duration =
  command === "advance"
    ? ConstructionDuration.parse(Number(values.days) * WORLD_DAY_MS)
    : undefined;
const databases = connectDatabases();
databases.queue.on("error", (error) => console.error(error));
try {
  await databases.verify();
  await databases.queue.start();
  const model = new LlmClient(databases.postgres);
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
    if (command === "act") {
      if (!values.action) throw new Error("--action <file> を指定してください");
      await construction.play(id, await readFile(values.action, "utf8"));
    } else if (command !== "show")
      await construction.command(id, command, duration);
    console.log(JSON.stringify(await construction.report(id), null, 2));
  }
} finally {
  await databases.queue.stop();
  await databases.close();
}
