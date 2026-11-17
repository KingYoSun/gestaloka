import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { WorldAccess } from "@gestaloka/server/access";
import type { WorldProposal } from "@gestaloka/server/agent";
import type {
  SceneBackground,
  SceneIntent,
} from "../../packages/server/src/runtime/scene-data.js";
import { isolatedDatabases } from "../support/isolated-db.js";
import { fixtureRuntime } from "../support/provider.js";
import { fixtureAuth } from "../support/auth.js";
import { createApp } from "../../apps/api/src/app.js";
import { playerCli } from "../support/player-cli.js";
import saved from "../fixtures/cross-scene-replies.json" with { type: "json" };

const isolated = isolatedDatabases(),
  scope = `handoff-${randomUUID()}`;
let runtime: Awaited<ReturnType<typeof fixtureRuntime>>["runtime"],
  access: WorldAccess,
  auth: Awaited<ReturnType<typeof fixtureAuth>>,
  app: Awaited<ReturnType<typeof createApp>>,
  cli: Awaited<ReturnType<typeof playerCli>>,
  world: string,
  graph: string;
const people: {
  id: string;
  cookie: string;
  profile: string;
  actor: string;
  scene: string;
}[] = [];
let partial:
  { input: string; reached: () => void; wait: Promise<void> } | undefined;
