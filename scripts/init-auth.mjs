import { oryConfiguration } from "../infra/ory/config.mjs";
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";

const root = new URL("../", import.meta.url);
const envFile = new URL(".env.ory", root);
try {
  await writeFile(
    envFile,
    [
      `ORY_DATABASE_PASSWORD=${randomBytes(24).toString("hex")}`,
      `KRATOS_COOKIE_SECRET=${randomBytes(32).toString("hex")}`,
      `KRATOS_CIPHER_SECRET=${randomBytes(16).toString("hex")}`,
      `HYDRA_SYSTEM_SECRET=${randomBytes(32).toString("hex")}`,
      `HYDRA_PAIRWISE_SALT=${randomBytes(32).toString("hex")}`,
      "ORY_GOOGLE_CLIENT_ID=",
      "ORY_GOOGLE_CLIENT_SECRET=",
      "ORY_X_API_KEY=",
      "ORY_X_API_SECRET=",
      "ORY_APP_URL=http://127.0.0.1:5173",
      "ORY_ADMIN_APP_URL=http://127.0.0.1:5174",
      "ORY_AUTH_URL=http://127.0.0.1:3000/auth",
      "ORY_KRATOS_PUBLIC_URL=http://127.0.0.1:24433",
      "ORY_HYDRA_PUBLIC_URL=http://127.0.0.1:24444",
      "ORY_HYDRA_ADMIN_URL=http://127.0.0.1:24445",
      "",
    ].join("\n"),
    { flag: "wx", mode: 0o600 },
  );
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}
const env = parseEnv(await readFile(envFile, "utf8"));
const missingSettings = Object.entries({
  ORY_CONFIG_UID: process.getuid?.() ?? 1000,
  ORY_CONFIG_GID: process.getgid?.() ?? 1000,
  OPERATIONS_TOKEN_SECRET: randomBytes(32).toString("hex"),
}).filter(([name]) => !env[name]);
if (missingSettings.length)
  await appendFile(
    envFile,
    `\n${missingSettings.map(([name, value]) => `${name}=${value}`).join("\n")}\n`,
  );
const { kratos, hydra, configured } = oryConfiguration(env);
await mkdir(new URL(".ory/", root), { recursive: true, mode: 0o700 });
for (const [name, config] of Object.entries({ kratos, hydra }))
  await writeFile(
    new URL(`.ory/${name}.json`, root),
    `${JSON.stringify(config, null, 2)}\n`,
    { mode: 0o600 },
  );
console.log(
  `Ory設定を生成しました。外部ログイン設定済み: ${configured.map((p) => p.id).join(", ") || "なし"}。`,
);
