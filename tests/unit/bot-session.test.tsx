// @vitest-environment jsdom
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  test,
  expect,
  vi,
} from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { createMemoryHistory } from "@tanstack/react-router";
import { App, createAppRouter } from "../../apps/web/src/App.js";
import { resetSession } from "../../apps/web/src/api.js";
const user = "00000000-0000-4000-8000-000000000001",
  world = "00000000-0000-4000-8000-000000000002",
  actor = "00000000-0000-4000-8000-000000000003",
  scene = "00000000-0000-4000-8000-000000000004",
  peer = "00000000-0000-4000-8000-000000000005";
type Entry = {
  actorId: string;
  label: string;
  input: string;
  result: { state: string };
};
let entries: Entry[] = [],
  comment: string | undefined,
  posted: { requestId: string; command: string; actorId: string | null }[] = [],
  drop = false;
let view: Record<string, unknown>;
const receipts = new Map<string, unknown>();
const json = (value: unknown, status = 200) =>
  HttpResponse.json(value as never, {
    status,
    headers: { "X-Gestaloka-Subject": user },
  });
const server = setupServer(
  http.get("*/api/session", () => json({ id: user })),
  http.post("*/api/session", () => json({ id: user })),
  http.get("*/api/account", () =>
    json({ member: { id: user, role: "user", banned: false } }),
  ),
  http.get("*/api/worlds/:id/knowledge", () =>
    json({ viewerId: actor, items: [], next: null, previous: null }),
  ),
  http.get("*/api/worlds/:id/session", ({ request }) => {
    if (new URL(request.url).searchParams.get("view") !== "screen")
      return json(view);
    return json({
      ...view,
      screen: {
        own: { actorId: actor, name: "観測者", profile: [] },
        people: [],
        neighbors: [],
        past: [],
      },
    });
  }),
  http.post("*/api/worlds/:id/session", async ({ request }) => {
    const body = (await request.json()) as {
      requestId: string;
      command: string;
      text?: string;
      accept?: boolean;
      query?: { kind: string };
    };
    posted.push({
      requestId: body.requestId,
      command: body.command,
      actorId: new URL(request.url).searchParams.get("actorId"),
    });
    if (receipts.has(body.requestId)) return json(receipts.get(body.requestId));
    if (body.command === "search") {
      view.callsUsed = Number(view.callsUsed) + 1;
      return json({
        ...view,
        material: { node: { text: "本人だけに返った素材" }, states: [] },
        ...(body.query?.kind === "self"
          ? {
              arriving: [
                {
                  items: [{ label: "木箱", count: 2 }, { label: "粘土" }],
                  dueAt: "2026-11-21T04:00:00.000Z",
                },
              ],
            }
          : {}),
      });
    }
    if (body.command === "say") {
      entries.push({
        actorId: actor,
        label: "観測者",
        input: body.text!,
        result: { state: "accepted" },
      });
      view.callsUsed = Number(view.callsUsed) + 1;
    }
    if (body.command === "comment") {
      comment = body.text;
      view.commentUsed = true;
    }
    if (body.command === "end-turn") {
      view.entries = [
        {
          id: "1",
          payload: { entries: [...entries], ...(comment ? { comment } : {}) },
        },
      ];
      entries = [];
      comment = undefined;
      view.commentUsed = false;
      view.callsUsed = 0;
    }
    if (body.command === "receive") {
      view.receiving = null;
      view.actorId = peer;
    }
    if (body.command === "finish") {
      delete view.sessionId;
      view.members = [];
      view.result = { entries: view.entries };
    }
    const result = { ...view };
    receipts.set(body.requestId, result);
    if (drop) {
      drop = false;
      return HttpResponse.error();
    }
    return json(result);
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  localStorage.clear();
  resetSession();
  receipts.clear();
  entries = [];
  comment = undefined;
  posted = [];
  drop = false;
  view = {
    viewerId: actor,
    sessionId: scene,
    actorId: actor,
    callsUsed: 0,
    callsLimit: 8,
    commentUsed: false,
    members: [{ actorId: actor, sceneId: scene }],
    characters: [{ actorId: actor, name: "観測者", icon: null }],
    entries: [],
    legacy: [],
    receiving: null,
  };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("scrollTo", vi.fn());
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.unstubAllGlobals();
  resetSession();
});
afterAll(() => server.close());
const show = () =>
  render(
    <App
      navigation={createAppRouter(
        createMemoryHistory({
          initialEntries: [`/worlds/${world}/play?actorId=${actor}`],
        }),
      )}
    />,
  );

test("本人の素材を個別表示し、手番終了時に入力・結果・任意コメントを共有する", async () => {
  show();
  await screen.findByRole(
    "heading",
    { name: "1人のセッション" },
    { timeout: 5000 },
  );
  fireEvent.click(screen.getByRole("button", { name: "自分の情報" }));
  await screen.findByText("本人だけに返った素材");
  const arriving = screen.getByText("届く予定").parentElement!;
  expect(arriving.textContent).toContain("木箱 ×2、粘土");
  expect(arriving.querySelector("time")?.dateTime).toBe(
    "2026-11-21T04:00:00.000Z",
  );
  const field = screen.getByLabelText("発言・ターンコメント");
  fireEvent.change(field, { target: { value: "記録の方法を提案する" } });
  fireEvent.compositionStart(field);
  fireEvent.keyDown(field, { key: "Enter", keyCode: 229, isComposing: true });
  fireEvent.compositionEnd(field);
  expect(posted.filter((p) => p.command === "say")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "発言する" }));
  await waitFor(() => expect(view.callsUsed).toBe(2));
  const chat = screen.getByLabelText("セッションのチャット");
  expect(within(chat).queryByText("記録の方法を提案する")).toBeNull();
  fireEvent.change(field, { target: { value: "次の観測につなげたい" } });
  fireEvent.click(
    screen.getByRole("button", { name: "ターンコメントを付ける" }),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "ターンコメントを付ける",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole("button", { name: "手番を終える" }));
  await within(chat).findByText("記録の方法を提案する");
  expect(chat.textContent).toContain("次の観測につなげたい");
  expect(chat.textContent).not.toContain("本人だけに返った素材");
  expect(chat.textContent).not.toContain("届く予定");
  fireEvent.click(screen.getByRole("button", { name: "本人のシーンを終了" }));
  await screen.findByRole("heading", { name: "本人のシーンを終了しました" });
  expect(chat.textContent).toContain("記録の方法を提案する");
  expect(posted.every((p) => p.actorId === actor)).toBe(true);
});

