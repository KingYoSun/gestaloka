import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { join as pathJoin } from "node:path";
import { playerCli } from "../support/player-cli.js";
import { afterAll, beforeAll, expect, test } from "vitest";
import { WorldAccess } from "@gestaloka/server/access";
import { createApp } from "../../apps/api/src/app.js";
import { fixtureRuntime } from "../support/provider.js";
import { fixtureAuth } from "../support/auth.js";
import { isolatedDatabases } from "../support/isolated-db.js";
import type { WorldProposal } from "@gestaloka/server/agent";

const isolated = isolatedDatabases(),
  scope = `icons-${randomUUID()}`;
let runtime: Awaited<ReturnType<typeof fixtureRuntime>>["runtime"],
  access: WorldAccess,
  auth: Awaited<ReturnType<typeof fixtureAuth>>,
  app: Awaited<ReturnType<typeof createApp>>,
  one: Awaited<ReturnType<typeof auth.person>>,
  two: typeof one,
  world: string,
  graph: string,
  preset: string;
type Player = {
  entry: string;
  actor: string;
  name: string;
  icon: string | null;
};
let a: Player, b: Player, c: Player;
const picture = async (color: string) =>
  (
    await sharp({
      create: { width: 24, height: 16, channels: 3, background: color },
    })
      .png()
      .toBuffer()
  ).toString("base64");
const put = (cookie: string, entry: string, image: string | null) =>
  app.inject({
    method: "PUT",
    url: `/api/worlds/${world}/players/${entry}/icon`,
    headers: { cookie, "x-gestaloka-request": "1" },
    payload: { image },
  });
const knowledge = (person: typeof one, actor: string) =>
  app.inject({
    url: `/api/worlds/${world}/knowledge?actorId=${actor}`,
    headers: { cookie: person.cookie },
  });