const invite = new Map<string, string[]>();
const inputs = new Map<string, (typeof saved.records)[number]>();
beforeAll(async () => {
  await isolated.setup();
  ({ runtime } = await fixtureRuntime(
    scope,
    async (content, raw) => {
      const input = raw as {
        request?: {
          actorId: string;
          rootIds: string[];
          intentions?: SceneIntent[];
          controlledInputs?: { id: string; actorId: string }[];
        };
        responseSchema?: unknown;
        acceptedPlayerIds?: string[];
      };
      const proposal = content as WorldProposal;
      if (proposal.newParticipantId)
        return {
          ...proposal,
          changes: {
            ...proposal.changes,
            edges: proposal.changes.edges.filter(
              (e) =>
                e.kind !== "see" || e.text === "あなたが初めて知覚した景色",
            ),
          },
        };
      if ((JSON.stringify(input.responseSchema) ?? "").includes('"selection"'))
        return {
          type: "selection",
          candidates: invite.get(input.request!.actorId) ?? [],
          mergeInto: null,
        };
      if (
        (content as { type?: string }).type === "background" &&
        input.acceptedPlayerIds
      ) {
        const bg = content as SceneBackground;
        return {
          ...bg,
          participants: input.acceptedPlayerIds,
          perceptions: input.acceptedPlayerIds.map((actor) => ({
            observerId: actor,
            text: `本人だけに見えていた背景-${actor}`,
            sourceIds: [
              input.request!.rootIds.find(
                (id) => id !== input.request!.actorId,
              )!,
            ],
          })),
        };
      }
      if (
        (content as { type?: string }).type === "scene" &&
        input.request?.intentions
      ) {
        const intentions = input.request.intentions;
        const remaining = intentions.find((i) => i.inputId === partial?.input);
        if (remaining?.actionText === '選択済みの作業' && partial) {
          const gate = partial;
          gate.reached();
          await gate.wait;
          return {
            type: "scene",
            events: [
              {
                actorId: remaining.actorId,
                text: "選択済みの作業の途中",
                receipts: [
                  {
                    observerId: remaining.actorId,
                    text: "選択済みの作業の途中",
                  },
                  {
                    observerId: people[0]!.actor,
                    text: "選択済みの作業の途中",
                  },
                ],
              },
            ],
            decisions: {
              [remaining.actorId]: {
                pending: "選択済みの作業の残り",
                waitingFor: [],
              },
            },
          };
        }
        return {
          type: "scene",
          events: intentions.map((i) => {
            const record = inputs.get(i.inputId ?? "");
            const peer = record ? people[1 - record.actor]!.actor : undefined;
            return {
              actorId: i.actorId,
              text: i.actionText,
              receipts: [
                { observerId: i.actorId, text: i.actionText },
                ...(peer ? [{ observerId: peer, text: record!.receipt }] : []),
              ],
            };
          }),
          decisions: Object.fromEntries(
            intentions.map((i) => [i.actorId, "finished"]),
          ),
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
      prompt: "進行の引継ぎを検証する世界",
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
    title: "引継ぎ検証",
    description: "",
    published: true,
    accepting: true,
    reason: "検証",
  });
  const preset = randomUUID();
  await auth.operations.execute(admin.id, randomUUID(), {
    operation: "presets.put",
    presetId: preset,
    title: "村人",
    description: "",
    settings: "自分の目的を持って暮らしている",
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
    const profile = join(cli.directory, `${i}.json`);
    const connected = await cli.run(
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
    people.push({
      id: person.id,
      cookie: person.cookie,
      profile,
      actor,
      scene: "",
    });
    await access.presence(
      person.id,
      world,
      { requestId: randomUUID(), connectionId: randomUUID(), active: true },
      "bot",
      actor,
    );
  }
}, 120000);

test("保存された反復入力を共通のターンで再生し、10往復の投票と続行後の再投票を使う", async () => {
  invite.clear();
  for (let i = 0; i < 2; i++) {
    const prepared = await command(i, {
      command: "prepare",
      purpose: "相手と会話する",
    });
    people[i]!.scene = prepared.scene!.id;
    await access.scenes.tick(prepared.scene!.id);
    await command(i, { command: "start" });
  }
  const request = randomUUID();
  inputs.set(request, saved.records[0]!);
  await access.sceneCommand(
    people[0]!.id,
    world,
    { requestId: request, command: "act", actionText: saved.records[0]!.text },
    false,
    people[0]!.actor,
    people[0]!.scene,
    "bot",
  );
  await settle();
  const execution = (await access.scenes.sessions.get(
    people[0]!.scene,
    people[0]!.actor,
  ))!.current_id;
  const countBefore = (
    await runtime.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM world_player_contact WHERE world_id=$1",
      [world],
    )
  ).rows[0]!.n;
  const proposals: string[] = [];
  for (let n = 1; n <= 20; n++) {
    await replyRecord(n);
    expect(
      (await access.scenes.sessions.get(people[1]!.scene, people[1]!.actor))!
        .current_id,
    ).toBe(execution);
    expect((await access.scenes.shared.turns.control(execution)).rounds).toBe(
      ((n - 1) % 10) + 1,
    );
    if (n % 10) continue;
    expect((await access.scenes.shared.turns.control(execution)).flow).toBe(
      "voting",
    );
    const proposal = (
      await access.inbox(people[0]!.id, world, people[0]!.actor)
    ).proposals[0]!;
    expect(proposal.sceneId).toBe(people[0]!.scene);
    proposals.push(proposal.id);
    const calls = vi.spyOn(runtime.agent.model, "complete");
    await access.scenes.tick(execution);
    expect(calls).not.toHaveBeenCalled();
    calls.mockRestore();
    for (let i = 0; i < 2; i++)
      await command(i, {
        command: "vote",
        proposalId: proposal.id,
        continue: n === 10,
      });
    await settle();
    if (n === 10)
      expect(await access.scenes.shared.turns.control(execution)).toMatchObject(
        { rounds: 0, flow: "open" },
      );
  }
  expect(new Set(proposals).size).toBe(2);
  expect(
    (
      await runtime.pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM world_player_contact WHERE world_id=$1",
        [world],
      )
    ).rows[0]!.n,
  ).toBe(countBefore);
  for (let i = 0; i < 2; i++) {
    const p = people[i]!,
      view = (await access.scene(p.id, world, false, p.actor, p.scene)).scene!;
    expect(view.state).toBe("result");
    expect(view.id).toBe(p.scene);
    expect(new Set(view.actions.map((a) => a.id)).size).toBe(
      view.actions.length,
    );
    expect(
      (await access.inbox(p.id, world, p.actor)).items.filter(
        (n) => n.sceneId === p.scene && n.kind === "result",
      ),
    ).toHaveLength(1);
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
async function command(index: number, body: Record<string, unknown>) {
  const p = people[index]!;
  return access.sceneCommand(
    p.id,
    world,
    { requestId: randomUUID(), ...body } as Parameters<
      WorldAccess["sceneCommand"]
    >[2],
    false,
    p.actor,
    p.scene || undefined,
    "bot",
  );
}
async function settle() {
  for (let pass = 0; pass < 6; pass++) {
    const rows = (
      await runtime.pool.query<{ id: string }>(
        `SELECT s.id FROM world_scene s WHERE s.construction_id=$1 AND
      (s.state IN ('preparing','acting','reflecting') OR EXISTS(SELECT 1 FROM world_player_contact c WHERE c.state='handoff' AND (c.source_scene=s.id OR c.target_scene=s.id)) OR EXISTS(SELECT 1 FROM world_scene_turn t WHERE t.scene_id=s.id AND t.state='queued') OR EXISTS(SELECT 1 FROM world_scene_session v WHERE v.current_id=s.id AND v.closed AND v.result IS NULL) OR coalesce(jsonb_array_length(s.data->'splitActors'),0)>0) ORDER BY s.created_at,s.id`,
        [world],
      )
    ).rows;
    if (!rows.length) return;
    for (const row of rows) await access.scenes.tick(row.id);
  }
  throw new Error("引継ぎが収束しません");
}
async function replyRecord(n: number) {
  const record = saved.records[n]!,
    p = people[record.actor]!,
    request = randomUUID();
  inputs.set(request, record);
  const offer = (await access.inbox(p.id, world, p.actor)).opportunities.find(
    (o) => o.sceneId === p.scene && !o.nextInput,
  )!;
  expect(offer, record.inputId).toBeDefined();
  if (n > 2) expect(offer.context).toContain(saved.records[n - 2]!.text);
  await access.sceneCommand(
    p.id,
    world,
    {
      requestId: request,
      command: "react",
      opportunityId: offer.id,
      actionText: record.text,
    },
    false,
    p.actor,
    p.scene,
    "bot",
  );
  await settle();
}
test("別の進行へ会話を合流し、無関係な人物は分離して、本人の表示IDと選択済み入力を保つ", async () => {
  invite.set(people[0]!.actor, [people[2]!.actor]);
  const first = await command(0, { command: "prepare", purpose: "相手と話す" });
  people[0]!.scene = first.scene!.id;
  people[2]!.scene = first.scene!.id;
  await access.scenes.tick(first.scene!.id);
  const invitation = (
    await access.inbox(people[2]!.id, world, people[2]!.actor)
  ).invitations[0]!;
  await command(2, {
    command: "invite",
    invitationId: invitation.id,
    accept: true,
  });
  await access.scenes.tick(first.scene!.id);
  await command(0, { command: "start" });
  const empty = await access.sceneRecords(people[0]!.id, world, {
    actorId: people[0]!.actor,
    sceneId: people[0]!.scene,
    kind: "events",
  });
  const second = await command(1, {
    command: "prepare",
    purpose: "自分の用事をしている",
  });
  people[1]!.scene = second.scene!.id;
  await access.scenes.tick(second.scene!.id);
  await command(1, { command: "start" });
  const source = saved.records[0]!,
    request = randomUUID(),
    third = randomUUID();
  inputs.set(request, source);
  await access.sceneCommand(
    people[0]!.id,
    world,
    { requestId: request, command: "act", actionText: source.text },
    false,
    people[0]!.actor,
    people[0]!.scene,
    "bot",
  );
  const original = await access.sceneCommand(
    people[0]!.id,
    world,
    { requestId: request, command: "act", actionText: source.text },
    false,
    people[0]!.actor,
    people[0]!.scene,
    "bot",
  );
  expect(original.scene!.id).toBe(people[0]!.scene);
  await access.sceneCommand(
    people[2]!.id,
    world,
    { requestId: third, command: "act", actionText: "選択済みの作業を続ける" },
    false,
    people[2]!.actor,
    people[2]!.scene,
    "bot",
  );
  await access.scenes.tick(first.scene!.id);
  const calls = vi.spyOn(runtime.agent.model, "complete");
  await settle();
  const current = await Promise.all(
    people.map((p) => access.scenes.sessions.get(p.scene, p.actor)),
  );
  expect(current[0]!.current_id).toBe(current[1]!.current_id);
  expect(current[2]!.current_id).not.toBe(current[0]!.current_id);
  expect(
    calls.mock.calls.filter(([, role]) => role === "scene-result"),
  ).toHaveLength(0);
  calls.mockRestore();
  for (const p of people)
    expect(
      (await access.scene(p.id, world, false, p.actor, p.scene)).scene!.id,
    ).toBe(p.scene);
  const thirdView = (
    await access.scene(
      people[2]!.id,
      world,
      false,
      people[2]!.actor,
      people[2]!.scene,
    )
  ).scene!;
  expect(thirdView.actions.filter((a) => a.id === third)).toHaveLength(1);
  expect(
    (
      await access.sceneRecords(people[0]!.id, world, {
        actorId: people[0]!.actor,
        sceneId: people[0]!.scene,
        kind: "events",
        ...(empty.previous ? { after: empty.previous } : {}),
      })
    ).items.map((i) => i.text),
  ).toContain(source.text);
  const web = await app.inject({
    url: `/api/worlds/${world}/scene?actorId=${people[0]!.actor}&sceneId=${people[0]!.scene}`,
    headers: { cookie: people[0]!.cookie },
  });
  expect(web.statusCode).toBe(200);
  expect(web.json().scene.id).toBe(people[0]!.scene);
  expect(
    (await cli.run(people[1]!.profile, "status", "--scene", people[1]!.scene))
      .scene.id,
  ).toBe(people[1]!.scene);
  expect(
    (
      await cli.run(
        people[0]!.profile,
        "history",
        "--scene",
        people[0]!.scene,
        "--kind",
        "actions",
      )
    ).items.filter((i: { id: string }) => i.id === request),
  ).toHaveLength(1);
  const offer = (
    await access.inbox(people[1]!.id, world, people[1]!.actor)
  ).opportunities.find((o) => o.sourceInputId === request)!;
  expect(offer.sceneId).toBe(people[1]!.scene);
  expect(offer.context).toContain(source.receipt);
  for (let n = 1; n <= 4; n++) await replyRecord(n);
  const results = vi.spyOn(runtime.agent.model, "complete");
  await command(1, { command: "finish" });
  await settle();
  const ended = (
    await access.scene(
      people[1]!.id,
      world,
      false,
      people[1]!.actor,
      people[1]!.scene,
    )
  ).scene!;
  const ongoing = (
    await access.scene(
      people[0]!.id,
      world,
      false,
      people[0]!.actor,
      people[0]!.scene,
    )
  ).scene!;
  expect(ended.state).toBe("result");
  expect(ongoing.state).toBe("active");
  expect(ended.id).toBe(people[1]!.scene);
  expect(ongoing.id).toBe(people[0]!.scene);
  expect(
    (await cli.run(people[1]!.profile, "result", "--scene", people[1]!.scene))
      .state,
  ).toBe("finished");
  const narrativeCalls = results.mock.calls.filter(
    ([, role]) => role === "scene-result",
  );
  expect(narrativeCalls).toHaveLength(1);
  const payload = JSON.parse(
    narrativeCalls[0]![2].find((m) => m.role === "user")!.content,
  );
  expect(payload.requestedInputs).toHaveLength(2);
  expect(
    payload.confirmed.observations.map((o: { text: string }) => o.text),
  ).toContain(source.receipt);
  expect(
    payload.confirmed.observations.map((o: { text: string }) => o.text),
  ).toContain(`本人だけに見えていた背景-${people[1]!.actor}`);
  expect(
    payload.confirmed.observations.map((o: { text: string }) => o.text),
  ).not.toContain(`本人だけに見えていた背景-${people[2]!.actor}`);
  results.mockRestore();
  await command(0, { command: "act", actionText: "自分の作業を続ける" });
  await settle();
  expect(
    (
      await access.scene(
        people[0]!.id,
        world,
        false,
        people[0]!.actor,
        people[0]!.scene,
      )
    ).scene!.actions.at(-1)!.text,
  ).toBe("自分の作業を続ける");
  await command(0, { command: "finish" });
  await command(2, { command: "finish" });
  await settle();
}, 120000);

async function preparePair(shared = false) {
  invite.clear();
  if (shared) invite.set(people[0]!.actor, [people[1]!.actor]);
  for (let i = 0; i < (shared ? 1 : 2); i++) {
    people[i]!.scene = (
      await command(i, {
        command: "prepare",
        purpose: "それぞれの用事を進める",
      })
    ).scene!.id;
    await access.scenes.tick(people[i]!.scene);
    if (shared) {
      people[1]!.scene = people[0]!.scene;
      const invitation = (
        await access.inbox(people[1]!.id, world, people[1]!.actor)
      ).invitations[0]!;
      await command(1, {
        command: "invite",
        invitationId: invitation.id,
        accept: true,
      });
      await access.scenes.tick(people[0]!.scene);
    }
    await command(i, { command: "start" });
  }
}

test("一人の終了投票で本人に結果を返し、残る人の未回答投票IDと続行時の反応機会を引き継ぐ", async () => {
  await preparePair(true);
  const row = (await access.scenes.latest(
    world,
    undefined,
    false,
    people[0]!.actor,
  ))!;
  const proposal = await access.scenes.shared.transaction(async (db) => {
    await access.scenes.shared.lock(db, world);
    await db.query(
      "UPDATE world_shared_scene SET continuation=$2 WHERE scene_id=$1",
      [
        row.id,
        JSON.stringify({
          turn: { id: randomUUID(), sourceKind: "bot", reply: true },
          targets: [people[1]!.actor],
        }),
      ],
    );
    return access.scenes.shared.turns.propose(
      db,
      row,
      people.slice(0, 2).map((p) => p.actor),
    );
  });
  expect(
    (
      await cli.run(
        people[0]!.profile,
        "vote",
        "--scene",
        people[0]!.scene,
        "--proposal",
        proposal,
        "--end",
      )
    ).state,
  ).not.toBe("error");
  await settle();
  expect((await cli.run(people[0]!.profile, "result")).state).toBe("finished");
  const pending = (await access.inbox(people[1]!.id, world, people[1]!.actor))
    .proposals[0]!;
  expect(pending.id).toBe(proposal);
  expect(pending.sceneId).toBe(people[1]!.scene);
  expect(
    (
      await cli.run(
        people[1]!.profile,
        "vote",
        "--scene",
        people[1]!.scene,
        "--proposal",
        proposal,
        "--continue",
      )
    ).state,
  ).not.toBe("error");
  await settle();
  const current = (await access.scenes.sessions.get(
    people[1]!.scene,
    people[1]!.actor,
  ))!.current_id;
  expect((await access.scenes.shared.turns.control(current)).flow).toBe("open");
  expect(
    (
      await access.inbox(people[1]!.id, world, people[1]!.actor)
    ).opportunities.filter((o) => !o.nextInput),
  ).toHaveLength(1);
  await command(1, { command: "finish" });
  await settle();
}, 120000);

test("生成中の入力を完了させてから合流し、保存済みの未完了部分を同じ入力IDで一度だけ続ける", async () => {
  await preparePair();
  const request = randomUUID();
  let reached!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    reached = resolve;
  });
  partial = {
    input: request,
    reached,
    wait: new Promise<void>((resolve) => {
      release = resolve;
    }),
  };
  const calls = vi.spyOn(runtime.agent.model, "complete");
  await access.sceneCommand(
    people[1]!.id,
    world,
    { requestId: request, command: "act", actionText: "選択済みの作業" },
    false,
    people[1]!.actor,
    people[1]!.scene,
    "bot",
  );
  const running = access.scenes.tick(people[1]!.scene);
  try {
    await entered;
    const voice = randomUUID();
    inputs.set(voice, saved.records[0]!);
    await access.sceneCommand(
      people[0]!.id,
      world,
      { requestId: voice, command: "act", actionText: saved.records[0]!.text },
      false,
      people[0]!.actor,
      people[0]!.scene,
      "bot",
    );
    await access.scenes.tick(people[0]!.scene);
    expect(
      (await access.scenes.sessions.get(people[1]!.scene, people[1]!.actor))!
        .current_id,
    ).toBe(people[1]!.scene);
  } finally {
    release();
    await running;
  }
  await settle();
  const offer = (await access.inbox(people[0]!.id, world, people[0]!.actor)).opportunities.find(o => o.sourceInputId === request && !o.nextInput);
  if (offer) {
    await command(0,{command:'react',opportunityId:offer.id,actionText:null});
    await settle();
  }
  const view = (
    await access.scene(
      people[1]!.id,
      world,
      false,
      people[1]!.actor,
      people[1]!.scene,
    )
  ).scene!;
  expect(view.actions.filter((a) => a.id === request)).toHaveLength(1);
  const repairs = calls.mock.calls
    .filter(([, role]) => role === "scene-resolve")
    .map(([, , messages]) => messages.slice(2).map((m) => m.content));
  calls.mockRestore();
  expect(
    view.messages.map((m) => m.text),
    JSON.stringify(repairs),
  ).toEqual(
    expect.arrayContaining(["選択済みの作業の途中", "選択済みの作業の残り"]),
  );
  expect(
    (await access.scenes.sessions.get(people[0]!.scene, people[0]!.actor))!
      .current_id,
  ).toBe(
    (await access.scenes.sessions.get(people[1]!.scene, people[1]!.actor))!
      .current_id,
  );
  for (let i = 0; i < 2; i++) await command(i, { command: "finish" });
  await settle();
  partial = undefined;
}, 120000);
