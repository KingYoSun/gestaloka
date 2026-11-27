import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { playerCli } from "../support/player-cli.js";

test("セッションのCLI応答では世界の判定基準を省き、各判定の理由を返す", async () => {
  const app = Fastify();
  const cli = await playerCli(app);
  try {
    const profile = join(cli.directory, "profile.json");
    const worldId = randomUUID();
    const deviceId = randomUUID();
    const sceneId = randomUUID();
    const device = {
      id: deviceId,
      worldId,
      actorId: randomUUID(),
      joinId: null,
      presetId: null,
      presetVersion: null,
      state: "ready",
    };
    await writeFile(
      profile,
      JSON.stringify({ server: cli.base, worldId, deviceId, secret: "local" }),
    );
    const criteria = {
      creationCriteria: "物品作成の基準の本文",
      skillCriteria: "技能の基準の本文",
      exploreCriteria: "探索の基準の本文",
      fumbleCriteria: "ファンブルの基準の本文",
    };
    const result = {
      diceReasons: ["持っていた道具が有利に働きました"],
      learningReasons: ["繰り返した稽古が有利に働きました"],
      thresholdReasons: ["足場が安定しているため成功上限を上げました"],
    };
    const entries = [{ payload: { entries: [{ result }] } }];
    app.get("/api/player-device", async () => device);
    app.get("/api/worlds/:id/session", async () => ({ ...criteria, entries }));
    app.post("/api/worlds/:id/session", async () => ({
      ...criteria,
      ...result,
    }));

    for (const args of [
      ["status"],
      ["status", "--after", "0"],
      ["status", "--scene", sceneId],
      ["result", "--scene", sceneId],
    ]) {
      expect(await cli.run(profile, ...args, "--full-ids")).toEqual({
        state: "ready",
        device,
        entries,
      });
    }
    const action = await cli.run(
      profile,
      "explore",
      "--from",
      randomUUID(),
      "--label",
      "鐘楼",
      "--text",
      "通路の先を調べる",
      "--expected-sp",
      "1",
    );
    expect(action).toEqual({ requestId: expect.any(String), result });
    expect(await cli.run(profile, "recover")).toEqual(action);
  } finally {
    await cli.close();
    await app.close();
  }
});

