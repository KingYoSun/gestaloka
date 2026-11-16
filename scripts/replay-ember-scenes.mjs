import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { connectDatabases, WorldBudget } from "@gestaloka/server";
import { LlmClient } from "@gestaloka/server/llm";
import { WorldAgent } from "@gestaloka/server/agent";
import { WorldBuilder } from "@gestaloka/server/build";
import { WorldConstruction } from "@gestaloka/server/construction";
import { WorldAccess } from "@gestaloka/server/access";
import { derivedId } from "../packages/server/dist/world/model.js";
import { locationRecords } from "../packages/server/dist/world/locations.js";
import { ModelSettings } from "../packages/server/dist/llm/settings.js";
import { fixtureAuth } from "../tests/support/auth.ts";
import { isolatedDatabases } from "../tests/support/isolated-db.ts";

const execute = process.argv.includes("--execute");
assert(process.argv.slice(2).every((arg) => arg === "--execute"));
process.env.DATABASE_URL =
  process.env.EMBER_DATABASE_URL ??
  "postgresql://gestaloka:evaluation-only@127.0.0.1:25434/gestaloka";
process.env.NEO4J_URI = process.env.EMBER_NEO4J_URI ?? "bolt://127.0.0.1:29687";
process.env.NEO4J_USER = "neo4j";
process.env.NEO4J_PASSWORD =
  process.env.EMBER_NEO4J_PASSWORD ?? "evaluation-only";
for (const key of ["DATABASE_URL", "NEO4J_URI"])
  assert.equal(new URL(process.env[key]).hostname, "127.0.0.1");
