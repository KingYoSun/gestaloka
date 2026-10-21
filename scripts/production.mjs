import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  initializeDeployment,
  renderDeployment,
} from "../infra/production/config.mjs";
import { command } from "../infra/production/engine.mjs";

const [action, directory, argument] = process.argv.slice(2);
if (!directory)
  throw new Error(
    "使い方: pnpm production <init|render|build|up|stop|status|controller|recover> <設定ディレクトリ> [JSONファイル]",
  );
const root = resolve(directory);
if (action === "init") {
  await initializeDeployment(
    root,
    JSON.parse(await readFile(argument, "utf8")),
  );
  console.log(
    "独立した設定と鍵を作成しました。ソーシャルログインの値をdeployment.envへ設定してください。",
  );
} else {
  const { config, env } = await renderDeployment(root);
  const compose = (...args) =>
    command(
      [
        "compose",
        "--project-name",
        config.name,
        "--env-file",
        join(root, "deployment.env"),
        "-f",
        resolve("infra/production/compose.yaml"),
        ...args,
      ],
      undefined,
      { ...process.env, ...env },
    );
  const controller = async () =>
    (await compose("ps", "-aq", "controller")).toString().trim();
  const seed = async () => {
    await compose("create", "--no-build", "controller");
    const id = await controller();
    for (const file of ["profile.json", "deployment.env"])
      await command(["cp", join(root, file), `${id}:/state/${file}`]);
    await command([
      "cp",
      `${join(root, "configuration")}/.`,
      `${id}:/configuration`,
    ]);
    await compose(
      "run",
      "--rm",
      "--no-deps",
      "--entrypoint",
      "sh",
      "controller",
      "-c",
      "chown -R 1000:1000 /configuration/ory && chmod -R go-rwx /configuration/ory && chmod 755 /configuration/init && chmod 644 /configuration/init/*",
    );
  };
  switch (action) {
    case "sync":
      await command([
        "cp",
        `${await controller()}:/state/deployment.env`,
        join(root, "deployment.env"),
      ]);
      await renderDeployment(root);
      console.log("復元後の鍵をローカル設定へ同期しました。");
      break;
    case "render":
      await seed();
      console.log("設定を反映しました。");
      break;
    case "build":
      await compose("build");
      console.log("公開用イメージを作成しました。");
      break;
    case "up":
      await seed();
      await compose("up", "-d", "--no-build", "--wait");
      console.log("起動しました。");
      break;
    case "stop":
      await compose("stop");
      console.log("停止しました。");
      break;
    case "status":
      console.log((await compose("ps", "--format", "json")).toString());
      break;
    case "controller": {
      const input = JSON.parse(await readFile(argument, "utf8"));
      const result = await compose(
        "exec",
        "-T",
        "controller",
        "node",
        "infra/production/local.mjs",
        JSON.stringify(input),
      );
      console.log(result.toString());
      break;
    }
    case "recover": {
      const id = argument;
      if (!/^[a-f0-9-]{36}$/.test(id ?? ""))
        throw new Error("復旧対象のジョブIDが必要です");
      console.log(
        (
          await compose(
            "exec",
            "-T",
            "controller",
            "node",
            "infra/production/local.mjs",
            JSON.stringify({ action: "recover", id }),
          )
        ).toString(),
      );
      break;
    }
    default:
      throw new Error("不明な操作です");
  }
}
