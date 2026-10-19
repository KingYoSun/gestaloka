import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { connectDatabases } from "@gestaloka/server";
import { DeepSeekClient } from "@gestaloka/server/llm";
import { WorldAgent } from "@gestaloka/server/agent";

const { values } = parseArgs({
  options: {
    build: { type: "string" },
    resume: { type: "string" },
    actor: { type: "string" },
    action: { type: "string" },
    phase: { type: "string", default: "interaction" },
    at: { type: "string", default: "0" },
    until: { type: "string", default: "0" },
  },
});
if (!values.build && !values.resume)
  throw new Error(
    "--build <buildRunId> または --resume <operationId> を指定してください",
  );
const databases = connectDatabases();
try {
  await databases.verify();
  const model = new DeepSeekClient(databases.postgres, {
    ...process.env,
    LLM_MAX_OUTPUT_TOKENS: process.env.LLM_MAX_OUTPUT_TOKENS ?? "65536",
  });
  const agent = new WorldAgent(
    databases.postgres,
    databases.graph,
    databases.checkpointer,
    model,
  );
  await agent.setup();
  let operationId = values.resume;
  if (!operationId) {
    const row = await databases.postgres.query<{
      world_id: string;
      result: { playerId: string; rootIds: string[] } | null;
    }>("SELECT world_id,result FROM world_build WHERE run_id=$1", [
      values.build,
    ]);
    const build = row.rows[0];
    if (!build?.result)
      throw new Error("T0が成立した構築セッションを指定してください");
    const phase = z
      .enum(["interaction", "schedule", "participant"])
      .parse(values.phase);
    const at = z.coerce.number().int().nonnegative().parse(values.at),
      until = z.coerce.number().int().min(at).parse(values.until);
    const actorId =
      phase === "interaction"
        ? (values.actor ?? build.result.playerId)
        : undefined;
    const actionText = values.action
      ? await readFile(values.action, "utf8")
      : actorId
        ? await agent.intent(build.world_id, actorId, at, randomUUID())
        : undefined;
    if (actionText === undefined)
      throw new Error("管理操作には --action <file> を指定してください");
    operationId = await agent.create({
      worldId: build.world_id,
      phase,
      at,
      until,
      rootIds: build.result.rootIds,
      actionText,
      ...(actorId ? { actorId } : {}),
    });
    console.log(JSON.stringify({ operationId, actionText }));
  }
  const result = await agent.run(operationId);
  const row = await databases.postgres.query<{
    request: { worldId: string; actorId?: string };
  }>("SELECT request FROM world_operation WHERE id=$1", [operationId]);
  const request = row.rows[0]!.request,
    observer = result.newParticipantId ?? request.actorId;
  const view = observer
    ? await agent.view(request.worldId, observer, result.resolvedUntil)
    : null;
  const report = {
    operationId,
    result,
    view,
    budget: await model.ledger.summary(),
  };
  const directory = new URL("../artifacts/world-operations/", import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(
    new URL(`${operationId}.json`, directory),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        operationId,
        summary: result.summary,
        resolvedUntil: result.resolvedUntil,
        wakeups: result.wakeups,
        continuation: result.continuation,
        newParticipantId: result.newParticipantId,
        view,
        budget: report.budget,
      },
      null,
      2,
    ),
  );
} finally {
  await databases.close();
}
