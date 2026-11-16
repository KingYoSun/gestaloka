import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { WorldAccess } from "@gestaloka/server/access";
import { changeBelongings } from "@gestaloka/server/belongings";
import { locationRecords } from "../../packages/server/src/world/locations.js";
import type { WorldProposal } from "@gestaloka/server/agent";
import {
  sceneAnchors,
  type SceneBackground,
  type RecordedSceneEvent,
  type SceneIntent,
} from "../../packages/server/src/runtime/scene-data.js";
import { createApp } from "../../apps/api/src/app.js";
import { isolatedDatabases } from "../support/isolated-db.js";
import { fixtureRuntime } from "../support/provider.js";
import { fixtureAuth } from "../support/auth.js";
import { playerCli } from "../support/player-cli.js";

const isolated = isolatedDatabases(),
  scope = `shared-${randomUUID()}`;
const selections = new Map<
  string,
  { candidates: string[]; mergeInto: string | null }
>();
let continuation: { actor: string; creation: string } | undefined;
let denyDeparture = false;
const backgroundFaults: ("participant" | "perception")[] = [];
let backgroundGate: (() => Promise<void>) | undefined;
type PlayInput = {
  receivedContacts?: {
    speaker: string;
    text: string;
    replyInputId: string | null;
  }[];
  sleepingPlayerIds: string[];
  otherPlayers?: {
    actorId: string;
    controlledByPlayer: true;
    locations: { id: string; text: string; at: number; aboutIds: string[] }[];
    states: { text: string; relationId: string }[];
  }[];
  background: SceneBackground;
  sceneHistory: RecordedSceneEvent[];
  request: {
    controlledActorId: string;
    controlledInputs: {
      id: string;
      actorId: string;
      text: string;
      seen: string[];
    }[];
    intentions: SceneIntent[];
    reactionTo: {
      inputId: string;
      seenEventIds: Record<string, string[]>;
    } | null;
  };
};
let npcGuest: string | undefined;
let playback: ((input: PlayInput) => unknown) | undefined;
let inventory:
  | {
      item: string;
      state: string;
      content: string;
      about: string;
      place: string;
      remaining: number;
    }
  | undefined;
let runtime: Awaited<ReturnType<typeof fixtureRuntime>>["runtime"],
  access: WorldAccess,
  auth: Awaited<ReturnType<typeof fixtureAuth>>,
  app: Awaited<ReturnType<typeof createApp>>,
  cli: Awaited<ReturnType<typeof playerCli>>,
  world: string,
  graph: string;
const people: { id: string; cookie: string; actor: string; profile: string }[] =
  [];