const base = new URL("../", import.meta.url);
const fixtureBytes = gunzipSync(
  await readFile(
    new URL("documents/evaluations/adr042-ember-fixtures.json.gz", base),
  ),
);
const fixtures = JSON.parse(fixtureBytes);
const plan = JSON.parse(
  await readFile(
    new URL("documents/evaluations/ember-flash-scenes-2026-11-17.json", base),
  ),
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.equal(
  sha256(fixtureBytes),
  plan.fixture.sha256,
  "Frozen fixture changed",
);
for (const [name, hash] of Object.entries(plan.prompts))
  assert.equal(
    sha256(await readFile(new URL(`prompts/${name}`, base))),
    hash,
    `Prompt changed: ${name}`,
  );
assert.equal(
  JSON.stringify(plan.configurations.flash.resolution),
  JSON.stringify(plan.configurations.ember.resolution),
);
assert.equal(plan.budgetUsd, 10);
assert.equal(plan.budgetUsdPerTrial, 2.5);
if (execute)
  for (const key of ["GEMINI_API_KEY", "OPENROUTER_API_KEY"])
    assert(process.env[key], `${key} is required; no generation sent`);
const directory = new URL(
  "artifacts/evaluations/ember-flash-scenes-2026-11-17/",
  base,
);
await mkdir(directory, { recursive: true });
const output = new URL(
  execute ? "execution.json" : "restore-check.json",
  directory,
);
const report = {
  status: "running",
  mode: execute ? "live" : "restore-only",
  startedAt: new Date().toISOString(),
  fixtureSha256: sha256(fixtureBytes),
  trials: [],
};
if (execute) await writeFile(output, JSON.stringify(report), { flag: "wx" });
const save = () => writeFile(output, JSON.stringify(report, null, 2) + "\n");
const noGeneration = async () => {
  throw new Error("Restore check must not call a model");
};

async function trial(fixture, group) {
  const iso = isolatedDatabases();
  await iso.setup();
  const d = iso.databases,
    world = randomUUID(),
    construction = randomUUID();
  assert.notEqual(world, fixture.scene.data.worldId);
  const budget = `ember-comparison-${world}`;
  const configuration = plan.configurations[group];
  const env = {
    ...ModelSettings.environment(configuration),
    GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "restore-only",
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? "restore-only",
    LLM_BUDGET_ID: budget,
    LLM_BUDGET_USD: String(plan.budgetUsdPerTrial),
    OPERATIONS_TOKEN_SECRET: "e".repeat(64),
  };
  const wire = [];
  const observe = async (url, init) => {
    const startedAt = new Date().toISOString(),
      started = performance.now();
    const response = await fetch(url, init);
    if (String(url).endsWith("/chat/completions")) {
      const request = JSON.parse(String(init.body));
      const raw = await response
        .clone()
        .json()
        .catch(() => ({}));
      wire.push({
        startedAt,
        elapsedMs: Math.round(performance.now() - started),
        status: response.status,
        requestSha256: sha256(String(init.body)),
        model: request.model,
        reasoning: request.reasoning ?? request.reasoning_effort,
        id: raw.id ?? null,
        returnedModel: raw.model ?? null,
        provider: raw.provider ?? null,
        usage: raw.usage ?? null,
        finishReasons:
          raw.choices?.map((choice) => choice.finish_reason) ?? null,
      });
    }
    return response;
  };
  const model = await LlmClient.create(
    d.postgres,
    env,
    execute ? observe : noGeneration,
  );
  const agent = new WorldAgent(d.postgres, d.graph, d.checkpointer, model);
  const runtime = new WorldConstruction(
    new WorldBuilder(d.postgres, d.graph, d.checkpointer, model),
    agent,
    d.queue,
    `ember-${world}`,
  );
  const access = new WorldAccess(runtime);
  const result = {
    scene: fixture.id,
    group,
    world,
    construction,
    budget,
    configuration,
    status: "restoring",
    checkpoints: [],
    timings: [],
    calls: [],
    wire,
  };
  report.trials.push(result);
  await save();
  try {
    await d.queue.start();
    const auth = await fixtureAuth(d.postgres);
    await access.setup();
    await WorldBudget.create(d.postgres, world, plan.budgetUsdPerTrial);
    // Preserve the exact record sequence and IDs. World IDs alone are isolated.
    for (const receipt of fixture.receipts) {
      await agent.store.commit(
        await agent.store.claim(world, randomUUID()),
        agent.store.context(world),
        {
          commitId: receipt.commitId,
          at: receipt.at,
          changes: receipt.changes,
        },
      );
      result.restoredReceipts = (result.restoredReceipts ?? 0) + 1;
      if (result.restoredReceipts % 25 === 0) {
        await save();
        console.log(
          JSON.stringify({
            scene: fixture.id,
            group,
            restoredReceipts: result.restoredReceipts,
          }),
        );
      }
    }
    const context = agent.store.context(world),
      at = fixture.scene.data.at;
    if (fixture.peers) {
      // Same captured-state reconciliation as ADR-042, with stable IDs in both groups.
      const changes = { nodes: [], edges: [], endEdges: [] };
      for (const peer of fixture.peers) {
        if (!(await context.node(peer.actorId)))
          changes.nodes.push({
            id: peer.actorId,
            kind: "existence",
            text: peer.name,
          });
        for (const state of peer.states) {
          if (
            (await context.relations(peer.actorId, "status", "out", at)).some(
              (edge) => edge.id === state.relationId,
            )
          )
            continue;
          const script = derivedId(`ember-fixture:${state.relationId}`);
          changes.nodes.push({ id: script, kind: "script", text: state.text });
          changes.edges.push({
            id: state.relationId,
            kind: "status",
            role: "content",
            source: peer.actorId,
            target: script,
            ...(peer.locations.some(
              (location) => location.id === state.relationId,
            )
              ? { text: "location" }
              : {}),
            period: { from: state.from },
          });
          for (const target of state.about)
            if (await context.node(target))
              changes.edges.push({
                id: derivedId(`ember-fixture:${state.relationId}:${target}`),
                kind: "status",
                role: "about",
                source: script,
                target,
                period: { from: state.from },
              });
        }
      }
      for (const [actor, locations] of Object.entries(fixture.positions))
        for (const old of await locationRecords(context, actor))
          if (!locations.some((location) => location.id === old.id))
            changes.endEdges.push(old.id);
      if (changes.nodes.length || changes.endEdges.length)
        await agent.store.commit(
          await agent.store.claim(world, randomUUID()),
          context,
          {
            commitId: derivedId("ember-fixture:peer-reconciliation"),
            at,
            changes,
          },
        );
    } else {
      // Proves the seven receipts reproduce the exact versions read at second-opening.
      await agent.store.context(world, fixture.scene.data.basis).validate();
    }
    const [actor, receiver] = fixture.actors,
      users = {};
    for (const id of fixture.actors) {
      users[id] = (await auth.person()).id;
      await d.postgres.query(
        "INSERT INTO world_subject(id,user_id) VALUES($1,$1)",
        [users[id]],
      );
    }
    await d.postgres.query(
      "INSERT INTO world_build(run_id,world_id,commit_id,initial_prompt,state,result) VALUES($1,$2,$3,'ADR042 saved-state comparison','ready',$4)",
      [
        construction,
        world,
        randomUUID(),
        {
          playerId: actor,
          rootIds: fixture.scene.data.roots,
          changes: { nodes: [], edges: [], endEdges: [] },
          report: "recovered ADR042 records",
        },
      ],
    );
    await d.postgres.query(
      "INSERT INTO world_construction(id,state,world_id,actor_id,root_ids,participant_id,at) VALUES($1,'finished',$2,$3,$4,$3,$5)",
      [
        construction,
        world,
        actor,
        JSON.stringify(fixture.scene.data.roots),
        at,
      ],
    );
    for (const item of fixture.controlled)
      await d.postgres.query(
        "INSERT INTO world_controlled_actor(world_id,actor_id,npc_active) VALUES($1,$2,$3)",
        [world, item.actor_id, item.npc_active],
      );
    for (const id of fixture.actors)
      await d.postgres.query(
        "INSERT INTO world_access(subject_id,construction_id,role,actor_id) VALUES($1,$2,'player',$3)",
        [users[id], construction, id],
      );
    for (const source of [fixture.scene, ...(fixture.relatedScenes ?? [])]) {
      const data = structuredClone(source.data);
      data.worldId = world;
      if (fixture.peers) data.basis = [];
      delete data.error;
      delete data.limitReached;
      delete data.suspended;
      if (data.work) data.work.id = randomUUID();
      const state =
        source.id === fixture.scene.id && fixture.peers
          ? "acting"
          : source.state;
      await d.postgres.query(
        "INSERT INTO world_scene(id,construction_id,actor_id,user_id,state,data) VALUES($1,$2,$3,$4,$5,$6)",
        [
          source.id,
          construction,
          source.actor_id,
          users[source.actor_id] ?? null,
          state,
          data,
        ],
      );
    }
    if (fixture.peers)
      await d.postgres.query(
        "INSERT INTO api_request(id,subject_id,hash,response) VALUES($1,$2,'isolated-source-input',$3)",
        [
          fixture.scene.data.actions[0].id,
          users[actor],
          { scene: { id: fixture.scene.id } },
        ],
      );
    await d.postgres.query(
      "UPDATE response_call_policy SET calls=128 WHERE singleton",
    );
    const positions = {};
    for (const [id, expected] of Object.entries(fixture.positions)) {
      positions[id] = await locationRecords(agent.store.context(world), id);
      assert.deepEqual(
        positions[id].map(({ id, text, aboutIds }) => ({ id, text, aboutIds })),
        expected.map(({ id, text, aboutIds }) => ({ id, text, aboutIds })),
      );
    }
    const modes = (
      await d.postgres.query(
        "SELECT actor_id,npc_active FROM world_controlled_actor ORDER BY actor_id",
      )
    ).rows;
    assert.deepEqual(
      modes,
      [...fixture.controlled].sort((a, b) =>
        a.actor_id.localeCompare(b.actor_id),
      ),
    );
    result.restoration = {
      receiptCount: fixture.receipts.length,
      positions,
      modes,
      sceneDataSha256: sha256(JSON.stringify(fixture.scene.data)),
    };
    const presence = async () => {
      for (const id of fixture.actors)
        await access.presence(
          users[id],
          construction,
          {
            requestId: randomUUID(),
            connectionId: derivedId(`ember-presence:${world}:${id}`),
            active: true,
          },
          "bot",
          id,
        );
    };
    const checkpoint = async (label, id = fixture.scene.id, viewer = actor) => {
      const row = await access.scenes.latest(
        construction,
        undefined,
        false,
        viewer,
        id,
      );
      result.checkpoints.push({
        label,
        row,
        display: await access.sceneData(row, false, viewer),
        inbox: await access.scenes.shared.inbox(construction, viewer),
      });
      await save();
      return row;
    };
    await presence();
    // Also exercise the current API's legacy unification without generating text.
    if (!fixture.peers)
      await access.sceneCommand(
        users[actor],
        construction,
        { requestId: randomUUID(), command: "start" },
        false,
        actor,
        fixture.scene.id,
        "bot",
      );
    result.status = "restore-verified";
    if (!execute) return;
    await model.verifyModel();
    await model.verifyModel("resolution");
    const started = performance.now();
    if (fixture.peers) {
      await agent.model.run(
        randomUUID(),
        () => access.scenes.tick(fixture.scene.id),
        world,
        users[actor],
      );
      const sender = await checkpoint("question-processed");
      result.timings.push({
        phase: "resumed-question-to-recipient",
        elapsedMs: Math.round(performance.now() - started),
      });
      if (sender.state === "paused") {
        result.status = "paused";
        return;
      }
      const packet = (
        await d.postgres.query(
          "SELECT * FROM world_player_contact WHERE source_scene=$1 AND listener=$2 ORDER BY at,id LIMIT 1",
          [fixture.scene.id, receiver],
        )
      ).rows[0];
      if (!packet) {
        result.status = "awaiting-recipient-delivery";
        return;
      }
      await access.scenes.tick(packet.target_scene);
      const before = await checkpoint(
        "receiver-before-input",
        packet.target_scene,
        receiver,
      );
      if (before.state === "paused") {
        result.status = "paused";
        return;
      }
      await presence();
      const replyStarted = performance.now(),
        requestId = randomUUID();
      result.receiverInput = {
        requestId,
        actor: receiver,
        text: fixture.reply,
      };
      await access.sceneCommand(
        users[receiver],
        construction,
        {
          requestId,
          command: "react",
          opportunityId: packet.id,
          actionText: fixture.reply,
        },
        false,
        receiver,
        undefined,
        "bot",
      );
      await access.scenes.tick(packet.target_scene);
      await checkpoint("receiver-after-input", packet.target_scene, receiver);
      await checkpoint("sender-after-reply");
      result.timings.push({
        phase: "receiver-input-to-sender-display",
        elapsedMs: Math.round(performance.now() - replyStarted),
      });
    } else {
      result.input = { requestId: randomUUID(), actor, text: fixture.input };
      await access.sceneCommand(
        users[actor],
        construction,
        {
          requestId: result.input.requestId,
          command: "act",
          actionText: fixture.input,
        },
        false,
        actor,
        fixture.scene.id,
        "bot",
      );
      await access.scenes.tick(fixture.scene.id);
      const row = await checkpoint("warehouse-action-and-response");
      result.timings.push({
        phase: "input-to-player-display",
        elapsedMs: Math.round(performance.now() - started),
      });
      if (row.state === "paused") {
        result.status = "paused";
        return;
      }
      await access.sceneCommand(
        users[actor],
        construction,
        { requestId: randomUUID(), command: "finish" },
        false,
        actor,
        fixture.scene.id,
        "bot",
      );
      await access.scenes.tick(fixture.scene.id);
      await checkpoint("warehouse-result");
    }
    result.status = "executed";
  } catch (error) {
    result.status = "error";
    result.error = String(error.stack ?? error);
  } finally {
    result.finalScenes = (
      await d.postgres.query("SELECT * FROM world_scene ORDER BY created_at,id")
    ).rows;
    result.calls = (
      await d.postgres.query(
        "SELECT id,created_at,request,response,state,delivery,charged_nano::text, reserved_nano::text,elapsed_ms,operation_id,response_id FROM llm_call ORDER BY created_at,id",
      )
    ).rows;
    const lower = result.calls.filter(
      (call) =>
        call.request.request?.model === configuration.default.model &&
        call.request.connection?.provider === configuration.default.provider &&
        ![
          "scene-intent",
          "world-update",
          "world-commit",
          "initial-generation",
          "initial-commit",
        ].includes(call.request.role),
    );
    result.lowerCalls = lower.length;
    result.lowerCostUsd =
      lower.reduce((sum, call) => sum + Number(call.charged_nano ?? 0), 0) /
      1e9;
    result.totalCostUsd =
      result.calls.reduce(
        (sum, call) => sum + Number(call.charged_nano ?? 0),
        0,
      ) / 1e9;
    await save();
    await d.queue.stop();
    // Only this runner's newly allocated world and schema are removed.
    await d.graph.executeQuery("MATCH(n {worldId:$world}) DETACH DELETE n", {
      world,
    });
    await iso.close();
    console.log(
      JSON.stringify({
        scene: fixture.id,
        group,
        status: result.status,
        generationCalls: result.calls.length,
      }),
    );
  }
}
// Check infrastructure once before allocating any trial.
const database = connectDatabases();
try {
  await database.verify();
} finally {
  await database.close();
}
for (const fixture of fixtures.scenarios)
  for (const group of ["flash", "ember"]) await trial(fixture, group);
report.status = report.trials.every(
  (result) => result.status === (execute ? "executed" : "restore-verified"),
)
  ? "complete"
  : "needs-review";
report.finishedAt = new Date().toISOString();
await save();
if (report.status !== "complete") process.exitCode = 1;
