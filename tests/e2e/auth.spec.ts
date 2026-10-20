import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
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

test("OAuth同意後にHydraと登録済みクライアントへ遷移できる", async ({
  page,
}) => {
  const databases = connectDatabases();
  const identityId = randomUUID(),
    sessionId = randomUUID();
  const target = "https://client.example/callback";
  let appUser = "",
    origin = "";
  const upstream = createServer((request, response) => {
    if (request.url === "/complete") {
      response.writeHead(303, { location: target });
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        request.method === "PUT"
          ? { redirect_to: `${origin}/complete` }
          : {
              subject: appUser,
              requested_scope: ["openid"],
              requested_access_token_audience: [],
              request_url: `${origin}/oauth2/auth?redirect_uri=${encodeURIComponent(target)}`,
              client: { client_id: "browser-test" },
            },
      ),
    );
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const address = upstream.address();
  if (!address || typeof address === "string")
    throw new Error("Missing upstream address");
  origin = `http://127.0.0.1:${address.port}`;
  const identity = new OryIdentity(databases.postgres, origin, async () =>
    Response.json({
      id: sessionId,
      active: true,
      expires_at: new Date(Date.now() + 60000).toISOString(),
      identity: { id: identityId, state: "active" },
    }),
  );
  await identity.setup();
  appUser = (await identity.session("session=browser-test")).userId;
  const app = await createApp(undefined, identity, origin);
  const url = await app.listen({ host: "127.0.0.1", port: 0 });
  try {
    await page.context().addCookies([
      {
        name: "ory_kratos_session",
        value: "browser-test",
        domain: "127.0.0.1",
        path: "/",
      },
    ]);
    const network = await page.context().newCDPSession(page);
    await network.send("Network.enable");
    await network.send("Network.setBlockedURLs", { urls: [target] });
    await page.goto(`${url}/auth/oauth/consent?consent_challenge=browser-test`);
    const redirected = page.waitForRequest(target);
    await page
      .getByRole("button", { name: "許可する", exact: true })
      .click({ noWaitAfter: true });
    expect((await redirected).url()).toBe(target);
  } finally {
    await app.close();
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    );
    await databases.postgres.query("DELETE FROM app_identity WHERE ory_id=$1", [
      identityId,
    ]);
    await databases.close();
  }
});
