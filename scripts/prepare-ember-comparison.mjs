import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

// Preparation only. Never connects to a database or sends a model request.
const root = new URL("../", import.meta.url);
const sourcePath =
  "documents/evaluations/adr042-unified-scenes-2026-11-17.json";
const bytes = await readFile(new URL(sourcePath, root));
const source = JSON.parse(bytes);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fixturePath = "documents/evaluations/adr042-ember-fixtures.json.gz";
const fixtureBytes = gunzipSync(await readFile(new URL(fixturePath, root)));
const recovered = JSON.parse(fixtureBytes);
const legacy = source.legacyReplay;
const harbor = source.cases.find((c) => c.label === "harbor");
const warehouse = harbor.commands.find((c) => c.actionText?.includes("素手"));
if (!warehouse || !legacy.replyInput?.text)
  throw new Error("保存資料の対象入力が見つかりません");
const flash = {
  provider: "gemini",
  model: "gemini-3.8-flash",
  api: "chat-completions",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  effort: "low",
  initialEffort: "low",
  contextTokens: 1048576,
  maxOutputTokens: 65536,
  inputUsdPerMillion: 0.75,
  cachedInputUsdPerMillion: 0.075,
  outputUsdPerMillion: 3.75,
  cacheStorageUsdPerMillionTokenHour: 0.5,
  pricingDate: "2026-10-29",
};
// Complete settings, not a Flash object with only its model ID replaced.
const ember = {
  provider: "openrouter",
  model: "meta/muse-ember",
  api: "chat-completions",
  baseUrl: "https://openrouter.ai/api/v1",
  effort: "low",
  initialEffort: "low",
  contextTokens: 1048576,
  maxOutputTokens: 65536,
  inputUsdPerMillion: 0.1,
  cachedInputUsdPerMillion: 0.004,
  outputUsdPerMillion: 0.5,
  pricingDate: "2026-11-17",
};
const promptNames = [
  "scene-background.md",
  "scene-participation.md",
  "scene-play.md",
  "actor-intent.md",
  "scene-result.md",
  "presentation-information.md",
  "world-update.md",
  "world-commit.md",
  "scene-world.md",
  "skills/belongings.md",
];
const prompts = Object.fromEntries(
  await Promise.all(
    promptNames.map(async (name) => [
      name,
      sha256(await readFile(new URL(`prompts/${name}`, root))),
    ]),
  ),
);
const scenarios = [
  {
    id: "johnny-michiko",
    sourceScene: legacy.sourceScene,
    sourceWorld: legacy.world,
    checkpoint: "legacyReplay.checkpoints[label=restored-input]",
    input: legacy.checkpoints[0].actions[0].text,
    sourceInputId: legacy.checkpoints[0].actions[0].id,
    sourceEventId: legacy.checkpoints[0].events[0].id,
    receiverInput: legacy.replyInput,
    externalPlayers: legacy.checkpoints[0].list.players,
    trace: [
      "元の質問",
      "ミチコへの受容",
      "本人入力前の全提示・行動・所在地",
      "固定した本人入力",
      "返答とジョニーへの受容",
      "本人への全提示",
    ],
  },
  {
    id: "welded-warehouse",
    sourceScene: harbor.scenes.at(-1).id,
    sourceWorld: harbor.world,
    checkpoint: "cases[label=harbor].checkpoints[label=second-opening]",
    input: warehouse.actionText,
    sourceInputId: warehouse.requestId,
    declaredContext: harbor.declaredContext,
    externalPlayers: {
      actor: harbor.actors.external,
      fixedInput: harbor.externalChoice.choice.actionText,
    },
    trace: [
      "溶接条件と開扉入力",
      "不成立の提示",
      "ネルへの受容",
      "ネルの意図と実行",
      "本人への日本語提示",
      "新しく判断できることとその重要度",
    ],
  },
].map((scenario) => ({ ...scenario, inputSha256: sha256(scenario.input) }));
const configurations = {
  flash: { default: flash, resolution: flash, judgment: "separate" },
  ember: { default: ember, resolution: flash, judgment: "separate" },
};
const plan = {
  version: "ember-flash-preparation-v1",
  status: "prepared-not-executed",
  source: {
    path: sourcePath,
    sha256: sha256(bytes),
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
  },
  fixture: {
    path: fixturePath,
    sha256: sha256(fixtureBytes),
    sources: recovered.sources,
    receiptCounts: recovered.scenarios.map(
      (scenario) => scenario.receipts.length,
    ),
  },
  trialsPerModelPerScene: 1,
  budgetUsd: 10,
  budgetUsdPerTrial: 2.5,
  configurations,
  prompts,
  scenarios,
  prerequisites: [
    "OPENROUTER_API_KEYとGEMINI_API_KEYを実行環境に用意する",
    "replay-ember-scenes.mjsの復元確認を実行する（別スキーマ・新規世界IDを自動使用）",
  ],
  trials: scenarios.flatMap(({ id, inputSha256 }) =>
    Object.keys(configurations).map((group) => ({
      scene: id,
      group,
      inputSha256,
      status: "not-run",
      presentations: null,
      lowerCalls: null,
      repairs: null,
      retries: null,
      inputToPresentationMs: null,
      lowerCostUsd: null,
      totalCostUsd: null,
      usage: null,
    })),
  ),
};
const out = resolve(
  process.argv[2] ?? "artifacts/evaluations/ember-flash-scenes-2026-11-17",
);
await mkdir(out, { recursive: true });
await writeFile(
  resolve(out, "plan.json"),
  JSON.stringify(plan, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    plan: resolve(out, "plan.json"),
    status: plan.status,
    trials: plan.trials.length,
    budgetUsd: plan.budgetUsd,
  }),
);
