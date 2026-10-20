import { createServer } from "node:http";
import { test, expect } from "@playwright/test";
import { connectDatabases } from "@gestaloka/server";
import { OryIdentity } from "@gestaloka/server/identity";
import { createApp } from "../../apps/api/src/app.js";

for (const [provider, target] of [
  ["google", "https://accounts.google.com/v3/signin/identifier"],
  ["twitter", "https://api.twitter.com/oauth/authenticate"],
] as const) {
  test(`${provider}のボタン送信後に認証先へのリダイレクトがCSPで遮断されない`, async ({
    page,
  }) => {
    const databases = connectDatabases();
    const upstream = createServer((_request, response) => {
      response.writeHead(303, { location: target });
      response.end();
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve),
    );
    const address = upstream.address();
    if (!address || typeof address === "string")
      throw new Error("Missing upstream address");
    const base = `http://127.0.0.1:${address.port}`;
    const identity = new OryIdentity(databases.postgres, base, async () =>
      Response.json({
        ui: {
          action: `${base}/submit`,
          nodes: [
            { attributes: { name: "csrf_token", value: "browser-csrf" } },
            { attributes: { name: "provider", value: provider } },
          ],
        },
      }),
    );
    const app = await createApp(undefined, identity);
    const url = await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      // Block the provider request before it leaves Chromium; only the CSP decision is under test.
      const network = await page.context().newCDPSession(page);
      await network.send("Network.enable");
      await network.send("Network.setBlockedURLs", {
        urls: [`${new URL(target).origin}/*`],
      });
      await page.goto(`${url}/auth/login?flow=browser-test`);
      const redirected = page.waitForRequest(target);
      await page
        .getByRole("button", { name: provider })
        .click({ noWaitAfter: true });
      expect((await redirected).url()).toBe(target);
    } finally {
      await app.close();
      await new Promise<void>((resolve, reject) =>
        upstream.close((error) => (error ? reject(error) : resolve())),
      );
      await databases.close();
    }
  });
}