test("長い履歴と定型の応答を短くしても次の操作に必要な情報を読める", async () => {
  const app = Fastify();
  const cli = await playerCli(app);
  try {
    const profile = join(cli.directory, "profile.json");
    const worldId = randomUUID(),
      deviceId = randomUUID(),
      actorId = randomUUID();
    const sceneId = randomUUID(),
      storyId = randomUUID(),
      questId = randomUUID();
    const longText = "石段の下に古い水路が続いている。".repeat(100);
    const at = "2026-01-01T00:00:00Z";
    const world = "/api/worlds/:id";
    await writeFile(
      profile,
      JSON.stringify({ server: cli.base, worldId, deviceId, secret: "local" }),
    );
    let ready = false,
      sessionReads = 0;
    app.get("/api/player-device", async () => ({
      id: deviceId,
      worldId,
      actorId: ready ? actorId : null,
      joinId: null,
      presetId: null,
      presetVersion: null,
      state: ready ? "ready" : "authorized",
      character: longText,
    }));
    app.post("/api/player-devices", async () => ({
      id: deviceId,
      userCode: "試験",
      verificationPath: "/auth/player?code=test",
    }));
    const entries = Array.from({ length: 73 }, (_, id) => ({
      id: id + 1,
      payload: { text: longText.slice(0, 660) },
    }));
    app.get(`${world}/session`, async () => {
      sessionReads++;
      return { entries, legacy: [], result: { entries, legacy: [] } };
    });
    app.post(`${world}/reports`, async () => ({ sent: 1, available: 0 }));
    app.post(`${world}/viewers`, async () => ({ viewers: [] }));
    app.get(`${world}/npc-promotions`, async () => ({
      items: [
        {
          id: sceneId,
          label: "水路番",
          state: "approved",
          npcId: actorId,
          description: longText,
          sourceText: longText,
          autoReview: null,
          decidedBy: deviceId,
        },
      ],
      next: sceneId,
    }));
    const view = {
      quest: {
        id: questId,
        phase: "build",
        template: { name: "石橋", instructions: longText },
        plan: { description: longText },
        buildingId: null,
      },
      requirements: [{ label: "石材", count: 3, provided: 2 }],
      next: "blueprint-provide",
    };
    app.post<{ Body: { command: string } }>(
      `${world}/session`,
      async ({ body }, reply) => {
        if (body.command === "blueprint-list")
          return { quests: [view], next: null };
        if (body.command === "blueprint-show") return view;
        return reply.code(409).send({
          code: "VOICE_RESTRICTED",
          message: `声が出ません。原因の状態 @12345678「${longText}」。`,
          blockingStates: [
            { stateId: questId, shortId: "@12345678", text: longText },
          ],
        });
      },
    );
    const episode = { number: 2, title: "石橋", publishedAt: at };
    const story = {
      id: storyId,
      worldId,
      worldTitle: "試験の村",
      title: "水路の記録",
      author: "旅人",
      mine: false,
    };
    app.get("/api/stories/:id", async () => ({
      story,
      episodes: [episode],
      episode: { ...episode, body: longText },
      hasNextEpisode: false,
      nextEpisode: null,
      next: null,
    }));
    const waiting = {
      state: "standby",
      active: true,
      connected: true,
      viewerId: actorId,
      actionable: false,
      wakeKey: null,
    };
    const waitingForReturn = {
      actorId,
      name: "旅人",
      deadline: at,
      remainingSeconds: 600,
      message: "旅人の復帰を待っています",
    };
    app.post(`${world}/waiting`, async () => waiting);
    app.get(`${world}/waiting/events`, async (_request, reply) =>
      reply.type("text/event-stream").send(
        [
          {
            ...waiting,
            progress: {
              cursor: "1",
              actorId,
              updates: [],
              message: waitingForReturn.message,
              waitingForReturn,
            },
          },
          { ...waiting, state: "inactive", active: false },
        ]
          .map((frame) => `event: waiting\ndata: ${JSON.stringify(frame)}\n\n`)
          .join(""),
      ),
    );

    const run = (...args: string[]) => cli.run(profile, ...args, "--full-ids");
    const connected = await run(
      "connect",
      "--server",
      cli.base,
      "--world",
      worldId,
    );
    expect(connected).toMatchObject({
      id: deviceId,
      userCode: "試験",
      verificationUrl: `${cli.base}/auth/player?code=test`,
      device: { character: longText },
    });
    expect(connected.device).not.toHaveProperty("id");
    expect(connected).not.toHaveProperty("requestId");
    expect(await run("recover")).toEqual(connected);
    ready = true;
    const completed = await run("result", "--scene", sceneId);
    expect(completed.entries).toEqual(entries);
    expect(completed).not.toHaveProperty("result");
    expect(completed.device).not.toHaveProperty("character");
    expect(JSON.stringify(completed).length).toBeLessThan(50_000 + 3_000);
    expect(await run("report", "--text", "水路の報告")).toMatchObject({
      state: "report",
      result: { sent: 1, available: 0 },
    });
    expect(
      await run("viewers", "--target", questId, "--to", "self"),
    ).toMatchObject({ state: "ready", result: { viewers: [] } });
    expect(sessionReads).toBe(1);
    expect(await run("promotions")).toEqual({
      state: "promotions",
      items: [
        { id: sceneId, label: "水路番", state: "approved", npcId: actorId },
      ],
      next: sceneId,
    });

    const play = async (input: Record<string, unknown>) => {
      const path = join(cli.directory, "play.json");
      await writeFile(path, JSON.stringify(input));
      return run("play", "--file", path);
    };
    expect((await play({ command: "blueprint-list" })).result.quests).toEqual([
      {
        quest: { id: questId, name: "石橋", phase: "build", buildingId: null },
        next: "blueprint-provide",
      },
    ]);
    expect(
      (await play({ command: "blueprint-show", questId })).result.requirements,
    ).toEqual(view.requirements);
    const index = await run(
      "stories",
      "read",
      "--story",
      storyId,
      "--after",
      "1",
    );
    expect(index).toMatchObject({
      story,
      episodes: [{ number: 2, title: "石橋" }],
    });
    expect(index).not.toHaveProperty("episode");
    expect(
      (await run("stories", "read", "--story", storyId, "--episode", "2"))
        .episode.body,
    ).toBe(longText);
    const error = await cli.run(profile, "say", "--text", "こんにちは");
    expect(error).toMatchObject({
      code: "VOICE_RESTRICTED",
      message: "声が出ません。",
      blockingStates: [
        { stateId: expect.stringMatching(/^@/), text: longText },
      ],
    });
    const [waitingFrame] = await cli.lines(profile, "listen", "--resume");
    expect(waitingFrame.progress.waitingForReturn).toMatchObject({
      message: waitingForReturn.message,
      remainingSeconds: 600,
    });
    expect(waitingFrame.progress).not.toHaveProperty("message");
  } finally {
    await cli.close();
    await app.close();
  }
});

test("検索のHTML応答ではHTTPの情報を表示し、JSONエラーではAPIのエラーを表示する", async () => {
  const app = Fastify();
  const cli = await playerCli(app);
  try {
    const profile = join(cli.directory, "profile.json");
    await writeFile(
      profile,
      JSON.stringify({
        server: cli.base,
        worldId: randomUUID(),
        deviceId: randomUUID(),
        secret: "local-test",
      }),
    );
    app.post<{ Body: { query: { kind: string } } }>(
      "/api/worlds/:id/session",
      async (request, reply) => {
        const html = "<!DOCTYPE html><title>Proxy error</title>";
        if (request.body.query.kind === "self")
          return reply
            .code(502)
            .type("text/html")
            .header("cf-ray", "example-NRT")
            .send(html);
        if (request.body.query.kind === "surroundings")
          return reply.code(503).type("text/html").send(html);
        return reply.code(403).send({
          code: "LOGIN_REQUIRED",
          message: "ログインしてください",
        });
      },
    );
    const failure = { state: "error", requestId: expect.any(String) };
    expect(await cli.run(profile, "search", "--kind", "self")).toEqual({
      ...failure,
      code: "HTTP_ERROR",
      message:
        "サーバーの応答をJSONとして読み取れませんでした（HTTP 502、Content-Type text/html、cf-ray example-NRT）",
    });
    expect(await cli.run(profile, "search", "--kind", "surroundings")).toEqual({
      ...failure,
      code: "HTTP_ERROR",
      message:
        "サーバーの応答をJSONとして読み取れませんでした（HTTP 503、Content-Type text/html）",
    });
    expect(await cli.run(profile, "search", "--kind", "history")).toEqual({
      ...failure,
      code: "LOGIN_REQUIRED",
      message: "ログインしてください",
    });
  } finally {
    await cli.close();
    await app.close();
  }
});