const connections = new Map<number, string>();
beforeEach(() => selections.clear());
beforeAll(async () => {
  await isolated.setup();
  ({ runtime } = await fixtureRuntime(
    scope,
    async (content, raw, messages) => {
      const input = raw as {
        request?: {
          actorId: string;
          rootIds: string[];
          controlledActorId?: string;
          leavingActorIds?: string[];
          completedScene?: unknown;
          until?: number;
        };
        responseSchema?: unknown;
        acceptedPlayerIds?: string[];
        priorScenes?: { background: SceneBackground }[];
        confirmed?: { observations: { text: string }[] };
      };
      const proposal = content as WorldProposal;
      if (
        inventory &&
        input.request?.completedScene &&
        (content as { type?: string }).type === "propose"
      ) {
        if (
          !messages.some(
            (m) =>
              m.role === "user" &&
              m.content.includes('"results"') &&
              m.content.includes(inventory!.content) &&
              m.content.includes(inventory!.about),
          )
        )
          return {
            type: "query",
            requests: [
              { kind: "edge", id: inventory.content },
              { kind: "edge", id: inventory.about },
            ],
          };
        return {
          ...proposal,
          changes: {
            ...proposal.changes,
            nodes: [
              ...proposal.changes.nodes,
              {
                id: inventory.state,
                kind: "script",
                text: JSON.stringify({ quantity: inventory.remaining }),
              },
            ],
            edges: [
              ...proposal.changes.edges,
              {
                id: randomUUID(),
                kind: "status",
                role: "content",
                source: inventory.item,
                target: inventory.state,
                period: { from: input.request.until! },
              },
              {
                id: randomUUID(),
                kind: "status",
                role: "about",
                source: inventory.state,
                target: inventory.place,
                period: { from: input.request.until! },
              },
            ],
            endEdges: [
              ...proposal.changes.endEdges,
              inventory.content,
              inventory.about,
            ],
          },
        };
      }
      if (proposal.newParticipantId)
        return {
          ...proposal,
          changes: {
            ...proposal.changes,
            edges: proposal.changes.edges
              .filter(
                (e) =>
                  e.kind !== "see" || e.text === "あなたが初めて知覚した景色",
              )
              .map((e) =>
                e.kind === "see"
                  ? { ...e, text: `PRIVATE-${proposal.newParticipantId}` }
                  : e,
              ),
          },
        };
      if ((JSON.stringify(input.responseSchema) ?? "").includes('"selection"'))
        return {
          type: "selection",
          ...(selections.get(input.request!.actorId) ?? {
            candidates: [],
            mergeInto: null,
          }),
        };
      if (continuation && input.confirmed)
        return {
          text:
            input.confirmed.observations.map((o) => o.text).join("\n") ||
            "本人に追加の受容はありません",
        };
      if (
        (content as { type?: string }).type === "scene" &&
        input.request?.leavingActorIds?.length
      ) {
        const actor = input.request.leavingActorIds[0]!;
        return {
          ...(content as object),
          events: [
            {
              actorId: actor,
              text: denyDeparture ? "退出を試みた" : "場を離れた",
              receipts: [
                {
                  observerId: actor,
                  text: denyDeparture ? "通路はまだ通れない" : "EXIT-OWN",
                },
              ],
            },
          ],
          departures: denyDeparture ? [] : [{ actorId: actor, eventIndex: 0 }],
        };
      }
      if (playback && (content as { type?: string }).type === "scene")
        return playback(raw as PlayInput);
      if (npcGuest && (raw as { observerId?: string }).observerId === npcGuest)
        return { actionText: "柵のそばの人に挨拶する" };
      if (
        (content as { type?: string }).type === "background" &&
        input.acceptedPlayerIds
      ) {
        await backgroundGate?.();
        const background = content as SceneBackground;
        const result = {
          ...background,
          ...(continuation && input.request!.actorId === continuation.actor
            ? {
                creations: [
                  { id: continuation.creation, text: "場に現れた持ち運べる物" },
                ],
                facts: [
                  ...background.facts,
                  {
                    subjectId: input.request!.actorId,
                    text: "この物を見つけた",
                    aboutIds: [continuation.creation],
                  },
                ],
              }
            : continuation && input.priorScenes?.length
              ? {
                  facts: [
                    ...background.facts,
                    {
                      subjectId: input.request!.actorId,
                      text: "前の場で見た物を改めて確かめる",
                      aboutIds: [continuation!.creation],
                    },
                  ],
                }
              : {}),
          participants: [
            ...input.acceptedPlayerIds,
            ...(npcGuest ? [npcGuest] : []),
          ],
          synopsis: `OWNER-${input.request!.actorId}`,
          perceptions: [
            ...input.acceptedPlayerIds,
            ...(npcGuest ? [npcGuest] : []),
          ].map((actor) => ({
            observerId: actor,
            text: `VIEW-${actor}`,
            sourceIds: [
              input.request!.rootIds.find(
                (id) => id !== input.request!.actorId,
              )!,
            ],
          })),
        };
        const omitted = input.acceptedPlayerIds.at(-1)!;
        const fault = backgroundFaults.shift();
        if (fault === "participant")
          result.participants = result.participants.filter(
            (id) => id !== omitted,
          );
        if (fault === "perception")
          result.perceptions = result.perceptions.filter(
            (p) => p.observerId !== omitted,
          );
        return result;
      }
      return content;
    },
    isolated.databases,
  ));
  auth = await fixtureAuth(isolated.databases.postgres);
  access = new WorldAccess(runtime);
  await access.setup();
  app = await createApp(access, auth.identity, undefined, auth.operations);
  cli = await playerCli(app);
  const admin = await auth.person();
  world = (
    await access.create(admin.id, {
      requestId: randomUUID(),
      budgetUsd: 100,
      prompt: "共有シーンの参加・認可を検証する世界",
    })
  ).id;
  await runtime.tick(world);
  graph = (await runtime.get(world)).world_id!;
  await access.command(admin.id, world, {
    requestId: randomUUID(),
    command: "finish",
  });
  await auth.operations.execute(admin.id, randomUUID(), {
    operation: "worlds.configure",
    worldId: world,
    title: "共有の村",
    description: "",
    published: true,
    accepting: true,
    reason: "検証",
  });
  const preset = randomUUID();
  await auth.operations.execute(admin.id, randomUUID(), {
    operation: "presets.put",
    presetId: preset,
    title: "村民",
    description: "",
    settings: "この世界で暮らす新しい人物",
    expectedVersion: 0,
    reason: "検証",
  });
  for (let i = 0; i < 3; i++) {
    const person = await auth.person("user"),
      id = randomUUID();
    await auth.operations.execute(
      person.id,
      id,
      {
        operation: "worlds.join",
        worldId: world,
        presetId: preset,
        presetVersion: 1,
      },
      { players: access.players },
    );
    await access.players.tick(id);
    const actor = (await access.players.list(person.id, world)).items[0]!
      .actorId!;
    const profile = join(cli.directory, `${i}.json`),
      connected = await cli.run(
        profile,
        "connect",
        "--server",
        cli.base,
        "--world",
        world,
      );
    expect(
      (await cli.approve(person.cookie, connected.userCode, `actor:${actor}`))
        .statusCode,
    ).toBe(302);
    people.push({ ...person, actor, profile });
  }
}, 120000);
afterAll(async () => {
  await cli?.close();
  await app?.close();
  for (const suffix of [
    "",
    "-play",
    "-scenes",
    "-joins",
    "-shared-scenes",
    "-scene-deadlines",
  ])
    await isolated.databases.queue.deleteQueue(`e2e-${scope}${suffix}`);
  if (graph)
    await isolated.databases.graph.executeQuery(
      "MATCH(n) WHERE n.worldId=$world DETACH DELETE n",
      { world: graph },
    );
  await isolated.close();
});
async function presence(index: number, active = true) {
  const p = people[index]!,
    saved = JSON.parse(await readFile(p.profile, "utf8")),
    connectionId = active
      ? randomUUID()
      : (connections.get(index) ?? randomUUID());
  if (active) connections.set(index, connectionId);
  const response = await app.inject({
    method: "POST",
    url: `/api/worlds/${world}/presence`,
    headers: {
      authorization: `Bearer ${saved.secret}`,
      "x-gestaloka-request": "1",
    },
    payload: { requestId: randomUUID(), connectionId, active },
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().kind).toBe("bot");
  return connectionId;
}
async function prepare(index: number, web = false) {
  const p = people[index]!;
  if (web) {
    const requestId = randomUUID(),
      r = await app.inject({
        method: "POST",
        url: `/api/worlds/${world}/scene?actorId=${p.actor}`,
        headers: { cookie: p.cookie, "x-gestaloka-request": "1" },
        payload: {
          requestId,
          command: "prepare",
          purpose: "相手と会って状況を確かめる",
          shared: true,
        },
      });
    expect(r.statusCode, r.body).toBe(202);
    return r.json().scene.id as string;
  }
  const r = await cli.run(
    p.profile,
    "prepare",
    "--shared",
    "--purpose",
    "相手と会って状況を確かめる",
  );
  expect(r.state).toBe("processing");
  return r.scene.id as string;
}

test("在席は最後の操作から10分維持し、待受終了では切断せず明示終了で解除する", async () => {
  const owner = people[0]!;
  selections.set(owner.actor, { candidates: [], mergeInto: null });
  await presence(0, false);
  const started = Date.now();
  const prepared = await cli.run(
    owner.profile,
    "prepare",
    "--purpose",
    "周囲を確かめる",
  );
  const id = prepared.scene.id;
  expect(
    (await access.scenes.latest(world, undefined, false, owner.actor))!.data
      .turns,
  ).toBe(true);
  const clock = vi.spyOn(access.scenes.shared, "now");
  try {
    clock.mockReturnValue(new Date(started + 599000));
    expect(await access.scenes.shared.active(world, [owner.actor])).toContain(
      owner.actor,
    );
    clock.mockReturnValue(new Date(Date.now() + 601000));
    expect(await access.scenes.shared.active(world, [owner.actor])).toEqual([]);
  } finally {
    clock.mockRestore();
  }
  const lines = await cli.lines(owner.profile, "listen", "--once");
  expect(lines.at(-1).state).toBe("waiting_stopped");
  expect(await access.scenes.shared.active(world, [owner.actor])).toContain(
    owner.actor,
  );
  await cli.run(owner.profile, "disconnect");
  expect(await access.scenes.shared.active(world, [owner.actor])).toEqual([]);
  expect((await cli.run(owner.profile, "standby")).state).toBe("inactive");
  expect((await cli.run(owner.profile, "standby", "--resume")).state).toBe(
    "standby",
  );
  await cli.run(owner.profile, "finish");
  await access.scenes.tick(id);
  expect((await cli.run(owner.profile, "result")).state).toBe("finished");
}, 60000);

test("形式修復の上限で保留しても終了要求から保存済みの内容でリザルトに進む", async () => {
  const owner = people[0]!;
  const id = (
    await cli.run(owner.profile, "prepare", "--purpose", "周囲を見渡す")
  ).scene.id;
  const calls = vi.spyOn(runtime.agent.model, "complete");
  backgroundFaults.push("perception", "perception", "perception", "perception");
  try {
    await expect(access.scenes.tick(id)).rejects.toThrow();
    expect((await cli.run(owner.profile, "status")).state).toBe("paused");
    expect(
      calls.mock.calls.filter(
        ([, role, messages]) =>
          role === "scene-background" &&
          messages.some((m) => m.content.includes('"backgroundVersion"')),
      ),
    ).toHaveLength(4);
    const before = calls.mock.calls.length;
    expect((await cli.run(owner.profile, "finish")).scene.shared.flow).toBe(
      "closing",
    );
    await access.scenes.tick(id);
    expect((await cli.run(owner.profile, "result")).state).toBe("finished");
    expect(
      calls.mock.calls
        .slice(before)
        .some(([, role]) => role === "scene-background"),
    ).toBe(false);
  } finally {
    backgroundFaults.length = 0;
    calls.mockRestore();
  }
}, 60000);

test("回答済みの発言を5分でまとめ、未回答者をWebとCLIの共通状態に示す", async () => {
  const id = await sharedGame(0, true),
    owner = people[0]!,
    first = people[1]!,
    last = people[2]!;
  playback = (input) =>
    playStep(
      input,
      input.request.controlledActorId === owner.actor
        ? [first.actor, last.actor]
        : [],
    );
  try {
    const before = Date.now();
    const input = await humanAct(0, "二人に声をかける");
    await access.scenes.tick(id);
    const offer = (await cli.run(first.profile, "inbox")).opportunities.find(
      (o: { sourceInputId: string }) => o.sourceInputId === input,
    );
    expect(Date.parse(offer.deadline) - before).toBeGreaterThanOrEqual(300000);
    expect(Date.parse(offer.deadline) - Date.now()).toBeLessThanOrEqual(300000);
    await cli.run(
      first.profile,
      "react",
      "--opportunity",
      offer.id,
      "--text",
      "自分の知ることを伝える",
    );
    const wave = (
      await runtime.pool.query(
        "SELECT w.id,w.state FROM world_scene_wave w JOIN world_scene_reply r ON r.wave_id=w.id WHERE r.id=$1",
        [offer.id],
      )
    ).rows[0];
    expect(wave.state).toBe("pending");
    const status = await cli.run(owner.profile, "status");
    expect(status.scene.waiting).toContainEqual(
      expect.objectContaining({
        kind: "participants",
        actors: [expect.objectContaining({ id: last.actor })],
        deadline: offer.deadline,
      }),
    );
    const clock = vi
      .spyOn(access.scenes.shared, "now")
      .mockReturnValue(new Date(Date.parse(offer.deadline) + 1));
    try {
      await access.scenes.shared.expire({ waveId: wave.id });
    } finally {
      clock.mockRestore();
    }
    await access.scenes.tick(id);
    const saved = (await access.scenes.latest(
      world,
      undefined,
      false,
      owner.actor,
    ))!;
    expect(saved.data.actions).toContainEqual(
      expect.objectContaining({
        actorId: first.actor,
        text: "自分の知ることを伝える",
        state: "complete",
      }),
    );
    expect(saved.data.events.some((e) => e.actorId === last.actor)).toBe(false);
    await cli.run(owner.profile, "finish");
    await access.scenes.tick(id);
  } finally {
    playback = undefined;
  }
}, 60000);
async function end(index: number) {
  await presence(index);
  const p = people[index]!;
  expect((await cli.run(p.profile, "start")).state).toBe("waiting_input");
  const r = await cli.run(p.profile, "finish");
  expect(r.state).toBe("processing");
  await access.scenes.tick(r.scene.id);
  expect((await cli.run(p.profile, "result")).state).toBe("finished");
}

test.each(["preparing", "ready", "legacy-closing"])(
  "%sの共有シーンも終了要求を保持し、再送で二重確定しない",
  async (state) => {
    selections.set(people[0]!.actor, { candidates: [], mergeInto: null });
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let running: Promise<void> | undefined;
    try {
      const id = await prepare(0);
      if (state === "preparing") {
        backgroundGate = async () => {
          entered();
          await gate;
        };
        running = access.scenes.tick(id);
        await started;
      } else await access.scenes.tick(id);
      if (state === "legacy-closing") {
        await isolated.databases.postgres.query(
          "UPDATE world_shared_scene SET flow='closing',end_reason='requested' WHERE scene_id=$1",
          [id],
        );
        expect((await cli.run(people[0]!.profile, "start")).code).toBe(
          "STATE_CONFLICT",
        );
        await isolated.databases.postgres.query(
          "UPDATE world_scene SET state='active' WHERE id=$1",
          [id],
        );
      } else {
        expect((await cli.run(people[0]!.profile, "finish")).state).toBe(
          "processing",
        );
      }
      release();
      await running;
      backgroundGate = undefined;
      await access.scenes.tick(id);
      const row = (await access.scenes.latest(
        world,
        undefined,
        false,
        people[0]!.actor,
        id,
      ))!;
      expect(row.state).toBe("result");
      expect(row.data.ending).toBe("requested");
      expect(row.data.actions).toEqual([]);
      expect(row.data.events).toEqual([]);
      await access.scenes.tick(id);
      expect(
        (
          await isolated.databases.postgres.query(
            "SELECT count(*)::int AS count FROM construction_log WHERE operation_id=$1",
            [row.data.operationId],
          )
        ).rows[0].count,
      ).toBe(1);
    } finally {
      release();
      await running;
      backgroundGate = undefined;
    }
  },
  60000,
);

test("承認済み参加者と視点の欠落を同じ背景要求内で修正し、旧保存状態も提示済み履歴を保って補う", async () => {
  backgroundFaults.push("participant", "perception");
  const id = await sharedGame();
  expect(backgroundFaults).toEqual([]);
  const before = (await access.scenes.latest(
    world,
    undefined,
    false,
    people[0]!.actor,
    id,
  ))!;
  expect([...before.data.background!.participants].sort()).toEqual(
    people.map((p) => p.actor).sort(),
  );
  expect(
    before.data.background!.perceptions.map((p) => p.observerId).sort(),
  ).toEqual(people.map((p) => p.actor).sort());
  const saved = structuredClone(before.data);
  saved.background!.participants = people.slice(0, 2).map((p) => p.actor);
  saved.background!.perceptions = saved.background!.perceptions.filter(
    (p) => p.observerId !== people[2]!.actor,
  );
  delete saved.views[people[2]!.actor];
  await isolated.databases.postgres.query(
    "UPDATE world_scene_presence SET active=false WHERE world_id=$1 AND actor_id=$2",
    [world, people[1]!.actor],
  );
  await isolated.databases.postgres.query(
    "UPDATE world_scene SET data=$2 WHERE id=$1",
    [id, saved],
  );
  await cli.run(people[0]!.profile, "finish");
  await access.scenes.tick(id);
  const after = (await access.scenes.latest(
    world,
    undefined,
    false,
    people[0]!.actor,
    id,
  ))!;
  expect(after.state).toBe("result");
  expect([...after.data.background!.participants].sort()).toEqual(
    people.map((p) => p.actor).sort(),
  );
  expect(after.data.background!.synopsis).toBe(
    before.data.background!.synopsis,
  );
  expect(after.data.events).toEqual(before.data.events);
  expect(after.data.background!.perceptions).toContainEqual(
    before.data.background!.perceptions.find(
      (p) => p.observerId === people[1]!.actor,
    ),
  );
  expect(after.data.presentations!.filter((p) => p.kind !== "result")).toEqual(
    before.data.presentations,
  );
  for (const p of people) expect(after.data.views[p.actor]).toBeDefined();
  for (const p of people.slice(1)) {
    const result = await access.scenes.resultSource(after, p.actor);
    expect(result.synopsis).toBe(`VIEW-${p.actor}`);
    expect(result.synopsis).not.toContain(people[0]!.actor);
  }
  await presence(1, false);
  await presence(2, false);
}, 60000);
test.each([false, true])(
  "共有ターンの境界からリザルトを取得する（旧版の停止状態を再開=%s）",
  async (legacy) => {
    const owner = people[0]!;
    selections.set(owner.actor, { candidates: [], mergeInto: null });
    await presence(0);
    const scene = await prepare(0);
    await access.scenes.tick(scene);
    await cli.run(owner.profile, "start");
    await cli.run(owner.profile, "act", "--text", "相手に声をかける");
    playback = () => ({ type: "boundary", reason: "相手の判断を待つ" });
    const calls = vi.spyOn(runtime.agent.model, "complete");
    const resultSource = access.scenes.resultSource.bind(access.scenes);
    const source = vi.spyOn(access.scenes, "resultSource");
    try {
      if (legacy) {
        // 旧版は世界への反映後も、完了した行動判定の作業を保持していた。
        source.mockImplementationOnce((row, viewer) => {
          const [id, , messages] = calls.mock.calls.find(
            ([, role]) => role === "scene-resolve",
          )!;
          row.data.work = {
            id,
            kind: "resolve",
            target: "resolution",
            messages,
          };
          return resultSource(row, viewer);
        });
        await expect(access.scenes.tick(scene)).rejects.toThrow(
          "同じ呼出しIDに異なる要求を使用できません",
        );
        const stopped = (await access.scenes.latest(
          world,
          undefined,
          false,
          owner.actor,
        ))!;
        expect(stopped).toMatchObject({
          state: "paused",
          data: { resumeState: "reflecting", work: { kind: "resolve" } },
        });
        expect(stopped.data.projection).toBeDefined();
        calls.mockClear();
        expect((await cli.run(owner.profile, "resume")).state).toBe(
          "processing",
        );
      }
      await access.scenes.tick(scene);
      expect((await cli.run(owner.profile, "result")).state).toBe("finished");
      if (legacy)
        expect(calls.mock.calls.map(([, role]) => role)).toEqual([
          "scene-result",
        ]);
      const results = calls.mock.calls.filter(
        ([, role]) => role === "scene-result",
      );
      expect(results).toHaveLength(1);
      expect(JSON.parse(results[0]![2][1]!.content)).toHaveProperty(
        "confirmed",
      );
    } finally {
      source.mockRestore();
      calls.mockRestore();
      playback = undefined;
    }
  },
  60000,
);
test("世界IDによる切替なしに共通のモデル役割で共有を準備する", async () => {
  const [a, b, c] = people;
  selections.set(a!.actor, {
    candidates: [b!.actor, c!.actor],
    mergeInto: null,
  });
  const calls = vi.spyOn(runtime.agent.model, "complete");
  try {
    const id = await prepare(0, true);
    await access.scenes.tick(id);
    expect(
      calls.mock.calls
        .filter(([, role]) => role === "scene-background")
        .map(([, , , target]) => target),
    ).toEqual(["default", "default"]);
    expect((await cli.run(a!.profile, "status")).state).toBe("prepared");
    expect((await cli.run(b!.profile, "inbox")).invitations).toEqual([]);
    await end(0);
  } finally {
    calls.mockRestore();
  }
}, 60000);

test("2人へ並行して要請し、私的な情報を混ぜず全回答で早期確定する", async () => {
  const [a, b, c] = people;
  await presence(1);
  await presence(2);
  selections.set(a!.actor, {
    candidates: [b!.actor, c!.actor],
    mergeInto: null,
  });
  const calls = vi.spyOn(runtime.agent.model, "complete");
  try {
    const id = await prepare(0);
    await access.scenes.tick(id);
    expect((await cli.run(a!.profile, "status")).scene.synopsis).toBeNull();
    const one = await cli.run(b!.profile, "inbox"),
      two = await cli.run(c!.profile, "inbox");
    expect(one.invitations).toHaveLength(1);
    expect(two.invitations).toHaveLength(1);
    const outsider = JSON.parse(await readFile(c!.profile, "utf8"));
    expect(
      (
        await app.inject({
          url: `/api/worlds/${world}/scene/records?sceneId=${id}&kind=events`,
          headers: { authorization: `Bearer ${outsider.secret}` },
        })
      ).statusCode,
    ).toBe(404);
    expect((await cli.run(c!.profile, "inbox", "--after", one.next)).code).toBe(
      "CURSOR_INVALID",
    );
    expect(one.invitations[0].deadline).toBe(two.invitations[0].deadline);
    expect(JSON.stringify(one)).toContain(`PRIVATE-${b!.actor}`);
    expect(JSON.stringify(one)).not.toContain(`PRIVATE-${a!.actor}`);
    expect(JSON.stringify(one)).not.toContain(`PRIVATE-${c!.actor}`);
    const before = calls.mock.calls.length;
    await access.scenes.tick(id);
    expect(calls).toHaveBeenCalledTimes(before);
    const accepted = await cli.run(
      b!.profile,
      "invite",
      "--invitation",
      one.invitations[0].id,
      "--accept",
    );
    expect(accepted.device.actorId).toBe(b!.actor);
    expect((await cli.run(a!.profile, "status")).scene.shared.pending).toBe(1);
    await cli.run(
      c!.profile,
      "invite",
      "--invitation",
      two.invitations[0].id,
      "--reject",
    );
    await access.scenes.tick(id);
    const first = await cli.run(a!.profile, "status"),
      second = await cli.run(b!.profile, "status");
    expect(first.scene.id).toBe(second.scene.id);
    expect(first.state).toBe("prepared");
    expect(second.scene.shared.owner).toBe(false);
    expect(second.scene.synopsis).toBe(`VIEW-${b!.actor}`);
    expect(second.scene.synopsis).not.toContain(a!.actor);
    expect(
      (await cli.run(b!.profile, "recover", "--request", accepted.requestId))
        .scene.id,
    ).toBe(id);
    expect((await cli.run(b!.profile, "start")).code).toBe("STATE_CONFLICT");
    expect(
      (await access.scenes.shared.members(id)).filter(
        (m) => m.actor_id === b!.actor,
      ),
    ).toHaveLength(1);
    selections.set(c!.actor, { candidates: [b!.actor], mergeInto: null });
    const other = await prepare(2);
    await access.scenes.tick(other);
    expect((await cli.run(c!.profile, "status")).state).toBe("prepared");
    expect((await cli.run(b!.profile, "inbox")).invitations).toEqual([]);
    await end(0);
    expect((await cli.run(b!.profile, "result")).scene.id).toBe(id);
    await end(2);
  } finally {
    calls.mockRestore();
  }
}, 60000);
test("全員が不参加を選んでも開始者の単独の顔ぶれで準備できる", async () => {
  const [a, b, c] = people;
  await presence(1);
  await presence(2);
  selections.set(a!.actor, {
    candidates: [b!.actor, c!.actor],
    mergeInto: null,
  });
  const id = await prepare(0);
  await access.scenes.tick(id);
  for (const p of [b!, c!]) {
    const invite = (await cli.run(p.profile, "inbox")).invitations.find(
      (i: { sceneId: string }) => i.sceneId === id,
    );
    expect(
      (
        await cli.run(
          p.profile,
          "invite",
          "--invitation",
          invite.id,
          "--reject",
        )
      ).state,
    ).not.toBe("error");
  }
  await access.scenes.tick(id);
  expect(
    (await access.scenes.shared.members(id)).map((m) => m.actor_id),
  ).toEqual([a!.actor]);
  expect((await cli.run(a!.profile, "status")).state).toBe("prepared");
  await end(0);
}, 60000);

test("締切で未回答を閉じ、遅延承認で確定済みの顔ぶれを変えない", async () => {
  const [a, b] = people;
  await presence(1);
  selections.set(a!.actor, { candidates: [b!.actor], mergeInto: null });
  const id = await prepare(0);
  await access.scenes.tick(id);
  const invite = (await cli.run(b!.profile, "inbox")).invitations[0];
  const now = new Date(invite.deadline).getTime(),
    clock = vi
      .spyOn(access.scenes.shared, "now")
      .mockImplementation(() => new Date(now));
  try {
    expect(
      (
        await cli.run(
          b!.profile,
          "invite",
          "--invitation",
          invite.id,
          "--accept",
        )
      ).code,
    ).toBe("STATE_CONFLICT");
    await access.scenes.tick(id);
    const state = await cli.run(a!.profile, "status");
    expect(state.state).toBe("prepared");
    expect(
      (await access.scenes.shared.members(id))
        .filter((m) => m.state === "joined")
        .map((m) => m.actor_id),
    ).toEqual([a!.actor]);
    expect(
      (
        await cli.run(
          b!.profile,
          "invite",
          "--invitation",
          invite.id,
          "--accept",
        )
      ).code,
    ).toBe("STATE_CONFLICT");
  } finally {
    clock.mockRestore();
  }
  await end(0);
}, 60000);
test("同じ人物への複数要請の同時承認でも所属を重複させない", async () => {
  const [a, b, c] = people;
  await presence(1);
  selections.set(a!.actor, { candidates: [b!.actor], mergeInto: null });
  selections.set(c!.actor, { candidates: [b!.actor], mergeInto: null });
  const x = await prepare(0),
    y = await prepare(2);
  await access.scenes.tick(x);
  await access.scenes.tick(y);
  const invites = (await cli.run(b!.profile, "inbox")).invitations;
  expect(invites).toHaveLength(2);
  const saved = JSON.parse(await readFile(b!.profile, "utf8"));
  const replies = await Promise.all(
    invites.map((i: { id: string }) =>
      app.inject({
        method: "POST",
        url: `/api/worlds/${world}/scene`,
        headers: {
          authorization: `Bearer ${saved.secret}`,
          "x-gestaloka-request": "1",
        },
        payload: {
          requestId: randomUUID(),
          command: "invite",
          invitationId: i.id,
          accept: true,
        },
      }),
    ),
  );
  expect(replies.map((r) => r.statusCode).sort()).toEqual([202, 409]);
  expect(
    (
      await isolated.databases.postgres.query(
        "SELECT scene_id FROM world_scene_member WHERE world_id=$1 AND actor_id=$2 AND state='joined'",
        [world, b!.actor],
      )
    ).rowCount,
  ).toBe(1);
  const clock = vi
    .spyOn(access.scenes.shared, "now")
    .mockImplementation(
      () =>
        new Date(
          Math.max(
            ...invites.map((i: { deadline: string }) => Date.parse(i.deadline)),
          ),
        ),
    );
  try {
    await access.scenes.tick(x);
    await access.scenes.tick(y);
  } finally {
    clock.mockRestore();
  }
  await end(0);
  await end(2);
}, 60000);
test("相互に訪ねる同時開始を先行する参加待ちシーンへ合流させる", async () => {
  const [a, b] = people;
  await presence(0);
  await presence(1);
  selections.set(a!.actor, { candidates: [b!.actor], mergeInto: null });
  const x = await prepare(0),
    y = await prepare(1);
  selections.set(b!.actor, { candidates: [a!.actor], mergeInto: x });
  await access.scenes.tick(x);
  await access.scenes.tick(y);
  const invite = (await cli.run(b!.profile, "inbox")).invitations.find(
    (i: { sceneId: string }) => i.sceneId === x,
  );
  expect(invite).toBeDefined();
  await cli.run(b!.profile, "invite", "--invitation", invite.id, "--accept");
  await access.scenes.tick(x);
  expect((await cli.run(b!.profile, "status")).scene.id).toBe(x);
  expect((await cli.run(b!.profile, "recover", "--request", y)).scene.id).toBe(
    x,
  );
  expect((await access.scenes.shared.get(y))!.phase).toBe("merged");
  await end(0);
}, 60000);
test("退出後は未確定の履歴から次々に開始でき、元の確定後に一度ずつ反映する", async () => {
  const a = people[0]!,
    b = people[1]!;
  continuation = { actor: a.actor, creation: randomUUID() };
  try {
    await presence(0);
    await presence(1);
    selections.set(a.actor, { candidates: [b.actor], mergeInto: null });
    const parent = await prepare(0);
    await access.scenes.tick(parent);
    const invitation = (await cli.run(b.profile, "inbox")).invitations.find(
      (i: { sceneId: string }) => i.sceneId === parent,
    );
    expect(
      (
        await cli.run(
          b.profile,
          "invite",
          "--invitation",
          invitation.id,
          "--accept",
        )
      ).state,
    ).not.toBe("error");
    await access.scenes.tick(parent);
    await cli.run(a.profile, "start");
    denyDeparture = true;
    const denied = await cli.run(b.profile, "leave");
    expect(denied.state, JSON.stringify(denied)).toBe("processing");
    await access.scenes.tick(parent);
    expect((await cli.run(b.profile, "status")).scene.departed).toBeUndefined();
    expect(
      (await cli.run(b.profile, "prepare", "--purpose", "別の場へ")).code,
    ).toBe("STATE_CONFLICT");
    denyDeparture = false;
    const leaving = await cli.run(b.profile, "leave");
    expect(leaving.state).toBe("processing");
    await access.scenes.tick(parent);
    expect((await cli.run(b.profile, "status")).scene.departed).toBe(true);
    expect(
      (await cli.run(b.profile, "recover", "--request", leaving.requestId))
        .scene.id,
    ).toBe(parent);
    const source = (await access.scenes.latest(
      world,
      undefined,
      false,
      a.actor,
    ))!;
    expect(
      source.data.actions.filter((action) => action.id === denied.requestId),
    ).toHaveLength(1);
    const anchors = sceneAnchors(
      source.data.background!,
      source.data.events,
      source.data.startedAt,
      parent,
    );
    expect(
      await runtime.agent.store.context(graph).node(continuation.creation),
    ).toBeUndefined();
    const prefix = source.data.events.length;
    const first = await cli.run(
      b.profile,
      "prepare",
      "--purpose",
      "先ほど見た物を確かめる",
    );
    const child = first.scene.id;
    await access.scenes.tick(child);
    let next = (await access.scenes.latest(world, undefined, false, b.actor))!;
    expect(next.state).toBe("ready");
    expect(next.data.drafts?.[0]?.events).toHaveLength(prefix);
    await access.scenes.drafts.run(next, async () => {
      const context = runtime.agent.store.context(graph);
      expect((await context.node(continuation!.creation))?.text).toBe(
        "場に現れた持ち運べる物",
      );
      const own = anchors.edges.filter(
        (e) => e.kind === "see" && e.source === b.actor,
      );
      const paged = await context.historyPage(b.actor, "see", next.data.at);
      expect(paged.map((e) => e.id)).toEqual(
        expect.arrayContaining(own.map((e) => e.id)),
      );
      expect(
        (await context.history(b.actor, "see", "out", next.data.at)).map(
          (e) => e.id,
        ),
      ).toEqual(expect.arrayContaining(own.map((e) => e.id)));
    });
    await cli.run(b.profile, "start");
    await cli.run(b.profile, "act", "--text", "自分の範囲を確かめる");
    await access.scenes.tick(child);
    await cli.run(b.profile, "finish");
    const waitingCalls = vi.spyOn(runtime.agent.model, "complete");
    await access.scenes.tick(child);
    expect(waitingCalls).not.toHaveBeenCalled();
    waitingCalls.mockRestore();
    expect((await cli.run(b.profile, "status")).scene.waitingFor).toEqual([
      parent,
    ]);
    const third = (
      await cli.run(b.profile, "prepare", "--purpose", "さらに別の場へ")
    ).scene.id;
    await access.scenes.tick(third);
    next = (await access.scenes.latest(world, undefined, false, b.actor))!;
    expect(next.state).toBe("ready");
    expect(next.data.drafts?.map((d) => d.sceneId)).toEqual([parent, child]);
    // Remaining participants continue; the frozen child prefix and the former member's receipts stay unchanged.
    await cli.run(a.profile, "act", "--text", "退出後に周囲を確かめる");
    await access.scenes.tick(parent);
    expect(
      (await access.scenes.latest(world, undefined, false, a.actor))!.data
        .events.length,
    ).toBeGreaterThan(prefix);
    expect(
      (await access.scenes.latest(world, undefined, false, b.actor))!.data
        .drafts?.[0]?.events,
    ).toHaveLength(prefix);
    expect(
      (await cli.run(b.profile, "status", "--scene", parent)).scene.messages,
    ).toHaveLength(prefix);
    expect(
      (await cli.run(people[2]!.profile, "status", "--scene", parent)).code,
    ).toBe("SCENE_NOT_FOUND");
    await cli.run(a.profile, "finish", "--scene", parent);
    await access.scenes.tick(parent);
    await access.scenes.tick(child);
    expect((await cli.run(b.profile, "result", "--scene", child)).state).toBe(
      "finished",
    );
    const result = await cli.run(b.profile, "result", "--scene", parent);
    expect(result.state).toBe("finished");
    expect(result.scene.result).toContain("EXIT-OWN");
    expect(result.scene.result).not.toContain("公開された経験");
    expect((await cli.run(b.profile, "status")).scene.id).toBe(third);
    expect(
      (await cli.run(b.profile, "recover", "--request", leaving.requestId))
        .scene.id,
    ).toBe(third);
    await cli.run(b.profile, "start");
    await cli.run(b.profile, "finish");
    await access.scenes.tick(third);
    expect((await cli.run(b.profile, "result")).state).toBe("finished");
    const after = (
      await runtime.agent.store
        .context(graph)
        .history(b.actor, "see", "out", (await runtime.get(world)).at)
    ).map((e) => e.id);
    await access.scenes.tick(parent);
    await access.scenes.tick(child);
    expect(
      (
        await runtime.agent.store
          .context(graph)
          .history(b.actor, "see", "out", (await runtime.get(world)).at)
      ).map((e) => e.id),
    ).toEqual(after);
  } finally {
    continuation = undefined;
    denyDeparture = false;
  }
}, 120000);

test("開始者も退出後に共有を開始でき、全員退出で元のシーンだけを終了する", async () => {
  const a = people[0]!,
    b = people[1]!;
  await presence(1);
  selections.set(a.actor, { candidates: [b.actor], mergeInto: null });
  const parent = await prepare(0);
  await access.scenes.tick(parent);
  const invite = (await cli.run(b.profile, "inbox")).invitations.find(
    (i: { sceneId: string }) => i.sceneId === parent,
  );
  await cli.run(b.profile, "invite", "--invitation", invite.id, "--accept");
  await access.scenes.tick(parent);
  await cli.run(a.profile, "start");
  await cli.run(a.profile, "leave");
  await access.scenes.tick(parent);
  selections.set(a.actor, { candidates: [], mergeInto: null });
  const child = await prepare(0);
  await access.scenes.tick(child);
  expect((await cli.run(a.profile, "status")).state).toBe("prepared");
  const leaving = await cli.run(b.profile, "leave", "--scene", parent);
  expect(leaving.state).toBe("processing");
  await access.scenes.tick(parent);
  expect((await cli.run(b.profile, "result")).state).toBe("finished");
  expect((await cli.run(a.profile, "result", "--scene", parent)).state).toBe(
    "finished",
  );
  expect((await cli.run(a.profile, "status")).scene.id).toBe(child);
  await end(0);
}, 60000);

async function sharedGame(owner = 0, web = false) {
  await isolated.databases.postgres.query(
    "UPDATE world_scene_presence SET active=false WHERE world_id=$1",
    [world],
  );
  connections.clear();
  for (const i of [0, 1, 2]) await presence(i);
  const p = people[owner]!;
  selections.set(p.actor, {
    candidates: people.filter((_, i) => i !== owner).map((p) => p.actor),
    mergeInto: null,
  });
  const id = await prepare(owner, web);
  await access.scenes.tick(id);
  for (const person of people.filter((_, i) => i !== owner)) {
    const invitation = (
      await cli.run(person.profile, "inbox")
    ).invitations.find((v: { sceneId: string }) => v.sceneId === id);
    expect(invitation).toBeDefined();
    expect(
      (
        await cli.run(
          person.profile,
          "invite",
          "--invitation",
          invitation.id,
          "--accept",
        )
      ).state,
    ).not.toBe("error");
  }
  await access.scenes.tick(id);
  await cli.run(p.profile, "start");
  return id;
}
async function humanAct(index: number, text: string) {
  const p = people[index]!,
    requestId = randomUUID();
  const response = await app.inject({
    method: "POST",
    url: `/api/worlds/${world}/scene?actorId=${p.actor}`,
    headers: { cookie: p.cookie, "x-gestaloka-request": "1" },
    payload: { requestId, command: "act", actionText: text },
  });
  expect(response.statusCode, response.body).toBe(202);
  return requestId;
}
function playStep(input: PlayInput, targets: string[] = []) {
  const intents = input.request.intentions;
  return {
    type: "scene",
    events: intents.map((i) => ({
      actorId: i.actorId,
      text: `EVENT-${i.actionText}`,
      receipts: [...new Set([i.actorId, ...targets])].map((actor) => ({
        observerId: actor,
        text: `VIEW-${actor}-${i.actionText}`,
      })),
    })),
    decisions: Object.fromEntries(intents.map((i) => [i.actorId, "finished"])),
    newDecisions: targets.filter(
      (id) => !intents.some((i) => i.actorId === id),
    ),
  };
}

test.each(["standby", "separate", "same"] as const)(
  "受容から%sの相手へ承認なしで届け、本人の入力だけを返答として扱う",
  async (mode) => {
    const [caller, peer] = [people[0]!, people[1]!];
    await presence(0);
    await presence(1);
    let target: string | undefined, source: string;
    if (mode === "same") source = await sharedGame(0, true);
    else {
      if (mode === "separate") {
        target = (
          await cli.run(
            peer.profile,
            "prepare",
            "--purpose",
            "自分の作業をしている",
          )
        ).scene.id;
        await access.scenes.tick(target!);
        await cli.run(peer.profile, "start");
      }
      source = (
        await cli.run(
          caller.profile,
          "prepare",
          "--purpose",
          "相手に問いかける",
        )
      ).scene.id;
      await access.scenes.tick(source);
      await cli.run(caller.profile, "start");
    }
    const before = await access.scenes.latest(
      world,
      undefined,
      false,
      peer.actor,
    );
    playback = (input) => {
      const actor = input.request.controlledActorId,
        reply = actor === peer.actor,
        text = reply
          ? "選んだ返答が届いた"
          : "知っている範囲を尋ねる声が届いた";
      const decisions = Object.fromEntries(
        input.request.intentions.map((i) => [
          i.actorId,
          reply
            ? i.actorId === caller.actor
              ? "decide"
              : "finished"
            : { pending: "相手の返答を待つ" },
        ]),
      );
      return {
        type: "scene",
        events: [
          {
            actorId: actor,
            text: reply ? "本人が返答した" : "相手に問いかけた",
            receipts: [
              { observerId: actor, text, at: 0 },
              { observerId: reply ? caller.actor : peer.actor, text, at: 0 },
            ],
          },
        ],
        decisions,
        elapsedMs: 1000,
      };
    };
    try {
      if (mode === "same") await humanAct(0, "知っている範囲を尋ねる");
      else
        await cli.run(
          caller.profile,
          "act",
          "--text",
          "知っている範囲を尋ね、返答を待つ",
        );
      await access.scenes.tick(source);
      expect((await cli.run(peer.profile, "inbox")).invitations).toEqual([]);
      const inbox = await cli.run(peer.profile, "inbox"),
        offer = inbox.opportunities.find((o: { context: string[] }) =>
          o.context.some((text) =>
            text.includes("知っている範囲を尋ねる声が届いた"),
          ),
        );
      expect(offer.context.join(" ")).toContain(
        "知っている範囲を尋ねる声が届いた",
      );
      const staged = (await access.scenes.latest(
        world,
        undefined,
        false,
        caller.actor,
      ))!;
      expect(staged.data.events.every((e) => e.actorId !== peer.actor)).toBe(
        true,
      );
      expect(
        staged.data.events.every((e) =>
          e.receipts.every((r) => r.at === e.period.until),
        ),
      ).toBe(true);
      if (mode === "standby") {
        const received = (await access.scenes.latest(
          world,
          undefined,
          false,
          peer.actor,
        ))!;
        expect(received.id).not.toBe(before?.id);
        expect(received.data.actions).toEqual([]);
        await cli.run(caller.profile, "act", "--text", "問いに補足する");
        await access.scenes.tick(source);
        await access.scenes.tick(received.id);
        expect(
          (await access.scenes.latest(world, undefined, false, peer.actor))!
            .data.startedAt,
        ).toBeGreaterThanOrEqual(
          (await access.scenes.latest(world, undefined, false, caller.actor))!
            .data.at,
        );
        for (const extra of (
          await cli.run(peer.profile, "inbox")
        ).opportunities.filter((o: { id: string }) => o.id !== offer.id))
          await cli.run(
            peer.profile,
            "react",
            "--opportunity",
            extra.id,
            "--none",
          );
      }
      const response = await cli.run(
        peer.profile,
        "react",
        "--scene",
        offer.sceneId,
        "--opportunity",
        offer.id,
        "--text",
        "自分が知ることを返す",
      );
      expect(response.state, JSON.stringify(response)).not.toBe("error");
      target = (await access.scenes.latest(
        world,
        undefined,
        false,
        peer.actor,
      ))!.id;
      if (mode === "standby") {
        expect(target).not.toBe(source);
        await access.scenes.tick(target);
      }
      await access.scenes.tick(target);
      const answered = (await access.scenes.latest(
        world,
        undefined,
        false,
        peer.actor,
      ))!;
      const selected = answered.data.actions.find(
        (a) => a.text === "自分が知ることを返す",
      )!;
      expect(selected.state).toBe("complete");
      expect(selected.actorId ?? answered.actor_id).toBe(peer.actor);
      if (mode === "same")
        expect(
          answered.data.events.some(
            (e) =>
              e.actorId === peer.actor &&
              e.receipts.some(
                (r) =>
                  r.observerId === caller.actor &&
                  r.text === "選んだ返答が届いた",
              ),
          ),
        ).toBe(true);
      else {
        expect(answered.data.events.some((e) => e.actorId === peer.actor)).toBe(
          true,
        );
        const received = (await cli.run(caller.profile, "inbox"))
          .opportunities[0];
        expect(received.context).toEqual(["選んだ返答が届いた"]);
        await cli.run(
          caller.profile,
          "react",
          "--opportunity",
          received.id,
          "--none",
        );
      }
    } finally {
      playback = undefined;
    }
    await cli.run(caller.profile, "finish");
    await access.scenes.tick(source);
    if (target && target !== source) {
      await cli.run(peer.profile, "finish");
      await access.scenes.tick(target);
    }
  },
  120000,
);

test.each(["decline", "timeout"] as const)(
  "待機相手は参加せず%sを選べ、本文や本人の行動を増やさない",
  async (answer) => {
    const [caller, peer] = [people[0]!, people[1]!];
    await presence(0);
    await presence(1);
    const id = (
      await cli.run(caller.profile, "prepare", "--purpose", "挨拶する")
    ).scene.id;
    await access.scenes.tick(id);
    await cli.run(caller.profile, "start");
    playback = (input) => ({
      ...playStep(input),
      events: [
        {
          actorId: caller.actor,
          text: "挨拶した",
          receipts: [
            { observerId: caller.actor, text: "挨拶をした" },
            { observerId: peer.actor, text: "挨拶が届いた" },
          ],
        },
      ],
    });
    try {
      await cli.run(caller.profile, "act", "--text", "挨拶する");
      await access.scenes.tick(id);
      const offer = (await cli.run(peer.profile, "inbox")).opportunities[0];
      if (answer === "decline")
        expect(
          (
            await cli.run(
              peer.profile,
              "react",
              "--opportunity",
              offer.id,
              "--none",
            )
          ).state,
        ).not.toBe("error");
      else {
        const now = vi
          .spyOn(access.scenes.shared, "now")
          .mockReturnValue(new Date(Date.parse(offer.deadline) + 1));
        try {
          await access.scenes.shared.expire({ contactId: offer.id });
        } finally {
          now.mockRestore();
        }
      }
      expect((await cli.run(peer.profile, "inbox")).opportunities).toEqual([]);
      expect(
        (await access.scenes.latest(
          world,
          undefined,
          false,
          caller.actor,
        ))!.data.events.every((e) => e.actorId === caller.actor),
      ).toBe(true);
    } finally {
      playback = undefined;
    }
    await cli.run(caller.profile, "finish");
    await access.scenes.tick(id);
    const target = (await access.scenes.latest(
      world,
      undefined,
      false,
      peer.actor,
    ))!;
    await access.scenes.tick(target.id);
    await cli.run(peer.profile, "start");
    await cli.run(peer.profile, "finish");
    await access.scenes.tick(target.id);
  },
  60000,
);

async function humanPresence(
  index: number,
  active = true,
  connectionId = randomUUID(),
) {
  const p = people[index]!;
  const response = await app.inject({
    method: "POST",
    url: `/api/worlds/${world}/presence?actorId=${p.actor}`,
    headers: { cookie: p.cookie, "x-gestaloka-request": "1" },
    payload: { requestId: randomUUID(), connectionId, active },
  });
  expect(response.statusCode, response.body).toBe(200);
  return connectionId;
}
async function replyRound(scene: string, except?: string) {
  let found = false;
  for (const person of people) {
    const opportunity = (
      await cli.run(person.profile, "inbox")
    ).opportunities.find(
      (o: { sceneId: string; sourceInputId: string }) =>
        o.sceneId === scene && o.sourceInputId !== except,
    );
    if (!opportunity) continue;
    const reply = await cli.run(
      person.profile,
      "react",
      "--opportunity",
      opportunity.id,
      "--text",
      "相手へ働きかける",
    );
    expect(reply.state, JSON.stringify(reply)).not.toBe("error");
    await access.scenes.tick(scene);
    found = true;
    break;
  }
  expect(found).toBe(true);
}
function alternateBots(input: PlayInput) {
  const actor = input.request.controlledActorId;
  return playStep(input, [
    actor === people[1]!.actor ? people[2]!.actor : people[1]!.actor,
  ]);
}
async function pauseNotice(scene: string) {
  const owner = people[0]!,
    notice = (
      await isolated.databases.postgres.query<{ id: string }>(
        "SELECT id FROM world_scene_notice WHERE world_id=$1 AND actor_id=$2 AND scene_id=$3 AND kind='paused' ORDER BY id DESC LIMIT 1",
        [world, owner.actor, scene],
      )
    ).rows[0];
  expect(notice).toBeDefined();
  const after = Buffer.from(
    JSON.stringify({
      world,
      actor: owner.actor,
      position: (BigInt(notice!.id) - 1n).toString(),
    }),
  ).toString("base64url");
  const lines = await cli.lines(
    owner.profile,
    "listen",
    "--once",
    "--after",
    after,
  );
  expect(lines[0].items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sceneId: scene, kind: "paused" }),
    ]),
  );
}

