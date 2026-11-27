import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { configuredApi, routeFile, caddy } from "./config.mjs";
import { command } from "./engine.mjs";

const slots = ["api", "api-next"];
const probe = async (compose) =>
  (
    await compose(
      "exec",
      "-T",
      "caddy",
      "wget",
      "-qO-",
      "-T",
      "1",
      "http://127.0.0.1:3000/",
    ).catch(() => Buffer.alloc(0))
  )
    .toString()
    .trim();

export async function activeApi(compose) {
  const proxy = (await compose("ps", "--status", "running", "-q", "caddy"))
    .toString()
    .trim();
  if (!proxy) return null;
  const contents = (
    await compose("exec", "-T", "caddy", "cat", "/etc/caddy/Caddyfile")
  ).toString();
  const initialized = /^# (api|api-next|active-api(?:-alt)?)\n/.test(contents);
  const token = await probe(compose);
  const api = token === "initial" ? "api" : token;
  if (!initialized) return { api: "api", initialized };
  const configured = await configuredApi(contents, (file) =>
    compose("exec", "-T", "caddy", "cat", `/etc/caddy/${file}`),
  );
  if (slots.includes(api) && api === configured) return { api, initialized };
  throw new Error("稼働中のCaddyのAPI転送先を確認できません");
}

export async function stageWeb(deployment, api) {
  const stack = deployment.config.name;
  const site = `/configuration/public/site-${api}`;
  await command([
    "run",
    "--rm",
    "--network",
    "none",
    "--mount",
    `type=volume,source=${stack}_configuration,target=/configuration`,
    "--entrypoint",
    "sh",
    `${stack}-web`,
    "-ec",
    'rm -rf -- "$1"; mkdir "$1"; cp -R /srv/. "$1/"',
    "sh",
    site,
  ]);
}

export async function setApiRoute(deployment, compose, controller, route) {
  const previous = (
    await compose("exec", "-T", "caddy", "cat", "/etc/caddy/Caddyfile")
  ).toString();
  const current = routeFile(previous);
  const configFor = (file) =>
    caddy(deployment.config, deployment.env, {
      file,
      initializing: route.initializing,
    });
  const reload = !current || previous !== configFor(current);
  // 設定自体の更新時は旧設定の参照先を保ち、再読み込みの失敗時に戻せるようにする。
  const selector = reload
    ? current === "active-api"
      ? "active-api-alt"
      : "active-api"
    : current;
  const previousApi = await probe(compose);
  const target = route.initializing ? "initial" : route.api;
  if (current && ![...slots, "initial"].includes(previousApi))
    throw new Error("切り替え前のAPI転送先を確認できません");
  const publish = async (name, text) => {
    const file = join(deployment.root, name + ".next");
    await writeFile(file, text);
    const dest = "/configuration/public/" + name;
    await command(["cp", file, `${controller}:${dest}.next`]);
    if (name === "Caddyfile")
      await compose(
        "exec",
        "-T",
        "caddy",
        "caddy",
        "validate",
        "--adapter",
        "caddyfile",
        "--config",
        "/etc/caddy/Caddyfile.next",
      );
    await compose("exec", "-T", "controller", "mv", dest + ".next", dest);
  };
  const signal = async () => {
    const proxy = (await compose("ps", "-q", "caddy")).toString().trim();
    await command(["kill", "--signal=USR1", proxy]);
  };
  const waitForRoute = async (api) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((await probe(compose)) === api) return;
      await delay(250);
    }
    throw new Error(
      `CaddyのAPI転送先を確認できません。${api || "初期設定"}への再読み込みが未確認です`,
    );
  };
  await publish(selector, target);
  if (reload) await publish("Caddyfile", configFor(selector));
  try {
    if (reload) await signal();
    await waitForRoute(target);
  } catch (error) {
    if (reload) {
      await publish("Caddyfile", previous);
      await signal();
    } else {
      await publish(selector, previousApi);
    }
    await waitForRoute(previousApi);
    throw error;
  }
}
