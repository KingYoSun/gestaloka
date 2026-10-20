import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { connectDatabases } from "@gestaloka/server";
import { BudgetUsd } from "@gestaloka/contracts";
import { LlmClient } from "@gestaloka/server/llm";
import { WorldBuilder } from "@gestaloka/server/build";

const { values } = parseArgs({
  options: {
    prompt: { type: "string" },
    resume: { type: "string" },
    budget: { type: "string" },
  },
});
if (!values.prompt && !values.resume)
  throw new Error("--prompt <file> または --resume <runId> を指定してください");
const databases = connectDatabases();
try {
  await databases.verify();
  const model = new LlmClient(databases.postgres, {
    ...process.env,
    LLM_MAX_OUTPUT_TOKENS: process.env.LLM_MAX_OUTPUT_TOKENS ?? "65536",
  });
  await model.verifyModel("resolution");
  const builder = new WorldBuilder(
    databases.postgres,
    databases.graph,
    databases.checkpointer,
    model,
  );
  await builder.setup();
  const runId =
    values.resume ??
    (await builder.create(
      await readFile(values.prompt!, "utf8"),
      BudgetUsd.parse(Number(values.budget)),
    ));
  console.log(JSON.stringify({ runId }));
  const build = await builder.generate(runId);
  const budget = await model.ledger.summary();
  const report = {
    requestedModel: model.settingsFor("resolution").version,
    ...build,
    budget,
  };
  const directory = new URL("../artifacts/evaluations/", import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(
    new URL(`${runId}.json`, directory),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        runId,
        worldId: build.world_id,
        state: build.state,
        nodes: build.result?.changes.nodes.length,
        edges: build.result?.changes.edges.length,
        playerId: build.result?.playerId,
        report: build.result?.report,
        budget,
      },
      null,
      2,
    ),
  );
} finally {
  await databases.close();
}