test("Webの人間がいる場合は5往復で自動応答を止め、新規入力で計数を戻す", async () => {
  const scene = await sharedGame(0, false);
  const human = await humanPresence(0);
  playback = alternateBots;
  try {
    await cli.run(people[1]!.profile, "act", "--text", "相手に働きかける");
    await access.scenes.tick(scene);
    for (let i = 1; i <= 5; i++) {
      await replyRound(scene);
      expect((await access.scenes.shared.turns.control(scene)).rounds).toBe(i);
    }
    expect(
      (await cli.run(people[0]!.profile, "status")).scene.shared.flow,
    ).toBe("manual");
    await pauseNotice(scene);
    const calls = vi.spyOn(runtime.agent.model, "complete");
    await access.scenes.tick(scene);
    await humanPresence(0, false, human);
    await access.scenes.tick(scene);
    expect((await access.scenes.shared.turns.control(scene)).flow).toBe("open");
    expect(calls).not.toHaveBeenCalled();
    calls.mockRestore();
    const offers = await Promise.all(
      people.map((p) => cli.run(p.profile, "inbox")),
    );
    expect(
      offers.flatMap((r) => r.opportunities).filter((o) => o.sceneId === scene),
    ).toHaveLength(1);
    await humanAct(0, "ここから自分で働きかける");
    expect((await access.scenes.shared.turns.control(scene)).rounds).toBe(0);
    await access.scenes.tick(scene);
    await cli.run(people[0]!.profile, "finish");
    await access.scenes.tick(scene);
    // End processes accepted reactions, without requiring another external response.
    expect((await cli.run(people[0]!.profile, "status")).state).toBe(
      "finished",
    );
  } finally {
    playback = undefined;
  }
}, 120000);

