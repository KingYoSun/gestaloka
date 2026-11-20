#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { cliVersion, update } from "./update.js";
import { fileURLToPath } from "node:url";
import { PlayerReferences } from "./references.js";
import {
  PlayerDeviceCode,
  PlayCommand,
  PlayerDeviceStatus,
  SceneRecordPage,
  JoinWorld,
  PlayerIconInput,
  WorldPlayerPage,
  PlayerReportInput,
  PlayerNotices,
  ViewersInput,
  WaitingContextStatus,
  WaitingEvent,
  WaitingStatus,
  playActionMessage,
} from "@gestaloka/contracts";

import { playerHelp, playerOptions } from "./help.js";

const Profile = z.object({
  server: z.url(),
  worldId: z.uuid(),
  deviceId: z.uuid(),
  secret: z.string(),
  lastRequestId: z.uuid().optional(),
  joinIconRequestId: z.uuid().optional(),
  waitingEnded: z.boolean().optional(),
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
    options: playerOptions,
  });
let values: ReturnType<typeof parse>["values"];
let profilePath: string, journal: string;
let requestId: string | undefined;
let references: PlayerReferences | undefined, pendingCursor: string | undefined;
const render = (value: unknown) =>
  JSON.stringify(
    !references || values["full-ids"] ? value : references.convert(value),
  );
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
  // Every write reaching this helper is journaled or an idempotent presence update.
  const attempt = async () => {
    const response = await fetch(new URL(path, profile.server), {
      method: body === undefined ? "GET" : method,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        "x-gestaloka-cli-version": cliVersion,
        ...(authenticated ? { authorization: `Bearer ${profile.secret}` } : {}),
        ...(body === undefined
          ? {}
          : { "content-type": "application/json", "x-gestaloka-request": "1" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(
        new Error(data.message ?? `HTTP ${response.status}`),
        {
          code: data.code ?? "HTTP_ERROR",
          callsUsed: data.callsUsed,
        },
      );
    return data;
  };
  try {
    return await attempt();
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "TimeoutError")
      throw error;
    return attempt();
  }
}
async function status(
  profile: Profile,
  after?: string,
  view?: "wait" | "joins",
) {
  const device = PlayerDeviceStatus.parse(
    await http(profile, "/api/player-device"),
  );
  if (device.state !== "ready") return { state: device.state, device };
  const query = new URLSearchParams();
  if (values.scene) query.set("sceneId", z.uuid().parse(values.scene));
  if (after !== undefined) query.set("after", after);
  if (view) query.set("view", view);
  return {
    state: "ready",
    ...(view ? {} : { device }),
    ...(await http(profile, `/api/worlds/${profile.worldId}/session?${query}`)),
  };
}
const WaitingControl = z.object({ enabled: z.boolean() });
async function waitingControl(profile: Profile) {
  try {
    return WaitingControl.parse(
      JSON.parse(await readFile(join(journal, "waiting.json"), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { enabled: !profile.waitingEnded };
    throw error;
  }
}
async function standby(
  profile: Profile,
  resume = false,
  includeContext = false,
) {
  if (resume) await save(join(journal, "waiting.json"), { enabled: true });
  const control = await waitingControl(profile),
    path = `/api/worlds/${profile.worldId}/waiting${includeContext ? "?context=1" : ""}`;
  const frame = WaitingContextStatus.parse(
    await http(profile, path, { active: control.enabled }),
  );
  if (control.enabled && !(await waitingControl(profile)).enabled)
    return WaitingStatus.parse(await http(profile, path, { active: false }));
  return frame;
}
function waitingNotice(
  frame: z.infer<typeof WaitingEvent>,
  lastWake: string | null = null,
) {
  const name = frame.context?.name ?? frame.progress?.name;
  const actionMessage = playActionMessage(
    frame.actionable,
    frame.state === "receiving",
    name,
  );
  return {
    ...frame,
    actionMessage,
    ...(frame.noticeKey
      ? { noticeMessage: "未読の通知があります。notices で読めます" }
      : {}),
    ...(frame.progress?.receiptResults?.length ||
    (frame.progress?.updates.length &&
      (!frame.actionable ||
        frame.wakeKey === lastWake ||
        frame.progress.updates.every(
          ({ transition }) =>
            transition.type === "session-joined" ||
            transition.type === "session-left",
        )))
      ? { notificationMessage: "この通知への操作は不要です" }
      : {}),
  };
}
async function listen(profile: Profile) {
  const registered = await standby(profile, !!values.resume);
  if (!registered.active) return waitingNotice(registered);
  let last = "",
    lastWake: string | null = values["after-wake"] ?? null,
    retry = 1000,
    after = references!.cursor();
  for (;;) {
    if (!(await waitingControl(profile)).enabled)
      return waitingNotice(await standby(profile));
    try {
      const url = new URL(
        `/api/worlds/${profile.worldId}/waiting/events`,
        profile.server,
      );
      url.searchParams.set("context", "1");
      if (!values.once) url.searchParams.set("after", after);
      const response = await fetch(url, {
        redirect: "error",
        headers: {
          authorization: `Bearer ${profile.secret}`,
          accept: "text/event-stream",
          "x-gestaloka-cli-version": cliVersion,
        },
        signal: AbortSignal.timeout(300000),
      });
      if (!response.ok) {
        if (response.status === 426) {
          const error = await response.json();
          throw Object.assign(new Error(error.message), { code: error.code });
        }
        if (response.status < 500)
          throw Object.assign(
            new Error(`待受に接続できません（HTTP ${response.status}）`),
            { code: "WAITING_STREAM_DENIED" },
          );
        await response.body?.cancel();
      } else {
        if (
          !response.body ||
          !response.headers.get("content-type")?.startsWith("text/event-stream")
        )
          throw new Error("手番の通知ストリームを確認できません");
        let buffer = "",
          event = "",
          data = "";
        for await (const chunk of response.body.pipeThrough(
          new TextDecoderStream(),
        )) {
          buffer += chunk;
          let end: number;
          while ((end = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, end).replace(/\r$/, "");
            buffer = buffer.slice(end + 1);
            if (line.startsWith("event:")) event = line.slice(6).trimStart();
            else if (line.startsWith("data:"))
              data += line.slice(5).trimStart() + "\n";
            else if (line === "") {
              if (event === "waiting" && data) {
                const frame = WaitingEvent.parse(JSON.parse(data));
                if (frame.viewerId !== registered.viewerId)
                  throw new Error("待受の人物が一致しません");
                if (!frame.active || frame.state === "inactive")
                  return waitingNotice(frame, lastWake);
                const progress = frame.progress;
                const key = JSON.stringify([
                  frame.state,
                  frame.wakeKey,
                  frame.noticeKey,
                  ...(progress
                    ? [
                        frame.sessionId,
                        frame.turn,
                        progress.actorId,
                        progress.waitingForReturn?.deadline,
                        progress.cursor,
                      ]
                    : []),
                ]);
                if (
                  values.once &&
                  ((frame.actionable &&
                    frame.wakeKey !== values["after-wake"]) ||
                    (frame.noticeKey &&
                      frame.noticeKey !== values["after-notice"]))
                )
                  return waitingNotice(frame, lastWake);
                if (!values.once && key !== last) {
                  console.log(render(waitingNotice(frame, lastWake)));
                  last = key;
                  if (frame.actionable) lastWake = frame.wakeKey;
                  if (progress) after = progress.cursor;
                }
                retry = 1000;
              }
              event = "";
              data = "";
            }
          }
        }
      }
    } catch (error) {
      if (
        !(error instanceof TypeError) &&
        !(
          error instanceof DOMException &&
          ["TimeoutError", "AbortError"].includes(error.name)
        )
      )
        throw error;
    }
    await delay(retry);
    retry = Math.min(30000, retry * 2);
  }
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
    ...(saved.path.endsWith("/session")
      ? {}
      : await status(profile).catch((error) => {
          if (saved.path.endsWith("/reports")) return { state: "report" };
          throw error;
        })),
    ...(saved.body.command === "finish"
      ? { state: "finished", sceneId: result.sceneId }
      : {}),
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
  if (command === "help") {
    if (positionals.length > 2)
      throw new Error("helpにはコマンドを1つ指定してください");
    return { help: playerHelp(positionals[1]) };
  }
  if (values.help) return { help: playerHelp(command) };
  if (values.profile && values.instance)
    throw new Error("--instanceと--profileはどちらか一方を指定してください");
  const instance =
    values.instance ??
    (values.profile ? undefined : process.env.GESTALOKA_INSTANCE);
  profilePath =
    values.profile ??
    join(
      process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
      "gestaloka",
      ...(instance === undefined
        ? ["default.json"]
        : [
            "instances",
            createHash("sha256")
              .update(z.string().min(1).parse(instance))
              .digest("hex"),
            "profile.json",
          ]),
    );
  journal = `${profilePath}.requests`;
  if (positionals.length > (command === "team" ? 2 : 1))
    throw new Error("コマンドは1つ指定してください（helpを参照）");
  if (command === "version")
    return {
      version: cliVersion,
      skillPath: fileURLToPath(
        new URL("../skills/gestaloka-player/SKILL.md", import.meta.url),
      ),
    };
  if (command === "update") {
    const server =
      values.server ??
      (
        await load().catch((e) => {
          if (e.code === "ENOENT")
            throw new Error(
              "接続設定がないため --server <接続先> を指定してください",
            );
          throw e;
        })
      ).server;
    return update(server);
  }
  await mkdir(journal, { recursive: true, mode: 0o700 });
  references = new PlayerReferences(join(journal, "references.sqlite"));
  for (const key of [
    "world",
    "target",
    "team",
    "owner",
    "scene",
    "application",
    "offer",
    "payment",
    "request",
    "source",
    "before",
    "from",
  ] as const)
    if (values[key]) values[key] = references.expand(values[key]!);
  for (const key of ["participants", "to"] as const)
    if (values[key])
      values[key] = values[key]!.split(",")
        .map((id) => references!.expand(id.trim()))
        .join(",");
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
  if (command === "result") return status(profile);
  if (command === "status") {
    const view = z.enum(["wait", "joins"]).optional().parse(values.view);
    if (view && values.scene)
      throw new Error("--viewは現在のセッションを表示します");
    const result = await status(
      profile,
      view === "wait"
        ? undefined
        : (values.after ?? (values.scene ? "0" : references.cursor())),
      view,
    );
    if (
      !view &&
      !values.scene &&
      values.after === undefined &&
      typeof result.nextCursor === "string"
    )
      pendingCursor = result.nextCursor;
    return result;
  }
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
  if (command === "standby")
    return waitingNotice(
      await standby(profile, !!values.resume, !!values.resume),
    );
  if (command === "listen") return listen(profile);
  if (command === "disconnect") {
    await save(join(journal, "waiting.json"), { enabled: false });
    return WaitingStatus.parse(
      await http(profile, `/api/worlds/${profile.worldId}/waiting`, {
        active: false,
      }),
    );
  }
  if (command === "report") {
    const path = `/api/worlds/${profile.worldId}/reports`;
    if (values.text === undefined)
      return { state: "report", ...(await http(profile, path)) };
    const id = randomUUID();
    return submit(
      profile,
      path,
      PlayerReportInput.parse({ requestId: id, text: values.text }),
      true,
      id,
    );
  }
  if (command === "viewers") {
    if (!values.target || !values.to)
      throw new Error("--targetと--toを指定してください");
    const id = randomUUID();
    return submit(
      profile,
      `/api/worlds/${profile.worldId}/viewers`,
      ViewersInput.parse({
        requestId: id,
        targetId: values.target,
        viewers:
          values.to === "all"
            ? "all"
            : values.to === "self"
              ? []
              : values.to.split(","),
      }),
      true,
      id,
    );
  }
  if (command === "notices")
    return {
      state: "notices",
      ...PlayerNotices.parse(
        await http(profile, `/api/worlds/${profile.worldId}/notices`),
      ),
    };
  if (command === "players")
    return {
      state: "players",
      ...(await http(
        profile,
        `/api/worlds/${profile.worldId}/partners${values.before ? `?before=${z.uuid().parse(values.before)}` : ""}`,
      )),
    };
  if (command === "promotions") {
    return {
      state: "promotions",
      ...(await http(
        profile,
        `/api/worlds/${profile.worldId}/npc-promotions${values.before ? `?before=${z.uuid().parse(values.before)}` : ""}`,
      )),
    };
  }
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
  if (command === "join" || command === "resume") {
    const device = PlayerDeviceStatus.parse(
      await http(profile, "/api/player-device"),
    );
    if (command === "resume") {
      if (!device.actorId && device.joinId)
        return submit(profile, "/api/operations", {
          command: { operation: "worlds.resumeJoin", joinId: device.joinId },
        });
      throw new Error("再開する参加要求がありません");
    }
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
  const id = randomUUID();
  const teamAction = positionals[1];
  if (
    command === "team" &&
    !["invite", "join", "status", "leave"].includes(teamAction ?? "")
  )
    throw new Error(playerHelp("team"));
  const body = PlayCommand.parse(
    command === "play"
      ? {
          ...(references.convert(
            JSON.parse(await readFile(z.string().parse(values.file), "utf8")),
            true,
          ) as object),
          requestId: id,
        }
      : {
          requestId: id,
          command: command === "team" ? `team-${teamAction}` : command,
          ...(command === "team" && teamAction === "join"
            ? { teamId: values.team }
            : {}),
          ...(command === "search"
            ? {
                query: {
                  kind: values.kind,
                  ...(values.target ? { targetId: values.target } : {}),
                },
              }
            : {}),
          ...(command === "contact" ||
          (command === "team" && teamAction === "invite")
            ? { targetId: values.target }
            : {}),
          ...(["say", "comment", "memo", "explore"].includes(command)
            ? {
                text: values.file
                  ? await readFile(values.file, "utf8")
                  : values.text,
              }
            : {}),
          ...(command === "memo"
            ? {
                participants:
                  values.participants?.split(",").map((v) => v.trim()) ?? [],
                dependencies: [],
                ...(values["deferred-until"]
                  ? { deferredUntil: values["deferred-until"] }
                  : {}),
              }
            : {}),
          ...(command === "explore"
            ? { label: values.label, fromId: values.from, dependencies: [] }
            : {}),
          ...(command === "promote-npc"
            ? {
                sourceRequestId: values.source,
                npcIndex: Number(values.index),
                description: values.text,
                ...(values.owner ? { ownerId: values.owner } : {}),
              }
            : {}),
          ...(command === "receive"
            ? { applicationId: values.application, accept: !!values.accept }
            : {}),
          ...(command === "withdraw"
            ? { applicationId: values.application }
            : {}),
          ...(command === "exchange"
            ? { offerId: values.offer, paymentItemId: values.payment }
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
  const output = render(await run()) + "\n";
  await new Promise<void>((resolve, reject) =>
    process.stdout.write(output, (e) => (e ? reject(e) : resolve())),
  );
  if (pendingCursor !== undefined) references?.advance(pendingCursor);
} catch (error) {
  console.log(
    render({
      state: "error",
      ...(requestId ? { requestId } : {}),
      code: (error as { code?: string }).code ?? "CLI_ERROR",
      message: error instanceof Error ? error.message : String(error),
      callsUsed: (error as { callsUsed?: number }).callsUsed,
    }),
  );
  process.exitCode = 1;
}
