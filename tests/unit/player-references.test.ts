import { PlayCommand } from "@gestaloka/contracts";
import { expect, test } from "vitest";
import {
  PlayerReferences,
  localTime,
  utcTime,
} from "../../packages/player-cli/src/references.js";

test("衝突時は新しい短縮IDだけを延ばし、元の参照と自由記述を保持する", () => {
  const refs = new PlayerReferences(":memory:");
  const ids = [
    "00000000-0000-4000-8000-000000000394",
    "00000000-0000-4000-8000-00000000226b",
  ];
  const payload = {
    sourceIds: ids,
    key: "relations:" + ids[0] + ":has:out",
    text: ids[1],
  };
  const compact = refs.convert(payload) as typeof payload;
  expect(compact.sourceIds[0]).toBe("@5c31f574");
  expect(compact.sourceIds[1]).toMatch(/^@5c31f574[0-9a-f]{2}$/);
  expect(compact.key).toBe("relations:@5c31f574:has:out");
  expect(compact.text).toBe(ids[1]);
  expect(refs.convert(compact, true)).toEqual(payload);
  expect(refs.convert(payload)).toEqual(compact);
});

test("出力の時刻は現地時刻とUTCとの差で示し、本文中の時刻表現は変えない", () => {
  const tz = process.env.TZ;
  const show = (zone: string, v: unknown) => {
    process.env.TZ = zone;
    return JSON.parse(JSON.stringify(v, localTime));
  };
  try {
    const payload = {
      deadline: "2026-11-30T15:00:00.000Z",
      text: "18:40ごろ到着。期限は2026-11-30T15:00:00.000Zと聞いた",
    };
    expect(show("Asia/Tokyo", payload)).toEqual({
      ...payload,
      deadline: "2026-12-01T00:00:00+09:00",
    });
    expect(show("UTC", payload).deadline).toBe("2026-11-30T15:00:00+00:00");
    expect(show("America/St_Johns", payload).deadline).toBe(
      "2026-11-30T11:30:00-03:30",
    );
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
});

test("入力の期限はUTCとの差を付けた日時も同じ瞬間として送り、ゾーンのない日時は直さない", () => {
  const refs = new PlayerReferences(":memory:");
  expect(
    refs.convert({ deferredUntil: "2026-12-01T00:00:00+09:00" }, true),
  ).toEqual({ deferredUntil: "2026-11-30T15:00:00.000Z" });
  expect(utcTime("2026-11-30T15:00:00Z")).toBe("2026-11-30T15:00:00.000Z");
  expect(utcTime("2026-12-01T00:00:00")).toBe("2026-12-01T00:00:00");
  const memo = (deferredUntil: string) =>
    PlayCommand.safeParse({
      requestId: "00000000-0000-4000-8000-000000000001",
      command: "memo",
      text: "例",
      deferredUntil: utcTime(deferredUntil),
      dependencies: [],
    }).success;
  expect(memo("2026-12-01T00:00:00+09:00")).toBe(true);
  expect(memo("2026-12-01T00:00:00")).toBe(false);
});