test.each(["end", "timeout", "continue", "interrupt"] as const)(
  "人間不在の10往復で終了提案し、%sを処理して投票中は進めない",
  async (answer) => {
    const scene = await sharedGame(0, false);
    playback = alternateBots;
    try {
      const previous =
        answer === "interrupt"
          ? await humanAct(0, "Aへの反応機会を残す")
          : undefined;
      if (previous) {
        await access.scenes.tick(scene);
        await humanPresence(0, false);
      }
      const original = previous
        ? (await cli.run(people[1]!.profile, "inbox")).opportunities.find(
            (o: { sourceInputId: string }) => o.sourceInputId === previous,
          )
        : undefined;
      await cli.run(people[1]!.profile, "act", "--text", "相手に働きかける");
      await access.scenes.tick(scene);
      for (let i = 0; i < 10; i++) await replyRound(scene, previous);
      expect(await access.scenes.shared.turns.control(scene)).toMatchObject({
        rounds: 10,
        flow: "voting",
      });
      const proposals = await Promise.all(
        people.map((p) => cli.run(p.profile, "inbox")),
      );
      const proposal = proposals[0].proposals.find(
        (p: { sceneId: string }) => p.sceneId === scene,
      );
      expect(proposal).toBeDefined();
      expect(
        proposals.every((p) =>
          p.proposals.some((v: { id: string }) => v.id === proposal.id),
        ),
      ).toBe(true);
      const calls = vi.spyOn(runtime.agent.model, "complete");
      await access.scenes.tick(scene);
      expect(calls).not.toHaveBeenCalled();
      calls.mockRestore();
      if (answer === "interrupt") {
        await humanPresence(0);
        await humanAct(0, "投票中に人間が送る入力B");
        expect(await access.scenes.shared.turns.control(scene)).toMatchObject({
          rounds: 0,
          flow: "open",
        });
        await access.scenes.tick(scene);
        for (const person of people)
          expect(
            (await cli.run(person.profile, "inbox")).proposals.some(
              (p: { id: string }) => p.id === proposal.id,
            ),
          ).toBe(false);
        expect(
          (await cli.run(people[1]!.profile, "inbox")).opportunities.find(
            (o: { id: string }) => o.id === original.id,
          ).deadline,
        ).toBe(original.deadline);
        expect(
          (
            await cli.run(
              people[0]!.profile,
              "vote",
              "--proposal",
              proposal.id,
              "--end",
            )
          ).code,
        ).toBe("STATE_CONFLICT");
        const now = vi
          .spyOn(access.scenes.shared, "now")
          .mockImplementation(
            () => new Date(Date.parse(proposal.deadline) + 1),
          );
        try {
          await access.scenes.shared.expire({ proposalId: proposal.id });
        } finally {
          now.mockRestore();
        }
        expect(await access.scenes.shared.turns.control(scene)).toMatchObject({
          rounds: 0,
          flow: "open",
        });
        await cli.run(people[0]!.profile, "finish");
        for (let i = 0; i < 3; i++) await access.scenes.tick(scene);
        expect((await cli.run(people[0]!.profile, "result")).state).toBe(
          "finished",
        );
        return;
      }
      if (answer === "timeout") {
        await cli.run(
          people[0]!.profile,
          "vote",
          "--proposal",
          proposal.id,
          "--end",
        );
        const now = vi
          .spyOn(access.scenes.shared, "now")
          .mockImplementation(
            () => new Date(Date.parse(proposal.deadline) + 1),
          );
        try {
          await access.scenes.shared.expire({ proposalId: proposal.id });
        } finally {
          now.mockRestore();
        }
      } else {
        for (let i = 0; i < people.length; i++) {
          const result = await cli.run(
            people[i]!.profile,
            "vote",
            "--proposal",
            proposal.id,
            answer === "continue" ? "--continue" : "--end",
          );
          expect(result.state, JSON.stringify(result)).not.toBe("error");
        }
      }
      await access.scenes.tick(scene);
      if (answer === "continue") {
        let prior = proposal.id;
        for (let cycle = 0; cycle < 2; cycle++) {
          for (let i = 0; i < 10; i++) await replyRound(scene);
          expect(
            (await cli.run(people[0]!.profile, "status")).scene,
          ).toMatchObject({
            state: "active",
            shared: { rounds: 10, flow: "voting" },
          });
          const next = (
            await cli.run(people[0]!.profile, "inbox")
          ).proposals.find((p: { sceneId: string }) => p.sceneId === scene);
          expect(next.id).not.toBe(prior);
          const stopped = vi.spyOn(runtime.agent.model, "complete");
          await access.scenes.tick(scene);
          expect(stopped).not.toHaveBeenCalled();
          stopped.mockRestore();
          for (const person of people)
            await cli.run(
              person.profile,
              "vote",
              "--proposal",
              next.id,
              "--continue",
            );
          await access.scenes.tick(scene);
          expect(await access.scenes.shared.turns.control(scene)).toMatchObject(
            {
              rounds: 0,
              flow: "open",
            },
          );
          prior = next.id;
        }
        expect(
          (
            await isolated.databases.postgres.query(
              "SELECT id FROM world_scene_notice WHERE scene_id=$1 AND kind='paused'",
              [scene],
            )
          ).rows,
        ).toEqual([]);
        await cli.run(people[0]!.profile, "finish");
        await access.scenes.tick(scene);
      }
      expect((await cli.run(people[0]!.profile, "result")).state).toBe(
        "finished",
      );
      for (const person of people)
        expect((await cli.run(person.profile, "result")).state).toBe(
          "finished",
        );
    } finally {
      playback = undefined;
    }
  },
  120000,
);

