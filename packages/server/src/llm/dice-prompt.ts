import { createHash } from "node:crypto";
import type { readBelongings } from "../world/belongings.js";
import type { ChatMessage } from "./client.js";
import type { PreparedPrompt } from "./prompt.js";

type Belongings = Awaited<ReturnType<typeof readBelongings>>;
type Item = Belongings["items"][number] & { ground?: boolean };
type Skill = Belongings["skills"][number];
export const diceStoragePlace = Symbol.for("gestaloka.diceStoragePlace");
export const diceJudgmentMaterials = Symbol.for(
  "gestaloka.diceJudgmentMaterials",
);
type MaterialFact = { node?: { id: string }; belongings?: Belongings };
type DiceInput = {
  premise?: string;
  actor: unknown;
  nodes?: MaterialFact[];
  materials?: MaterialFact[];
  consumable?: { id: string; label: string; count?: number }[];
  skillCriteria?: string;
  recentAttempts?: unknown;
};

function compactDiceInput(input: ChatMessage, cacheSkills: boolean) {
  const {
    premise,
    actor,
    nodes: creation,
    materials: opposition,
    consumable,
    skillCriteria,
    recentAttempts,
    ...action
  } = JSON.parse(input.content) as DiceInput;
  const nodes = creation ?? opposition;
  if (!Array.isArray(nodes)) return;
  const factKey = creation ? "nodes" : "materials";

  // 取得経緯は物品が増えるほど入力を膨らませる。申請がID・CLIの短縮ID・呼称で指す物品にだけ付ける。
  const request = JSON.stringify(action);
  const mentions = ({ id, label }: Pick<Item, "id" | "label">) =>
    request.includes(id) ||
    request.includes(
      "@" + createHash("sha256").update(id).digest("hex").slice(0, 8),
    ) ||
    (label !== "" && request.includes(label));
  const shownBasis = (item: Item) =>
    input[diceJudgmentMaterials] || opposition || mentions(item)
      ? item.basis
      : null;
  const held = nodes.find(({ node }) => node?.id === actor)?.belongings;
  const actorSkills = held?.skills ?? [];
  const prefix = JSON.stringify({ premise, actor, actorSkills });
  // 2 KiB was the lower bound for useful skill prefixes in the saved calls.
  const split =
    cacheSkills && actorSkills.length > 0 && Buffer.byteLength(prefix) >= 2048;
  const belongs = nodes.flatMap(({ belongings }) =>
    belongings ? [belongings] : [],
  );
  const counts = new Map<string, number>();
  for (const records of belongs)
    for (const basis of [
      ...[
        ...records.items,
        ...records.storages.flatMap(({ items }) => items),
      ].map(shownBasis),
      ...(split && records === held ? [] : records.skills).map((s) => s.basis),
    ])
      if (basis && basis.length > 12)
        counts.set(basis, (counts.get(basis) ?? 0) + 1);
  const basisDictionary = [...counts].flatMap(([basis, count]) =>
    count > 1 ? [basis] : [],
  );
  const references = new Map(
    basisDictionary.map((basis, index) => [basis, index]),
  );
  const basisValue = (basis: string | null) =>
    basis === null ? null : (references.get(basis) ?? basis);
  const item = (i: Item) => [
    i.id,
    i.label,
    basisValue(shownBasis(i)),
    i.since,
    ...(i.count === undefined ? [] : [i.count]),
  ];
  const skill = ({ id, text, basis, since, name }: Skill) => [
    id,
    text,
    basisValue(basis),
    since,
    ...(name ? [name] : []),
  ];
  const place = input[diceStoragePlace];
  const groundItems = belongs.flatMap(({ items }) =>
    items.flatMap((item: Item) => (item.ground ? [item.id] : [])),
  );
  let summarized = false;
  const storage = ({ id, label, items }: Belongings["storages"][number]) => {
    const remote = place && place !== id && !mentions({ id, label });
    return [
      id,
      label,
      items.map((row) => {
        if (!remote || mentions(row)) return item(row);
        summarized = true;
        return [
          null,
          row.label,
          null,
          null,
          ...(row.count === undefined ? [] : [row.count]),
        ];
      }),
    ];
  };
  const packedNodes = nodes.map(({ belongings, ...facts }) =>
    belongings
      ? {
          ...facts,
          belongings: {
            items: belongings.items.map(item),
            storages: belongings.storages.map(storage),
            ...(split && belongings === held
              ? {}
              : { skills: belongings.skills.map(skill) }),
          },
        }
      : facts,
  );
  const heldItems = new Map(held?.items.map((item) => [item.id, item]));
  const packedConsumable = consumable?.map((candidate) => {
    const held = heldItems.get(candidate.id);
    return held?.label === candidate.label && held.count === candidate.count
      ? candidate.id
      : candidate;
  });
  const allHeldConsumable =
    packedConsumable &&
    heldItems.size > 1 &&
    heldItems.size === packedConsumable.length &&
    packedConsumable.every((candidate) => typeof candidate === "string") &&
    new Set(packedConsumable).size === heldItems.size;
  const current = JSON.stringify({
    ...(split ? {} : { premise, actor }),
    ...action,
    [factKey]: packedNodes,
    ...(skillCriteria ? { skillCriteria, recentAttempts } : {}),
    ...(groundItems.length ? { groundItems } : {}),
    ...(packedConsumable
      ? { consumable: allHeldConsumable ? true : packedConsumable }
      : {}),
    ...(basisDictionary.length ? { basisDictionary } : {}),
    ...(summarized
      ? {
          storageStockNote:
            "遠隔保管先の品には表示名と個数だけを示す行がある。",
        }
      : {}),
  });
  return {
    premise,
    actor,
    action,
    actorSkills,
    prefix,
    split,
    current,
    packedConsumable,
    groundItems,
  };
}

