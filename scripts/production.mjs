import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  activeApi,
  setApiRoute,
  stageWeb,
} from "../infra/production/rollout.mjs";
import {
  initializeDeployment,
  renderDeployment,
} from "../infra/production/config.mjs";
import { command, deploymentLock } from "../infra/production/engine.mjs";
import {
  deployWorker,
  WorkerDrainError,
} from "../apps/worker/dist/deployment.js";

const [action, directory, argument] = process.argv.slice(2);
if (!directory)
  throw new Error(
    "使い方: pnpm production <init|render|build|up|rollout|stop|status|backup-controller|controller|recover> <設定ディレクトリ> [JSONファイル]",
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
  const deployment = await renderDeployment(root);
  const { config, env } = deployment;
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
  const seed = async (includePublic) => {
    await compose("create", "--no-build", "controller");
    const id = await controller();
    for (const file of ["profile.json", "deployment.env"])
      await command(["cp", join(root, file), `${id}:/state/${file}`]);
    for (const folder of includePublic
      ? ["ory", "init", "public"]
      : ["ory", "init"])
      await command([
        "cp",
        `${join(root, "configuration", folder)}/.`,
        `${id}:/configuration/${folder}`,
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
  const update = (...services) =>
    compose(
      "--profile",
      "api-handoff",
      "up",
      "-d",
      "--no-build",
      "--no-deps",
      "--wait",
      "--wait-timeout",
      "120",
      ...services,
    );
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
      await seed(!(await activeApi(compose)));
      console.log("設定を反映しました。");
      break;
    case "build":
      await compose("build");
      console.log("公開用イメージを作成しました。");
      break;
    case "backup-controller":
      await compose("build", "controller");
      await seed(!(await activeApi(compose)));
      await compose(
        "up",
        "-d",
        "--no-build",
        "--no-deps",
        "--wait",
        "controller",
      );
      console.log("バックアップ制御サービスを更新しました。");
      break;
    case "up":
    case "rollout": {
      const lock =
        process.platform === "linux" &&
        process.env.GESTALOKA_DEPLOYMENT_LOCK_HELD !== "1"
          ? await deploymentLock(env.DEPLOYMENT_LOCK_FILE, 60)
          : null;
      if (lock === undefined) {
        console.error("バックアップまたは別の配備が進行中です");
        process.exitCode = 75;
        break;
      }
      try {
        const active = await activeApi(compose);
        if (action === "rollout" && !active)
          throw new Error("API更新には稼働中のCaddyが必要です");
        if (active && !active.initialized && argument !== "--initialize")
          throw new Error(
            "初回の切り替えには --initialize が必要です。Kratosを再起動します。",
          );
        const worker = (
          await compose("ps", "--status", "running", "-q", "worker")
        )
          .toString()
          .trim();
        await deployWorker(worker, async () => {
          await seed(!active);
          if (!active) {
            await compose(
              "up",
              "-d",
              "--no-build",
              "--wait",
              "api",
              "controller",
              "caddy",
            );
            await update("worker");
            return;
          }
          await update("controller");
          const next = active.api === "api" ? "api-next" : "api";
          await stageWeb(deployment, next);
          try {
            await update(next);
            if (!active.initialized) {
              await setApiRoute(deployment, compose, await controller(), {
                api: active.api,
                initializing: true,
              });
              await compose("restart", "kratos");
              await compose(
                "up",
                "-d",
                "--no-build",
                "--no-deps",
                "--no-recreate",
                "--wait",
                "kratos",
              );
            }
            await update("worker");
          } catch (error) {
            await compose("--profile", "api-handoff", "stop", next);
            throw error;
          }
          await setApiRoute(deployment, compose, await controller(), {
            api: next,
          });
          await compose("--profile", "api-handoff", "stop", active.api);
        });
        console.log("起動しました。");
      } catch (error) {
        if (!(error instanceof WorkerDrainError)) throw error;
        console.error(error.message);
        process.exitCode = 75;
      } finally {
        await lock?.close();
      }
      break;
    }
    case "stop":
      await compose("--profile", "api-handoff", "stop");
      console.log("停止しました。");
      break;
    case "status":
      console.log(
        (
          await compose("--profile", "api-handoff", "ps", "--format", "json")
        ).toString(),
      );
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
