import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { gt, rcompare, valid } from "semver";
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

// A release becomes visible here only after its verified directory is renamed.
// Selecting the newest also prevents concurrent updates from rolling a shared VM back.
const dist = dirname(fileURLToPath(import.meta.url)),
  releases = join(dist, "..", ".gestaloka-releases");
let newer: string | undefined;
try {
  newer = readdirSync(releases, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() && valid(e.name) === e.name && gt(e.name, pkg.version),
    )
    .map((e) => e.name)
    .sort(rcompare)[0];
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
await import(
  pathToFileURL(
    newer
      ? join(releases, newer, "package", "dist", "main.js")
      : join(dist, "player.js"),
  ).href
);
