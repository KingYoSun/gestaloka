import { randomInt } from "node:crypto";
import { z } from "zod";
import type { WorldDice } from "@gestaloka/contracts";

export function diceFields({ count, sides }: WorldDice, certain = false) {
  return {
    count: z.literal(count).default(count),
    sides: z.literal(sides).default(sides),
    successThrough: z
      .number()
      .int()
      .min(count)
      .max(count * sides - (certain ? 0 : 1)),
  };
}

export function dicePrompt({ count, sides }: WorldDice, certain = false) {
  return `世界のダイスは${count}d${sides}。各ダイスを独立に振り、合計がsuccessThrough以下なら成功する。successThroughは${count}から${count * sides - (certain ? 0 : 1)}までの整数で、材料から目標値を直接決める。個数と面数はサーバーが設定する。`;
}

export function rollDice(
  { count = 1, sides }: { count?: number | undefined; sides: number },
  random: (min: number, max: number) => number = randomInt,
) {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += random(1, sides + 1);
  return sum;
}