export function measureDiceMaterials(input: ChatMessage, cacheSkills = false) {
  const packed = compactDiceInput(input, cacheSkills);
  if (!packed) throw new Error("ダイス判定の資料がありません");
  const { premise, actor, action, current, split, prefix } = packed;
  // Both layouts serialize the same action once. A split adds the actual skill prefix and its newline.
  return (
    Buffer.byteLength(current) +
    (split ? Buffer.byteLength(prefix) + 1 : 0) -
    Buffer.byteLength(JSON.stringify({ premise, actor, ...action }))
  );
}

export function prepareDicePrompt(
  messages: ChatMessage[],
  cacheSkills: boolean,
  partitionSkills = false,
): PreparedPrompt | undefined {
  const input = messages.find((message) => message.role === "user");
  const packed = input && compactDiceInput(input, cacheSkills);
  if (!packed) return;
  const {
    premise,
    actor,
    actorSkills,
    prefix,
    split,
    current,
    packedConsumable,
    groundItems,
  } = packed;
  const instructions =
    "itemsの列は[id,表示名,basis,成立時点,個数(任意)]、storagesは[id,表示名,物品行]、skillsは[id,説明,basis,成立時点,名称(任意)]。basisが整数ならbasisDictionaryの0始まりの添字。文字列なら取得経緯の原文。物品のbasisがnullなら、取得経緯が未記録か、申請が指さない物品なので省いた。nodesの物品のheldは現在それを持つ存在(by,label)と取得経緯、originはその物品が最初に成立したときの経緯。" +
    (packedConsumable
      ? "consumableがtrueなら申請者のitemsの全行が消費候補。配列の文字列は申請者のitemsにある物品のIDを指す。物品行から表示名と個数を読む。"
      : "") +
    (groundItems.length
      ? "groundItemsのIDは出現して地面にある物で、保持中の材料とは区別する。"
      : "") +
    (split
      ? "最初のJSONは世界設定・申請者・申請者の技能(actorSkills)。次のJSONは今回の申請と他の材料。両方を合わせて判定する。"
      : "");
  const skillBlocks = [
    { type: "text" as const, text: prefix, cacheBoundary: true as const },
  ];
  let suffix = "\n" + current;
  if (split && partitionSkills) {
    // 技能が増えても前の境界を残す。最後の境界は技能の末尾に置く。
    const header = JSON.stringify({ premise, actor, actorSkills: [] }).slice(
      0,
      -2,
    );
    skillBlocks.length = 0;
    let start = 0;
    for (const size of [4, 8, 16, actorSkills.length]) {
      if (start === actorSkills.length) break;
      const end = Math.min(start + size, actorSkills.length);
      skillBlocks.push({
        type: "text",
        text:
          (start ? "," : header) +
          JSON.stringify(actorSkills.slice(start, end)).slice(1, -1),
        cacheBoundary: true,
      });
      start = end;
    }
    suffix = "]}" + suffix;
  }
  return {
    system: [
      {
        type: "text",
        text:
          messages
            .filter(({ role }) => role === "system")
            .map(({ content }) => content)
            .join("\n\n") +
          "\n" +
          instructions,
        ...(split ? {} : { cacheBoundary: true as const }),
      },
    ],
    messages: messages
      .filter(({ role }) => role !== "system")
      .map((message) =>
        message !== input
          ? message
          : {
              role: message.role,
              content: split
                ? [...skillBlocks, { type: "text", text: suffix }]
                : current,
            },
      ),
    format: undefined,
  };
}
