import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { WorldAccess } from "@gestaloka/server/access";
import type { WorldProposal } from "@gestaloka/server/agent";
import { createApp } from "../../apps/api/src/app.js";
import { fixtureRuntime } from "../support/provider.js";
import { fixtureAuth } from "../support/auth.js";
import type {
  SceneBackground,
  SceneStep,
  CompletedScene,
} from "../../packages/server/src/runtime/scene-data.js";
import type { z } from "zod";

const scope = `players-${randomUUID()}`,
  mark = "確定した合図",
  people: string[] = [];
let world: string,
  graph: string,
  a: string,
  b: string,
  admin: string,
  one: string,
  two: string;
let forceOther = false,
  seen = false;
type Input = {
  request?: {
    actorId?: string;
    controlledActorId?: string;
    rootIds: string[];
    until?: number;
    completedScene?: CompletedScene;
  };
  background?: SceneBackground;
  initialContext?: unknown;
};
const setup = await fixtureRuntime(scope, (content, raw) => {
  const input = raw as Input;
  if (input.background && input.request?.controlledActorId === a) {
    const step = content as Extract<
      z.infer<typeof SceneStep>,
      { type: "scene" }
    >;
    return {
      ...step,
      events: [
        { actorId: a, text: mark, receipts: [{ observerId: a, text: mark }] },
      ],
      elapsedMs: 1000,
    };
  }
  if ((content as { type?: string }).type === "background") {
    const background = content as SceneBackground;
    if (forceOther && input.request?.actorId === a)
      return { ...background, participants: [a, b] };
    if (
      input.request?.actorId === b &&
      JSON.stringify(input.initialContext).includes(mark)
    ) {
      seen = true;
      return {
        ...background,
        synopsis: mark,
        perceptions: [
          {
            observerId: b,
            text: mark,
            sourceIds: input.request.rootIds.filter((id) => id !== b),
          },
        ],
      };
    }
  }
  if (input.request?.completedScene && input.request.controlledActorId === a) {
    const proposal = content as WorldProposal;
    return {
      ...proposal,
      changes: {
        ...proposal.changes,
        edges: [
          ...proposal.changes.edges,
          {
            id: randomUUID(),
            kind: "effect",
            source: input.request.completedScene.events[0]!.id,
            target: input.request.rootIds.find((id) => id !== a)!,
            period: { from: input.request.until! },
          },
        ],
      },
    };
  }
  return content;
});
const { databases: db, runtime } = setup,
  access = new WorldAccess(runtime);
let auth: Awaited<ReturnType<typeof fixtureAuth>>,
  app: Awaited<ReturnType<typeof createApp>>;
beforeAll(async () => {
  auth = await fixtureAuth(db.postgres);
  await access.setup();
  app = await createApp(access, auth.identity, undefined, auth.operations);
  const operator = await auth.person(),
    p1 = await auth.person("user"),
    p2 = await auth.person("user");
  admin = operator.id;
  one = p1.id;
  two = p2.id;
  people.push(admin, one, two);
  world = (
    await access.create(admin, {
      requestId: randomUUID(),
      prompt: "参加者の共有とシーン分離を確かめるための世界",
    })
  ).id;
  await runtime.tick(world);
  graph = (await runtime.get(world)).world_id!;
  await access.command(admin, world, {
    requestId: randomUUID(),
    command: "finish",
  });
  await auth.operations.execute(admin, randomUUID(), {
    operation: "worlds.configure",
    worldId: world,
    title: "共有世界",
    description: "参加用",
    published: true,
    accepting: true,
    reason: "検証",
  });
  const presetId = randomUUID();
  await auth.operations.execute(admin, randomUUID(), {
    operation: "presets.put",
    presetId,
    title: "世界の一員",
    description: "この地で暮らす",
    settings: "世界と両立する役割と知識を持つ。",
    expectedVersion: 0,
    reason: "検証",
  });
  for (const user of [one, two]) {
    const id = randomUUID();
    await auth.operations.execute(
      user,
      id,
      { operation: "worlds.join", worldId: world, presetId, presetVersion: 1 },
      { players: access.players },
    );
    await access.players.tick(id);
  }
  a = (await access.players.list(one, world)).items[0]!.actorId!;
  b = (await access.players.list(two, world)).items[0]!.actorId!;
});
afterAll(async () => {
  await app?.close();
  for (const suffix of ["", "-play", "-scenes", "-joins"])
    await db.queue.deleteQueue(`e2e-${scope}${suffix}`);
  await db.postgres.query("DELETE FROM world_event WHERE construction_id=$1", [
    world,
  ]);
  await db.postgres.query("DELETE FROM world_access WHERE construction_id=$1", [
    world,
  ]);
  await db.postgres.query("DELETE FROM api_request WHERE subject_id=ANY($1)", [
    people,
  ]);
  await db.postgres.query("DELETE FROM world_subject WHERE id=ANY($1)", [
    people,
  ]);
  await db.postgres.query(
    "DELETE FROM construction_log WHERE construction_id=$1",
    [world],
  );
  await db.postgres.query("DELETE FROM world_construction WHERE id=$1", [
    world,
  ]);
  await db.postgres.query("DELETE FROM world_build WHERE run_id=$1", [world]);
  await db.postgres.query(
    "DELETE FROM world_operation WHERE request->>'worldId'=$1",
    [graph],
  );
  await db.postgres.query("DELETE FROM world_intent WHERE world_id=$1", [
    graph,
  ]);
  await db.postgres.query(
    "DELETE FROM world_controlled_actor WHERE world_id=$1",
    [graph],
  );
  await db.postgres.query("DELETE FROM llm_call WHERE budget_id=$1", [
    `e2e-${scope}`,
  ]);
  await db.postgres.query("DELETE FROM llm_budget WHERE id=$1", [
    `e2e-${scope}`,
  ]);
  await auth?.cleanup();
  await db.graph.executeQuery(
    "MATCH(n) WHERE n.worldId=$worldId DETACH DELETE n",
    { worldId: graph },
  );
  await db.queue.stop();
  await db.close();
});

