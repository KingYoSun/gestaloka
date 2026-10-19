// dsh's published bin uses import.meta.main, absent in the project's Node 22.14 runtime.
const cli: { runCli(): Promise<void> } = await import(
  new URL("./lib/bin.js", import.meta.resolve("@deepseek-ai/dsh/package.json"))
    .href
);
await cli.runCli();
