import { createHash } from "node:crypto";
import type { readBelongings } from "../world/belongings.js";
import type { ChatMessage } from "./client.js";
import type { PreparedPrompt } from "./prompt.js";

type Belongings = Awaited<ReturnType<typeof readBelongings>>;
type Item = Belongings["items"][number];
type Skill = Belongings["skills"][number];
type DiceInput = {
  premise: string;
  actor: string;
  nodes: { node: { id: string }; belongings?: Belongings }[];
  consumable?: { id: string; label: string; count?: number }[];
};

export function prepareDicePrompt(
  messages: ChatMessage[],
  cacheSkills: boolean,
): PreparedPrompt | undefined {
  const input = messages.find((message) => message.role === "user");
  if (!input) return;
  const { premise, actor, nodes, consumable, ...action } = JSON.parse(
    input.content,
  ) as DiceInput;
  if (!Array.isArray(nodes)) return;

  // 取得経緯は物品が増えるほど入力を膨らませる。申請がID・CLIの短縮ID・呼称で指す物品にだけ付ける。
  const request = JSON.stringify(action);
  const shownBasis = ({ id, label, basis }: Item) =>
    request.includes(id) ||
    request.includes(
      "@" + createHash("sha256").update(id).digest("hex").slice(0, 8),
    ) ||
    (label !== "" && request.includes(label))
      ? basis
      : null;
  const held = nodes.find(({ node }) => node.id === actor)?.belongings;
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
  const skill = ({ id, text, basis, since }: Skill) => [
    id,
    text,
    basisValue(basis),
    since,
  ];
  const packedNodes = nodes.map(({ belongings, ...facts }) =>
    belongings
      ? {
          ...facts,
          belongings: {
            items: belongings.items.map(item),
            storages: belongings.storages.map(({ id, label, items }) => [
              id,
              label,
              items.map(item),
            ]),
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
    nodes: packedNodes,
    ...(packedConsumable
      ? { consumable: allHeldConsumable ? true : packedConsumable }
      : {}),
    ...(basisDictionary.length ? { basisDictionary } : {}),
  });
  const instructions =
    "itemsの列は[id,表示名,basis,成立時点,個数(任意)]、storagesは[id,表示名,物品行]、skillsは[id,説明,basis,成立時点]。basisが整数ならbasisDictionaryの0始まりの添字。文字列なら取得経緯の原文。物品のbasisがnullなら、取得経緯が未記録か、申請が指さない物品なので省いた。nodesの物品のheldは現在それを持つ存在(by,label)と取得経緯、originはその物品が最初に成立したときの経緯。" +
    (packedConsumable
      ? "consumableがtrueなら申請者のitemsの全行が消費候補。配列の文字列は申請者のitemsにある物品のIDを指す。物品行から表示名と個数を読む。"
      : "") +
    (split
      ? "最初のJSONは世界設定・申請者・申請者の技能(actorSkills)。次のJSONは今回の申請と他の材料。両方を合わせて判定する。"
      : "");
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
                ? [
                    { type: "text", text: prefix, cacheBoundary: true },
                    { type: "text", text: "\n" + current },
                  ]
                : current,
            },
      ),
    format: undefined,
  };
}