test.each([false, true])(
  "投票が割れたら終了票だけを退出させ、NPCの未実行部分と続行側の入力を保つ（開始者が終了=%s）",
  async (ownerEnds) => {
    const scene = await sharedGame(0, false),
      ender = people[ownerEnds ? 0 : 1]!,
      continuer = people[ownerEnds ? 1 : 0]!,
      speaker = people[2]!,
      npc = randomUUID(),
      condition = randomUUID();
    let child: string | undefined;
    const pending = {
      actorId: npc,
      actionText: "読みかけの資料を調べ、分かった範囲を伝える",
      continuing: true,
    };
    try {
      playback = (input) => playStep(input, [ender.actor, continuer.actor]);
      await humanAct(2, "二人に問いかける");
      await access.scenes.tick(scene);
      const reply = async (person: typeof ender, text: string) => {
        const offer = (
          await cli.run(person.profile, "inbox")
        ).opportunities.find((o: { sceneId: string }) => o.sceneId === scene);
        const result = await cli.run(
          person.profile,
          "react",
          "--opportunity",
          offer.id,
          "--text",
          text,
        );
        expect(result.state, JSON.stringify(result)).not.toBe("error");
        return result.requestId as string;
      };
      const endedInput = await reply(ender, "終了前に選んでいた返答"),
        continuedInput = await reply(continuer, "続きを確かめる返答");
      await runtime.agent.store.commit(
        await runtime.agent.store.claim(graph, randomUUID()),
        runtime.agent.store.context(graph),
        {
          commitId: randomUUID(),
          at: 0,
          changes: {
            nodes: [
              { id: npc, kind: "existence", text: "資料を調べている存在" },
              {
                id: condition,
                kind: "script",
                text: "自分の資料から確かめたことだけを伝える",
              },
            ],
            edges: [
              {
                id: randomUUID(),
                kind: "status",
                role: "content",
                source: npc,
                target: condition,
                period: { from: 0 },
              },
            ],
            endEdges: [],
          },
        },
      );
      const before = (await access.scenes.latest(
        world,
        undefined,
        false,
        people[0]!.actor,
        scene,
      ))!;
      before.data.background!.participants.push(npc);
      before.data.views[npc] = await runtime.agent.intentView(
        graph,
        npc,
        before.data.at,
      );
      before.data.pending[npc] = pending;
      before.data.intentions[npc] = pending;
      await runtime.pool.query(
        "UPDATE world_scene SET data=$2,state='active' WHERE id=$1",
        [scene, before.data],
      );
      const proposal = await access.scenes.shared.transaction(async (db) => {
        await access.scenes.shared.lock(db, world);
        await db.query(
          "UPDATE world_shared_scene SET rounds=10,continuation=$2 WHERE scene_id=$1",
          [
            scene,
            {
              turn: {
                id: before.data.actions[0]!.id,
                sourceKind: "bot",
                reply: true,
              },
              targets: [ender.actor, continuer.actor],
            },
          ],
        );
        return access.scenes.shared.turns.propose(
          db,
          before,
          people.map((p) => p.actor),
        );
      });
      await cli.run(ender.profile, "vote", "--proposal", proposal, "--end");
      await cli.run(
        continuer.profile,
        "vote",
        "--proposal",
        proposal,
        "--continue",
      );
      expect((await access.scenes.shared.turns.control(scene)).flow).toBe(
        "voting",
      );
      const result = await cli.run(
        speaker.profile,
        "vote",
        "--proposal",
        proposal,
        "--continue",
      );
      expect(result.state).not.toBe("error");
      const split = (await access.scenes.latest(
        world,
        undefined,
        false,
        people[0]!.actor,
        scene,
      ))!;
      expect(split.data.events).toEqual(before.data.events);
      expect(split.data.pending[npc]).toEqual(pending);
      expect(split.data.departures?.[ender.actor]).toBe(
        before.data.events.length,
      );
      expect(split.data.departures?.[continuer.actor]).toBeUndefined();
      expect(await access.scenes.shared.turns.control(scene)).toMatchObject({
        flow: "open",
        rounds: 0,
        end_reason: null,
      });
      expect(
        (await cli.run(ender.profile, "status", "--scene", scene)).state,
      ).toBe("departed");
      expect(
        (
          await cli.run(
            ender.profile,
            "act",
            "--scene",
            scene,
            "--text",
            "退出後の入力",
          )
        ).code,
      ).toBe("STATE_CONFLICT");
      for (const offer of (await cli.run(ender.profile, "inbox")).opportunities)
        expect(offer.sceneId).not.toBe(scene);
      const inputs: PlayInput[] = [];
      playback = (input) => {
        inputs.push(input);
        return {
          ...playStep(input),
          decisions: {
            [continuer.actor]: "decide",
            [npc]: { pending: pending.actionText },
          },
        };
      };
      await access.scenes.tick(scene);
      const after = (await access.scenes.latest(
        world,
        undefined,
        false,
        people[0]!.actor,
        scene,
      ))!;
      expect(inputs).toHaveLength(1);
      expect(inputs[0]!.request.controlledInputs.map((i) => i.id)).toEqual([
        continuedInput,
      ]);
      expect(inputs[0]!.request.intentions).toContainEqual(pending);
      expect(after.data.pending[npc]).toEqual(pending);
      expect(after.state).toBe("active");
      expect(after.data.result).toBeUndefined();
      expect(after.data.actions.some((a) => a.id === endedInput)).toBe(false);
      expect(after.data.events.slice(0, before.data.events.length)).toEqual(
        before.data.events,
      );
      expect(
        (
          await access.sceneRecords(ender.id, world, {
            sceneId: scene,
            kind: "events",
            actorId: ender.actor,
          })
        ).items,
      ).toHaveLength(before.data.events.length);
      child = (
        await cli.run(ender.profile, "prepare", "--purpose", "別の場面へ進む")
      ).scene.id;
    } finally {
      playback = undefined;
      if (child)
        await runtime.pool.query("DELETE FROM world_scene WHERE id=$1", [
          child,
        ]);
      await runtime.pool.query("DELETE FROM world_scene WHERE id=$1", [scene]);
    }
  },
  120000,
);

test("同じ時点の複数botの並行回答はまとめて1往復と数える", async () => {
  const scene = await sharedGame(0, false);
  playback = (input) =>
    playStep(
      input,
      input.request.reactionTo ? [] : people.slice(1).map((p) => p.actor),
    );
  try {
    await cli.run(people[0]!.profile, "act", "--text", "二人へ働きかける");
    await access.scenes.tick(scene);
    const replies = await Promise.all(
      people.slice(1).map(async (person) => {
        const o = (await cli.run(person.profile, "inbox")).opportunities.find(
          (o: { sceneId: string }) => o.sceneId === scene,
        );
        return cli.run(
          person.profile,
          "react",
          "--opportunity",
          o.id,
          "--text",
          "本人が選んだ反応",
        );
      }),
    );
    expect(replies.every((r) => r.state !== "error")).toBe(true);
    await access.scenes.tick(scene);
    expect((await access.scenes.shared.turns.control(scene)).rounds).toBe(1);
    await cli.run(people[0]!.profile, "finish");
    await access.scenes.tick(scene);
    expect((await cli.run(people[0]!.profile, "result")).state).toBe(
      "finished",
    );
  } finally {
    playback = undefined;
  }
}, 60000);

test("並行の回答をまとめ、割り込みBの後もAの範囲へ回答し、反応なしから次の指名へ進める", async () => {
  const [a, b, c] = people,
    id = await sharedGame();
  const resolved: PlayInput[] = [];
  // Human input reaches each bot in its own view, without private observations of the other bot.
  playback = (input) => {
    resolved.push(structuredClone(input));
    return playStep(
      input,
      input.request.reactionTo ? [a!.actor] : [b!.actor, c!.actor],
    );
  };
  try {
    const beforeAct = Date.now();
    const first = await humanAct(0, "A");
    await access.scenes.tick(id);
    const inboxB = await cli.run(b!.profile, "inbox"),
      inboxC = await cli.run(c!.profile, "inbox");
    const one = inboxB.opportunities.find(
        (o: { sourceInputId: string }) => o.sourceInputId === first,
      ),
      two = inboxC.opportunities.find(
        (o: { sourceInputId: string }) => o.sourceInputId === first,
      );
    expect(one.deadline).toBe(two.deadline);
    expect(Date.parse(one.deadline)).toBeGreaterThanOrEqual(beforeAct + 300000);
    expect(Date.parse(one.deadline)).toBeLessThanOrEqual(Date.now() + 300000);
    expect(JSON.stringify(one.context)).not.toContain(`VIEW-${c!.actor}-`);
    expect(JSON.stringify(two.context)).not.toContain(`VIEW-${b!.actor}-`);
    const second = await humanAct(0, "B");
    await access.scenes.tick(id);
    expect(
      (await cli.run(b!.profile, "inbox")).opportunities.find(
        (o: { id: string }) => o.id === one.id,
      ).deadline,
    ).toBe(one.deadline);
    const before = resolved.length;
    const answer = await cli.run(
      b!.profile,
      "react",
      "--opportunity",
      one.id,
      "--text",
      "Aへの返答",
    );
    await access.scenes.tick(id);
    expect(resolved).toHaveLength(before);
    const none = await cli.run(
      c!.profile,
      "react",
      "--opportunity",
      two.id,
      "--none",
    );
    expect(none.state).not.toBe("error");
    await access.scenes.tick(id);
    expect(resolved).toHaveLength(before + 1);
    const reaction = resolved.at(-1)!;
    expect(reaction.request.reactionTo!.inputId).toBe(first);
    expect(reaction.request.reactionTo!.seenEventIds[b!.actor]).toEqual(
      one.seenEventIds,
    );
    expect(reaction.request.controlledInputs.map((i) => i.text)).toEqual([
      "Aへの返答",
    ]);
    const bEvent = reaction.sceneHistory.find((e) => e.inputId === second)!;
    expect(one.seenEventIds).not.toContain(bEvent.id);
    expect(
      (await cli.run(b!.profile, "recover", "--request", answer.requestId))
        .state,
    ).not.toBe("error");
    expect(
      (await cli.run(b!.profile, "react", "--opportunity", one.id, "--none"))
        .code,
    ).toBe("STATE_CONFLICT");
    const laterB = (await cli.run(b!.profile, "inbox")).opportunities.find(
        (o: { sourceInputId: string }) => o.sourceInputId === second,
      ),
      laterC = (await cli.run(c!.profile, "inbox")).opportunities.find(
        (o: { sourceInputId: string }) => o.sourceInputId === second,
      );
    await Promise.all([
      cli.run(b!.profile, "react", "--opportunity", laterB.id, "--none"),
      cli.run(
        c!.profile,
        "react",
        "--opportunity",
        laterC.id,
        "--text",
        "次の指名への返答",
      ),
    ]);
    await access.scenes.tick(id);
    expect(
      resolved.at(-1)!.request.controlledInputs.map((i) => i.text),
    ).toEqual(["次の指名への返答"]);
    const input = await humanAct(0, "期限を過ぎる問い");
    await access.scenes.tick(id);
    const pending = (await cli.run(b!.profile, "inbox")).opportunities.find(
      (o: { sourceInputId: string }) => o.sourceInputId === input,
    );
    const wave = (
      await isolated.databases.postgres.query(
        "SELECT wave_id FROM world_scene_reply WHERE id=$1",
        [pending.id],
      )
    ).rows[0].wave_id;
    const now = vi
      .spyOn(access.scenes.shared, "now")
      .mockImplementation(() => new Date(Date.parse(pending.deadline) + 1));
    try {
      await access.scenes.shared.expire({ waveId: wave });
      expect(
        (
          await cli.run(
            b!.profile,
            "react",
            "--opportunity",
            pending.id,
            "--text",
            "遅延回答",
          )
        ).code,
      ).toBe("STATE_CONFLICT");
      const calls = resolved.length;
      await access.scenes.tick(id);
      expect(resolved).toHaveLength(calls);
    } finally {
      now.mockRestore();
    }
    await cli.run(a!.profile, "finish");
    const queued = (
      await runtime.pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM world_scene_turn WHERE scene_id=$1 AND state='queued'",
        [id],
      )
    ).rows[0]!.count;
    for (let i = 0; i <= queued; i++) await access.scenes.tick(id);
    expect((await cli.run(c!.profile, "result")).state).toBe("finished");
  } finally {
    playback = undefined;
  }
}, 120000);

