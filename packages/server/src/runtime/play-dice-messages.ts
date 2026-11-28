import { z } from "zod";

const DiceOutcome = z.object({
  success: z.boolean().optional(),
  roll: z.number().int(),
  setting: z.object({
    count: z.number().int().positive().optional(),
    sides: z.number().int(),
    successThrough: z.number().int(),
    fumble: z.object({ through: z.number().int() }).optional(),
  }),
  text: z.string().optional(),
  opponentId: z.string().optional(),
  repeated: z.boolean().optional(),
  fumble: z.object({ roll: z.number().int(), success: z.boolean() }).optional(),
});

export function playedDice(
  outcome: unknown,
  text = "",
): z.infer<typeof DiceOutcome>[] {
  if (!outcome || typeof outcome !== "object") return [];
  const { proposals, contests } = outcome as Record<string, unknown>;
  if (Array.isArray(proposals)) return proposals.flatMap((p) => playedDice(p));
  if (Array.isArray(contests))
    return contests.flatMap((contest, i) =>
      playedDice(contest, `対抗判定 ${i + 1}`),
    );
  const { data } = DiceOutcome.safeParse(outcome);
  return data ? [{ ...data, text: data.text ?? text }] : [];
}

export function playDiceMessages(outcome: unknown): string[] {
  return playedDice(outcome).flatMap((data) => {
    const { roll, setting, text, success, repeated, fumble } = data;
    const { sides, successThrough } = setting;
    const scale =
      setting.count === undefined
        ? ` / ${sides}`
        : `（${setting.count}d${sides}）`;
    const label = text ? `「${text}」の判定` : "判定";
    const replay = repeated ? "（前回の結果）" : "";
    const messages = [
      `${label}${replay} 出目 ${roll}${scale}、成功は ${successThrough} 以下（${(success ?? roll <= successThrough) ? "成功" : "失敗"}）`,
    ];
    if (fumble && setting.fumble)
      messages.push(
        `ファンブル判定 出目 ${fumble.roll}${scale}、ファンブルは ${setting.fumble.through} 以下（${fumble.success ? "ファンブル" : "ファンブルなし"}）`,
      );
    return messages;
  });
}

// 出目のない案には、抽選を止めた条件か審査で返された理由が保存される。
export function unrolledReasons(outcome: unknown): string[] {
  if (!outcome || typeof outcome !== "object") return [];
  const p = outcome as Record<string, unknown>;
  if (Array.isArray(p.proposals)) return p.proposals.flatMap(unrolledReasons);
  if (
    p.success !== false ||
    p.roll !== undefined ||
    typeof p.reason !== "string"
  )
    return [];
  const proposal = p.text ? `「${p.text}」の案` : "この案";
  if (p.reason === "MATERIAL_ID_REQUIRED") {
    const labels = z
      .array(z.string())
      .safeParse(p.unresolvedMaterialLabels).data;
    const missing = z.array(z.string()).safeParse(p.missingMaterialLabels).data;
    if (labels?.length && missing) {
      const ambiguous = labels.filter((label) => !missing.includes(label));
      const guidance = [];
      if (missing.length)
        guidance.push(
          `材料「${missing.join("」「")}」の候補が見つかりません。手持ち（search --kind self）と現在地（search --kind surroundings）を調べ、使う物品のIDをmaterialsに指定してください。現物がまだなければ、取得を申請するか、現在地の発見物を拾えます。取得の申請では command に apply、action.type に generate、action.plans[].operation.type に create を指定してください。`,
        );
      if (ambiguous.length)
        guidance.push(
          `材料「${ambiguous.join("」「")}」には同名の候補が複数あります。使う物品のIDをmaterialsに指定してください。`,
        );
      return [`${proposal}は振っていません。${guidance.join("")}`];
    }
    return [
      labels?.length
        ? `${proposal}は振っていません。材料「${labels.join("」「")}」に使う物品を特定できません。使う物品のIDをmaterialsに指定するか、その材料を使う工程を申請文から外してください。`
        : `${proposal}は振っていません。申請文からどの材料を使うのか読み取れません。使う材料を申請文に明記し、その物品のIDをmaterialsに指定してください。`,
    ];
  }
  if (typeof p.message === "string" && p.message.trim())
    return [
      `${p.text ? `「${p.text}」は` : "この申請は"}差し戻されました。${p.message}`,
    ];
  const reasons: Record<string, string> = {
    MATERIAL_SHORTAGE: "使える材料が足りません",
    SKILL_CAPACITY_EXCEEDED: "技能の空き枠が足りません",
    JUDGMENT_MATERIAL_LIMIT: "判定に必要な資料が収まりません",
  };
  return [`${proposal}は振っていません。${reasons[p.reason] ?? p.reason}`];
}
