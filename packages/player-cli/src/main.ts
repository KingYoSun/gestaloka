#!/usr/bin/env node
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  PlayerDeviceCode,
  PlayCommand,
  PlayerDeviceStatus,
  SceneRecordPage,
  JoinWorld,
  PlayerIconInput,
  WorldPlayerPage,
} from "@gestaloka/contracts";

const help = `GESTALOKA プレイヤーCLI

gestaloka connect --server <URL> --world <IDまたはURL> [--character <ファイル>] [--icon <画像>]
gestaloka join [--icon <画像>]           認可されたキャラクターを生成
gestaloka status                        参加状態・手番・チャットを取得（枠外）
gestaloka start                         単独セッションを開始
gestaloka search --kind <surroundings|belongings|self|history|subject> [--target <ID>]
gestaloka contact --target <人物ID>      所在地から接触・合流を申請
gestaloka say --text <発言>              本人の一手を記録
gestaloka comment --text <コメント>      本人の手番に1回、枠外でコメント
gestaloka receive --application <ID> --accept|--reject  受領判断
gestaloka end-turn                      手番を終え、入力と結果を共有
gestaloka leave                         セッションを分離して続行
gestaloka finish                        本人のシーンを終了し履歴を取得
gestaloka play --file <JSONファイル>     PlayCommandの検索・更新・作成・対抗行動を送信
gestaloka history --scene <ID> --kind <events|actions>  旧シーンの保存履歴
gestaloka icon [--file <画像>|--clear]   アイコンを操作
gestaloka recover [--request <ID>]       保存した同じ要求を再送

通常枠の初期値は成功8回。検索結果は本人だけへ返ります。
エラー・状態確認・チャット取得・再送・コメントは枠を消費しません。
全コマンド: --profile <ファイル>。出力はJSON。認可は持ち主のブラウザーで行います。
`;
const Profile = z.object({
  server: z.url(),
  worldId: z.uuid(),
  deviceId: z.uuid(),
  secret: z.string(),
  lastRequestId: z.uuid().optional(),
  joinIconRequestId: z.uuid().optional(),
});
const Request = z.object({
  id: z.uuid(),
  path: z.string(),
  body: z.record(z.string(), z.unknown()),
  authenticated: z.boolean(),
  method: z.enum(["POST", "PUT"]).default("POST"),
});
type Profile = z.infer<typeof Profile>;
const parse = () =>
  parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean" },
      server: { type: "string" },
      world: { type: "string" },
      profile: { type: "string" },
      text: { type: "string" },
      file: { type: "string" },
      after: { type: "string" },
      before: { type: "string" },
      scene: { type: "string" },
      kind: { type: "string" },
      target: { type: "string" },
      application: { type: "string" },
      request: { type: "string" },
      icon: { type: "string" },
      character: { type: "string" },
      clear: { type: "boolean" },
      accept: { type: "boolean" },
      reject: { type: "boolean" },
    },
  });
