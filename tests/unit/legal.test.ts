import { afterEach, expect, test, vi } from "vitest";

async function edition(name: string, contact: string) {
  vi.stubEnv("LEGAL_OPERATOR_NAME", name);
  vi.stubEnv("LEGAL_CONTACT", contact);
  vi.resetModules();
  return import("../../packages/server/src/http/legal.js");
}
afterEach(() => vi.unstubAllEnvs());

test.each([
  ["", ""],
  ["試験運営者", ""],
  [" ", "operator@example.test"],
])(
  "運営者情報がそろうまで同意を受け付けない (%s, %s)",
  async (name, contact) => {
    const legal = await edition(name, contact);
    const db = { query: vi.fn() };
    expect(legal.legalConfigured).toBe(false);
    expect(await legal.hasLegalConsent(db, "user")).toBe(false);
    await expect(legal.recordLegalConsent(db, "user")).rejects.toMatchObject({
      code: "LEGAL_NOT_CONFIGURED",
    });
    await expect(legal.beginRegistrationConsent(db)).rejects.toMatchObject({
      code: "LEGAL_NOT_CONFIGURED",
    });
    expect(db.query).not.toHaveBeenCalled();
  },
);

test("掲載する運営者名又は窓口を変更すると新しい同意版になる", async () => {
  const first = await edition("試験運営", "first@example.test");
  const renamed = await edition("別の運営者", "first@example.test");
  const moved = await edition("試験運営", "https://support.example.test/");
  expect(
    new Set([first.legalVersion, renamed.legalVersion, moved.legalVersion])
      .size,
  ).toBe(3);
  for (const text of [moved.terms, moved.privacy]) {
    expect(text).toContain("試験運営");
    expect(text).toContain("https://support.example.test/");
  }
});
