import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { connectDatabases } from "@gestaloka/server";
import { DeepSeekClient, type ChatMessage } from "@gestaloka/server/llm";
import { Change } from "@gestaloka/server/world";

const { values } = parseArgs({
  options: {
    operation: { type: "string" },
    effort: { type: "string", default: "low" },
  },
});
const id = z.uuid().parse(values.operation),
  effort = z.enum(["none", "low", "high", "max"]).parse(values.effort);
const databases = connectDatabases();
try {
  const row = (
    await databases.postgres.query<{ messages: ChatMessage[]; state: string }>(
      "SELECT messages,state FROM world_operation WHERE id=$1",
      [id],
    )
  ).rows[0];
  if (row?.state !== "complete" || row.messages.at(-1)?.role !== "assistant")
    throw new Error("完了した世界更新のIDを指定してください");
  const messages = row.messages.slice(0, -1);
  const source = (
    await databases.postgres.query<{
      id: string;
      request: { request: { max_tokens: number } };
      elapsed_ms: number;
      response: { content: string };
    }>(
      "SELECT id,request,elapsed_ms,response FROM llm_call WHERE request#>'{request,messages}'=$1::jsonb AND request->>'role'='world-update' AND state='complete' ORDER BY created_at DESC LIMIT 1",
      [JSON.stringify(messages)],
    )
  ).rows[0];
  if (!source) throw new Error("保存済み呼出しを確認できません");
  const model = new DeepSeekClient(databases.postgres, {
    ...process.env,
    LLM_REASONING_EFFORT: effort,
    LLM_MAX_OUTPUT_TOKENS: String(source.request.request.max_tokens),
  });
  await model.ledger.setup();
  const callId = randomUUID();
  console.log(
    JSON.stringify({
      sourceOperation: id,
      sourceCall: source.id,
      callId,
      effort,
    }),
  );
  const started = performance.now();
  const result = await model.complete(
    callId,
    `reasoning-comparison-${effort}`,
    messages,
  );
  const response: unknown = JSON.parse(result.content);
  const envelope = z.object({ type: z.string() }).passthrough().parse(response);
  const validation =
    envelope.type === "propose"
      ? Change.safeParse(envelope.changes).success
      : null;
  const report = {
    sourceOperation: id,
    sourceCall: source.id,
    callId,
    effort,
    elapsedMs: Math.round(performance.now() - started),
    sourceElapsedMs: source.elapsed_ms,
    finishReason: result.finishReason,
    changeStructureValid: validation,
    usage: result.usage,
    response,
    budget: await model.ledger.summary(),
  };
  const directory = new URL("../artifacts/evaluations/", import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(
    new URL(`reasoning-${callId}.json`, directory),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        callId,
        effort,
        elapsedMs: report.elapsedMs,
        sourceElapsedMs: report.sourceElapsedMs,
        finishReason: report.finishReason,
        responseType: envelope.type,
        changeStructureValid: validation,
        usage: report.usage,
        budget: report.budget,
      },
      null,
      2,
    ),
  );
} finally {
  await databases.close();
}
