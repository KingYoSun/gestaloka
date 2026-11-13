import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { WorldAccess } from "@gestaloka/server/access";
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
type PlayInput = {
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
beforeAll(async () => {
  await isolated.setup();
  ({ runtime } = await fixtureRuntime(
    scope,
    (content, raw, messages) => {
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
      if (
        (content as { type?: string }).type === "background" &&
        input.acceptedPlayerIds
      ) {
        const background = content as SceneBackground;
        return {
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
          participants: input.acceptedPlayerIds,
          synopsis: `OWNER-${input.request!.actorId}`,
          perceptions: input.acceptedPlayerIds.map((actor) => ({
            observerId: actor,
            text: `VIEW-${actor}`,
            sourceIds: [
              input.request!.rootIds.find(
                (id) => id !== input.request!.actorId,
              )!,
            ],
          })),
        };
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
async function end(index: number) {
  const p = people[index]!;
  expect((await cli.run(p.profile, "start")).state).toBe("waiting_input");
  const r = await cli.run(p.profile, "finish");
  expect(r.state).toBe("processing");
  await access.scenes.tick(r.scene.id);
  expect((await cli.run(p.profile, "result")).state).toBe("finished");
}
test("Webから対象0人で共有を準備し、確認してから開始する", async ({
  onTestFinished,
}) => {
  vi.stubEnv("SCENE_DEFAULT_BACKGROUND_WORLD_ID", world);
  const calls = vi.spyOn(runtime.agent.model, "complete");
  onTestFinished(() => {
    calls.mockRestore();
    vi.unstubAllEnvs();
  });
  const [a, b, c] = people;
  selections.set(a!.actor, {
    candidates: [b!.actor, c!.actor],
    mergeInto: null,
  });
  const id = await prepare(0, true);
  await access.scenes.tick(id);
  expect(
    calls.mock.calls
      .filter(([, role]) => role === "scene-background")
      .map(([, , , target]) => target),
  ).toEqual(["resolution", "default"]);
  const state = await cli.run(a!.profile, "status");
  expect(state.state).toBe("prepared");
  expect(state.scene.shared.pending).toBe(0);
  expect((await cli.run(b!.profile, "inbox")).invitations).toEqual([]);
  expect((await cli.run(c!.profile, "inbox")).invitations).toEqual([]);
  await end(0);
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
    .mockImplementation(() => new Date(Date.now() + 61000));
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

async function sharedGame(owner = 0, web = true) {
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

test.each(["end", "timeout"] as const)(
  "AIの単独シーンでは一区切りで本人に提案し、%sで確定する",
  async (ending) => {
    const { profile } = people[0]!;
    const scene = (await cli.run(profile, "prepare", "--purpose", "村を歩く"))
      .scene.id;
    await access.scenes.tick(scene);
    await cli.run(profile, "start");
    playback = (input) => ({ ...playStep(input), concluded: true });
    try {
      // Webからの一手は同じ人物・判定でも提案を作らない。
      await humanAct(0, "道を見渡す");
      await access.scenes.tick(scene);
      expect((await cli.run(profile, "status")).state).toBe("waiting_input");
      if (ending === "end") {
        // 旧版でも行動の判定は保存済み。次の入力は続行回答まで実行しない。
        await runtime.pool.query(
          "UPDATE world_scene SET data=data-'soloBot' WHERE id=$1",
          [scene],
        );
      }
      const act = await cli.run(profile, "act", "--text", "戸口に戻る");
      await access.scenes.tick(scene);
      expect((await cli.run(profile, "status")).state).toBe("waiting_vote");
      const proposal = (await cli.run(profile, "inbox")).proposals.find(
        (p: { sceneId: string }) => p.sceneId === scene,
      );
      expect(proposal).toBeDefined();
      expect((await cli.run(people[1]!.profile, "inbox")).proposals).toEqual(
        [],
      );
      expect((await cli.run(profile, "act", "--text", "別の入力")).code).toBe(
        "STATE_CONFLICT",
      );
      if (ending === "end") {
        expect(act.state).toBe("waiting_vote");
        playback = (input) => playStep(input);
        await cli.run(profile, "vote", "--proposal", proposal.id, "--continue");
        await access.scenes.tick(scene);
        const continued = await cli.run(profile, "status");
        expect(continued.state).toBe("waiting_input");
        expect(
          continued.scene.actions.filter(
            (a: { id: string }) => a.id === act.requestId,
          ),
        ).toHaveLength(1);
        playback = (input) => ({ ...playStep(input), concluded: true });
        await cli.run(profile, "act", "--text", "家に入る");
        await access.scenes.tick(scene);
        const next = (await cli.run(profile, "inbox")).proposals[0];
        expect(next.id).not.toBe(proposal.id);
        await cli.run(profile, "vote", "--proposal", next.id, "--end");
      } else {
        const now = vi
          .spyOn(access.scenes.shared, "now")
          .mockReturnValue(new Date(Date.parse(proposal.deadline) + 1));
        try {
          await access.scenes.shared.expire({ proposalId: proposal.id });
        } finally {
          now.mockRestore();
        }
      }
      await access.scenes.tick(scene);
      expect((await cli.run(profile, "result")).state).toBe("finished");
      expect((await cli.run(profile, "inbox")).proposals).toEqual([]);
    } finally {
      playback = undefined;
    }
  },
  120000,
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
    for (let i = 0; i < people.length; i++) await presence(i, false);
    await presence(1);
    await access.scenes.tick(scene);
    expect(await access.scenes.shared.turns.control(scene)).toMatchObject({
      flow: "manual",
      rounds: 5,
    });
    expect(calls).not.toHaveBeenCalled();
    calls.mockRestore();
    for (const person of people)
      expect(
        (await cli.run(person.profile, "inbox")).opportunities.filter(
          (o: { sceneId: string }) => o.sceneId === scene,
        ),
      ).toEqual([]);
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

test.each(["end", "mixed", "timeout", "continue", "interrupt"] as const)(
  "人間不在の10往復で終了提案し、%sを処理して投票中は進めない",
  async (answer) => {
    const scene = await sharedGame(0, false);
    playback = alternateBots;
    try {
      const previous =
        answer === "interrupt"
          ? await humanAct(0, "Aへの反応機会を残す")
          : undefined;
      if (previous) await access.scenes.tick(scene);
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
            answer === "continue" || (answer === "mixed" && i === 1)
              ? "--continue"
              : "--end",
          );
          if (answer === "mixed" && i === 2)
            expect(result.code).toBe("STATE_CONFLICT");
          else expect(result.state, JSON.stringify(result)).not.toBe("error");
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
    await access.scenes.tick(id);
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

test("旧版の共有シーンの保存済み入力は従来の進行で再開し重複させない", async () => {
  const owner = people[0]!,
    id = await sharedGame(0, false);
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
  expect(saved.data.actions.map((a) => a.id)).toEqual([accepted.requestId]);
  await access.scenes.tick(id);
  expect(
    (await cli.run(owner.profile, "recover", "--request", accepted.requestId))
      .state,
  ).toBe("waiting_input");
  await cli.run(owner.profile, "finish");
  await access.scenes.tick(id);
  expect((await cli.run(owner.profile, "result")).state).toBe("finished");
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
    playback = (input) => ({
      ...playStep(input, [owner.actor, peer.actor]),
      ...(input.request.reactionTo ? { concluded: true } : {}),
    });
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

test("CLIの明示終了と90秒の失効を世界内の退出や新しい生成にしない", async () => {
  const a = people[0]!,
    calls = vi.spyOn(runtime.agent.model, "complete"),
    before = (await runtime.get(world)).at;
  try {
    const lines = await cli.lines(a.profile, "listen", "--once");
    expect(lines[0].state).toBe("listening");
    expect(lines.at(-1).state).toBe("inactive");
    const lease = (
      await isolated.databases.postgres.query(
        "SELECT active FROM world_scene_presence WHERE id=$1",
        [lines[0].connectionId],
      )
    ).rows[0];
    expect(lease.active).toBe(false);
    const connectionId = await presence(0),
      start = Date.now();
    const clock = vi
      .spyOn(access.scenes.shared, "now")
      .mockImplementation(() => new Date(start + 90000));
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
