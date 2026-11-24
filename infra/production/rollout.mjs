import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { apiService, caddy } from "./config.mjs";
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
  const initialized = /^# (api|api-next)\n/.test(contents);
  const api = await probe(compose);
  if (!initialized) return { api: "api", initialized };
  if (slots.includes(api) && api === apiService(contents))
    return { api, initialized };
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
  return `/etc/caddy/site-${api}`;
}

export async function setApiRoute(deployment, compose, controller, route) {
  const previous = (
    await compose("exec", "-T", "caddy", "cat", "/etc/caddy/Caddyfile")
  ).toString();
  const contents = caddy(deployment.config, deployment.env, route);
  const previousApi = await probe(compose);
  const proxy = (await compose("ps", "-q", "caddy")).toString().trim();
  const file = join(deployment.root, "Caddyfile.next");
  let published = false;
  const publish = async (text, validate) => {
    await writeFile(file, text);
    await command([
      "cp",
      file,
      `${controller}:/configuration/public/Caddyfile.next`,
    ]);
    if (validate)
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
    await compose(
      "exec",
      "-T",
      "controller",
      "mv",
      "/configuration/public/Caddyfile.next",
      "/configuration/public/Caddyfile",
    );
    published = true;
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
  try {
    await publish(contents, true);
    await waitForRoute(route.api);
  } catch (error) {
    if (published) {
      await publish(previous, false);
      await waitForRoute(previousApi);
    }
    throw error;
  }
}
