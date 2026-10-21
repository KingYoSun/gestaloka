import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseEnv } from "node:util";
import { z } from "zod";
import { oryConfiguration } from "../ory/config.mjs";

export const Deployment = z
  .object({
    name: z
      .string()
      .regex(/^[a-z][a-z0-9-]{2,62}$/)
      .refine((n) => n !== "gestaloka-v3"),
    domain: z.string().regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/),
    mode: z.enum(["production", "testing"]),
    httpPort: z.number().int().min(1).max(65535),
    httpsPort: z.number().int().min(1).max(65535),
    accessCidrs: z.string().regex(/^[a-fA-F0-9.:/ ]+$/),
  })
  .strict();
export const keyNames = [
  "OPERATIONS_TOKEN_SECRET",
  "KRATOS_COOKIE_SECRET",
  "KRATOS_CIPHER_SECRET",
  "HYDRA_SYSTEM_SECRET",
  "HYDRA_PAIRWISE_SALT",
];

function caddy(config, env) {
  const tls = config.mode === "testing" ? "tls internal" : "";
  const protect = `@blocked not remote_ip ${config.accessCidrs}\n respond @blocked "公開準備中です" 503`;
  const frontend = (host, origin, root) => `http://${host}:80 {
  redir ${origin}{uri} 308
}
https://${host} {
  ${tls}
  ${protect}
  @auth path /auth/*
  redir @auth ${env.ORY_KRATOS_PUBLIC_URL}{uri} 303
  handle /api/* {
    reverse_proxy api:3000
  }
  handle {
    root * /srv/${root}
    try_files {path} /index.html
    file_server
  }
}`;
  return `{
  admin off
  auto_https disable_redirects
}
${frontend(`play.${config.domain}`, env.ORY_APP_URL, "user")}
${frontend(`admin.${config.domain}`, env.ORY_ADMIN_APP_URL, "admin")}
http://api.${config.domain}:80 {
  redir ${env.ORY_KRATOS_PUBLIC_URL}{uri} 308
}
https://api.${config.domain} {
  ${tls}
  ${protect}
  @kratos path /self-service/* /sessions/* /schemas/*
  handle @kratos {
    reverse_proxy kratos:4433
  }
  @hydra path /oauth2/* /.well-known/openid-configuration /.well-known/oauth-authorization-server /.well-known/jwks.json /userinfo
  handle @hydra {
    reverse_proxy hydra:4444
  }
  handle {
    reverse_proxy api:3000
  }
}
`;
}

export async function renderDeployment(directory) {
  const root = resolve(directory),
    config = Deployment.parse(
      JSON.parse(await readFile(join(root, "profile.json"), "utf8")),
    );
  const env = parseEnv(await readFile(join(root, "deployment.env"), "utf8"));
  for (const name of [
    ...keyNames,
    "CONTROL_TOKEN",
    "POSTGRES_PASSWORD",
    "NEO4J_PASSWORD",
    "ORY_DATABASE_PASSWORD",
  ])
    if (!/^[a-f0-9]{32,64}$/.test(env[name] ?? ""))
      throw new Error(`秘密設定が未設定です: ${name}`);
  const port = config.httpsPort === 443 ? "" : `:${config.httpsPort}`,
    api = `https://api.${config.domain}${port}`;
  Object.assign(env, {
    STACK_NAME: config.name,
    DEPLOYMENT_MODE: config.mode,
    BIND_ADDRESS: config.mode === "testing" ? "127.0.0.1" : "0.0.0.0",
    HTTP_PORT: String(config.httpPort),
    HTTPS_PORT: String(config.httpsPort),
    ISOLATED_NETWORK: String(config.mode === "testing"),
    CONFIG_ENV_FILE: join(root, "deployment.env").replaceAll("\\", "/"),
    ORY_APP_URL: `https://play.${config.domain}${port}`,
    ORY_ADMIN_APP_URL: `https://admin.${config.domain}${port}`,
    ORY_AUTH_URL: `${api}/auth`,
    ORY_KRATOS_PUBLIC_URL: api,
    ORY_HYDRA_PUBLIC_URL: api,
    ORY_COOKIE_DOMAIN: config.domain,
  });
  await writeFile(
    join(root, "deployment.env"),
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  for (const folder of [
    "configuration/ory",
    "configuration/public",
    "configuration/init",
  ])
    await mkdir(join(root, folder), { recursive: true, mode: 0o750 });
  const { kratos, hydra } = oryConfiguration(env);
  hydra.urls.identity_provider.publicUrl = api;
  for (const [name, value] of Object.entries({ kratos, hydra }))
    await writeFile(
      join(root, "configuration/ory", `${name}.json`),
      JSON.stringify(value, null, 2) + "\n",
      { mode: 0o640 },
    );
  for (const file of ["identity.schema.json", "social.jsonnet"])
    await copyFile(
      new URL(`../ory/${file}`, import.meta.url),
      join(root, "configuration/ory", file),
    );
  await copyFile(
    new URL("../ory/databases.sql", import.meta.url),
    join(root, "configuration/init/001-ory.sql"),
  );
  await writeFile(
    join(root, "configuration/public/Caddyfile"),
    caddy(config, env),
    { mode: 0o644 },
  );
  return { config, env, root };
}

export async function initializeDeployment(directory, input) {
  const config = Deployment.parse(input),
    root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(
    join(root, "profile.json"),
    JSON.stringify(config, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  const secrets = Object.fromEntries(
    [
      ...keyNames,
      "CONTROL_TOKEN",
      "POSTGRES_PASSWORD",
      "NEO4J_PASSWORD",
      "ORY_DATABASE_PASSWORD",
    ].map((k) => [
      k,
      randomBytes(k === "KRATOS_CIPHER_SECRET" ? 16 : 32).toString("hex"),
    ]),
  );
  const env = {
    ...secrets,
    ORY_GOOGLE_CLIENT_ID: "",
    ORY_GOOGLE_CLIENT_SECRET: "",
    ORY_X_API_KEY: "",
    ORY_X_API_SECRET: "",
  };
  await writeFile(
    join(root, "deployment.env"),
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return renderDeployment(root);
}
