import { test as base, expect } from "@playwright/test";
import { connectDatabases } from "@gestaloka/server";
import { fixtureAuth } from "../support/auth.js";

export { expect };
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