test("通知の未読をプレイヤー情報に示し、通知タブを開いたときだけ既読にする", async () => {
  view.actorId = peer;
  const reads: (string | null)[] = [];
  const at = "2026-11-21T04:00:00.000Z";
  server.use(
    http.get("*/api/worlds/:id/notices", ({ request }) => {
      reads.push(new URL(request.url).searchParams.get("actorId"));
      delete view.unreadNotices;
      return json({
        notices: [{ id: scene, at, text: "木箱が届きました。", unread: true }],
      });
    }),
  );
  show();
  const player = await screen.findByRole("complementary", {
    name: "プレイヤー情報",
  });
  expect(within(player).getByRole("tab", { name: "通知" })).toBeTruthy();
  view.unreadNotices = 1;
  const drawer = await screen.findByRole(
    "button",
    { name: "プレイヤー情報（未読の通知 1件）" },
    { timeout: 5000 },
  );
  expect(
    within(player).getByRole("tab", { name: /通知.*未読.*1件/ }),
  ).toBeTruthy();
  fireEvent.click(drawer);
  const dialog = await screen.findByRole("dialog", { name: "プレイヤー情報" });
  expect(reads).toEqual([]);
  fireEvent.mouseDown(
    within(dialog).getByRole("tab", { name: /通知.*未読.*1件/ }),
    {
      button: 0,
      ctrlKey: false,
    },
  );
  const body = await within(dialog).findByText("木箱が届きました。");
  expect(body.parentElement?.querySelector("time")?.dateTime).toBe(at);
  await within(dialog).findByRole("tab", { name: "通知" });
  expect(reads).toEqual([actor]);
  expect(posted).toEqual([]);
  fireEvent.click(within(dialog).getByRole("button", { name: "閉じる" }));
  await screen.findByRole("button", { name: "プレイヤー情報", exact: true });
});

