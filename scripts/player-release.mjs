import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../artifacts/player-cli/", import.meta.url);
const pkg = JSON.parse(
  await readFile(
    new URL("../packages/player-cli/package.json", import.meta.url),
    "utf8",
  ),
);
const filename = `gestaloka-player-cli-${pkg.version}.tgz`;
const bytes = await readFile(new URL(filename, root));
for (const name of ["join", "setup"]) {
  await writeFile(
    new URL(`${name}.md`, root),
    await readFile(
      new URL(
        `../packages/player-cli/skills/gestaloka-player/references/${name}.md`,
        import.meta.url,
      ),
    ),
    { mode: 0o644 },
  );
}
await writeFile(
  new URL("latest.json", root),
  JSON.stringify(
    {
      version: pkg.version,
      node: pkg.engines.node,
      downloadUrl: `/api/player-cli/download/${filename}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.length,
      setupUrl: `/api/player-cli/docs/${pkg.version}/setup.md`,
    },
    null,
    2,
  ) + "\n",
);
