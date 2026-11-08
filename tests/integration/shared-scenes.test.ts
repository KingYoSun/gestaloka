import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { WorldAccess } from "@gestaloka/server/access";
import type { WorldProposal } from "@gestaloka/server/agent";
import {
  sceneAnchors,
  type SceneBackground,
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
let runtime: Awaited<ReturnType<typeof fixtureRuntime>>["runtime"],
  access: WorldAccess,
  auth: Awaited<ReturnType<typeof fixtureAuth>>,
  app: Awaited<ReturnType<typeof createApp>>,
  cli: Awaited<ReturnType<typeof playerCli>>,
  world: string,
  graph: string;
const people: { id: string; cookie: string; actor: string; profile: string }[] =
  [];
beforeAll(async () => {
  await isolated.setup();
  ({ runtime } = await fixtureRuntime(
    scope,
    (content, raw) => {
      const input = raw as {
        request?: {
          actorId: string;
          rootIds: string[];
          controlledActorId?: string;
          leavingActorIds?: string[];
        };
        responseSchema?: unknown;
        acceptedPlayerIds?: string[];
        priorScenes?: { background: SceneBackground }[];
        confirmed?: { observations: { text: string }[] };
      };
      const proposal = content as WorldProposal;
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
    connectionId = randomUUID();
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
test("Webから対象0人で共有を準備し、確認してから開始する", async () => {
  const [a, b, c] = people;
  selections.set(a!.actor, {
    candidates: [b!.actor, c!.actor],
    mergeInto: null,
  });
  const id = await prepare(0, true);
  await access.scenes.tick(id);
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
