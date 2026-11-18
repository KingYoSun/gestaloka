import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { gt, lte, satisfies, sort, valid } from "semver";
import { x as extract } from "tar";
import { z } from "zod";
import { PlayerCliRelease } from "@gestaloka/contracts";
import { readFileSync } from "node:fs";
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

export const cliVersion: string = pkg.version;
const notesSchema = z.record(
  z.string().refine((v) => valid(v) === v),
  z.array(z.string().trim().min(1)),
);
const skill = (folder: string) =>
  join(folder, "skills", "gestaloka-player", "SKILL.md");
async function publicFile(url: URL) {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error(`CLI配布物の取得に失敗しました（HTTP ${response.status}）`);
  return response;
}
export async function update(server: string) {
  const origin = new URL(server);
  if (
    origin.username ||
    origin.password ||
    !(
      origin.protocol === "https:" ||
      (origin.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
    )
  )
    throw new Error("接続先にはHTTPSまたはローカルのURLを指定してください");
  const release = PlayerCliRelease.parse(
    await (await publicFile(new URL("/api/player-cli/latest", origin))).json(),
  );
  if (valid(release.version) !== release.version)
    throw new Error("配布CLIの版番号が不正です");
  if (!gt(release.version, cliVersion))
    return {
      state: "up_to_date",
      version: cliVersion,
      latest: release.version,
      changes: [],
    };
  if (!satisfies(process.versions.node, release.node))
    throw new Error(
      `CLI ${release.version} はNode.js ${release.node} が必要です。Node.jsを更新してから再実行してください`,
    );
  const url = new URL(release.downloadUrl, origin);
  if (
    url.origin !== origin.origin ||
    url.username ||
    url.password ||
    !url.pathname.startsWith("/api/player-cli/download/")
  )
    throw new Error("配布URLが接続先と一致しません");
  const entry = await realpath(process.argv[1]!),
    root = dirname(dirname(entry)),
    folder = join(root, ".gestaloka-releases"),
    target = join(folder, release.version);
  await mkdir(folder, { recursive: true });
  const stage = await mkdtemp(join(folder, ".stage-"));
  try {
    const bytes = Buffer.from(await (await publicFile(url)).arrayBuffer());
    if (
      bytes.length !== release.sizeBytes ||
      createHash("sha256").update(bytes).digest("hex") !== release.sha256
    )
      throw new Error("配布物のサイズまたはSHA-256が一致しません");
    const archive = join(stage, "release.tgz");
    await writeFile(archive, bytes);
    let invalid = false;
    await extract({
      file: archive,
      cwd: stage,
      strict: true,
      filter: (path, entry) => {
        const parts = path.replace(/\/$/, "").split("/");
        const safe =
          parts[0] === "package" &&
          parts.every(
            (v) => v !== "." && v !== ".." && /^[a-zA-Z0-9._-]+$/.test(v),
          ) &&
          "type" in entry &&
          ["File", "Directory"].includes(entry.type);
        if (!safe) invalid = true;
        return safe;
      },
    });
    if (invalid) throw new Error("配布物に不正なファイルが含まれています");
    const unpacked = join(stage, "package"),
      manifest = JSON.parse(
        await readFile(join(unpacked, "package.json"), "utf8"),
      );
    if (
      manifest.name !== pkg.name ||
      manifest.version !== release.version ||
      manifest.engines?.node !== release.node
    )
      throw new Error("展開したCLIと配布情報が一致しません");
    await access(skill(unpacked));
    const notes = notesSchema.parse(
      JSON.parse(
        await readFile(join(unpacked, "gameplay-changes.json"), "utf8"),
      ),
    );
    if (!notes[release.version])
      throw new Error("最新版のプレイ変更履歴がありません");
    const changes = sort(Object.keys(notes))
      .filter(
        (v) => gt(v, cliVersion) && lte(v, release.version) && notes[v]!.length,
      )
      .map((version) => ({ version, items: notes[version]! }));
    const probe = await promisify(execFile)(
      process.execPath,
      [join(unpacked, "dist", "main.js"), "version"],
      { timeout: 15000 },
    );
    if (JSON.parse(probe.stdout).version !== release.version)
      throw new Error("新版CLIの起動を確認できません");
    await unlink(archive);
    await writeFile(join(stage, "sha256"), release.sha256);
    try {
      await rename(stage, target);
    } catch (e) {
      // A different View may have installed the exact same archive meanwhile.
      if (
        (await readFile(join(target, "sha256"), "utf8").catch(() => "")) !==
        release.sha256
      )
        throw e;
    }
    return {
      state: "updated",
      fromVersion: cliVersion,
      version: release.version,
      cliPath: entry,
      skillPath: skill(join(target, "package")),
      changes,
    };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