test("同じ品への意図は到着順を逆にしても両方を一度の解決へ渡し、資源を一度だけ反映する", async () => {
  const store = runtime.agent.store;
  try {
    for (const order of [
      [1, 2],
      [2, 1],
    ]) {
      const at = (await runtime.get(world)).at,
        place = (await runtime.get(world)).root_ids[0]!,
        item = randomUUID(),
        old = randomUUID(),
        content = randomUUID(),
        about = randomUUID(),
        state = randomUUID();
      inventory = { item, state, content, about, place, remaining: 1 };
      await store.commit(
        await store.claim(graph, randomUUID()),
        store.context(graph),
        {
          commitId: randomUUID(),
          at,
          changes: {
            nodes: [
              { id: item, kind: "existence", text: "共有の消費資源" },
              {
                id: old,
                kind: "script",
                text: JSON.stringify({ quantity: 1 }),
              },
            ],
            revisions: [],
            endEdges: [],
            edges: [
              {
                id: content,
                kind: "status",
                role: "content",
                source: item,
                target: old,
                period: { from: at },
              },
              {
                id: about,
                kind: "status",
                role: "about",
                source: old,
                target: place,
                period: { from: at },
              },
            ],
          },
        },
      );
      const scene = await sharedGame();
      const groups: PlayInput[] = [];
      playback = (input) => {
        if (!input.request.reactionTo)
          return playStep(input, [people[1]!.actor, people[2]!.actor]);
        groups.push(structuredClone(input));
        inventory!.remaining = Math.max(0, inventory!.remaining - 1);
        return playStep(input);
      };
      const origin = await humanAct(0, "同じ品について二人へ働きかける");
      await access.scenes.tick(scene);
      for (let i = 0; i < order.length; i++) {
        const person = people[order[i]!]!,
          opportunity = (
            await cli.run(person.profile, "inbox")
          ).opportunities.find(
            (o: { sourceInputId: string }) => o.sourceInputId === origin,
          );
        await cli.run(
          person.profile,
          "react",
          "--opportunity",
          opportunity.id,
          "--text",
          "この品を一つ使う",
        );
        await access.scenes.tick(scene);
        expect(groups).toHaveLength(i);
      }
      expect(groups).toHaveLength(1);
      expect(
        groups[0]!.request.controlledInputs.map((i) => ({
          actorId: i.actorId,
          text: i.text,
        })),
      ).toEqual(
        people
          .slice(1)
          .map((p) => ({ actorId: p.actor, text: "この品を一つ使う" }))
          .sort((a, b) => a.actorId.localeCompare(b.actorId)),
      );
      expect((await store.context(graph).node(old))!.text).toBe(
        JSON.stringify({ quantity: 1 }),
      );
      expect(await store.context(graph).node(state)).toBeUndefined();
      await cli.run(people[0]!.profile, "finish");
      await access.scenes.tick(scene);
      const row = (await access.scenes.latest(
        world,
        undefined,
        false,
        people[0]!.actor,
      ))!;
      expect(row.state).toBe("result");
      const active = await store
        .context(graph)
        .relations(item, "status", "out", row.data.at);
      expect(active).toHaveLength(1);
      expect(
        JSON.parse((await store.context(graph).node(active[0]!.target))!.text),
      ).toEqual({ quantity: 0 });
      const op = (
        await isolated.databases.postgres.query(
          "SELECT commit_id FROM world_operation WHERE id=$1",
          [row.data.operationId],
        )
      ).rows[0];
      expect(
        (await store.receipt(graph, op.commit_id))!.changes.nodes.filter(
          (n) => n.id === state,
        ),
      ).toHaveLength(1);
      await access.scenes.tick(scene);
      expect(
        (
          await store
            .context(graph)
            .relations(item, "status", "out", row.data.at)
        ).map((e) => e.id),
      ).toEqual(active.map((e) => e.id));
      playback = undefined;
      inventory = undefined;
    }
  } finally {
    playback = undefined;
    inventory = undefined;
  }
}, 120000);

test("旧版のシーンも共通の入力キューへ引き継ぎ、再送で重複させない", async () => {
  const owner = people[0]!,
    id = await sharedGame(0, false);
  const originalOffer = (
    await runtime.pool.query<{ id: string }>(
      "SELECT id FROM world_scene_wave WHERE scene_id=$1 AND state='pending' AND source_kind='idle'",
      [id],
    )
  ).rows[0]!;
  await isolated.databases.postgres.query(
    "UPDATE world_scene SET data=data-'turns' WHERE id=$1",
    [id],
  );
  const accepted = await cli.run(
    owner.profile,
    "act",
    "--text",
    "保存した入力を続ける",
  );
  const saved = (await access.scenes.latest(
    world,
    undefined,
    false,
    owner.actor,
  ))!;
  expect(saved.data.turn).toBeUndefined();
  expect(saved.data.actions).toEqual([]);
  expect(saved.data.turns).toBe(true);
  await access.scenes.tick(id);
  expect(
    (await access.scenes.latest(
      world,
      undefined,
      false,
      owner.actor,
    ))!.data.actions.map((a) => a.id),
  ).toEqual([accepted.requestId]);
  expect(
    (await cli.run(owner.profile, "recover", "--request", accepted.requestId))
      .state,
  ).toBe("waiting_input");
  await cli.run(owner.profile, "finish");
  await access.scenes.tick(id);
  expect((await cli.run(owner.profile, "result")).state).toBe("finished");
  expect(
    (
      await runtime.pool.query(
        "SELECT state FROM world_scene_wave WHERE id=$1",
        [originalOffer.id],
      )
    ).rows[0].state,
  ).toBe("closed");
  expect(
    (await access.scenes.latest(world, undefined, false, owner.actor))!.data
      .actions,
  ).toHaveLength(1);
}, 60000);

test.each([true, false])(
  "開始者のWeb=%sでも、切断後は同席botの判断から終了し本人の記録へ復帰できる",
  async (web) => {
    const scene = await sharedGame(0, web),
      owner = people[0]!,
      peer = people[1]!;
    const human = web ? await humanPresence(0) : undefined;
    playback = (input) => {
      expect(input.sleepingPlayerIds.includes(owner.actor)).toBe(
        !!input.request.reactionTo,
      );
      return {
        ...playStep(input, [owner.actor, peer.actor]),
        ...(input.request.reactionTo ? { concluded: true } : {}),
      };
    };
    try {
      if (web) await humanAct(0, "相手へ働きかける");
      else await cli.run(owner.profile, "act", "--text", "相手へ働きかける");
      await access.scenes.tick(scene);
      const pending = (await cli.run(peer.profile, "inbox")).opportunities.find(
        (o: { sceneId: string }) => o.sceneId === scene,
      );
      expect(pending).toBeDefined();
      await presence(0, false);
      if (human) await humanPresence(0, false, human);
      const snapshot = (await access.scenes.latest(
        world,
        undefined,
        false,
        owner.actor,
      ))!;
      expect(snapshot.state).toBe("active");
      expect(snapshot.data.departures).toBeUndefined();
      await cli.run(
        peer.profile,
        "react",
        "--opportunity",
        pending.id,
        "--text",
        "本人が選んだ返答",
      );
      await access.scenes.tick(scene);
      const result = (await access.scenes.latest(
        world,
        undefined,
        false,
        owner.actor,
      ))!;
      expect(result.state).toBe("result");
      expect(result.data.ending).toBe("concluded");
      expect(
        result.data.events.filter((e) => e.actorId === owner.actor),
      ).toHaveLength(1);
      const source = await access.scenes.resultSource(result, owner.actor);
      expect(
        result.data.events
          .at(-1)!
          .receipts.some((r) => r.observerId === owner.actor),
      ).toBe(false);
      expect(source.connectionAbsences).toEqual([{ from: 1, through: 2 }]);
      const calls = vi.spyOn(runtime.agent.model, "complete"),
        at = (await runtime.get(world)).at;
      await presence(0);
      expect((await cli.run(owner.profile, "result")).state).toBe("finished");
      expect((await runtime.get(world)).at).toBe(at);
      expect(calls).not.toHaveBeenCalled();
      calls.mockRestore();
    } finally {
      playback = undefined;
    }
  },
  120000,
);

test("全員切断は退出を作らず保存し、開始者以外の再接続で同じ反応機会へ自動復帰する", async () => {
  const scene = await sharedGame(0, false),
    owner = people[0]!,
    peer = people[1]!;
  playback = (input) => ({
    ...playStep(input, [peer.actor]),
    ...(input.request.reactionTo ? { concluded: true } : {}),
  });
  try {
    await cli.run(owner.profile, "act", "--text", "返答を待つ");
    await access.scenes.tick(scene);
    const before = (await access.scenes.latest(
        world,
        undefined,
        false,
        owner.actor,
      ))!,
      pending = (await cli.run(peer.profile, "inbox")).opportunities.find(
        (o: { sceneId: string }) => o.sceneId === scene,
      ),
      at = (await runtime.get(world)).at;
    const calls = vi.spyOn(runtime.agent.model, "complete");
    for (let i = 0; i < people.length; i++) await presence(i, false);
    const paused = (await access.scenes.latest(
      world,
      undefined,
      false,
      owner.actor,
    ))!;
    expect(paused.state).toBe("paused");
    expect(paused.data.departures).toBeUndefined();
    expect(paused.data.events).toEqual(before.data.events);
    await access.scenes.tick(scene);
    expect(calls).not.toHaveBeenCalled();
    expect((await runtime.get(world)).at).toBe(at);
    calls.mockRestore();
    await presence(1);
    await presence(1, false);
    await presence(1);
    await access.scenes.tick(scene);
    expect((await access.scenes.shared.turns.control(scene)).flow).toBe("open");
    expect(
      (await cli.run(peer.profile, "inbox")).opportunities.some(
        (o: { id: string }) => o.id === pending.id,
      ),
    ).toBe(true);
    await cli.run(
      peer.profile,
      "react",
      "--opportunity",
      pending.id,
      "--text",
      "再接続後の返答",
    );
    await access.scenes.tick(scene);
    expect((await cli.run(owner.profile, "result")).state).toBe("finished");
  } finally {
    playback = undefined;
  }
}, 120000);

test.each(["deadline", "reconnect"])(
  "全員切断の10分後は%sでも終了し、再接続前の期限では終了しない",
  async (trigger) => {
    const scene = await sharedGame(0, false),
      owner = people[0]!,
      peer = people[1]!,
      start = access.scenes.shared.now().getTime(),
      now = vi
        .spyOn(access.scenes.shared, "now")
        .mockReturnValue(new Date(start));
    playback = (input) => playStep(input, [peer.actor]);
    try {
      await cli.run(owner.profile, "act", "--text", "返答を待つ");
      await access.scenes.tick(scene);
      const before = (await access.scenes.latest(
        world,
        undefined,
        false,
        owner.actor,
      ))!;
      for (let i = 0; i < people.length; i++) await presence(i, false);
      await isolated.databases.postgres.query(
        "UPDATE world_shared_scene SET inactive_until=NULL,resume_flow=NULL WHERE scene_id=$1",
        [scene],
      );
      await access.scenes.shared.setup();
      const first = (await access.scenes.shared.turns.control(scene))
        .inactive_until!;
      expect(first.getTime()).toBe(start + 600000);
      now.mockReturnValue(new Date(start + 300000));
      await access.scenes.shared.setup();
      expect(
        (await access.scenes.shared.turns.control(scene)).inactive_until,
      ).toEqual(first);
      await presence(1);
      await access.scenes.tick(scene);
      expect(
        (await access.scenes.shared.turns.control(scene)).inactive_until,
      ).toBeNull();
      await presence(1, false);
      const second = (await access.scenes.shared.turns.control(scene))
        .inactive_until!;
      expect(second.getTime()).toBe(start + 900000);
      const calls = vi.spyOn(runtime.agent.model, "complete");
      for (const time of [first.getTime(), second.getTime() - 1]) {
        now.mockReturnValue(new Date(time));
        await access.scenes.shared.expire({ inactiveSceneId: scene });
        await access.scenes.tick(scene);
        expect((await access.scenes.shared.turns.control(scene)).flow).toBe(
          "inactive",
        );
      }
      expect(calls).not.toHaveBeenCalled();
      calls.mockRestore();
      now.mockReturnValue(second);
      if (trigger === "deadline")
        await access.scenes.shared.expire({ inactiveSceneId: scene });
      else await presence(1);
      await access.scenes.tick(scene);
      const result = (await access.scenes.latest(
        world,
        undefined,
        false,
        owner.actor,
      ))!;
      expect(result.state).toBe("result");
      expect(result.data.ending).toBe("dissolved");
      expect(result.data.events).toEqual(before.data.events);
      expect(result.data.departures).toBeUndefined();
      const callsAfter = vi.spyOn(runtime.agent.model, "complete");
      await access.scenes.shared.expire({ inactiveSceneId: scene });
      await presence(1);
      await access.scenes.tick(scene);
      expect(callsAfter).not.toHaveBeenCalled();
      callsAfter.mockRestore();
    } finally {
      now.mockRestore();
      playback = undefined;
    }
  },
  120000,
);

