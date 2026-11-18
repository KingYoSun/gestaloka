import { readFile, writeFile } from "node:fs/promises";
import { format } from "prettier";
import {
  commandGuide,
  playerOptions,
} from "../packages/player-cli/src/help.js";

const target = new URL(
  "../packages/player-cli/skills/gestaloka-player/references/cli.md",
  import.meta.url,
);
const guide = await format(commandGuide(), { parser: "markdown" });
for (const option of Object.keys(playerOptions)) {
  if (!new RegExp(`--${option}(?![\\w-])`).test(guide))
    throw new Error(`CLIのコマンド一覧に --${option} がありません`);
}
if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")).replaceAll("\r\n", "\n") !== guide)
    throw new Error("CLIのコマンド一覧を pnpm generate で更新してください");
} else await writeFile(target, guide);
