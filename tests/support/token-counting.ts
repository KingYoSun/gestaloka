import { LlmClient } from "@gestaloka/server/llm";

export const withTokenCount =
  (transport: typeof fetch): typeof fetch =>
  async (url, init) =>
    String(url).endsWith("/messages/count_tokens")
      ? Response.json({ input_tokens: 370 })
      : transport(url, init);

export function createCountedClient(
  ...args: ConstructorParameters<typeof LlmClient>
) {
  args[2] = withTokenCount(args[2] ?? fetch);
  return new LlmClient(...args);
}