beforeAll(async () => {
  await isolated.setup();
  let sequence = 0;
  ({ runtime } = await fixtureRuntime(
    scope,
    (content) => {
      const proposal = content as WorldProposal;
      if (proposal.newParticipantId)
        return {
          ...proposal,
          changes: {
            ...proposal.changes,
            nodes: proposal.changes.nodes.map((n) =>
              n.id === proposal.newParticipantId
                ? { ...n, text: `村民${++sequence}` }
                : n,
            ),
            edges: proposal.changes.edges.filter(
              (e) =>
                e.kind !== "see" || e.text === "あなたが初めて知覚した景色",
            ),
          },
        };
      return content;
    },
    isolated.databases,
  ));
  access = new WorldAccess(runtime);
  auth = await fixtureAuth(isolated.databases.postgres);
  await access.setup();
  app = await createApp(access, auth.identity, undefined, auth.operations);
  const admin = await auth.person();
  one = await auth.person("user");
  two = await auth.person("user");
  world = (
    await access.create(admin.id, {
      requestId: randomUUID(),
      prompt: "アイコンの共有を検証する世界",
      budgetUsd: 100,
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
    title: "アイコンの村",
    description: "",
    published: true,
    accepting: true,
    reason: "検証",
  });
  preset = randomUUID();
  await auth.operations.execute(admin.id, randomUUID(), {
    operation: "presets.put",
    presetId: preset,
    title: "村民",
    description: "",
    settings: "この地に暮らす",
    expectedVersion: 0,
    reason: "検証",
  });
}, 60000);
afterAll(async () => {
  await app?.close();
  for (const suffix of ["", "-play", "-scenes", "-joins"])
    await isolated.databases.queue.deleteQueue(`e2e-${scope}${suffix}`);
  if (graph)
    await isolated.databases.graph.executeQuery(
      "MATCH(n) WHERE n.worldId=$world DETACH DELETE n",
      { world: graph },
    );
  await isolated.close();
});

async function join(person: typeof one, color?: string): Promise<Player> {
  const entry = randomUUID();
  const command = {
    operation: "worlds.join" as const,
    worldId: world,
    presetId: preset,
    presetVersion: 1,
  };
  await auth.operations.execute(person.id, entry, command, {
    players: access.players,
  });
  let icon: string | null = null;
  if (color) {
    const response = await put(person.cookie, entry, await picture(color));
    expect(response.statusCode).toBe(200);
    icon = response.json().image;
  }
  // The image belongs to the request while generation is still asynchronous, including a replay.
  await auth.operations.execute(person.id, entry, command, {
    players: access.players,
  });
  expect(
    (await access.players.list(person.id, world, undefined, entry)).items[0],
  ).toMatchObject({ state: "joining", actorId: null, icon });
  await access.players.tick(entry);
  const player = (await access.players.list(person.id, world, undefined, entry))
    .items[0]!;
  expect(player.icon).toBe(icon);
  return { entry, actor: player.actorId!, name: player.name!, icon };
}

test("2ユーザーの画像を参加要求に結び付け、同じ持ち主の人物を分離する", async () => {
  a = await join(one, "red");
  b = await join(one);
  c = await join(two, "blue");
  expect(a.icon).not.toBe(c.icon);
  expect(
    (await access.players.list(one.id, world)).items
      .map((p) => p.actorId)
      .sort(),
  ).toEqual([a.actor, b.actor].sort());
  const changed = await put(one.cookie, a.entry, await picture("green"));
  expect(changed.statusCode).toBe(200);
  a.icon = changed.json().image;
  expect(
    (await access.players.list(one.id, world, undefined, b.entry)).items[0]!
      .icon,
  ).toBeNull();
  const read = await app.inject({
    url: `/api/worlds/${world}/players/${a.entry}`,
    headers: { cookie: one.cookie },
  });
  expect(read.json().player).toMatchObject({
    actorId: a.actor,
    name: a.name,
    icon: a.icon,
  });
  expect((await put(one.cookie, c.entry, null)).statusCode).toBe(404);
  const hidden = await app.inject({
    url: `/api/worlds/${world}/players/${c.entry}`,
    headers: { cookie: one.cookie },
  });
  expect(hidden.json()).toEqual({ player: null });
  expect((await knowledge(one, c.actor)).statusCode).toBe(404);
});

test("名前を識別できる観測だけに顔を添え、未知・匿名・未観測の情報を返さない", async () => {
  expect(JSON.stringify((await knowledge(one, a.actor)).json())).not.toContain(
    c.icon,
  );
  const event = randomUUID(),
    anonymous = randomUUID(),
    commit = randomUUID();
  const namedText = `${c.name}が手を振った。`;
  const changes = {
    nodes: [event, anonymous].map((id) => ({
      id,
      kind: "event" as const,
      text: "共有の出来事",
      period: { from: 0, until: 0 },
    })),
    revisions: [],
    endEdges: [],
    edges: [
      ...[event, anonymous].map((target) => ({
        id: randomUUID(),
        kind: "happen" as const,
        source: c.actor,
        target,
        period: { from: 0, until: 0 },
      })),
      ...[
        { source: a.actor, target: event, text: namedText },
        {
          source: a.actor,
          target: anonymous,
          text: `正体不明の人影が、${c.name}の噂を口にした。`,
        },
        { source: c.actor, target: a.actor, text: `${a.name}と出会った。` },
      ].map((e) => ({
        ...e,
        id: randomUUID(),
        kind: "see" as const,
        period: { from: 0 },
      })),
    ],
  };
  await runtime.agent.store.commit(
    await runtime.agent.store.claim(graph, commit),
    runtime.agent.store.context(graph),
    { commitId: commit, at: 0, changes },
  );
  const items = (await knowledge(one, a.actor)).json().items;
  expect(
    items.find((i: { text: string }) => i.text === namedText).characters,
  ).toEqual([]);
  expect(
    items.find((i: { text: string }) => i.text.startsWith("正体不明"))
      .characters,
  ).toEqual([]);
  expect(JSON.stringify((await knowledge(one, b.actor)).json())).not.toContain(
    c.icon,
  );
  expect(
    (await knowledge(two, c.actor))
      .json()
      .items.find((i: { text: string }) => i.text.includes(a.name)).characters,
  ).toEqual([{ actorId: a.actor, name: a.name, icon: a.icon }]);

  const opened = await access.sceneCommand(
    one.id,
    world,
    {
      requestId: randomUUID(),
      command: "prepare",
      purpose: "出会いを振り返る",
    },
    false,
    a.actor,
  );
  const scene = (await access.scenes.latest(
    world,
    isolated.databases.postgres,
    false,
    a.actor,
  ))!;
  scene.data.background = {
    type: "background",
    synopsis: namedText,
    participants: [a.actor, c.actor],
    facts: [],
    unknowns: [],
    creations: [],
    beliefs: [],
    perceptions: [
      { observerId: a.actor, sourceIds: [c.actor], text: namedText },
    ],
  };
  scene.data.events = [
    {
      id: event,
      actorId: c.actor,
      text: "内部の出来事",
      period: { from: 0, until: 0 },
      receipts: [
        {
          observerId: a.actor,
          text: namedText,
          information: [{ id: c.actor, evidence: namedText }],
        },
      ],
    },
    {
      id: randomUUID(),
      actorId: c.actor,
      text: c.name,
      period: { from: 0, until: 0 },
      receipts: [
        { observerId: a.actor, text: `${c.name}の噂を語る見知らぬ人影。` },
      ],
    },
  ];
  scene.data.actions = [
    { id: randomUUID(), text: "声をかける", state: "complete" },
  ];
  await isolated.databases.postgres.query(
    "UPDATE world_scene SET data=$2 WHERE id=$1",
    [scene.id, scene.data],
  );
  for (const compact of [true, false]) {
    const view = (await access.scene(one.id, world, compact, a.actor)).scene!;
    expect(view.synopsisCharacters).toEqual([
      { actorId: c.actor, name: c.name, icon: c.icon },
    ]);
  }
  const records = await access.sceneRecords(one.id, world, {
    actorId: a.actor,
    sceneId: opened.scene!.id,
    kind: "events",
  });
  expect(records.items.find((i) => i.text === namedText)!.characters).toEqual([
    { actorId: c.actor, name: c.name, icon: c.icon },
  ]);
  expect(
    records.items.find((i) => i.text === `${c.name}の噂を語る見知らぬ人影。`)!
      .characters,
  ).toEqual([]);
  expect(
    (await knowledge(one, a.actor))
      .json()
      .items.find((i: { text: string }) => i.text === namedText).characters,
  ).toEqual([{ actorId: c.actor, name: c.name, icon: c.icon }]);
  expect(
    (
      await access.sceneRecords(one.id, world, {
        actorId: a.actor,
        sceneId: scene.id,
        kind: "actions",
      })
    ).items[0]!.characters,
  ).toEqual([{ actorId: a.actor, name: a.name, icon: a.icon }]);
});

test("不正画像で成立済みの参加と以前の画像を失わず、再試行・解除・旧人物を扱う", async () => {
  for (const image of [
    "bad",
    (
      await sharp({
        create: { width: 4097, height: 1, channels: 3, background: "red" },
      })
        .png()
        .toBuffer()
    ).toString("base64"),
  ])
    expect((await put(one.cookie, a.entry, image)).statusCode).toBe(400);
  expect(
    (await access.players.list(one.id, world, undefined, a.entry)).items[0],
  ).toMatchObject({ state: "ready", icon: a.icon });
  const retried = await put(one.cookie, b.entry, await picture("gold"));
  expect(retried.statusCode).toBe(200);
  expect((await put(one.cookie, b.entry, null)).json()).toEqual({
    image: null,
  });
  expect((await access.player(one.id, world, b.actor)).viewerId).toBe(b.actor);
  // Existing grants without a world_join row use the same settings API.
  await isolated.databases.postgres.query(
    "DELETE FROM world_join WHERE id=$1",
    [b.entry],
  );
  expect(
    (await access.players.list(one.id, world, undefined, b.entry)).items[0]!
      .icon,
  ).toBeNull();
  expect(
    (await put(one.cookie, b.entry, await picture("orange"))).statusCode,
  ).toBe(200);
  const csrf = await app.inject({
    method: "PUT",
    url: `/api/worlds/${world}/players/${a.entry}/icon`,
    headers: {
      cookie: one.cookie,
      origin: "https://other.invalid",
      "x-gestaloka-request": "1",
    },
    payload: { image: null },
  });
  expect(csrf.statusCode).toBe(403);
});

test("CLIから参加時の画像を復旧し、Webとの更新・解除と村民単位の認可を共有する", async () => {
  const fixture = await playerCli(app),
    { base, directory, run } = fixture;
  const profiles = [
    pathJoin(directory, "one.json"),
    pathJoin(directory, "two.json"),
  ];
  const red = pathJoin(directory, "red.png"),
    blue = pathJoin(directory, "blue.png"),
    bad = pathJoin(directory, "bad.png");
  await writeFile(red, Buffer.from(await picture("red"), "base64"));
  await writeFile(blue, Buffer.from(await picture("blue"), "base64"));
  await writeFile(bad, "not an image");
  try {
    const first = await run(
        profiles[0]!,
        "connect",
        "--server",
        base,
        "--world",
        world,
      ),
      second = await run(
        profiles[1]!,
        "connect",
        "--server",
        base,
        "--world",
        world,
      );
    expect(
      (await fixture.approve(one.cookie, first.userCode, `preset:${preset}:1`))
        .statusCode,
    ).toBe(302);
    expect(
      (await fixture.approve(two.cookie, second.userCode, `preset:${preset}:1`))
        .statusCode,
    ).toBe(302);
    fixture.dropNextResponse(`/api/worlds/${world}/players/${first.id}/icon`);
    const lost = await run(profiles[0]!, "join", "--icon", red);
    expect(lost.state).toBe("error");
    expect(lost.requestId).not.toBe(first.id);
    const recovered = await run(profiles[0]!, "recover");
    expect(recovered.requestId).toBe(lost.requestId);
    expect(recovered.state).toBe("joining");
    const failed = await run(profiles[1]!, "join", "--icon", bad);
    expect(failed.code).toBe("ICON_INVALID");
    expect(
      (await access.players.list(two.id, world, undefined, second.id)).items[0],
    ).toMatchObject({ state: "joining", icon: null });
    expect((await run(profiles[1]!, "icon", "--file", blue)).state).toBe(
      "joining",
    );
    await access.players.tick(first.id);
    await access.players.tick(second.id);
    const web = (cookie: string, id: string) =>
      app.inject({
        url: `/api/worlds/${world}/players/${id}`,
        headers: { cookie },
      });
    const firstPlayer = (await web(one.cookie, first.id)).json().player,
      secondPlayer = (await web(two.cookie, second.id)).json().player;
    expect(firstPlayer.icon).toBe(recovered.result.image);
    expect(secondPlayer.icon).not.toBe(firstPlayer.icon);
    expect(firstPlayer.actorId).not.toBe(secondPlayer.actorId);
    expect((await run(profiles[0]!, "icon")).player).toEqual(firstPlayer);
    const changed = await put(one.cookie, first.id, await picture("green"));
    expect((await run(profiles[0]!, "icon")).player.icon).toBe(
      changed.json().image,
    );
    const beforeBad = (await run(profiles[0]!, "icon")).player.icon;
    expect((await run(profiles[0]!, "icon", "--file", bad)).code).toBe(
      "ICON_INVALID",
    );
    expect((await web(one.cookie, first.id)).json().player.icon).toBe(
      beforeBad,
    );
    const updated = await run(profiles[0]!, "icon", "--file", red);
    expect((await web(one.cookie, first.id)).json().player.icon).toBe(
      updated.result.image,
    );
    expect((await web(two.cookie, second.id)).json().player.icon).toBe(
      secondPlayer.icon,
    );
    expect(
      (await run(profiles[0]!, "icon", "--clear")).result.image,
    ).toBeNull();
    expect((await web(one.cookie, first.id)).json().player.icon).toBeNull();
    const profile = JSON.parse(await readFile(profiles[0]!, "utf8")),
      headers = {
        authorization: `Bearer ${profile.secret}`,
        "x-gestaloka-request": "1",
      };
    for (const id of [b.entry, second.id]) {
      expect(
        (
          await app.inject({
            url: `/api/worlds/${world}/players/${id}`,
            headers,
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "PUT",
            url: `/api/worlds/${world}/players/${id}/icon`,
            headers,
            payload: { image: null },
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await app.inject({
          url: `/api/worlds/${randomUUID()}/players`,
          headers,
        })
      ).statusCode,
    ).toBe(403);
    const scoped = await app.inject({
      url: `/api/worlds/${world}/players`,
      headers,
    });
    expect(scoped.json().items.map((p: { id: string }) => p.id)).toEqual([
      first.id,
    ]);
    const extra = pathJoin(directory, "existing.json"),
      connection = await run(
        extra,
        "connect",
        "--server",
        base,
        "--world",
        world,
      );
    expect(
      (
        await fixture.approve(
          one.cookie,
          connection.userCode,
          `actor:${b.actor}`,
        )
      ).statusCode,
    ).toBe(302);
    expect((await run(extra, "icon")).player.id).toBe(b.entry);
    const legacy = await run(extra, "icon", "--file", blue);
    expect((await web(one.cookie, b.entry)).json().player.icon).toBe(
      legacy.result.image,
    );
    expect((await web(one.cookie, first.id)).json().player.icon).toBeNull();
    const saved = JSON.parse(await readFile(profiles[0]!, "utf8"));
    expect(saved.joinIconRequestId).toBeUndefined();
    await access.devices.revoke(one.id, first.id);
    expect((await run(profiles[0]!, "icon")).code).toBe("PLAYER_DEVICE_DENIED");
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/worlds/${world}/players/${first.id}/icon`,
          headers,
          payload: { image: null },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await isolated.databases.postgres.query(
          "SELECT id FROM world_join WHERE id=ANY($1)",
          [[first.id, second.id]],
        )
      ).rowCount,
    ).toBe(2);
  } finally {
    await fixture.close();
  }
}, 120000);