test("独立したシーンを保ちながら確定した作用を後続の参照へ引き継ぐ", async () => {
  const prepare = async (user: string, actor: string) =>
    (
      await access.sceneCommand(
        user,
        world,
        { requestId: randomUUID(), command: "prepare", purpose: mark },
        false,
        actor,
      )
    ).scene!;
  const x = await prepare(one, a),
    y = await prepare(two, b);
  await access.scenes.tick(x.id);
  await access.scenes.tick(y.id);
  await access.sceneCommand(
    one,
    world,
    { requestId: randomUUID(), command: "start" },
    false,
    a,
  );
  await access.sceneCommand(
    two,
    world,
    { requestId: randomUUID(), command: "start" },
    false,
    b,
  );
  const before = await access.scene(two, world, false, b);
  await access.sceneCommand(
    one,
    world,
    { requestId: randomUUID(), command: "act", actionText: mark },
    false,
    a,
  );
  await access.scenes.tick(x.id);
  await access.sceneCommand(
    one,
    world,
    { requestId: randomUUID(), command: "finish" },
    false,
    a,
  );
  await access.scenes.tick(x.id);
  expect((await access.scene(one, world, false, a)).scene!.state).toBe(
    "result",
  );
  expect(await access.scene(two, world, false, b)).toEqual(before);
  expect(
    JSON.stringify(
      await access.knowledge(two, world, undefined, undefined, undefined, b),
    ),
  ).not.toContain(mark);
  await access.sceneCommand(
    two,
    world,
    { requestId: randomUUID(), command: "finish" },
    false,
    b,
  );
  await access.scenes.tick(y.id);
  const next = await prepare(two, b);
  await access.scenes.tick(next.id);
  expect(seen).toBe(true);
  const state = (await access.scene(two, world, false, b)).scene!;
  expect(state.state).toBe("ready");
  expect(state.synopsis).toBe(mark);
  expect((await runtime.get(world)).at).toBeGreaterThanOrEqual(1000);
  expect(await runtime.agent.controlledActors(graph, [a, b])).toEqual(
    new Set([a, b]),
  );
});

test("他プレイヤーをNPCの登場主体にせず新たな意図を代行しない", async () => {
  forceOther = true;
  const scene = (
    await access.sceneCommand(
      one,
      world,
      {
        requestId: randomUUID(),
        command: "prepare",
        purpose: "周囲を確かめる",
      },
      false,
      a,
    )
  ).scene!;
  const calls = vi.spyOn(runtime.agent.model, "complete");
  try {
    await expect(access.scenes.tick(scene.id)).rejects.toThrow(
      "他プレイヤーをNPC",
    );
    expect((await access.scene(one, world, false, a)).scene!.state).toBe(
      "paused",
    );
    expect(
      calls.mock.calls.filter((call) => call[1] === "scene-intent"),
    ).toHaveLength(0);
    await expect(
      runtime.agent.intent(graph, b, 1000, randomUUID()),
    ).rejects.toThrow("本人の入力");
  } finally {
    calls.mockRestore();
  }
});
