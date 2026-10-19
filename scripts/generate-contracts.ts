import { readFile, writeFile } from "node:fs/promises";
import openapiTS, { astToString } from "openapi-typescript";
import { createApp } from "../apps/api/src/app.js";

const app = await createApp();
try {
  const document = app.swagger();
  const files = new Map([
    [
      "../packages/contracts/openapi.json",
      JSON.stringify(document, null, 2) + "\n",
    ],
    [
      "../packages/contracts/src/http.d.ts",
      astToString(await openapiTS(JSON.stringify(document))),
    ],
  ]);
  for (const [path, content] of files) {
    const url = new URL(path, import.meta.url);
    if (process.argv.includes("--check")) {
      if ((await readFile(url, "utf8")) !== content)
        throw new Error(`${path}: pnpm generate を実行してください`);
    } else {
      await writeFile(url, content);
    }
  }
} finally {
  await app.close();
}
