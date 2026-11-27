import { expect, test } from "vitest";
import { z } from "zod";
import { defaultDice, WorldDice } from "@gestaloka/contracts";
import {
  diceFields,
  rollDice,
} from "../../packages/server/src/runtime/dice.js";

test("3d6の全216通りで、合計10と11が最も多く、3と18は各1通りになる", () => {
  const counts = Array<number>(16).fill(0);
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++)
      for (let c = 1; c <= 6; c++) {
        const faces = [a, b, c];
        const sum = rollDice(defaultDice, (min, max) => {
          expect([min, max]).toEqual([1, 7]);
          return faces.shift()!;
        });
        expect(sum).toBe(a + b + c);
        counts[sum - 3]!++;
      }
  expect(counts).toEqual([
    1, 3, 6, 10, 15, 21, 25, 27, 27, 25, 21, 15, 10, 6, 3, 1,
  ]);
});

test("2d8の通常判定は2～15、探索は16までを目標値にできる", () => {
  const dice = { count: 2, sides: 8 };
  const basis = { thresholdBasis: "足場が安定している。" };
  const check = z.strictObject(diceFields(dice));
  expect(check.parse({ ...basis, successThrough: 2 })).toEqual({
    ...dice,
    ...basis,
    successThrough: 2,
  });
  expect(check.safeParse({ ...basis, successThrough: 15 }).success).toBe(true);
  for (const invalid of [
    { successThrough: 2 },
    { successThrough: 2, thresholdBasis: "  " },
    { successThrough: 2, thresholdBasis: "2" },
    { ...basis, successThrough: 1 },
    { ...basis, successThrough: 16 },
    { ...basis, successThrough: 8, sides: 6 },
    { ...basis, successThrough: 8, count: 3 },
  ])
    expect(check.safeParse(invalid).success).toBe(false);
  expect(
    z
      .strictObject(diceFields(dice, true))
      .parse({ ...basis, successThrough: 16 }).successThrough,
  ).toBe(16);
  expect(rollDice(dice, (_min, max) => max - 1)).toBe(16);
  expect(rollDice({ sides: 100 }, (_min, max) => max - 1)).toBe(100);
});

test("運営者は整数の個数と面数を指定し、出目の合計を保存できる", () => {
  expect(WorldDice.parse({ count: 1, sides: 20 })).toEqual({
    count: 1,
    sides: 20,
  });
  for (const invalid of [
    { count: 0, sides: 6 },
    { count: 3, sides: 1 },
    { count: 1.5, sides: 6 },
    { count: 2, sides: 2147483647 },
  ])
    expect(WorldDice.safeParse(invalid).success).toBe(false);
});