let values: ReturnType<typeof parse>["values"];
let profilePath: string, journal: string;
let requestId: string | undefined;
async function save(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(data) + "\n", { mode: 0o600 });
  await rename(temporary, path);
}
async function load() {
  return Profile.parse(JSON.parse(await readFile(profilePath, "utf8")));
}
async function http(
  profile: Profile,
  path: string,
  body?: unknown,
  authenticated = true,
  method = "POST",
) {
  const response = await fetch(new URL(path, profile.server), {
    method: body === undefined ? "GET" : method,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      ...(authenticated ? { authorization: `Bearer ${profile.secret}` } : {}),
      ...(body === undefined
        ? {}
        : { "content-type": "application/json", "x-gestaloka-request": "1" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.message ?? `HTTP ${response.status}`), {
      code: data.code ?? "HTTP_ERROR",
    });
  return data;
}
async function status(profile: Profile) {
  const device = PlayerDeviceStatus.parse(
    await http(profile, "/api/player-device"),
  );
  if (device.state !== "ready") return { state: device.state, device };
  return {
    state: "ready",
    device,
    ...(await http(
      profile,
      `/api/worlds/${profile.worldId}/session${values.scene ? `?sceneId=${z.uuid().parse(values.scene)}` : ""}`,
    )),
  };
}
async function send(
  profile: Profile,
  saved: z.infer<typeof Request>,
): Promise<Record<string, unknown>> {
  requestId = saved.id;
  const result = await http(
    profile,
    saved.path,
    saved.body,
    saved.authenticated,
    saved.method,
  );
  await save(join(journal, `${saved.id}.json`), { ...saved, result });
  if (profile.joinIconRequestId === saved.id) {
    delete profile.joinIconRequestId;
    await save(profilePath, profile);
  }
  if (!saved.authenticated) {
    const code = PlayerDeviceCode.parse(result);
    return {
      ...(await status(profile)),
      requestId,
      ...code,
      verificationUrl: new URL(code.verificationPath, profile.server).href,
    };
  }
  if (
    saved.body.command &&
    (saved.body.command as { operation?: string }).operation ===
      "worlds.join" &&
    profile.joinIconRequestId
  ) {
    profile.lastRequestId = profile.joinIconRequestId;
    await save(profilePath, profile);
    return {
      joinRequestId: saved.id,
      ...(await send(
        profile,
        Request.parse(
          JSON.parse(
            await readFile(
              join(journal, `${profile.joinIconRequestId}.json`),
              "utf8",
            ),
          ),
        ),
      )),
    };
  }
  return {
    ...(saved.path.endsWith("/session") ? {} : await status(profile)),
    requestId,
    result,
  };
}
async function submit(
  profile: Profile,
  path: string,
  body: Record<string, unknown>,
  authenticated = true,
  id: string = randomUUID(),
  method: "POST" | "PUT" = "POST",
) {
  requestId = id;
  const saved = {
    id,
    path,
    body: method === "PUT" ? body : { ...body, requestId: id },
    authenticated,
    method,
  };
  await save(join(journal, `${id}.json`), saved);
  await save(profilePath, { ...profile, lastRequestId: id });
  return send(profile, saved);
}
async function run() {
  const parsed = parse();
  values = parsed.values;
  const positionals = parsed.positionals,
    command = positionals[0] ?? "help";
  profilePath =
    values.profile ??
    join(
      process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
      "gestaloka",
      "default.json",
    );
  journal = `${profilePath}.requests`;
  if (command === "help" || values.help) return { help };
  if (positionals.length > 1)
    throw new Error("コマンドは1つ指定してください（helpを参照）");
  if (command === "connect") {
    if (!values.server || !values.world)
      throw new Error("--serverと--worldを指定してください");
    const server = new URL(values.server).origin;
    const worldId = z
      .uuid()
      .parse(
        URL.canParse(values.world)
          ? new URL(values.world).pathname.match(
              /\/worlds\/([a-f0-9-]{36})(?:\/|$)/i,
            )?.[1]
          : values.world,
      );
    let profile: Profile;
    try {
      profile = await load();
      if (profile.server !== server || profile.worldId !== worldId)
        throw new Error("別の接続には別の--profileを指定してください");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      profile = {
        server,
        worldId,
        deviceId: randomUUID(),
        secret: randomBytes(32).toString("hex"),
      };
      await save(profilePath, profile);
    }
    return submit(
      profile,
      "/api/player-devices",
      {
        worldId,
        secret: profile.secret,
        ...(values.character
          ? { character: await readFile(values.character, "utf8") }
          : {}),
        ...(values.icon
          ? { icon: (await readFile(values.icon)).toString("base64") }
          : {}),
      },
      false,
      profile.deviceId,
    );
  }
  const profile = await load();
  if (
    values.scene &&
    !["status", "result", "history", "recover"].includes(command)
  )
    throw new Error(
      "--sceneは状態・履歴の照会に使います。プレイ操作は本人の現在のシーンを指定します。",
    );
  if (["status", "result"].includes(command)) return status(profile);
  if (command === "recover") {
    const id = z.uuid().parse(values.request ?? profile.lastRequestId);
    return send(
      profile,
      Request.parse(
        JSON.parse(await readFile(join(journal, `${id}.json`), "utf8")),
      ),
    );
  }
  if (command === "history") {
    const query = new URLSearchParams({
      sceneId: z.uuid().parse(values.scene),
      kind: z.enum(["events", "actions"]).parse(values.kind ?? "events"),
    });
    for (const key of ["before", "after"] as const)
      if (values[key]) query.set(key, values[key]!);
    return {
      state: "history",
      ...SceneRecordPage.parse(
        await http(
          profile,
          `/api/worlds/${profile.worldId}/scene/records?${query}`,
        ),
      ),
    };
  }
  const device = PlayerDeviceStatus.parse(
    await http(profile, "/api/player-device"),
  );
  if (command === "icon") {
    const player = WorldPlayerPage.parse(
      await http(profile, `/api/worlds/${profile.worldId}/players`),
    ).items[0];
    if (!player)
      throw new Error("参加要求または許可された人物を確認してください");
    if (values.file && values.clear)
      throw new Error("--fileと--clearはどちらか一方を指定してください");
    if (!values.file && !values.clear) return { state: "icon", player };
    const body = PlayerIconInput.parse({
      image: values.clear
        ? null
        : (await readFile(values.file!)).toString("base64"),
    });
    delete profile.joinIconRequestId;
    return submit(
      profile,
      `/api/worlds/${profile.worldId}/players/${player.id}/icon`,
      body,
      true,
      randomUUID(),
      "PUT",
    );
  }
  if (command === "join") {
    const joinCommand = JoinWorld.parse({
      operation: "worlds.join",
      worldId: profile.worldId,
      ...(device.character
        ? { character: device.character }
        : {
            presetId: device.presetId,
            presetVersion: device.presetVersion,
          }),
    });
    if (!device.joinId) throw new Error("新規参加が許可されていません");
    const image = values.icon
      ? (await readFile(values.icon)).toString("base64")
      : device.character
        ? Request.parse(
            JSON.parse(
              await readFile(join(journal, `${profile.deviceId}.json`), "utf8"),
            ),
          ).body.icon
        : undefined;
    if (image) {
      const icon = {
        id: randomUUID(),
        path: `/api/worlds/${profile.worldId}/players/${device.joinId}/icon`,
        body: PlayerIconInput.parse({
          image,
        }),
        authenticated: true,
        method: "PUT" as const,
      };
      await save(join(journal, `${icon.id}.json`), icon);
      profile.joinIconRequestId = icon.id;
    }
    return submit(
      profile,
      "/api/operations",
      { command: joinCommand },
      true,
      device.joinId,
    );
  }
  if (command === "resume" && !device.actorId && device.joinId)
    return submit(profile, "/api/operations", {
      command: { operation: "worlds.resumeJoin", joinId: device.joinId },
    });
  const id = randomUUID();
  const body = PlayCommand.parse(
    command === "play"
      ? {
          ...JSON.parse(await readFile(z.string().parse(values.file), "utf8")),
          requestId: id,
        }
      : {
          requestId: id,
          command,
          ...(command === "search"
            ? {
                query: {
                  kind: values.kind,
                  ...(values.target ? { targetId: values.target } : {}),
                },
              }
            : {}),
          ...(command === "contact" ? { targetId: values.target } : {}),
          ...(["say", "comment"].includes(command)
            ? {
                text: values.file
                  ? await readFile(values.file, "utf8")
                  : values.text,
              }
            : {}),
          ...(command === "receive"
            ? { applicationId: values.application, accept: !!values.accept }
            : {}),
        },
  );
  if (command === "receive" && !!values.accept === !!values.reject)
    throw new Error("--acceptか--rejectを一つ指定してください");
  return submit(
    profile,
    `/api/worlds/${profile.worldId}/session`,
    body,
    true,
    id,
  );
}
try {
  console.log(JSON.stringify(await run()));
} catch (error) {
  console.log(
    JSON.stringify({
      state: "error",
      ...(requestId ? { requestId } : {}),
      code: (error as { code?: string }).code ?? "CLI_ERROR",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
}
