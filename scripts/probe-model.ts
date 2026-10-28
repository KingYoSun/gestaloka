import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { entrypoint, task } from "@langchain/langgraph";
import { z } from "zod";
import { connectDatabases, WorldBudget } from "@gestaloka/server";
import { BudgetUsd } from "@gestaloka/contracts";
import { LlmClient } from "@gestaloka/server/llm";
import { parseArgs } from "node:util";
import { WorldAgent } from "@gestaloka/server/agent";
import { WorldStore } from "@gestaloka/server/world";

const { values } = parseArgs({
  options: {
    target: { type: "string", default: "default" },
    budget: { type: "string" },
  },
});
const target = z.enum(["default", "resolution"]).parse(values.target);

const databases = connectDatabases();
try {
  await databases.verify();
  await databases.checkpointer.setup();
  const model = new LlmClient(databases.postgres);
  await model.ledger.setup();
  const identity = await model.verifyModel(target);
  if (target === "resolution") {
    const agent = new WorldAgent(
      databases.postgres,
      databases.graph,
      databases.checkpointer,
      model,
    );
    await agent.setup();
    const worldId = randomUUID(),
      actor = randomUUID(),
      store = new WorldStore(databases.graph);
    await WorldBudget.create(
      databases.postgres,
      worldId,
      BudgetUsd.parse(Number(values.budget)),
    );
    const lease = await store.claim(worldId, randomUUID());
    await store.commit(lease, store.context(worldId), {
      commitId: randomUUID(),
      at: 0,
      changes: {
        nodes: [{ id: actor, kind: "existence", text: "接続確認の対象" }],
        edges: [
          {
            id: randomUUID(),
            kind: "see",
            source: actor,
            target: actor,
            text: "自分がここに存在していることを知覚している",
            period: { from: 0 },
          },
        ],
        revisions: [],
        endEdges: [],
      },
    });
    const operationId = await agent.create({
      worldId,
      phase: "interaction",
      at: 0,
      rootIds: [actor],
      actionText: "",
      intentions: [
        {
          actorId: actor,
          actionText:
            "既に受容している自分の状況を確認する。変化がなければ新たな状態や出来事を追加せず、この確認を完了する。",
          continuing: false,
        },
      ],
    });
    const result = await agent.run(operationId);
    if (
      !(await store.receipt(
        worldId,
        (
          await databases.postgres.query(
            "SELECT commit_id FROM world_operation WHERE id=$1",
            [operationId],
          )
        ).rows[0].commit_id,
      ))
    )
      throw new Error("世界への確定を確認できません");
    console.log(
      JSON.stringify(
        {
          ...identity,
          target,
          worldId,
          operationId,
          summary: result.summary,
          budget: await model.ledger.summary(),
        },
        null,
        2,
      ),
    );
  } else {
    const prompt = await readFile(
      new URL("../prompts/connection-probe.md", import.meta.url),
      "utf8",
    );
    const invoke = task("model-connection-probe", async (id: string) =>
      model.complete(
        id,
        "connection-probe",
        [{ role: "user", content: prompt }],
        target,
      ),
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
  }
} finally {
  await databases.close();
}