test("発言の応答待ちに書き始めた次の入力を消さない", async () => {
  let release!: () => void,
    started = false;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.post("*/api/worlds/:id/session", async () => {
      started = true;
      await held;
      return json(view);
    }),
  );
  show();
  const field = await screen.findByRole("textbox", {
    name: "発言・ターンコメント",
  });
  fireEvent.change(field, { target: { value: "最初の発言" } });
  fireEvent.click(screen.getByRole("button", { name: "発言する" }));
  await waitFor(() => expect(started).toBe(true));
  fireEvent.change(field, { target: { value: "次の入力" } });
  release();
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "発言する" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  expect((field as HTMLTextAreaElement).value).toBe("次の入力");
});

test("目撃した物品の参照と成立した所有・保持の変化を表示する", async () => {
  view.characters = [
    { actorId: actor, name: "渡す人物", icon: null },
    { actorId: peer, name: "受け取る人物", icon: null },
  ];
  view.entries = [
    {
      id: "12",
      payload: {
        entries: [
          {
            actorId: actor,
            label: "渡す人物",
            input: "紐を渡す",
            result: {
              state: "accepted",
              items: [
                {
                  itemId: scene,
                  label: "紐",
                  ownership: { fromIds: [actor], toId: peer },
                  holding: { fromId: actor, toId: peer },
                },
              ],
            },
          },
        ],
      },
    },
  ];
  show();
  expect(await screen.findByText("紐〈" + scene + "〉")).toBeTruthy();
  expect(screen.getByText(/所有.*渡す人物.*受け取る人物/)).toBeTruthy();
  expect(screen.getByText(/保持.*渡す人物.*受け取る人物/)).toBeTruthy();
});
test("受領判断を表示し、判断後は元の人物の通常手番へ戻る", async () => {
  view.members = [
    { actorId: actor, sceneId: scene },
    { actorId: peer, sceneId: scene },
  ];
  view.characters = [
    { actorId: actor, name: "観測者", icon: null },
    { actorId: peer, name: "相手", icon: null },
  ];
  view.receiving = {
    applicationId: scene,
    text: "道具の受領を申し出ています",
    deadline: new Date(Date.now() + 600000).toISOString(),
  };
  show();
  await screen.findByRole("button", { name: "受け入れる" });
  expect(screen.queryByRole("button", { name: "自分の情報" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "拒否する" }));
  await screen.findByText(/相手の手番を待っています/);
  expect(screen.queryByRole("button", { name: "受け入れる" })).toBeNull();
});

test("応答喪失後は保存した同じ要求を再送し、入力を重ねない", async () => {
  const first = show();
  await screen.findByLabelText("発言・ターンコメント");
  drop = true;
  fireEvent.change(screen.getByLabelText("発言・ターンコメント"), {
    target: { value: "同じ入力を照合する" },
  });
  fireEvent.click(screen.getByRole("button", { name: "発言する" }));
  await screen.findByRole("button", { name: "保存した同じ要求で確認する" });
  first.unmount();
  show();
  fireEvent.click(
    await screen.findByRole("button", { name: "保存した同じ要求で確認する" }),
  );
  await waitFor(() =>
    expect(posted.filter((p) => p.command === "say")).toHaveLength(2),
  );
  expect(posted[0]!.requestId).toBe(posted[1]!.requestId);
  expect(entries).toHaveLength(1);
});
