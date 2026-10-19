import { ESLint } from "eslint";
import { expect, test } from "vitest";

test.each([
  "@gestaloka/server",
  "../../../packages/server/src/index.js",
  "neo4j-driver",
  "node:fs",
])("公開契約・Webから%sへの依存を拒否する", async (source) => {
  const eslint = new ESLint();
  for (const filePath of [
    "apps/web/src/probe.ts",
    "packages/contracts/src/probe.ts",
  ]) {
    const [result] = await eslint.lintText(`import '${source}';`, { filePath });
    expect(
      result?.messages.some(
        (message) => message.ruleId === "no-restricted-imports",
      ),
    ).toBe(true);
  }
});
