import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, expect, test, vi } from "vitest";
import {
  Operation,
  InspectionReadResult,
  SemanticAssessment,
} from "@gestaloka/contracts";
import { LlmClient } from "@gestaloka/server/llm";
import { InspectionStore } from "../../packages/server/src/inspection/store.js";
import { recordInitialPresentation } from "../../packages/server/src/inspection/record.js";
import { InspectionWorker } from "../../packages/server/src/inspection/worker.js";
import { runEvaluation } from "../../packages/server/src/inspection/evaluate.js";
import {
  measure,
  unitWeights,
} from "../../packages/server/src/inspection/measure.js";
import {
  inspectionClient,
  inspectionReport,
  compareInspections,
  readableInspection,
  parseMcpMessage,
} from "../../scripts/inspection-client.js";
import { fid, inspectionFixture } from "../fixtures/inspection.js";
import { fixtureAuth } from "../support/auth.js";
import { isolatedDatabases } from "../support/isolated-db.js";
import { modelEnvironment } from "../support/model.js";
import { createApp } from "../../apps/api/src/app.js";

const isolated = isolatedDatabases(),
  pool = isolated.databases.postgres,
  m = inspectionFixture();
let auth: Awaited<ReturnType<typeof fixtureAuth>>,
  admin: { id: string; cookie: string },
  user: { id: string; cookie: string };
let generationCalls = 0,
  evaluationCalls = 0;
