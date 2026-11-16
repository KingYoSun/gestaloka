import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import {
  SceneRecordQuery,
  readSceneRecords,
  scenePlayContext,
  type SceneRecords,
} from "../../packages/server/src/runtime/scene-records.js";

const actor = randomUUID(),
  peer = randomUUID(),
  other = randomUUID();
function records(): SceneRecords {
  return {
    history: Array.from({ length: 28 }, (_, n) => ({
      id: randomUUID(),
      actorId: actor,
      inputId: randomUUID(),
      text: n === 0 ? "明朝９時、入口で会ってから出発する約束" : `後の発言${n}`,
      period: { from: n * 1000, until: n * 1000 + 500 },
      receipts: [
        { observerId: actor, text: `本人の受容${n}`, at: n * 1000 + 500 },
        { observerId: peer, text: `相手の受容${n}`, at: n * 1000 + 500 },
      ],
    })),
    contacts: Array.from({ length: 28 }, (_, n) => ({
      eventId: randomUUID(),
      speaker: peer,
      listener: actor,
      text: n === 0 ? "まだ承諾していない。条件を確かめたい" : `届いた発言${n}`,
      at: n * 1000,
      replyInputId: randomUUID(),
    })),
  };
}

test("古い返信元と継続中の意図、配送先を初期に残し、別の古い原文も照会できる", () => {
  const source = records(),
    requestId = source.contacts[0]!.replyInputId!;
  const input = {
    initialContext: [
      {
        request: { kind: "node", id: actor },
        result: {
          node: { id: actor, kind: "existence", text: "本人" },
          states: ["現在の条件"],
          possessions: ["照会できる在庫詳細"],
        },
      },
    ],
    request: {
      controlledActorId: actor,
      controlledInputId: requestId,
      intentions: [
        {
          actorId: actor,
          actionText: "条件を確かめる",
          continuing: true,
          inputId: source.history[1]!.inputId!,
        },
      ],
    },
    controlledView: { observations: ["以前から分からないこと"] },
  };
  const original = structuredClone(source),
    packet = scenePlayContext(input, source);
  expect(packet.request).toEqual(input.request);
  expect(packet.controlledView).toEqual(input.controlledView);
  expect(packet.sceneHistory.map((e) => e.id)).toEqual([
    source.history[1]!.id,
    source.history[27]!.id,
  ]);
  expect(packet.sceneHistory[0]!.receipts).toContainEqual({
    observerId: peer,
    at: 1500,
  });
  expect(packet.receivedContacts).toEqual([
    source.contacts[0],
    source.contacts[27],
  ]);
  expect(packet.initialContext![0]!.result).toEqual({
    node: { id: actor, kind: "existence", text: "本人" },
    states: ["現在の条件"],
    possessions: ["照会できる在庫詳細"],
  });
  expect(
    readSceneRecords(
      source,
      SceneRecordQuery.parse({
        kind: "scene-records",
        source: "history",
        actorId: actor,
        observerId: peer,
        text: "朝9時 入口",
      }),
    ).items,
  ).toEqual([source.history[0]]);
  expect(
    readSceneRecords(
      source,
      SceneRecordQuery.parse({
        kind: "scene-records",
        source: "contacts",
        id: source.contacts[0]!.eventId,
        observerId: actor,
        inputId: requestId,
      }),
    ).items,
  ).toEqual([source.contacts[0]]);
  expect(source).toEqual(original);
});

test("ページを最後まで読むと、途中を不存在にせず全原文と時点を回収する", () => {
  const source = records(),
    received = [];
  let offset: number | null = 0;
  do {
    const page = readSceneRecords(
      source,
      SceneRecordQuery.parse({
        kind: "scene-records",
        source: "history",
        offset,
      }),
    );
    expect(page.total).toBe(28);
    received.push(...page.items);
    offset = page.next;
  } while (offset !== null);
  expect(received).toEqual([...source.history].reverse());
  expect(
    readSceneRecords(
      source,
      SceneRecordQuery.parse({
        kind: "scene-records",
        source: "history",
        from: 1000,
        through: 2000,
      }),
    ).items,
  ).toEqual([source.history[2], source.history[1]]);
  expect(
    readSceneRecords(
      source,
      SceneRecordQuery.parse({
        kind: "scene-records",
        source: "contacts",
        observerId: other,
      }),
    ),
  ).toEqual({ items: [], next: null, total: 0 });
});

test("同じ時点に届いた複数の受容をIDの大小で一つへ絞らない", () => {
  const source = records();
  source.contacts[26]!.at = source.contacts[27]!.at;
  const packet = scenePlayContext(
    {
      request: {
        controlledActorId: actor,
        controlledInputId: randomUUID(),
        intentions: [],
      },
    },
    source,
  );
  expect(packet.receivedContacts).toEqual(source.contacts.slice(26));
});

test("未完了の意図の起点と、その相手への配送済みの根拠を残す", () => {
  const source = records(),
    origin = source.history[0]!;
  source.history[27]!.receipts = [
    { observerId: actor, text: "本人が待っている" },
  ];
  const packet = scenePlayContext(
    {
      request: {
        controlledActorId: actor,
        controlledInputId: randomUUID(),
        intentions: [
          {
            actorId: actor,
            actionText: "相手の返答を受け取る",
            continuing: true,
            originEventId: origin.id,
          },
        ],
      },
    },
    source,
  );
  expect(packet.sceneHistory[0]!.id).toBe(origin.id);
  expect(packet.sceneHistory[0]!.receipts).toContainEqual({
    observerId: peer,
    at: 500,
  });
  expect(packet.sceneHistory.at(-1)!.id).toBe(source.history[27]!.id);
});

test("起点のない旧継続は、最後の配送を元の問いと推定せず当人の履歴を残す", () => {
  const source = records();
  const packet = scenePlayContext(
    {
      request: {
        controlledActorId: actor,
        controlledInputId: randomUUID(),
        intentions: [
          { actorId: actor, actionText: "途中の意図", continuing: true },
        ],
      },
    },
    source,
  );
  expect(packet.sceneHistory.map((e) => e.id)).toEqual(
    source.history.map((e) => e.id),
  );
});
