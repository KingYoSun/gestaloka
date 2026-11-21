import { readFile, writeFile, rename } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";

const root = new URL("../artifacts/player-cli/", import.meta.url);
const pkg = JSON.parse(
  await readFile(
    new URL("../packages/player-cli/package.json", import.meta.url),
    "utf8",
  ),
);
const notes = JSON.parse(
  await readFile(
    new URL("../packages/player-cli/gameplay-changes.json", import.meta.url),
    "utf8",
  ),
);
if (
  !Object.hasOwn(notes, pkg.version) ||
  !Object.values(notes).every(
    (rows) =>
      Array.isArray(rows) &&
      rows.every((line) => typeof line === "string" && line.trim()),
  )
)
  throw new Error(
    "配布する版のプレイ変更履歴がありません（変更がなければ空配列）",
  );
const filename = `gestaloka-player-cli-${pkg.version}.tgz`;
const bytes = await readFile(new URL(filename, root));
for (const name of [
  "join",
  "setup",
  "runtimes",
  "commands",
  "cli",
  "dice",
  "SKILL",
]) {
  await writeFile(
    new URL(`${name}.md`, root),
    await readFile(
      new URL(
        `../packages/player-cli/skills/gestaloka-player/${name === "SKILL" ? "" : "references/"}${name}.md`,
        import.meta.url,
      ),
    ),
    { mode: 0o644 },
  );
}
const temporary = new URL(`latest-${randomUUID()}.tmp`, root);
await writeFile(
  temporary,
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

await rename(temporary, new URL("latest.json", root));