const selection = { ...m.selection, userId: null };
const transport: typeof fetch = async (_url, options) => {
  evaluationCalls++;
  const body = JSON.parse(String(options?.body));
  const source = JSON.parse(
    body.messages.find((message: { role: string }) => message.role === "user")
      .content,
  ) as {
    task: string;
    context: {
      input?: { text: string };
      presentations?: {
        text: string;
        presentationId: number;
        currentResponse: boolean;
      }[];
      quotes?: { quoteIndex: number; presentationId: number; text: string }[];
    };
  };
  if (
    source.task === "input" &&
    source.context.input?.text === m.scenes[0]!.inputs[0]!.text
  )
    expect(
      source.context.presentations!.some((p) =>
        p.text.includes("扉は開いた。"),
      ),
    ).toBe(false);
  const item =
    source.task === "summary"
      ? {
          responsiveness: "fixture",
          stagnation: "fixture",
          principle: "unknown",
          explanation: "CIでは実モデルの意味判断を代替しない",
        }
      : source.task === "input"
        ? {
            units: [],
            responsiveness: "unknown",
            principle: "unknown",
            principleEvidence: [],
            disagreements: [],
          }
        : { units: [], disagreements: [] };
  if (source.task === "input") {
    const current = source.context.presentations!.find(
      (p) => p.currentResponse,
    )!;
    const quote = source.context.quotes!.find(
      (q) => q.presentationId === current.presentationId,
    )!;
    Object.assign(item, {
      units: [
        {
          text: "入力の復唱",
          category: "duplicate",
          importance: 0,
          evidence: { current: { quoteIndex: quote.quoteIndex }, context: [] },
          explanation: "検証用の復唱",
        },
      ],
    });
  }
  return Response.json({
    id: randomUUID(),
    model: "fixture-model",
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify(item),
        },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
  });
};
beforeAll(async () => {
  await isolated.setup();
  auth = await fixtureAuth(pool);
  admin = await auth.person();
  user = await auth.person("user");
  const model = new LlmClient(
    pool,
    modelEnvironment(randomUUID()),
    async () => {
      generationCalls++;
      return Response.json({
        id: randomUUID(),
        model: "fixture-model",
        choices: [{ finish_reason: "stop", message: { content: "{}" } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 100,
          total_tokens: 200,
        },
      });
    },
  );
  await model.ledger.setup();
  await pool.query(
    "INSERT INTO player_initial_presentation(id,construction_id,actor_id,provided_at,data) VALUES($1,$2,$3,now()-interval '2 minutes',$4)",
    [
      fid("initial"),
      selection.worldId,
      selection.actorId,
      {
        id: fid("initial"),
        text: "",
        at: 0,
        providedAt: new Date(Date.now() - 120000).toISOString(),
        information: [],
      },
    ],
  );
  await pool.query(
    "CREATE TABLE world_scene(id uuid PRIMARY KEY,construction_id uuid NOT NULL,actor_id uuid NOT NULL,user_id uuid,state text NOT NULL,data jsonb NOT NULL,claim uuid,created_at timestamptz NOT NULL DEFAULT now(),inspection_revision bigint NOT NULL DEFAULT 0)",
  );
  const data = {
    ...m.scenes[0]!,
    purpose: "扉の様子を確かめる",
    character: {
      presetId: fid("preset"),
      version: 1,
      settings: "以前から村で暮らす成人",
      registrationAt: 0,
    },
    recordingVersion: "inspection-record-v1",
    worldId: fid("graph"),
    at: 0,
    startedAt: 0,
    basis: [],
    actions: m.scenes[0]!.inputs,
    events: Array.from({ length: 30 }, (_, i) => ({
      id: fid(`internal:${i}`),
      actorId: fid("npc"),
      text: "内部だけの記録",
      receipts: [],
      period: { from: 0, until: 0 },
    })),
    presentations: m.scenes[0]!.presentations,
    background: { synopsis: "fixture" },
  };
  await pool.query(
    "INSERT INTO world_scene(id,construction_id,actor_id,state,data,created_at) VALUES($1,$2,$3,'result',$4,now()-interval '1 minute')",
    [fid("scene"), selection.worldId, selection.actorId, data],
  );
  await model.run(fid("success"), () =>
    model.complete(fid("call"), "scene-resolve", [
      { role: "user", content: "JSON" },
    ]),
  );
  const setting = {
    provider: "gemini" as const,
    model: "fixture-model",
    api: "chat-completions" as const,
    baseUrl: "https://fixture.invalid",
    effort: "low" as const,
    initialEffort: "low" as const,
    contextTokens: 200000,
    maxOutputTokens: 1000,
    inputUsdPerMillion: 0.1,
    cachedInputUsdPerMillion: 0.01,
    outputUsdPerMillion: 0.1,
    pricingDate: "2026-10-28",
  };
  await auth.operations.models.put(
    pool,
    { default: setting, resolution: setting, judgment: "combined" },
    0,
    admin.id,
  );
  await auth.operations.models.putSecret(
    pool,
    "gemini",
    "private-evaluation-key",
    0,
    admin.id,
  );
});
afterAll(async () => {
  vi.restoreAllMocks();
  await isolated.close();
});
const select = async () =>
  InspectionReadResult.parse(
    await auth.operations.execute(admin.id, randomUUID(), {
      operation: "inspection.select",
      selection,
    }),
  );

test("初期提示の全ページを凍結し、他者とシーン開始後の取得を混ぜない", async () => {
  const worldId = randomUUID(),
    actorId = randomUUID(),
    sceneId = randomUUID();
  const make = (offset: number, length: number) =>
    Array.from({ length }, (_, i) => ({
      id: fid(`initial-edge-${offset + i}`),
      kind: "observation" as const,
      text: `初期知識${offset + i}`,
      from: 0,
    }));
  const first = make(0, 50),
    second = make(50, 2);
  await recordInitialPresentation(
    pool,
    worldId,
    user.id,
    {
      viewerId: randomUUID(),
      at: 0,
      items: make(90, 1),
      next: null,
      previous: null,
    },
    new Map([[fid("initial-edge-90"), fid("other-target")]]),
  );
  for (const items of [first, first, second])
    await recordInitialPresentation(
      pool,
      worldId,
      admin.id,
      {
        viewerId: actorId,
        at: 0,
        items,
        next: items === second ? null : "next",
        previous: null,
      },
      new Map(items.map((i) => [i.id, fid(`target-${i.id}`)])),
    );
  const data = {
    actions: [],
    events: [],
    presentations: [],
    recordingVersion: "inspection-record-v1",
    basis: [],
  };
  await pool.query(
    "INSERT INTO world_scene(id,construction_id,actor_id,user_id,state,data) VALUES($1,$2,$3,$4,'result',$5)",
    [sceneId, worldId, actorId, admin.id, data],
  );
  const selected = await InspectionStore.select(pool, {
    worldId,
    actorId,
    userId: admin.id,
    endSceneId: sceneId,
    n: 1,
  });
  const m = await InspectionStore.manifest(pool, worldId, selected.manifest.id);
  expect(m.initial).toHaveLength(2);
  expect(
    m
      .initial!.map((p) => p.text)
      .join("\n")
      .split("\n"),
  ).toHaveLength(52);
  expect(selected.manifest.initialRecording).toBe("recorded");
  await recordInitialPresentation(
    pool,
    worldId,
    admin.id,
    {
      viewerId: actorId,
      at: 1,
      items: make(60, 1),
      next: null,
      previous: null,
    },
    new Map([[fid("initial-edge-60"), fid("later-target")]]),
  );
  const reread = await InspectionStore.select(pool, {
    worldId,
    actorId,
    userId: admin.id,
    endSceneId: sceneId,
    n: 1,
  });
  expect(reread.manifest.id).toBe(selected.manifest.id);
  const page = await InspectionStore.read(pool, worldId, m.id);
  expect(page.items.filter((i) => i.section === "initial")).toHaveLength(2);
});

test("APIと共通計測の値が一致し、全ページの取得・再取得は生成も世界更新もしない", async () => {
  const selected = await select(),
    id = selected.manifest.id,
    raw = await InspectionStore.manifest(pool, selection.worldId, id);
  expect(raw.declaredContext).toMatchObject({
    character: {
      version: 1,
      settings: "以前から村で暮らす成人",
      registrationAt: 0,
    },
    preparations: [
      { sceneId: selection.endSceneId, purpose: "扉の様子を確かめる" },
    ],
    timeBasis: "world-clock-is-not-character-history",
  });
  const before = (await pool.query("SELECT data FROM world_scene ORDER BY id"))
    .rows;
  const app = await createApp(
    undefined,
    auth.identity,
    undefined,
    auth.operations,
  );
  const client = inspectionClient(
    { GESTALOKA_API_URL: "http://localhost", GESTALOKA_COOKIE: admin.cookie },
    async (url, init) => {
      const response = await app.inject({
        method: "POST",
        url: new URL(String(url)).pathname,
        headers: Object.fromEntries(new Headers(init?.headers)),
        payload: JSON.parse(String(init?.body)),
      });
      return new Response(response.body, {
        status: response.statusCode,
        headers: { "content-type": "application/json" },
      });
    },
  );
  try {
    const report = await inspectionReport(client, selection.worldId, id);
    expect(report.measurement).toEqual(measure(raw));
    expect(await inspectionReport(client, selection.worldId, id)).toEqual(
      report,
    );
    expect(report.items.length).toBeGreaterThan(50);
    expect(report.items.some((i) => i.section === "administrator")).toBe(true);
    expect(generationCalls).toBe(1);
    expect(evaluationCalls).toBe(0);
    expect(
      (await pool.query("SELECT data FROM world_scene ORDER BY id")).rows,
    ).toEqual(before);
    expect(readableInspection(report)).toContain("橋板が腐っている");
    expect(compareInspections(report, report).valueDifference).toBe(0);
    const changed = structuredClone(report);
    changed.manifest.requestedScenes++;
    expect(compareInspections(report, changed).mismatches).toContain("n");
    expect(app.swagger().paths?.["/api/operations"]).toBeDefined();
  } finally {
    await app.close();
  }
});
test("文書化したCLI入口が計測・比較と意味評価を実行し、JSONと可読報告を保存する", async () => {
  const selected = await select(),
    app = await createApp(undefined, auth.identity, undefined, auth.operations);
  const execute = auth.operations.execute.bind(auth.operations);
  const evaluator = vi
    .spyOn(auth.operations, "execute")
    .mockImplementation(async (...args) => {
      const result = await execute(...args);
      if (args[2].operation === "inspection.evaluate")
        await runEvaluation(pool, args[1], "2".repeat(64), transport);
      return result;
    });
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  const directory = await mkdtemp(join(tmpdir(), "gestaloka-inspection-")),
    id = selected.manifest.id;
  const args = [
    "--import",
    "tsx",
    "scripts/inspect-story.ts",
    "--world",
    selection.worldId,
    "--manifest",
    id,
    "--output",
    directory,
  ];
  try {
    const before = generationCalls;
    const first = await promisify(execFile)(
      process.execPath,
      [...args, "--compare", id],
      {
        env: {
          ...process.env,
          GESTALOKA_API_URL: base,
          GESTALOKA_COOKIE: admin.cookie,
          GESTALOKA_MCP_TOKEN: "",
        },
      },
    );
    expect(JSON.parse(first.stdout).status).toBe("complete");
    const json = JSON.parse(
        await readFile(join(directory, `${id}.json`), "utf8"),
      ),
      md = await readFile(join(directory, `${id}.md`), "utf8");
    expect(json.comparison.valueDifference).toBe(0);
    expect(md).toContain(json.manifest.id);
    expect(generationCalls).toBe(before);
    const paid = await promisify(execFile)(
      process.execPath,
      [
        ...args,
        "--semantic",
        "--configuration",
        "1",
        "--target",
        "resolution",
        "--budget",
        "1",
        "--wait-seconds",
        "5",
      ],
      {
        env: {
          ...process.env,
          GESTALOKA_API_URL: base,
          GESTALOKA_COOKIE: admin.cookie,
          GESTALOKA_MCP_TOKEN: "",
        },
      },
    );
    expect(JSON.parse(paid.stdout).status).toBe("complete");
    const evaluated = JSON.parse(
      await readFile(join(directory, `${id}.json`), "utf8"),
    );
    expect(evaluated.semantic.result.skill.rubricVersion).toBe("meaning-v2");
    expect(
      evaluated.semantic.result.evaluationCost.calculatedNanoUsd,
    ).not.toBeNull();
    const charged = (
      await pool.query(
        "SELECT sum(charged_nano)::text AS amount,count(*)::int AS calls FROM llm_call WHERE response_id=$1",
        [evaluated.semantic.result.runId],
      )
    ).rows[0];
    expect(charged.calls).toBeGreaterThan(1);
    expect(evaluated.semantic.result.evaluationCost.calculatedNanoUsd).toBe(
      charged.amount,
    );
  } finally {
    evaluator.mockRestore();
    await app.close();
    await unlink(join(directory, `${id}.json`)).catch(() => {});
    await unlink(join(directory, `${id}.md`)).catch(() => {});
    await rmdir(directory);
  }
});

test("並行追加後も固定manifestは変わらず、旧記録とn不足を明示する", async () => {
  const selected = await select();
  const data = (
    await pool.query("SELECT data FROM world_scene WHERE id=$1", [fid("scene")])
  ).rows[0].data;
  await pool.query(
    "INSERT INTO world_scene(id,construction_id,actor_id,state,data,created_at) VALUES($1,$2,$3,'paused',$4,now())",
    [
      fid("later"),
      selection.worldId,
      selection.actorId,
      { ...data, presentations: [], actions: [], recordingVersion: undefined },
    ],
  );
  expect((await select()).manifest.id).toBe(selected.manifest.id);
  const changed = InspectionReadResult.parse(
    await auth.operations.execute(admin.id, randomUUID(), {
      operation: "inspection.select",
      selection: { ...selection, endSceneId: fid("later"), n: 10 },
    }),
  );
  expect(changed.measurement.total.value).toBeNull();
  expect(changed.manifest.actualScenes).toBe(2);
  expect(changed.manifest.requestedScenes).toBe(10);
  expect(changed.manifest.sceneOrder.at(-1)?.state).toBe("paused");
});
test("管理者・scope・世界制限をAPIとMCPの共通操作で適用する", async () => {
  const selected = await select(),
    command = {
      operation: "inspection.read" as const,
      worldId: selection.worldId,
      manifestId: selected.manifest.id,
    };
  await expect(
    auth.operations.execute(user.id, randomUUID(), command),
  ).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
  const clientId = randomUUID(),
    grantId = randomUUID();
  vi.spyOn(auth.operations.mcp, "hydra").mockResolvedValue({});
  const scopes = ["inspection.read", "inspection.select"];
  await auth.operations.execute(admin.id, randomUUID(), {
    operation: "mcp.clients.put",
    clientId,
    configuration: {
      name: "検品試験",
      enabled: true,
      redirectUris: ["http://localhost/callback"],
      scopes,
      worldIds: [selection.worldId],
    },
    expectedVersion: 0,
    reason: "fixture",
  });
  await pool.query(
    "INSERT INTO mcp_grant(id,client_id,user_id,scopes,world_ids,consent_hash) VALUES($1,$2,$3,$4,$5,$6)",
    [
      grantId,
      clientId,
      admin.id,
      ["mcp.connect", ...scopes],
      [selection.worldId],
      randomUUID(),
    ],
  );
  const principal = {
    userId: admin.id,
    clientId,
    grantId,
    scopes: ["mcp.connect", ...scopes],
    worldIds: [selection.worldId],
    scope: "mcp.connect",
  };
  expect(
    (
      await auth.operations.execute(admin.id, randomUUID(), command, {
        mcp: principal,
      })
    ).measurement,
  ).toEqual(selected.measurement);
  await expect(
    auth.operations.execute(
      admin.id,
      randomUUID(),
      { ...command, worldId: fid("other-world") },
      { mcp: principal },
    ),
  ).rejects.toMatchObject({ code: "MCP_TARGET_DENIED" });
  await expect(
    auth.operations.execute(
      admin.id,
      randomUUID(),
      {
        operation: "inspection.evaluate",
        worldId: selection.worldId,
        manifestId: selected.manifest.id,
        configuration: {
          configurationVersion: 1,
          target: "resolution",
          budgetUsd: 1,
        },
      },
      { mcp: principal },
    ),
  ).rejects.toMatchObject({ code: "MCP_SCOPE_DENIED" });
  const app = await createApp(
    undefined,
    auth.identity,
    undefined,
    auth.operations,
  );
  vi.spyOn(auth.operations.mcp, "verify").mockResolvedValue(principal);
  const list = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      host: new URL(auth.operations.mcp.resource).host,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(list.statusCode).toBe(200);
  const tools = parseMcpMessage(list.body).result.tools;
  expect(
    tools.some((t: { name: string }) => t.name === "inspection_read"),
  ).toBe(true);
  expect(tools.length).toBe(Operation.options.length);
  await app.close();
});
test("同一評価ジョブは再送せず、意図した再評価を別保存し、予算終了を部分評価で残す", async () => {
  const selected = await select(),
    ids = [randomUUID(), randomUUID()];
  const config = {
    configurationVersion: 1,
    target: "resolution" as const,
    budgetUsd: 1,
  };
  for (const id of ids) {
    await auth.operations.execute(admin.id, id, {
      operation: "inspection.evaluate",
      worldId: selection.worldId,
      manifestId: selected.manifest.id,
      configuration: config,
    });
    await runEvaluation(pool, id, "2".repeat(64), transport);
  }
  const count = evaluationCalls;
  await runEvaluation(pool, ids[0]!, "2".repeat(64), transport);
  expect(evaluationCalls).toBe(count);
  const results = (
    await pool.query("SELECT * FROM inspection_evaluation WHERE id=ANY($1)", [
      ids,
    ])
  ).rows;
  expect(results).toHaveLength(2);
  expect(
    SemanticAssessment.parse(results[0].result.assessment).inputs,
  ).toHaveLength(9);
  const id = randomUUID();
  await auth.operations.execute(admin.id, id, {
    operation: "inspection.evaluate",
    worldId: selection.worldId,
    manifestId: selected.manifest.id,
    configuration: { ...config, budgetUsd: 1e-9 },
  });
  await runEvaluation(pool, id, "2".repeat(64), transport);
  expect(
    (
      await pool.query("SELECT status FROM inspection_evaluation WHERE id=$1", [
        id,
      ])
    ).rows[0].status,
  ).toBe("partial");
  expect(evaluationCalls).toBe(count);
});
test("個別評価の応答喪失を合算して予約を保持し、再開時に再送しない", async () => {
  const selected = await select(),
    id = randomUUID();
  await auth.operations.execute(admin.id, id, {
    operation: "inspection.evaluate",
    worldId: selection.worldId,
    manifestId: selected.manifest.id,
    configuration: {
      configurationVersion: 1,
      target: "resolution",
      budgetUsd: 1,
    },
  });
  const lost = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error("response lost"));
  const first = await runEvaluation(pool, id, "2".repeat(64), lost);
  expect(first!.evaluationCost).toMatchObject({ calculatedNanoUsd: null });
  expect(
    Number(
      (first!.evaluationCost as { reservedNanoUsd: string }).reservedNanoUsd,
    ),
  ).toBeGreaterThan(0);
  const calls = lost.mock.calls.length;
  await pool.query(
    "UPDATE inspection_evaluation SET status='queued' WHERE id=$1",
    [id],
  );
  const resumed = await runEvaluation(pool, id, "2".repeat(64), lost);
  expect(resumed).toMatchObject({
    status: "partial",
    reason: expect.stringContaining("自動では再送しません"),
  });
  expect(lost).toHaveBeenCalledTimes(calls);
});

