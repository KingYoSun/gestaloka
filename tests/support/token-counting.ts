import { LlmClient } from "@gestaloka/server/llm";

export const withTokenCount =
  (transport: typeof fetch): typeof fetch =>
  async (url, init) =>
    String(url).endsWith("/messages/count_tokens") ||
    String(url).endsWith("/responses/input_tokens")
      ? Response.json({ input_tokens: 370 })
      : String(url).endsWith(":countTokens")
        ? Response.json({ totalTokens: 370 })
        : transport(url, init);

export function createCountedClient(
  ...args: ConstructorParameters<typeof LlmClient>
) {
  args[2] = withTokenCount(args[2] ?? fetch);
  return new LlmClient(...args);
}
