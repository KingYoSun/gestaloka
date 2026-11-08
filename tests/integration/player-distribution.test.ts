import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { PlayerCliRelease } from "@gestaloka/contracts";
import { createApp } from "../../apps/api/src/app.js";

test("ログインなしで公開中のCLIと一致する最新版情報・配布物・AI向け案内を取得できる", async () => {
  const app = await createApp();
  const folder = await mkdtemp(join(tmpdir(), "gestaloka-release-"));
  try {
    const latest = await app.inject("/api/player-cli/latest");
    expect(latest.statusCode).toBe(200);
    expect(latest.headers["cache-control"]).toBe("no-store");
    const release = PlayerCliRelease.parse(latest.json());
    const download = await app.inject(release.downloadUrl);
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("application/gzip");
    const bytes = download.rawPayload;
    expect(bytes.length).toBe(release.sizeBytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      release.sha256,
    );
    const archive = join(folder, "cli.tgz");
    await writeFile(archive, bytes);
    await promisify(execFile)("tar", ["-xzf", archive, "-C", folder]);
    const pkg = JSON.parse(
      await readFile(join(folder, "package/package.json"), "utf8"),
    );
    expect(pkg.version).toBe(release.version);
    expect(pkg.engines.node).toBe(release.node);
    const help = await promisify(execFile)(
      process.execPath,
      [join(folder, "package/dist/main.js"), "help"],
      { cwd: folder },
    );
    expect(JSON.parse(help.stdout).help).toContain("gestaloka connect");
    const setup = await app.inject(release.setupUrl);
    expect(setup.statusCode).toBe(200);
    expect(setup.headers["content-type"]).toContain("text/markdown");
    expect(setup.body).toBe(
      await readFile(
        join(folder, "package/skills/gestaloka-player/references/setup.md"),
        "utf8",
      ),
    );
    const entry = await app.inject("/api/player-cli/join");
    expect(entry.statusCode).toBe(200);
    expect(entry.headers["referrer-policy"]).toBe("no-referrer");
    expect(entry.body).toBe(
      await readFile(
        join(folder, "package/skills/gestaloka-player/references/join.md"),
        "utf8",
      ),
    );
    const linked = await app.inject("/api/player-cli/setup.md");
    expect(linked.body).toBe(setup.body);
    for (const file of [
      "README.md",
      "skills/gestaloka-player/SKILL.md",
      "skills/gestaloka-player/references/setup.md",
      "skills/gestaloka-player/references/join.md",
      "skills/gestaloka-player/references/runtimes.md",
    ]) {
      const path = join(folder, "package", file);
      const markdown = await readFile(path, "utf8");
      for (const match of markdown.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
        if (!match[1]!.includes("://"))
          await readFile(resolve(dirname(path), match[1]!));
      }
    }
  } finally {
    await app.close();
    await rm(folder, { recursive: true, force: true });
  }
});
