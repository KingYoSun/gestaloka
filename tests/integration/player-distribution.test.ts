import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
    expect(release.setupUrl).toContain(`/docs/${release.version}/setup.md`);
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
    const indexUrl = "/api/player-cli/";
    const index = await app.inject(indexUrl);
    expect(index.statusCode).toBe(200);
    expect(index.headers["content-type"]).toContain("text/html");
    const linkedGuides = Array.from(
      index.body.matchAll(/href="([^"]+)"/g),
      ([, file]) => file,
    );
    const packagedGuides = await readdir(
      join(folder, "package/skills/gestaloka-player/references"),
    );
    expect(linkedGuides.sort()).toEqual([...packagedGuides, "SKILL.md"].sort());
    for (const file of linkedGuides) {
      const guide = await app.inject(indexUrl + file);
      expect(guide.statusCode, file).toBe(200);
      expect(guide.headers["content-type"], file).toContain("text/markdown");
    }
    const help = await promisify(execFile)(
      process.execPath,
      [join(folder, "package/dist/main.js"), "help"],
      { cwd: folder },
    );
    expect(JSON.parse(help.stdout).help).toContain("gestaloka connect");
    const individual = async (...args: string[]) =>
      JSON.parse(
        (
          await promisify(execFile)(
            process.execPath,
            [join(folder, "package/dist/main.js"), ...args],
            { cwd: folder },
          )
        ).stdout,
      ).help;
    const listen = await individual("help", "listen");
    expect(listen).toContain("--after-wake");
    expect(await individual("listen", "--help")).toBe(listen);
    expect(await individual("help", "receive")).toContain(
      "--accept | --reject",
    );
    expect(await individual("help", "status")).toContain("--view <wait|joins>");
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
    const skill = await app.inject("/api/player-cli/SKILL.md");
    expect(skill.statusCode).toBe(200);
    expect(skill.body).toBe(
      await readFile(
        join(folder, "package/skills/gestaloka-player/SKILL.md"),
        "utf8",
      ),
    );
    for (const match of skill.body.matchAll(/\]\((references\/[^)]+)\)/g)) {
      const reference = await app.inject("/api/player-cli/" + match[1]);
      expect(reference.statusCode).toBe(200);
      expect(reference.body).toBe(
        await readFile(
          join(folder, "package/skills/gestaloka-player", match[1]!),
          "utf8",
        ),
      );
    }
    const linked = await app.inject("/api/player-cli/setup.md");
    expect(linked.body).toBe(setup.body);
    for (const [file, heading] of [
      ["draw.md", "銅貨を受け取る福引を作る"],
      ["blueprints.md", "テンプレート・設計図・クエスト"],
      ["inventory.md", "持ち物・保管・取引"],
      ["sessions.md", "セッション・手番・受領とチーム"],
      ["npcs.md", "NPCの出現・昇格・同行"],
      ["vehicles.md", "乗り物の設定・乗降・操縦"],
      ["health.md", "死亡・怪我・治療"],
    ] as const) {
      const guide = await app.inject(
        `/api/player-cli/docs/${release.version}/${file}`,
      );
      expect(guide.statusCode).toBe(200);
      expect(guide.body).toContain(heading);
      expect(guide.body).toBe(
        await readFile(
          join(folder, "package/skills/gestaloka-player/references", file),
          "utf8",
        ),
      );
      for (const link of guide.body.matchAll(
        /\]\(([^)#]+\.md)(?:#[^)]*)?\)/g,
      )) {
        const target = await app.inject(
          `/api/player-cli/docs/${release.version}/${link[1]}`,
        );
        expect(target.statusCode, link[1]).toBe(200);
      }
    }
    const old = await app.inject(
      "/api/player-cli/docs/0.0.1/join.md?world=00000000-0000-4000-8000-000000000001",
    );
    expect(old.statusCode).toBe(302);
    expect(old.headers.location).toBe(
      `/api/player-cli/docs/${release.version}/join.md?world=00000000-0000-4000-8000-000000000001`,
    );
    for (const file of [
      "README.md",
      "skills/gestaloka-player/SKILL.md",
      "skills/gestaloka-player/references/setup.md",
      "skills/gestaloka-player/references/join.md",
      "skills/gestaloka-player/references/runtimes.md",
      "skills/gestaloka-player/references/dice.md",
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
