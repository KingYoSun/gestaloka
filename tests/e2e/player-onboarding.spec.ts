import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { WorldAccess } from "@gestaloka/server/access";
import { createApp } from "../../apps/api/src/app.js";
import { isolatedDatabases } from "../support/isolated-db.js";
import { fixtureRuntime } from "../support/provider.js";
import { fixtureAuth } from "../support/auth.js";
import { playerCli } from "../support/player-cli.js";

for (const base of ["", "共通の所属と個別の所有物を持つ新しい参加者。"])
  test(`未登録・人物なしから招待で登録し、許可したAIの設定とアイコンをCLIで一度だけ引き継ぐ${base ? "（世界の基本設定あり）" : ""}`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    const isolated = isolatedDatabases();
    await isolated.setup();
    const scope = randomUUID();
    let receivedSettings = "";
    const { databases: db, runtime } = await fixtureRuntime(
      scope,
      (content, input) => {
        if (input.initialPrompt) {
          if (base) expect(input.initialPrompt).not.toContain(base);
          const initial = content as {
            changes: { nodes: { id: string }[] };
            rootIds: string[];
          };
          return {
            ...initial,
            playerId: null,
            changes: {
              nodes: initial.changes.nodes.filter((n) =>
                initial.rootIds.includes(n.id),
              ),
              edges: [],
              revisions: [],
              endEdges: [],
            },
          };
        }
        const request = input.request as
          { phase?: string; actionText?: string } | undefined;
        if (request?.phase === "participant")
          receivedSettings = request.actionText ?? "";
        return content;
      },
      isolated.databases,
    );
    const access = new WorldAccess(runtime);
    const auth = await fixtureAuth(db.postgres);
    await access.setup();
    const app = await createApp(
      access,
      auth.identity,
      undefined,
      auth.operations,
    );
    const cli = await playerCli(app);
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    let graph: string | undefined;
    try {
      const admin = await auth.person();
      await db.postgres.query(
        "UPDATE operation_state SET bootstrapped=true,invite_required=true",
      );
      const person = await auth.person("user");
      await db.postgres.query("DELETE FROM app_user WHERE id=$1", [person.id]);
      const world = (
        await access.create(admin.id, {
          requestId: randomUUID(),
          budgetUsd: 100,
          prompt: "参加の導線を確認する世界",
          playerSettings: base,
        })
      ).id;
      await runtime.tick(world);
      expect((await runtime.get(world)).actor_id).toBeNull();
      expect((await runtime.get(world)).agenda.map((w) => w.mode)).toEqual([
        "schedule",
      ]);
      graph = (await runtime.get(world)).world_id!;
      await access.command(admin.id, world, {
        requestId: randomUUID(),
        command: "finish",
      });
      await auth.operations.execute(admin.id, randomUUID(), {
        operation: "worlds.configure",
        worldId: world,
        title: "参加する世界",
        description: "",
        published: true,
        accepting: true,
        reason: "試験",
      });
      const presetId = randomUUID();
      if (base)
        await auth.operations.execute(admin.id, randomUUID(), {
          operation: "presets.put",
          presetId,
          title: "汎用の人物設定",
          description: "",
          settings: "Webから参加する別の人物",
          expectedVersion: 0,
          reason: "試験",
        });
      const invitation = await auth.operations.execute(admin.id, randomUUID(), {
        operation: "invites.create",
        maxUses: 1,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        reason: "新しい参加者を招く",
      });
      const token = String(invitation.token);
      const settings =
        "名前はミラ。星の記録を集める旅人。落ち着いた口調で話し、青い外套を着ている。";
      const approvedSettings = base
        ? `参加者の基本設定\n${base}\n\n人物の個別設定\n${settings}`
        : settings;
      const settingsFile = join(cli.directory, "character.txt");
      const imageFile = join(cli.directory, "face.png");
      const profile = join(cli.directory, "player.json");
      await writeFile(settingsFile, settings);
      await writeFile(
        imageFile,
        await sharp({
          create: { width: 8, height: 8, channels: 4, background: "#c6922e" },
        })
          .png()
          .toBuffer(),
      );
      const initial = await cli.run(
        profile,
        "connect",
        "--server",
        cli.base,
        "--world",
        world,
        "--character",
        settingsFile,
        "--icon",
        imageFile,
      );
      expect(initial.state).toBe("authorization_pending");
      const permit = `/auth/player?${new URLSearchParams({ code: initial.userCode, invitation: token })}`;
      const anonymous = await app.inject({
        url: permit,
        headers: { host: new URL(cli.base).host },
      });
      expect(anonymous.statusCode).toBe(302);
      expect(
        new URL(String(anonymous.headers.location), cli.base).searchParams.get(
          "return_to",
        ),
      ).toBe(cli.base + permit);
      const unregistered = await app.inject({
        url: permit,
        headers: { cookie: person.cookie },
      });
      expect(unregistered.statusCode).toBe(302);
      await page.context().addCookies([
        {
          name: "test_ory",
          value: person.id,
          url: origin,
          httpOnly: true,
          sameSite: "Strict",
        },
      ]);
      await page.goto(origin + permit);
      await expect(
        page.getByRole("heading", { name: "利用登録", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByLabel("招待トークン", { exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "利用登録する", exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "AIにプレイを許可する",
          exact: true,
        }),
      ).toBeVisible();
      expect(new URL(page.url()).searchParams.get("code")).toBe(
        initial.userCode,
      );
      await expect(page.getByRole("radio")).toHaveCount(0);
      await expect(
        page.getByText("汎用の人物設定", { exact: false }),
      ).toHaveCount(0);
      await expect(page.getByText(settings, { exact: !base })).toBeVisible();
      if (base) await expect(page.getByText(base)).toBeVisible();
      const portrait = page.getByRole("img", {
        name: "AIが用意した人物のアイコン",
      });
      await expect(portrait).toBeVisible();
      expect(
        await portrait.evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
      ).toBe(true);
      const icon = await portrait.getAttribute("src");
      await page.screenshot({
        path: `artifacts/screenshots/ai-first-participation${base ? "-with-base" : ""}.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", {
          name: "この人物のプレイを許可する",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "プレイを許可しました",
          exact: true,
        }),
      ).toBeVisible();
      expect((await auth.operations.state(person.id)).member?.role).toBe(
        "user",
      );
      expect((await access.players.list(person.id, world)).items).toEqual([]);
      expect(
        (await db.postgres.query("SELECT uses::int AS uses FROM app_invite"))
          .rows[0].uses,
      ).toBe(1);
      expect(
        (await db.postgres.query("SELECT invite_required FROM operation_state"))
          .rows[0].invite_required,
      ).toBe(true);
      const state = await cli.run(profile, "status");
      expect(state.device.character).toBe(approvedSettings);
      expect(state.device.presetId).toBeNull();
      const secret = JSON.parse(await readFile(profile, "utf8")).secret;
      const headers = {
        authorization: `Bearer ${secret}`,
        "x-gestaloka-request": "1",
      };
      const tampered = await app.inject({
        method: "POST",
        url: "/api/operations",
        headers,
        payload: {
          requestId: initial.id,
          command: {
            operation: "worlds.join",
            worldId: world,
            character: "別の設定",
          },
        },
      });
      expect(tampered.statusCode).toBe(403);
      cli.dropNextResponse("worlds.join");
      const lost = await cli.run(profile, "join");
      expect(lost.state).toBe("error");
      await cli.run(profile, "recover", "--request", lost.requestId);
      const own = (await access.players.list(person.id, world)).items[0]!;
      expect(own.icon).toBe(icon);
      const other = randomUUID();
      await auth.operations.execute(
        person.id,
        other,
        { operation: "worlds.join", worldId: world, character: "別の人物" },
        { players: access.players },
      );
      const denied = await app.inject({
        method: "PUT",
        url: `/api/worlds/${world}/players/${other}/icon`,
        headers,
        payload: { image: null },
      });
      expect(denied.statusCode).toBe(403);
      const scoped = await app.inject({
        url: `/api/worlds/${world}/players`,
        headers,
      });
      expect(scoped.json().items.map((p: { id: string }) => p.id)).toEqual([
        initial.id,
      ]);
      await access.players.tick(initial.id);
      expect(receivedSettings).toBe(approvedSettings);
      const ready = await cli.run(profile, "status");
      expect(ready.state).toBe("no_scene");
      expect(ready.device.actorId).toBeTruthy();
      expect((await cli.run(profile, "icon")).player.icon).toBe(icon);
      await cli.run(profile, "recover", "--request", lost.requestId);
      expect(
        (
          await db.postgres.query(
            "SELECT count(*)::int AS n FROM world_join WHERE id=$1",
            [initial.id],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await db.postgres.query(
            "SELECT count(*)::int AS n FROM player_preset",
          )
        ).rows[0].n,
      ).toBe(base ? 1 : 0);
      if (base) {
        const webJoin = randomUUID();
        await auth.operations.execute(
          person.id,
          webJoin,
          {
            operation: "worlds.join",
            worldId: world,
            presetId,
            presetVersion: 1,
          },
          { players: access.players },
        );
        await access.players.tick(webJoin);
        expect(receivedSettings).toBe(
          `参加者の基本設定\n${base}\n\n人物の個別設定\nWebから参加する別の人物`,
        );
        const webPerson = (
          await access.players.list(person.id, world)
        ).items.find((p) => p.id === webJoin)!;
        expect(webPerson.state).toBe("ready");
        expect(webPerson.actorId).not.toBe(ready.device.actorId);
      }
    } finally {
      await cli.close();
      await app.close();
      for (const suffix of [
        "",
        "-play",
        "-scenes",
        "-joins",
        "-shared-scenes",
        "-scene-deadlines",
      ])
        await db.queue.deleteQueue(`e2e-${scope}${suffix}`);
      if (graph)
        await db.graph.executeQuery(
          "MATCH(n) WHERE n.worldId=$world DETACH DELETE n",
          { world: graph },
        );
      await isolated.close();
    }
  });