test("再接続は接続の休止だけを解除し、別の理由で保留した生成を動かさない", async () => {
  const scene = await sharedGame(0, false);
  for (let i = 0; i < people.length; i++) await presence(i, false);
  await isolated.databases.postgres.query(
    `UPDATE world_scene SET data=data || '{"error":"呼出し上限","limitReached":true}'::jsonb WHERE id=$1`,
    [scene],
  );
  const calls = vi.spyOn(runtime.agent.model, "complete");
  try {
    await presence(1);
    await access.scenes.tick(scene);
    const row = (await access.scenes.latest(
      world,
      undefined,
      false,
      people[0]!.actor,
    ))!;
    expect(row.state).toBe("paused");
    expect(row.data.error).toBe("呼出し上限");
    expect(row.data.limitReached).toBe(true);
    expect(
      (await access.scenes.shared.turns.control(scene)).inactive_until,
    ).toBeNull();
    expect(calls).not.toHaveBeenCalled();
  } finally {
    calls.mockRestore();
    await isolated.databases.postgres.query(
      "UPDATE world_scene SET data=data-'error'-'limitReached' WHERE id=$1",
      [scene],
    );
    await cli.run(people[0]!.profile, "resume");
    await cli.run(people[0]!.profile, "finish");
    await access.scenes.tick(scene);
  }
}, 120000);

test("生成中も割り込みと終了を受理し、受理済み入力を処理してから一度だけ確定する", async () => {
  const scene = await sharedGame(),
    owner = people[0]!;
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve;
    });
  const resolved: PlayInput[] = [];
  playback = async (input) => {
    resolved.push(input);
    if (resolved.length === 1) {
      entered();
      await gate;
    }
    return playStep(input);
  };
  let running: Promise<void> | undefined;
  try {
    const first = await humanAct(0, "生成中の入力A");
    running = access.scenes.tick(scene);
    await started;
    const later = humanAct(0, "割り込む入力B");
    const second = await Promise.race([
      later,
      new Promise<undefined>((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (!second) {
      release();
      await running;
      await later;
    }
    expect(second).toBeTypeOf("string");
    const finish = cli.run(owner.profile, "finish");
    const accepted = await Promise.race([
      finish,
      new Promise<undefined>((resolve) => setTimeout(resolve, 3000)),
    ]);
    release();
    await running;
    expect(accepted).toBeDefined();
    expect((await finish).state).not.toBe("error");
    expect(
      (await cli.run(owner.profile, "act", "--text", "終了後の入力C")).code,
    ).toBe("STATE_CONFLICT");
    await access.scenes.tick(scene);
    const final = (await access.scenes.latest(
      world,
      undefined,
      false,
      owner.actor,
    ))!;
    expect(final.state).toBe("result");
    expect(final.data.actions.map((a) => a.id)).toEqual([first, second]);
    expect(final.data.events.map((e) => e.inputId)).toEqual([first, second]);
    expect(resolved.map((r) => r.request.controlledInputs[0]!.text)).toEqual([
      "生成中の入力A",
      "割り込む入力B",
    ]);
    const count = (
      await isolated.databases.postgres.query(
        "SELECT count(*)::int AS count FROM construction_log WHERE operation_id=$1",
        [final.data.operationId],
      )
    ).rows[0].count;
    expect(count).toBe(1);
    await access.scenes.tick(scene);
    expect((await cli.run(owner.profile, "result")).state).toBe("finished");
  } finally {
    release();
    await running;
    playback = undefined;
  }
}, 120000);

test("CLIの待受停止と明示終了・10分の失効を世界内の退出や新しい生成にしない", async () => {
  const a = people[0]!,
    calls = vi.spyOn(runtime.agent.model, "complete"),
    before = (await runtime.get(world)).at;
  try {
    const lines = await cli.lines(a.profile, "listen", "--once");
    expect(lines[0].state).toBe("listening");
    expect(lines.at(-1).state).toBe("waiting_stopped");
    expect(
      await access.scenes.shared.active(world, [a.actor], "bot"),
    ).toContain(a.actor);
    await cli.run(a.profile, "disconnect");
    expect(await access.scenes.shared.active(world, [a.actor], "bot")).toEqual(
      [],
    );
    const connectionId = await presence(0),
      start = Date.now();
    const clock = vi
      .spyOn(access.scenes.shared, "now")
      .mockImplementation(() => new Date(start + 600000));
    try {
      expect(
        await access.scenes.shared.active(world, [a.actor], "bot"),
      ).toEqual([]);
      await access.scenes.shared.expire({ connectionId });
      expect(
        (
          await isolated.databases.postgres.query(
            "SELECT active FROM world_scene_presence WHERE id=$1",
            [connectionId],
          )
        ).rows[0].active,
      ).toBe(false);
    } finally {
      clock.mockRestore();
    }
    expect(connectionId).toBeTruthy();
    expect((await runtime.get(world)).at).toBe(before);
    expect(calls).not.toHaveBeenCalled();
  } finally {
    calls.mockRestore();
  }
}, 60000);

test("待機中・NPCモードのプレイヤーとNPCを、WebとCLIへ同じ内容で世界を進めずに返す", async () => {
  const [viewer, guest] = [people[0]!, people[1]!],
    store = runtime.agent.store,
    at = (await runtime.get(world)).at,
    npc = randomUUID(),
    place = randomUUID();
  const locationBackground: SceneBackground = {
      type: "background",
      synopsis: "所在の記録",
      participants: [npc, guest.actor],
      facts: [
        {
          subjectId: npc,
          text: "見張り台の上にいる",
          aboutIds: [place],
          location: true,
        },
        {
          subjectId: guest.actor,
          text: "見張り台の入口にいる",
          aboutIds: [place],
          location: true,
        },
        { subjectId: npc, text: "秘密の任務を気にしている", aboutIds: [place] },
      ],
      perceptions: [],
      beliefs: [],
      creations: [],
      unknowns: [],
    },
    anchors = sceneAnchors(locationBackground, [], at, randomUUID());
  await store.commit(
    await store.claim(graph, randomUUID()),
    store.context(graph),
    {
      commitId: randomUUID(),
      at,
      changes: {
        nodes: [
          { id: npc, kind: "existence", text: "見張り番" },
          { id: place, kind: "existence", text: "見張り台" },
          ...anchors.nodes,
        ],
        revisions: [],
        endEdges: [],
        edges: [
          ...anchors.edges,
          {
            id: randomUUID(),
            kind: "see",
            source: npc,
            target: place,
            text: "見張り台が見える",
            period: { from: at },
          },
        ],
      },
    },
  );
  await changeBelongings(store, await store.claim(graph, randomUUID()), {
    commitId: randomUUID(),
    at,
    ops: locationBackground.facts
      .filter((f) => f.location)
      .map((f) => ({
        type: "locate",
        subjectId: f.subjectId,
        text: f.text,
        aboutIds: f.aboutIds,
      })),
  });
  await isolated.databases.postgres.query(
    "UPDATE world_scene_presence SET active=false WHERE world_id=$1",
    [world],
  );
  const web = async (actor = viewer.actor) =>
    app.inject({
      url: `/api/worlds/${world}/partners?actorId=${actor}`,
      headers: { cookie: viewer.cookie },
    });
  const players = async () => (await web()).json().players;
  const calls = vi.spyOn(runtime.agent.model, "complete");
  try {
    // 待機接続もNPCモードもない人物は載せない。
    expect(await players()).toEqual([]);
    await cli.run(guest.profile, "standby");
    expect(await players()).toEqual([
      {
        actorId: guest.actor,
        name: expect.any(String),
        mode: "standby",
        locations: ["見張り台の入口にいる"],
      },
    ]);
    await cli.run(guest.profile, "npc", "--away");
    expect(await players()).toEqual([
      {
        actorId: guest.actor,
        name: expect.any(String),
        mode: "npc",
        locations: ["見張り台の入口にいる"],
      },
    ]);
    const shown = (await web()).json();
    expect(shown.viewerId).toBe(viewer.actor);
    // 観測を持つ存在のうち、プレイヤーが操作していない人物だけがNPC。
    expect(shown.npcs).toContainEqual({
      actorId: npc,
      name: "見張り番",
      locations: ["見張り台の上にいる"],
    });
    const ids = shown.npcs.map((n: { actorId: string }) => n.actorId);
    expect(ids).not.toContain(place);
    for (const person of people) expect(ids).not.toContain(person.actor);
    expect((await cli.run(viewer.profile, "players")).players).toEqual(
      shown.players,
    );
    expect((await cli.run(viewer.profile, "npcs")).npcs).toEqual(shown.npcs);
    expect((await web()).json()).toEqual(shown);
    await changeBelongings(store, await store.claim(graph, randomUUID()), {
      commitId: randomUUID(),
      at: Math.max(0, at - 1000),
      ops: [
        {
          type: "locate",
          subjectId: npc,
          text: "見張り台の下にいる",
          aboutIds: [place],
        },
      ],
    });
    const sceneId = randomUUID();
    await isolated.databases.postgres.query(
      "INSERT INTO world_scene(id,construction_id,actor_id,state,data) VALUES($1,$2,$3,'active',$4)",
      [
        sceneId,
        world,
        viewer.actor,
        {
          at: Math.max(0, at - 1000),
          startedAt: at,
          background: locationBackground,
          events: [
            {
              id: randomUUID(),
              actorId: npc,
              text: "台を降りた",
              receipts: [],
              period: { from: at, until: at + 1000 },
              locations: [
                {
                  subjectId: npc,
                  text: "見張り台の下にいる",
                  aboutIds: [place],
                },
              ],
            },
          ],
        },
      ],
    );
    try {
      const moved = (await web()).json();
      expect(
        moved.npcs.find((n: { actorId: string }) => n.actorId === npc)
          .locations,
      ).toEqual(["見張り台の下にいる"]);
      expect((await cli.run(viewer.profile, "npcs")).npcs).toEqual(moved.npcs);
      expect(JSON.stringify(moved)).not.toContain("秘密の任務");
    } finally {
      await isolated.databases.postgres.query(
        "DELETE FROM world_scene WHERE id=$1",
        [sceneId],
      );
    }
    expect((await web(guest.actor)).statusCode).toBe(404);
    expect((await runtime.get(world)).at).toBe(at);
    expect(calls).not.toHaveBeenCalled();
  } finally {
    calls.mockRestore();
    await cli.run(guest.profile, "npc", "--return");
  }
  expect(await players()).toEqual([]);
}, 60000);

test("一覧と別シーンの接触文脈が、古い背景より最新の確定所在地を共用する", async () => {
  const [viewer, guest] = [people[0]!, people[1]!],
    store = runtime.agent.store,
    at = (await runtime.get(world)).at + 1000,
    place = randomUUID(),
    scene = randomUUID();
  await cli.run(guest.profile, "standby");
  await changeBelongings(store, await store.claim(graph, randomUUID()), {
    commitId: randomUUID(),
    at,
    nodes: [{ id: place, kind: "existence", text: "灯台" }],
    ops: [
      {
        type: "locate",
        subjectId: guest.actor,
        text: "灯台の門前",
        aboutIds: [place],
      },
    ],
  });
  const previous = (
    await isolated.databases.postgres.query(
      "SELECT scene_id FROM world_actor_scene WHERE world_id=$1 AND actor_id=$2",
      [world, guest.actor],
    )
  ).rows[0];
  await isolated.databases.postgres.query(
    "INSERT INTO world_scene(id,construction_id,actor_id,state,data) VALUES($1,$2,$3,'active',$4)",
    [
      scene,
      world,
      guest.actor,
      {
        worldId: graph,
        at: 0,
        startedAt: 0,
        background: {
          facts: [
            {
              subjectId: guest.actor,
              text: "古い家の前",
              aboutIds: [],
              location: true,
            },
          ],
        },
        events: [],
      },
    ],
  );
  await isolated.databases.postgres.query(
    "INSERT INTO world_actor_scene(world_id,actor_id,scene_id) VALUES($1,$2,$3) ON CONFLICT(world_id,actor_id) DO UPDATE SET scene_id=excluded.scene_id",
    [world, guest.actor, scene],
  );
  try {
    const listed = (
      await access.partners(viewer.id, world, viewer.actor)
    ).players.find((p) => p.actorId === guest.actor)!;
    const positions = await locationRecords(store.context(graph), guest.actor);
    expect(listed.locations).toEqual(["灯台の門前"]);
    expect(positions.map((r) => r.text)).toEqual(listed.locations);
    expect(positions[0]!.aboutIds).toEqual([place]);
    expect(positions[0]!.at).toBe(at);
  } finally {
    if (previous)
      await isolated.databases.postgres.query(
        "UPDATE world_actor_scene SET scene_id=$3 WHERE world_id=$1 AND actor_id=$2",
        [world, guest.actor, previous.scene_id],
      );
    else
      await isolated.databases.postgres.query(
        "DELETE FROM world_actor_scene WHERE world_id=$1 AND actor_id=$2",
        [world, guest.actor],
      );
    await isolated.databases.postgres.query(
      "DELETE FROM world_scene WHERE id=$1",
      [scene],
    );
  }
}, 60000);

test.each(["join", "decline"])(
  "NPCとして登場した本人にログを返し、復帰時に%sできる",
  async (choice) => {
    const [owner, guest] = [people[0]!, people[1]!];
    const standby = await cli.run(guest.profile, "standby");
    expect(standby.state).toBe("standby");
    expect((await cli.run(guest.profile, "standby")).connectionId).toBe(
      standby.connectionId,
    );
    expect((await cli.run(guest.profile, "npc", "--away")).result.active).toBe(
      true,
    );
    expect((await cli.run(guest.profile, "standby")).state).toBe("npc_mode");
    expect(
      await access.scenes.shared.active(world, [guest.actor], "bot"),
    ).toEqual([]);
    npcGuest = guest.actor;
    try {
      const scene = (
        await cli.run(owner.profile, "prepare", "--purpose", "近くの人物と会う")
      ).scene.id;
      await access.scenes.tick(scene);
      await cli.run(owner.profile, "start");
      const back = await cli.run(guest.profile, "npc", "--return");
      expect(back.result.scenes).toEqual([
        expect.objectContaining({
          sceneId: scene,
          handoff: "available",
          log: [{ kind: "observation", text: "VIEW-" + guest.actor }],
        }),
      ]);
      expect(back.result.summary).toContain("VIEW-" + guest.actor);
      const response = await cli.run(
        guest.profile,
        "npc",
        choice === "join" ? "--accept" : "--reject",
        "--scene",
        scene,
      );
      expect(response.state, JSON.stringify(response)).not.toBe("error");
      const row = await access.scenes.latest(
        world,
        undefined,
        false,
        owner.actor,
      );
      if (choice === "join") {
        expect(row?.data.externalActors).toContain(guest.actor);
        expect((await cli.run(guest.profile, "status")).scene.id).toBe(scene);
        playback = (input) => playStep(input);
        await cli.run(guest.profile, "act", "--text", "自分の言葉で話す");
        await access.scenes.tick(scene);
      } else {
        expect(row?.data.departures?.[guest.actor]).toBeDefined();
        expect(row?.data.events.at(-1)?.text).toContain("その場を離れた");
      }
      await cli.run(owner.profile, "finish");
      await access.scenes.tick(scene);
    } finally {
      npcGuest = undefined;
      playback = undefined;
      await cli.run(guest.profile, "npc", "--return");
    }
  },
  90000,
);

test("一人のシーンも共通キューでNPCへ任せ、本人の意図と見聞を復帰時に読む", async () => {
  const { profile, actor } = people[0]!;
  const scene = (await cli.run(profile, "prepare", "--purpose", "村で過ごす"))
    .scene.id;
  await access.scenes.tick(scene);
  await cli.run(profile, "start");
  await cli.run(profile, "npc", "--away");
  let turns = 0;
  playback = (input) => ({
    ...playStep(input),
    ...(++turns === 2 ? { concluded: true } : {}),
  });
  try {
    await access.scenes.tick(scene);
    expect((await cli.run(profile, "status")).scene.state).toBe("acting");
    await access.scenes.tick(scene);
    expect((await cli.run(profile, "status")).scene.state).toBe("result");
    const report = (await cli.run(profile, "npc", "--return")).result;
    expect(report.scenes[0].log).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "intent" }),
        expect.objectContaining({
          kind: "observation",
          text: expect.stringContaining(actor),
        }),
      ]),
    );
    expect(report.scenes[0].handoff).toBeNull();
  } finally {
    playback = undefined;
    await cli.run(profile, "npc", "--return");
  }
}, 90000);

