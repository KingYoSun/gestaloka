import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

export function workerSocket(pid: number) {
  return process.platform === "win32"
    ? `\\\\.\\pipe\\gestaloka-worker-${pid}`
    : `/tmp/gestaloka-worker-${pid}.sock`;
}

export class WorkerDrainError extends Error {}

export async function withDrainedWorker<T>(
  hold: ChildProcessWithoutNullStreams,
  replace: () => Promise<T>,
  timeoutMs = 240_000,
) {
  const output = createInterface({ input: hold.stdout });
  hold.stderr.resume();
  hold.stdin.on("error", () => {});
  let timer: NodeJS.Timeout | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const failed = () =>
        reject(new WorkerDrainError("旧ワーカーの停止準備を確認できません"));
      hold.once("error", failed);
      hold.once("close", failed);
      output.once("line", (line) => (line === "ready" ? resolve() : failed()));
      timer = setTimeout(
        () =>
          reject(new WorkerDrainError("NPC手番の保存待ちが上限に達しました")),
        timeoutMs,
      );
    });
    clearTimeout(timer);
    return await replace();
  } finally {
    clearTimeout(timer);
    hold.stdin.end();
    output.close();
  }
}

export async function deployWorker<T>(
  container: string,
  replace: () => Promise<T>,
  timeoutMs?: number,
) {
  if (!container) return replace();
  return withDrainedWorker(
    spawn("docker", [
      "exec",
      "-i",
      container,
      "node",
      "apps/worker/dist/deployment.js",
      "hold",
    ]),
    replace,
    timeoutMs,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [, , action, target, ...args] = process.argv;
  if (action === "hold") {
    const socket = createConnection(target ?? workerSocket(1));
    socket.on("error", () => {
      process.exitCode = 1;
    });
    socket.on("close", () => process.stdin.destroy());
    process.stdin.pipe(socket).pipe(process.stdout);
  } else if (action === "compose" && target !== undefined) {
    try {
      await deployWorker(
        target,
        () =>
          new Promise<void>((resolve, reject) => {
            const compose = spawn("docker", ["compose", ...args], {
              stdio: "inherit",
            });
            compose.once("error", reject);
            compose.once("exit", (code) =>
              code === 0
                ? resolve()
                : reject(new Error("Composeによる交換が失敗しました")),
            );
          }),
      );
    } catch (error) {
      if (!(error instanceof WorkerDrainError)) throw error;
      console.error(error.message);
      process.exitCode = 75;
    }
  } else throw new Error("hold または compose を指定してください");
}
