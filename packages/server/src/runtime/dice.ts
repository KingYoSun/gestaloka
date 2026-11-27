import { randomInt } from "node:crypto";
import { z } from "zod";
import type { WorldDice } from "@gestaloka/contracts";

export function diceFields({ count, sides }: WorldDice, certain = false) {
  return {
    count: z.literal(count).default(count),
    sides: z.literal(sides).default(sides),
    thresholdBasis: z
      .string()
      .trim()
      .regex(/\p{L}/u, "上限を決めた具体的な条件を言葉で指定してください"),
    successThrough: z
      .number()
      .int()
      .min(count)
      .max(count * sides - (certain ? 0 : 1)),
  };
}

export function dicePrompt({ count, sides }: WorldDice, certain = false) {
  return `世界のダイスは${count}d${sides}。各ダイスを独立に振り、合計がsuccessThrough以下なら成功する。successThroughは${count}から${count * sides - (certain ? 0 : 1)}までの整数で、材料から目標値を直接決める。個数と面数はサーバーが設定する。各successThroughと同じオブジェクトにthresholdBasisを必ず返す。申請のどの手段・条件や判定基準をどう評価して、この上限を選んだかを申請者に伝わる一文で具体的に説明する。出目や上限の言い換え、成否の予告は根拠にならない。本人が知らない人物・状態・非公開の基準の原文は明かさない。`;
}

export function rollDice(
  { count = 1, sides }: { count?: number | undefined; sides: number },
  random: (min: number, max: number) => number = randomInt,
) {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += random(1, sides + 1);
  return sum;
}