test.each([0, 1])(
  "共有シーンの人物%sがNPCに切り替えると、その人の見聞から一手だけ引き継ぐ",
  async (index) => {
    const scene = await sharedGame(),
      actor = people[index]!,
      other = people[1 - index]!;
    const calls = vi.spyOn(runtime.agent.model, "complete");
    playback = (input) => playStep(input, [actor.actor]);
    try {
      await humanAct(1 - index, "直前の働きかけ");
      await access.scenes.tick(scene);
      const before = (await access.scenes.latest(
        world,
        undefined,
        false,
        actor.actor,
      ))!;
      const transition = await cli.run(actor.profile, "npc", "--away");
      await cli.run(
        actor.profile,
        "recover",
        "--request",
        transition.requestId,
      );
      calls.mockClear();
      playback = (input) => playStep(input, [other.actor]);
      await access.scenes.tick(scene);
      await access.scenes.tick(scene);
      const after = (await access.scenes.latest(
        world,
        undefined,
        false,
        actor.actor,
      ))!;
      expect(after.data.events.slice(0, before.data.events.length)).toEqual(
        before.data.events,
      );
      expect(after.data.actions.slice(before.data.actions.length)).toEqual([
        expect.objectContaining({
          id: transition.requestId,
          actorId: actor.actor,
          state: "complete",
        }),
      ]);
      expect(after.data.choices.slice(before.data.choices.length)).toEqual([
        expect.objectContaining({ actorId: actor.actor }),
      ]);
      const intents = calls.mock.calls.filter(
        ([, role]) => role === "scene-intent",
      );
      expect(intents).toHaveLength(1);
      const view = JSON.parse(
        intents[0]![2].find((m) => m.role === "user")!.content,
      );
      expect(view.observerId).toBe(actor.actor);
      expect(view.observations.map((o: { text: string }) => o.text)).toContain(
        `VIEW-${actor.actor}-直前の働きかけ`,
      );
      expect(JSON.stringify(view)).not.toContain(
        `VIEW-${other.actor}-直前の働きかけ`,
      );
      expect(
        after.data.events
          .slice(before.data.events.length)
          .some((e) => e.actorId === actor.actor),
      ).toBe(true);
      if (index === 0)
        expect((await cli.run(other.profile, "inbox")).opportunities).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ sourceInputId: transition.requestId }),
          ]),
        );
      expect(
        (await cli.run(actor.profile, "npc", "--return")).result.scenes[0].log,
      ).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: "intent" })]),
      );
      await cli.run(people[0]!.profile, "finish");
      await access.scenes.tick(scene);
    } finally {
      calls.mockRestore();
      playback = undefined;
      await cli.run(actor.profile, "npc", "--return");
    }
  },
  90000,
);
test("共有中に離席した人物が、他の人物の一手からNPCとして行動し復帰できる", async () => {
  const scene = await sharedGame(0, false);
  const firstOffer = (
    await runtime.pool.query<{ actor_id: string }>(
      "SELECT r.actor_id FROM world_scene_reply r JOIN world_scene_wave w ON w.id=r.wave_id WHERE w.scene_id=$1 AND w.source_kind='idle' AND w.state='pending'",
      [scene],
    )
  ).rows[0]!;
  const guest = people.find((p) => p.actor === firstOffer.actor_id)!;
  const speaker = people.findIndex((p) => p.actor !== guest.actor);
  await cli.run(guest.profile, "npc", "--away");
  playback = (input) => playStep(input);
  await access.scenes.tick(scene);
  let steps = 0;
  playback = (input) => playStep(input, steps++ === 0 ? [guest.actor] : []);
  try {
    await humanAct(speaker, "近くに声をかける");
    await access.scenes.tick(scene);
    const report = (await cli.run(guest.profile, "npc", "--return")).result;
    expect(report.scenes[0].log).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "intent" })]),
    );
    expect((await cli.run(guest.profile, "inbox")).opportunities).toHaveLength(
      0,
    );
    expect(
      (await cli.run(guest.profile, "npc", "--accept", "--scene", scene)).result
        .scenes[0].handoff,
    ).toBeNull();
    await cli.run(people[0]!.profile, "finish");
    await access.scenes.tick(scene);
  } finally {
    playback = undefined;
    await cli.run(guest.profile, "npc", "--return");
  }
}, 90000);

test("共有ターンの外部入力が完了してもNPCの未実行部分を保存し、自動で続ける", async () => {
  const scene = await sharedGame(),
    owner = people[0]!,
    peer = people[1]!;
  const snapshot = async () =>
    (await access.scenes.latest(world, undefined, false, owner.actor))!;
  const calls = vi.spyOn(runtime.agent.model, "complete");
  try {
    playback = (input) => {
      const step = playStep(input, [peer.actor]);
      step.decisions[owner.actor] = "pending";
      return step;
    };
    await cli.run(owner.profile, "npc", "--away");
    await access.scenes.tick(scene);
    const waiting = await snapshot();
    expect(waiting.state).toBe("active");
    expect(waiting.data.pending[owner.actor]?.continuing).toBe(true);
    calls.mockClear();
    await access.scenes.tick(scene);
    expect(calls).not.toHaveBeenCalled();
    const opportunity = (await cli.run(peer.profile, "inbox")).opportunities[0];
    const wake = vi.spyOn(access.scenes.shared, "wake");
    await cli.run(
      peer.profile,
      "react",
      "--opportunity",
      opportunity.id,
      "--text",
      "相手の一手",
    );
    wake.mockClear();
    playback = (input) => {
      const step = playStep(input);
      return {
        ...step,
        decisions: {
          ...step.decisions,
          [owner.actor]: { pending: "印を確かめながら書類を届ける" },
        },
      };
    };
    await access.scenes.tick(scene);
    const saved = await snapshot();
    expect(saved.state).toBe("acting");
    expect(saved.data.pending[owner.actor]).toMatchObject({
      actionText: "印を確かめながら書類を届ける",
      continuing: true,
    });
    expect(wake.mock.calls.map(([, id]) => id)).toEqual([scene]);
    wake.mockRestore();
    calls.mockClear();
    const next: PlayInput[] = [];
    playback = (input) => {
      next.push(input);
      return { ...playStep(input), elapsedMs: 1000 };
    };
    await access.scenes.tick(scene);
    const done = await snapshot();
    expect(next).toHaveLength(1);
    expect(next[0]!.request.controlledInputs).toEqual([]);
    expect(next[0]!.request.intentions).toContainEqual(
      saved.data.pending[owner.actor],
    );
    expect(done.data.events.slice(0, saved.data.events.length)).toEqual(
      saved.data.events,
    );
    expect(done.data.events.length).toBeGreaterThan(saved.data.events.length);
    expect(done.data.at).toBe(saved.data.at + 1000);
    expect(done.data.choices).toEqual(saved.data.choices);
    expect(done.data.actions).toEqual(saved.data.actions);
    expect(done.data.pending[owner.actor]).toBeUndefined();
    expect(calls.mock.calls.some(([, role]) => role === "scene-intent")).toBe(
      false,
    );
    calls.mockClear();
    await access.scenes.tick(scene);
    expect(calls).not.toHaveBeenCalled();
  } finally {
    playback = undefined;
    calls.mockRestore();
    await cli.run(owner.profile, "npc", "--return");
    await cli.run(owner.profile, "finish");
    await access.scenes.tick(scene);
  }
}, 90000);

test("入力待ちは在席する人間を優先し、不在になればAI一人ずつに巡回する", async () => {
  const scene = await sharedGame(),
    order = [...people].sort((a, b) => a.actor.localeCompare(b.actor));
  const offers = async () =>
    (
      await Promise.all(
        order.map(async (person) => ({
          person,
          items: (await cli.run(person.profile, "inbox")).opportunities.filter(
            (o: { sceneId: string }) => o.sceneId === scene,
          ),
        })),
      )
    ).flatMap(({ person, items }) =>
      items.map((item: { id: string; nextInput?: true }) => ({
        person,
        id: item.id,
        nextInput: item.nextInput,
      })),
    );
  try {
    const first = await offers();
    expect(first).toHaveLength(1);
    expect(first[0]!.nextInput).toBe(true);
    expect(first[0]!.person.actor).toBe(order[0]!.actor);
    await access.scenes.tick(scene);
    expect(await offers()).toEqual(first);
    const seen: PlayInput[] = [];
    playback = (input) => {
      seen.push(input);
      return playStep(input);
    };
    await cli.run(
      order[0]!.profile,
      "react",
      "--opportunity",
      first[0]!.id,
      "--text",
      "本人が次の一手を選ぶ",
    );
    await access.scenes.tick(scene);
    expect(seen[0]!.request.reactionTo).toBeNull();
    expect(seen[0]!.request.controlledInputs[0]!.text).toBe(
      "本人が次の一手を選ぶ",
    );
    for (const idx of [1, 2]) {
      const current = await offers();
      expect(current).toHaveLength(1);
      expect(current[0]!.person.actor).toBe(order[idx]!.actor);
      await cli.run(
        order[idx]!.profile,
        "react",
        "--opportunity",
        current[0]!.id,
        "--none",
      );
      await access.scenes.tick(scene);
    }
    expect((await offers())[0]!.person.actor).toBe(order[0]!.actor);
    const human = await humanPresence(0);
    await humanAct(0, "自分で入力する");
    await access.scenes.tick(scene);
    expect(await offers()).toEqual([]);
    await access.scenes.tick(scene);
    expect(await offers()).toEqual([]);
    await humanPresence(0, false, human);
    expect(await offers()).toHaveLength(1);
  } finally {
    playback = undefined;
    await cli.run(people[0]!.profile, "finish");
    await access.scenes.tick(scene);
  }
}, 90000);

test("在席している最後の人間が入力待ちで離れると成立済みの内容で終了する", async () => {
  const owner = people[0]!;
  selections.set(owner.actor, { candidates: [], mergeInto: null });
  const scene = await prepare(0, true);
  await access.scenes.tick(scene);
  await runtime.pool.query(
    "UPDATE world_scene_presence SET active=false WHERE world_id=$1 AND actor_id=$2",
    [world, owner.actor],
  );
  const human = await humanPresence(0);
  await access.sceneCommand(
    owner.id,
    world,
    { requestId: randomUUID(), command: "start" },
    false,
    owner.actor,
  );
  expect((await cli.run(owner.profile, "status")).state).toBe("waiting_input");
  await humanPresence(0, false, human);
  await access.scenes.tick(scene);
  const row = await access.scenes.latest(world, undefined, false, owner.actor);
  expect(row).toMatchObject({
    id: scene,
    state: "result",
    data: { ending: "dissolved", actions: [], events: [] },
  });
}, 60000);
