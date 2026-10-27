import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  inspectionClient,
  inspectionReport,
  compareInspections,
  readableInspection,
} from "./inspection-client.js";

const { values } = parseArgs({
  options: {
    world: { type: "string" },
    user: { type: "string" },
    actor: { type: "string" },
    end: { type: "string" },
    n: { type: "string" },
    manifest: { type: "string" },
    compare: { type: "string" },
    output: { type: "string", default: "artifacts/inspection" },
    semantic: { type: "boolean", default: false },
    configuration: { type: "string" },
    target: { type: "string", default: "resolution" },
    budget: { type: "string" },
    "wait-seconds": { type: "string", default: "900" },
  },
});
try {
  const client = inspectionClient(),
    worldId = values.world;
  if (!worldId) throw new Error("--worldを指定してください");
  let manifestId = values.manifest;
  if (!manifestId) {
    if (!values.actor || !values.end || !values.n)
      throw new Error("--manifest、または--actor --end --nを指定してください");
    const selected = await client({
      operation: "inspection.select",
      selection: {
        worldId,
        userId: values.user ?? null,
        actorId: values.actor,
        endSceneId: values.end,
        n: Number(values.n),
      },
    });
    manifestId = (selected.manifest as { id: string }).id;
  }
  const report = await inspectionReport(client, worldId, manifestId);
  let semantic: Record<string, unknown> | undefined;
  if (values.semantic) {
    if (!values.configuration || !values.budget)
      throw new Error(
        "意味評価には--configurationと--budgetを明示してください",
      );
    if (values.target !== "default" && values.target !== "resolution")
      throw new Error("--targetはdefaultまたはresolutionです");
    const started = await client({
      operation: "inspection.evaluate",
      worldId,
      manifestId,
      configuration: {
        configurationVersion: Number(values.configuration),
        target: values.target,
        budgetUsd: Number(values.budget),
      },
    });
    const end = Date.now() + Number(values["wait-seconds"]) * 1000;
    do {
      semantic = await client({
        operation: "inspection.evaluation",
        worldId,
        id: String(started.id),
      });
      if (!["queued", "running"].includes(String(semantic.status))) break;
      await new Promise((done) => setTimeout(done, 1000));
    } while (Date.now() < end);
    if (semantic?.status !== "complete") report.status = "partial";
  }
  const comparisonReport = values.compare
    ? await inspectionReport(client, worldId, values.compare)
    : undefined;
  const semanticResult = semantic?.result as
    Record<string, unknown> | undefined;
  const comparison = comparisonReport
    ? compareInspections(report, comparisonReport, {
        left: semantic
          ? {
              configuration: semantic.configuration,
              model: semanticResult?.model,
              skill: semanticResult?.skill,
            }
          : null,
        right: null,
      })
    : undefined;
  const directory = resolve(values.output);
  await mkdir(directory, { recursive: true });
  const result = { ...report, semantic, comparison, comparisonReport };
  await writeFile(
    resolve(directory, `${manifestId}.json`),
    JSON.stringify(result, null, 2) + "\n",
  );
  await writeFile(
    resolve(directory, `${manifestId}.md`),
    readableInspection(report, semantic) +
      (comparisonReport ? "\n" + readableInspection(comparisonReport) : "") +
      (comparison
        ? "\n## 比較\n\n```json\n" +
          JSON.stringify(comparison, null, 2) +
          "\n```\n"
        : ""),
  );
  console.log(
    JSON.stringify({
      status: semantic?.status === "failed" ? "failed" : report.status,
      manifestId,
      output: directory,
    }),
  );
  if (semantic?.status === "failed") process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify({
      status: "failed",
      reason: error instanceof Error ? error.message : "検品を実行できません",
    }),
  );
  process.exitCode = 1;
}
