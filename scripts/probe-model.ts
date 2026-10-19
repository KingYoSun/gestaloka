import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { entrypoint, task } from "@langchain/langgraph";
import { z } from "zod";
import { connectDatabases } from "@gestaloka/server";
import { DeepSeekClient } from "@gestaloka/server/llm";

const databases = connectDatabases();
try {
  await databases.verify();
  await databases.checkpointer.setup();
  const model = new DeepSeekClient(databases.postgres);
  await model.ledger.setup();
  const identity = await model.verifyModel();
  const prompt = await readFile(
    new URL("../prompts/connection-probe.md", import.meta.url),
    "utf8",
  );
  const invoke = task("model-connection-probe", async (id: string) =>
    model.complete(id, "connection-probe", [{ role: "user", content: prompt }]),
  );
  const probe = entrypoint(
    { name: "model-connection-probe", checkpointer: databases.checkpointer },
    async (id: string) => invoke(id),
  );
  const runId = randomUUID();
  const response = await probe.invoke(runId, {
    configurable: { thread_id: runId },
  });
  if (response.finishReason !== "stop")
    throw new Error("モデルの応答が完了していません");
  z.object({ connected: z.literal(true) })
    .strict()
    .parse(JSON.parse(response.content));
  console.log(
    JSON.stringify(
      {
        ...identity,
        reportedModel: response.model,
        runId,
        usage: response.usage,
        budget: await model.ledger.summary(),
      },
      null,
      2,
    ),
  );
} finally {
  await databases.close();
}
