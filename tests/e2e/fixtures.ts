import { randomUUID } from "node:crypto";
import { test as base, expect, type APIRequestContext } from "@playwright/test";
import { connectDatabases } from "@gestaloka/server";
import { fixtureAuth } from "../support/auth.js";

export { expect };
export async function worldInvite(
  request: APIRequestContext,
  worldId: string,
  maxUses = 1,
) {
  const response = await request.post("/api/operations", {
    headers: { "x-gestaloka-request": "1" },
    data: {
      requestId: randomUUID(),
      command: {
        operation: "invites.create",
        worldId,
        maxUses,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        reason: "E2E",
      },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).result.token as string;
}
export async function acceptWorldInvite(
  request: APIRequestContext,
  invitation: string,
) {
  const response = await request.post("/api/operations", {
    headers: { "x-gestaloka-request": "1" },
    data: {
      requestId: randomUUID(),
      command: { operation: "account.register", invitation },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
}
export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    const db = connectDatabases();
    try {
      const auth = await fixtureAuth(db.postgres),
        person = await auth.person();
      await db.postgres.query(
        "INSERT INTO e2e_subject(scope,id) VALUES($1,$2)",
        [process.env.E2E_SCOPE, person.id],
      );
      await context.addCookies([
        {
          name: "test_ory",
          value: person.id,
          url: baseURL!,
          httpOnly: true,
          sameSite: "Strict",
        },
      ]);
      await use(context);
    } finally {
      await db.close();
    }
  },
});
