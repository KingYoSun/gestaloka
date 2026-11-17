import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { connectDatabases } from "@gestaloka/server";
import { calculatedCharge } from "../packages/server/dist/llm/client.js";

const directory = new URL(
  "../artifacts/evaluations/ember-flash-scenes-2026-11-17/",
  import.meta.url,
);
const bytes = await readFile(new URL("execution.json", directory));
const execution = JSON.parse(bytes);
assert.notEqual(execution.status, "running");
// The current run also archives final rows at schema cleanup, including paused scenes.
process.env.DATABASE_URL =
  "postgresql://gestaloka:evaluation-only@127.0.0.1:25434/gestaloka";
process.env.NEO4J_PASSWORD = "evaluation-only";
const archivePath = new URL(
  "ember-flash-scenes-2026-11-17-evidence.json.gz",
  directory,
);
let finalScenes = execution.trials.flatMap((trial) => trial.finalScenes ?? []);
if (!finalScenes.length) {
  const archivedBytes = await readFile(archivePath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  const archived = archivedBytes && JSON.parse(gunzipSync(archivedBytes));
  if (
    archived?.execution.startedAt === execution.startedAt &&
    archived?.execution.finishedAt === execution.finishedAt
  )
    finalScenes = archived.finalScenes;
  else {
    const database = connectDatabases();
    try {
      finalScenes = (
        await database.postgres.query(
          "SELECT row_data FROM public.ember_final_scene ORDER BY schema_name,scene_id",
        )
      ).rows.map((row) => row.row_data);
    } finally {
      await database.close();
    }
  }
}
const lowerRoles = new Set([
  "scene-background",
  "scene-resolve",
  "scene-result",
]);
const summaries = execution.trials.map((trial) => {
  const generation = trial.calls.filter(
    (call) => call.request.role !== "prompt-cache",
  );
  const upperRepair = (call) => {
    const messages =
      call.request.sourceMessages ?? call.request.request.messages ?? [];
    const last =
      messages.findLast((message) => message.role === "user")?.content ?? "";
    return (
      last.includes("意味の評価や改善は行わず") ||
      last.includes("未表示の原応答を元の入力")
    );
  };
  const lower = (call) =>
    lowerRoles.has(call.request.role) &&
    call.request.connection.provider === trial.configuration.default.provider &&
    !upperRepair(call);
  const owner = (call) =>
    call.request.role === "prompt-cache"
      ? generation.find((next) => next.created_at >= call.created_at)
      : call;
  const lowerCalls = generation.filter(lower);
  const settled = trial.calls.filter((call) => call.charged_nano !== null);
  const unsettled = trial.calls.filter((call) => call.state !== "complete");
  const repairCalls = generation.filter((call) => {
    const messages =
      call.request.sourceMessages ?? call.request.request.messages ?? [];
    const last =
      messages.findLast((message) => message.role === "user")?.content ?? "";
    return (
      last.includes('"validationErrors"') ||
      last.includes("直前の未表示の応答は形式が不正") ||
      upperRepair(call)
    );
  });
  const cost = (calls) =>
    calls.reduce((sum, call) => sum + Number(call.charged_nano ?? 0), 0) / 1e9;
  const chargeMismatches = settled.filter(
    (call) =>
      call.response?.usage &&
      call.request.role !== "prompt-cache" &&
      calculatedCharge(call.response.usage, call.request.connection) !==
        Number(call.charged_nano),
  );
  assert.equal(
    chargeMismatches.length,
    0,
    "Usage-based charge differs from ledger",
  );
  const knownCost = cost(settled),
    reserved =
      unsettled.reduce((sum, call) => sum + Number(call.reserved_nano), 0) /
      1e9;
  assert(knownCost + reserved <= 2.5, "Trial exceeds frozen budget");
  const usage = {};
  for (const call of generation) {
    const name = `${lower(call) ? "lower" : "upper"}:${call.request.connection.provider}:${call.request.request.model}`;
    const totals = (usage[name] ??= {
      calls: 0,
      normalInput: 0,
      cachedInput: 0,
      output: 0,
      reasoning: 0,
      reportedReasoningSubtotal: 0,
      rawCacheMissing: 0,
      rawReasoningMissing: 0,
      ratesUsdPerMillion: {
        normal: call.request.connection.inputMiss / 1000,
        cached: call.request.connection.inputHit / 1000,
        output: call.request.connection.output / 1000,
      },
    });
    totals.calls++;
    const value = call.response?.usage;
    if (!value) continue;
    totals.normalInput += value.prompt_cache_miss_tokens;
    totals.cachedInput += value.prompt_cache_hit_tokens;
    totals.output += value.completion_tokens;
    totals.reasoning += value.reasoning_tokens ?? 0;
    totals.reportedReasoningSubtotal += value.reasoning_tokens ?? 0;
    const raw = trial.wire.find(
      (entry) => entry.id === call.response.id,
    )?.usage;
    if (
      raw?.prompt_tokens_details?.cached_tokens === undefined &&
      raw?.prompt_cache_hit_tokens === undefined
    )
      totals.rawCacheMissing++;
    if (raw?.completion_tokens_details?.reasoning_tokens === undefined)
      totals.rawReasoningMissing++;
  }
  for (const totals of Object.values(usage))
    if (totals.rawReasoningMissing) totals.reasoning = null;
  return {
    scene: trial.scene,
    group: trial.group,
    status: trial.status,
    error: trial.error ?? null,
    lowerCalls: lowerCalls.length,
    upperCalls: generation.length - lowerCalls.length,
    cacheCalls: trial.calls.length - generation.length,
    cacheCharges: settled
      .filter((call) => call.request.role === "prompt-cache")
      .map((call) => ({
        id: call.id,
        ownerCall: owner(call)?.id,
        tier: lower(owner(call)) ? "lower" : "upper",
        chargedNano: call.charged_nano,
        tokenSeconds: call.response?.usage?.cache_storage_token_seconds,
        usdPerMillionTokenHour:
          (call.request.connection.cacheStorage * 3600) / 1000,
      })),
    repairs: repairCalls.map((call) => ({
      id: call.id,
      role: call.request.role,
      model: call.request.request.model,
    })),
    non200Requests: trial.wire
      .filter((entry) => entry.status !== 200)
      .map((entry) => ({ status: entry.status, model: entry.model })),
    lowerCostUsd: cost(
      settled.filter((call) => owner(call) && lower(owner(call))),
    ),
    settledTotalCostUsd: knownCost,
    unsettledReservedUsd: reserved,
    totalCostUsd: unsettled.length ? null : knownCost,
    openrouterReturnedCostUsd: trial.wire.some(
      (entry) => typeof entry.usage?.cost === "number",
    )
      ? trial.wire
          .filter(
            (entry) =>
              entry.model === "meta/muse-ember" &&
              typeof entry.usage?.cost === "number",
          )
          .reduce((sum, entry) => sum + entry.usage.cost, 0)
      : null,
    timings: trial.timings,
    usage,
  };
});
assert(
  summaries.reduce(
    (sum, trial) =>
      sum + trial.settledTotalCostUsd + trial.unsettledReservedUsd,
    0,
  ) <= 10,
);
const evidence = { execution, finalScenes };
const output = new URL(
  "ember-flash-scenes-2026-11-17-evidence.json.gz",
  directory,
);
const evidenceBytes = Buffer.from(JSON.stringify(evidence));
await writeFile(output, gzipSync(evidenceBytes));
const report = {
  executionSha256: createHash("sha256").update(bytes).digest("hex"),
  evidenceSha256: createHash("sha256").update(evidenceBytes).digest("hex"),
  summaries,
};
await writeFile(
  new URL("measurements.json", directory),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
