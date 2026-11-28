import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { npcWakeLease } from "./npc-cli-lease.mjs";

const dir = new URL("./", import.meta.url);
const exec = promisify(execFile);
const log = (name, type, info = {}) =>
  console.log(
    JSON.stringify({ at: new Date().toISOString(), name, type, ...info }),
  );

export async function forwardWakes({
  lastWake,
  lastNotice,
  listen,
  mint,
  post,
  save,
  retrySignal = () => AbortSignal.timeout(60_000),
}) {
  let pending;
  let noticeMayBeRunning = Boolean(lastNotice);
  for (;;) {
    // Keep accepting newer turns and notices while the bot waits for its lock.
    const retry = pending && !pending.retry.aborted ? pending.retry : undefined;
    const afterWake = pending ? retry && pending.key : lastWake;
    let frame;
    try {
      frame = await listen(afterWake, lastNotice, retry);
    } catch (error) {
      if (error.name === "AbortError" && retry?.aborted) continue;
      throw error;
    }
    if (pending && frame.wakeKey !== pending.key) {
      await save("key", pending.key);
      lastWake = pending.key;
      pending = undefined;
    }
    let wakeKey =
      frame.actionable &&
      /^[a-f0-9]{64}$/.test(frame.wakeKey ?? "") &&
      frame.wakeKey !== afterWake
        ? frame.wakeKey
        : undefined;
    const noticeKey =
      /^[0-9a-f-]{36}$/.test(frame.noticeKey ?? "") &&
      frame.noticeKey !== lastNotice
        ? frame.noticeKey
        : undefined;
    if (!wakeKey && !noticeKey) return frame.state;

    let grant = await mint(wakeKey, !!noticeKey);
    if (grant.used) {
      await save("key", wakeKey);
      lastWake = wakeKey;
      pending = undefined;
      noticeMayBeRunning = false;
      if (!noticeKey) continue;
      wakeKey = undefined;
      grant = await mint(undefined, true);
    }
    await post(frame.state, {
      event: "gestaloka.waiting",
      wakeKey,
      noticeKey,
      ...grant,
      ...(grant.lease &&
        !wakeKey && {
          instruction:
            "通知用の lease です。notices と必要な受領判断を済ませてロックを解放してください。手番の発言と終了は、wakeKey が届いた起床で、その手番用 lease を使ってください。",
        }),
    });
    if (wakeKey) {
      if (grant.lease && (noticeMayBeRunning || pending?.key === wakeKey)) {
        pending = { key: wakeKey, retry: retrySignal() };
      } else {
        await save("key", wakeKey);
        lastWake = wakeKey;
      }
      noticeMayBeRunning = false;
    }
    if (noticeKey) {
      await save("notice", noticeKey);
      lastNotice = noticeKey;
      if (!wakeKey && grant.lease) noticeMayBeRunning = true;
    }
  }
}

async function serve(cli, { name, profile, url }) {
  if (
    process.env.WAKE_SENDER_TEST !== "1" &&
    new URL(url).protocol !== "https:"
  )
    throw new Error(`${name}: https の送信先が必要です`);
  const state = (kind) => new URL(`state/${name}.${kind}`, dir);
  const readState = (kind) =>
    readFile(state(kind), "utf8")
      .then((s) => s.trim())
      .catch((error) => {
        if (error.code !== "ENOENT") throw error;
        return "";
      });
  for (;;) {
    try {
      const idle = await forwardWakes({
        lastWake: await readState("key"),
        lastNotice: await readState("notice"),
        async listen(afterWake, afterNotice, signal) {
          const { stdout } = await exec(
            process.execPath,
            [
              cli,
              "listen",
              "--resume",
              "--once",
              ...(afterWake ? ["--after-wake", afterWake] : []),
              ...(afterNotice ? ["--after-notice", afterNotice] : []),
              "--profile",
              profile,
            ],
            { maxBuffer: 8e6, signal },
          );
          return JSON.parse(stdout);
        },
        mint: (wakeKey, receive) =>
          npcWakeLease(dir, name, !!wakeKey, receive, wakeKey),
        async post(state, body) {
          const key = (
            await readFile(new URL(`keys/${name}`, dir), "utf8")
          ).trim();
          if (!key) throw new Error("Webhookキーが未設定です");
          const response = await fetch(url, {
            method: "POST",
            redirect: "error",
            headers: {
              authorization: `Bearer ${key}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15000),
          });
          await response.body?.cancel();
          if (!response.ok)
            throw new Error(`送信先が ${response.status} を返しました`);
          log(name, "delivered", {
            state,
            ...(body.wakeKey && { key: body.wakeKey.slice(0, 10) }),
            ...(body.noticeKey && { notice: body.noticeKey.slice(0, 8) }),
            status: response.status,
          });
        },
        save: (kind, value) => writeFile(state(kind), value, { mode: 0o600 }),
      });
      log(name, "idle", { state: idle });
    } catch (error) {
      log(name, "retry", {
        reason: String(error.message ?? error)
          .split("\n")[0]
          .replace(/https?:\S+/g, "[url]")
          .slice(0, 200),
      });
    }
    await sleep(30000);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const config = JSON.parse(
    await readFile(new URL("config.json", dir), "utf8"),
  );
  await mkdir(new URL("state/", dir), { recursive: true });
  log("sender", "start", { targets: config.targets.map((t) => t.name) });
  await Promise.all(config.targets.map((target) => serve(config.cli, target)));
}