test("定期集計は再開で重複せず、重複窓の入力と費用を水増ししない", async () => {
  await auth.operations.execute(admin.id, randomUUID(), {
    operation: "inspection.configure",
    worldId: selection.worldId,
    expectedVersion: 0,
    reason: "fixture",
    configuration: {
      enabled: true,
      intervalMinutes: 60,
      periodHours: 24,
      n: 2,
      weights: unitWeights,
      lowThreshold: 0,
      evaluation: null,
      sampleCount: 0,
    },
  });
  const worker = new InspectionWorker(
    pool,
    isolated.databases.queue,
    "2".repeat(64),
    transport,
  );
  await worker.tick();
  const before = (await pool.query("SELECT count(*) FROM inspection_manifest"))
    .rows[0].count;
  await worker.tick();
  expect(
    (await pool.query("SELECT count(*) FROM inspection_manifest")).rows[0]
      .count,
  ).toBe(before);
  const history = await auth.operations.execute(admin.id, randomUUID(), {
    operation: "inspection.history",
    query: {
      worldId: selection.worldId,
      from: "2026-01-01T00:00:00Z",
      to: "2027-01-01T00:00:00Z",
    },
  });
  const summaries = history.summary as {
    uniqueScenes: number;
    uniqueInputs: number;
    uniqueCalls: number;
  }[];
  expect(
    summaries.some(
      (s) =>
        s.uniqueScenes === 2 && s.uniqueInputs === 9 && s.uniqueCalls === 1,
    ),
  ).toBe(true);
  const calls = evaluationCalls;
  await auth.operations.execute(admin.id, randomUUID(), {
    operation: "inspection.configure",
    worldId: selection.worldId,
    expectedVersion: 1,
    reason: "fixtureの費用上限",
    configuration: {
      enabled: true,
      intervalMinutes: 60,
      periodHours: 24,
      n: 2,
      weights: unitWeights,
      lowThreshold: 0,
      evaluation: {
        configurationVersion: 1,
        target: "resolution",
        budgetUsd: 1e-9,
      },
      sampleCount: 1,
    },
  });
  await worker.tick();
  await worker.tick();
  const batch = (
    await pool.query(
      "SELECT result FROM inspection_batch WHERE configuration_version=2",
    )
  ).rows[0].result;
  expect(batch.eligible).toBe(2);
  expect(batch.selected).toBe(1);
  expect(batch.evaluated).toBe(0);
  expect(batch.unevaluated).toBe(2);
  expect(batch.evaluations[0].status).toBe("partial");
  expect(evaluationCalls).toBe(calls);
});
