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
  drop = false,
  spectating = false;
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
  http.get("*/api/account/spectating", () => json({ public: spectating })),
  http.put("*/api/account/spectating", async ({ request }) => {
    const { public: enabled } = (await request.json()) as { public: boolean };
    spectating = enabled;
    return json({ public: spectating });
  }),
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
        neighbors: view.neighbors ?? [],
        past: [],
        place: view.place,
        belongings: view.belongings,
      },
    });
  }),
  http.post("*/api/worlds/:id/session", async ({ request }) => {
    const body = (await request.json()) as {
      requestId: string;
      command: string;
      text?: string;
      accept?: boolean;
      targetId?: string;
      query?: { kind: string };
    };
    posted.push({
      requestId: body.requestId,
      command: body.command,
      actorId: new URL(request.url).searchParams.get("actorId"),
    });
    if (receipts.has(body.requestId)) return json(receipts.get(body.requestId));
    if (body.command === "companion-wait")
      view.departureFollowers = (
        view.departureFollowers as { targetId: string }[]
      ).filter((person) => person.targetId !== body.targetId);
    if (body.command === "home-set")
      view.home = {
        placeId: "00000000-0000-4000-8000-000000000006",
        name: view.place,
      };
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
  spectating = false;
  view = {
    viewerId: actor,
    aiControlled: false,
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
const playPath = `/worlds/${world}/play?actorId=${actor}`;
const watchPath = `/worlds/${world}/watch/${actor}`;
const show = (path = playPath) =>
  render(
    <App
      navigation={createAppRouter(
        createMemoryHistory({
          initialEntries: [path],
        }),
      )}
    />,
  );
// 申請と操作は、画面下部のボタンから開くダイアログの中にある。
const open = async (name: string) =>
  fireEvent.click(
    await screen.findByRole("button", { name }, { timeout: 5000 }),
  );

test("公開設定を保存すると本人のプレイ画面だけで観戦URLをコピーできる", async () => {
  const account = show("/account");
  const label = "他のユーザーからの観戦を許可する";
  const option = (await screen.findByRole(
    "checkbox",
    { name: label },
    {
      timeout: 5000,
    },
  )) as HTMLInputElement;
  expect(option.checked).toBe(false);
  fireEvent.click(option);
  await waitFor(() => expect(option.checked).toBe(true));
  account.unmount();

  const writeText = vi.fn().mockResolvedValue(undefined);
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  try {
    show();
    await open("観戦URLをコピー");
    await screen.findByText("観戦URLをコピーしました。");
    expect(writeText).toHaveBeenCalledWith(
      new URL(watchPath, location.origin).href,
    );
    fireEvent.click(screen.getByRole("link", { name: "アカウント設定" }));
    const saved = (await screen.findByRole(
      "checkbox",
      { name: label },
      {
        timeout: 5000,
      },
    )) as HTMLInputElement;
    expect(saved.checked).toBe(true);
    fireEvent.click(saved);
    await waitFor(() => expect(saved.checked).toBe(false));
    expect(spectating).toBe(false);
  } finally {
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

test("初期表示の再生を省き、最新ログが進むと選んだ音色と音量で一度鳴る", async () => {
  const start = vi.fn();
  const gain = { gain: { value: 1 }, connect: vi.fn() };
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      decodeAudioData = vi.fn().mockResolvedValue({});
      createGain = () => gain;
      createBufferSource = () => ({ connect: () => gain, start, stop() {} });
    },
  );
  const loadSound = vi.fn();
  server.use(
    http.get(/\/sounds\/electro\.mp3$/, () => {
      loadSound();
      return HttpResponse.arrayBuffer(new ArrayBuffer(1));
    }),
  );
  view.sceneId = scene;
  const turn = (id: string, message: string) => ({
    id,
    payload: { transition: { at: "2026-11-26T00:00:00Z", message } },
  });
  view.entries = [turn("9007199254740992", "先に届いた記録")];
  show();
  await screen.findByText("先に届いた記録");
  await open("効果音設定");
  const settings = within(
    screen.getByRole("dialog", { name: "プレイログの効果音" }),
  );
  const toggle = settings.getByRole<HTMLInputElement>("checkbox", {
    name: "新しいログが届いたら効果音を鳴らす",
  });
  expect(toggle.checked).toBe(false);
  const picker = settings.getByRole("combobox", { name: "音色" });
  expect(within(picker).getAllByRole("option")).toHaveLength(4);
  fireEvent.change(picker, { target: { value: "electro" } });
  fireEvent.change(settings.getByRole("slider", { name: /音量/ }), {
    target: { value: "30" },
  });
  fireEvent.click(toggle);
  await open("閉じる");
  expect(start).not.toHaveBeenCalled();
  view.entries = [turn("9007199254740993", "新しく届いた記録")];
  await screen.findByText("新しく届いた記録", {}, { timeout: 3000 });
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(loadSound).toHaveBeenCalledTimes(1);
  expect(gain.gain.value).toBe(0.3);
  view.actorId = peer;
  await screen.findByText(/の手番を待っています/, {}, { timeout: 3000 });
  expect(start).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("link", { name: "アカウント設定" }));
  const saved = await screen.findByRole<HTMLSelectElement>("combobox", {
    name: "音色",
  });
  expect(saved.value).toBe("electro");
});

test("観戦画面で進行中のセッションの記録を前後に移動できる", async () => {
  const ownerReads = vi.fn();
  server.use(
    http.get("*/api/worlds/:id/session", () => {
      ownerReads();
      return json(view);
    }),
    http.get("*/api/worlds/:id/spectate", ({ request }) => {
      const query = new URL(request.url).searchParams;
      expect(query.get("actorId")).toBe(actor);
      const earlier = query.has("before");
      if (earlier) expect(query.get("before")).toBe("2");
      return json({
        name: "観測者",
        scene: {
          id: scene,
          entries: [
            {
              id: earlier ? "1" : "2",
              lines: [
                {
                  speaker: "渡し守",
                  text: earlier ? "菜の花が咲いている" : "渡し船が戻った",
                },
              ],
            },
            ...(earlier
              ? []
              : [{ id: "3", lines: [{ text: "船が岸に着いた" }] }]),
          ],
          before: earlier ? null : "2",
        },
      });
    }),
  );
  show(watchPath);
  await screen.findByRole("heading", { name: "「観測者」の観戦" });
  await screen.findByText("渡し船が戻った");
  await open("効果音設定");
  expect(
    screen.getByRole("dialog", { name: "プレイログの効果音" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "試聴する" })).toBeTruthy();
  await open("閉じる");
  const log = screen.getByRole("region", { name: "セッションのチャット" });
  expect(within(log).getAllByRole("article")[0]?.textContent).toContain(
    "船が岸に着いた",
  );
  const scrollTo = vi.fn();
  log.scrollTo = scrollTo;
  Object.defineProperty(log, "scrollHeight", { value: 1800 });
  await open("最下部に移動");
  await open("最上部へ移動");
  expect(scrollTo.mock.calls).toEqual([[{ top: 1800 }], [{ top: 0 }]]);
  await open("前の記録を表示");
  await screen.findByText("菜の花が咲いている");
  expect(screen.queryByText("渡し船が戻った")).toBeNull();
  await open("最新の記録へ戻る");
  await screen.findByText("渡し船が戻った");
  expect(screen.queryByRole("button", { name: "観戦URLをコピー" })).toBeNull();
  expect(screen.queryByRole("button", { name: "操作" })).toBeNull();
  expect(ownerReads).not.toHaveBeenCalled();
});

test("非公開の観戦URLを開いてもログイン状態を保持する", async () => {
  server.use(
    http.get("*/api/worlds/:id/spectate", () =>
      json({ code: "SPECTATE_NOT_FOUND", message: "観戦できません" }, 404),
    ),
  );
  show(watchPath);
  await screen.findByText("観戦できません");
  expect(screen.getByRole("link", { name: "アカウント設定" })).toBeTruthy();
});

test("手番外に現在地をHomeに設定し、表示を更新する", async () => {
  view.actorId = peer;
  view.place = "渡し場";
  show();
  await open("現在地をHomeにする");
  await waitFor(() => expect(screen.getAllByText("渡し場")).toHaveLength(2));
  expect(posted).toEqual([
    { requestId: expect.any(String), command: "home-set", actorId: actor },
  ]);
});

test("セッションの外で申請を開き、受領を確定する", async () => {
  delete view.sessionId;
  view.members = [];
  let accepted = false;
  server.use(
    http.get("*/api/worlds/:id/session", () =>
      json({
        ...view,
        screen: {
          own: { actorId: actor, name: "観測者", profile: [] },
          people: [],
          neighbors: [],
          past: [],
          applications: accepted
            ? []
            : [
                {
                  id: scene,
                  senderId: peer,
                  senderName: "渡し守",
                  text: "水位が下がったら渡し場を確認する",
                  deadline: "2030-01-01T00:00:00.000Z",
                  awaitingYou: true,
                  preview: [],
                },
              ],
        },
      }),
    ),
    http.post("*/api/worlds/:id/session", async ({ request }) => {
      expect(await request.json()).toMatchObject({
        command: "receive",
        applicationId: scene,
        accept: true,
      });
      accepted = true;
      return json({ state: "accepted", message: "申請を確定しました" });
    }),
  );
  show();
  await open("受領と交換（1件）");
  await screen.findByText("水位が下がったら渡し場を確認する");
  fireEvent.click(screen.getByRole("button", { name: "承認する" }));
  await screen.findByText("申請を確定しました");
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "承認する" })).toBeNull(),
  );
});

test("出現した一団を一人分の同席枠に現在数つきで表示する", async () => {
  view.characters = [
    { actorId: actor, name: "観測者", icon: null },
    { actorId: peer, name: "鳥", icon: null, count: 4 },
  ];
  show();
  const group = await screen.findByRole("button", {
    name: "鳥 ×4のプロフィール",
  });
  expect(within(group).getByText("×4")).toBeTruthy();
});

test("検索結果とセッションのチャットに同じ出現描写を表示する", async () => {
  const appearanceText = "水鳥が現れた\n\n浅瀬の飛び石を順に指さす。";
  server.use(
    http.post("*/api/worlds/:id/session", () => {
      view.entries = [
        {
          id: "1",
          payload: {
            entries: [{ actorId: actor, input: appearanceText, result: {} }],
          },
        },
      ];
      return json({
        material: { node: { text: "本人だけに返った素材" } },
        appearanceText,
      });
    }),
  );
  show();
  await open("操作");
  fireEvent.click(await screen.findByRole("button", { name: "周囲を見る" }));
  const search = (await screen.findByText("自分への検索結果")).parentElement!;
  const chat = screen.getByLabelText("セッションのチャット");
  for (const text of appearanceText.split("\n\n")) {
    await within(search).findByText(text);
    await within(chat).findByText(text);
  }
  expect(within(chat).queryByText("本人だけに返った素材")).toBeNull();
});

test("本人の素材を個別表示し、手番終了時に入力・結果・任意コメントを共有する", async () => {
  show();
  await screen.findByRole(
    "heading",
    { name: "1人のセッション" },
    { timeout: 5000 },
  );
  await open("操作");
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
  fireEvent.click(
    screen.getByRole("button", { name: "自分のプレイを終了する" }),
  );
  await screen.findByRole("heading", {
    name: "今回のプレイを終了しました",
    hidden: true,
  });
  expect(chat.textContent).toContain("記録の方法を提案する");
  expect(posted.every((p) => p.actorId === actor)).toBe(true);
});

test("手動で操作する人物の待機を、下部のボタンから解除する", async () => {
  const released: unknown[] = [];
  server.use(
    http.post("*/api/worlds/:id/waiting", async ({ request }) => {
      released.push({
        actorId: new URL(request.url).searchParams.get("actorId"),
        ...((await request.json()) as object),
      });
      return json({ state: "standby", active: false, actionable: false });
    }),
  );
  show();
  await open("操作");
  fireEvent.click(
    await screen.findByRole("button", { name: "待機を解除する" }),
  );
  await screen.findByRole("button", { name: "待機を解除しました" });
  expect(released).toEqual([{ actorId: actor, active: false }]);
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
  await screen.findByRole("button", { name: "プレイヤー情報" });
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
  await open("操作");
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

test("発声が制限された状態を確認し、同じ入力を発声せずに使える", async () => {
  const body = vi.fn();
  const cause = {
    stateId: peer,
    shortId: "@a1b2c3d4",
    text: "喉が負傷している",
  };
  server.use(
    http.post("*/api/worlds/:id/session", async ({ request }) => {
      const sent = (await request.json()) as { mode?: string };
      body(sent);
      return sent.mode === "nonverbal"
        ? json(view)
        : json(
            {
              code: "COMMAND_RESTRICTED",
              message:
                "発声できません。原因の状態 @a1b2c3d4「喉が負傷している」。",
              blockingStates: [cause],
            },
            409,
          );
    }),
  );
  show();
  await open("操作");
  const field = await screen.findByLabelText("発言・ターンコメント");
  fireEvent.change(field, { target: { value: "道を教えてほしい" } });
  fireEvent.click(screen.getByRole("button", { name: "発言する" }));
  expect(await screen.findByText(/@a1b2c3d4「喉が負傷している」/)).toBeTruthy();
  expect((field as HTMLTextAreaElement).value).toBe("道を教えてほしい");
  fireEvent.click(screen.getByRole("button", { name: "発声せずに行動する" }));
  await waitFor(() =>
    expect(body).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: "say",
        mode: "nonverbal",
        text: "道を教えてほしい",
      }),
    ),
  );
});

test("目撃した物品の参照と渡した先を表示する", async () => {
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
  expect(screen.getByText(/渡す人物.*受け取る人物/)).toBeTruthy();
});

test("同席者の判定の出目と成功範囲をプレイログで読める", async () => {
  view.characters = [
    { actorId: actor, name: "観測者", icon: null },
    { actorId: peer, name: "同席者", icon: null },
  ];
  view.entries = [
    {
      id: "12",
      payload: {
        entries: [
          {
            actorId: peer,
            input: "広場の先を探る",
            result: {
              outcome: { success: false },
              dice: ["判定 出目 42 / 100、成功は 25 以下（失敗）"],
            },
          },
          {
            actorId: actor,
            input: "足跡を調べる",
            result: {
              state: "accepted",
              diceReasons: ["判定で、技能「追跡」が有利に働きました"],
            },
          },
        ],
      },
    },
  ];
  show();
  await screen.findByText("広場の先を探る");
  expect(
    screen.getByText(/出目 42 \/ 100、成功は 25 以下（失敗）/),
  ).toBeTruthy();
  expect(
    screen.getByText("判定で、技能「追跡」が有利に働きました"),
  ).toBeTruthy();
  expect(screen.getAllByText(/出目/)).toHaveLength(1);
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
  await open("操作");
  await screen.findByRole("button", { name: "受け入れる" });
  expect(screen.queryByRole("button", { name: "自分の情報" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "拒否する" }));
  await screen.findByText(/相手の手番を待っています/);
  expect(screen.queryByRole("button", { name: "受け入れる" })).toBeNull();
});

test("応答喪失後は保存した同じ要求を再送し、入力を重ねない", async () => {
  const first = show();
  await open("操作");
  await screen.findByLabelText("発言・ターンコメント");
  drop = true;
  fireEvent.change(screen.getByLabelText("発言・ターンコメント"), {
    target: { value: "同じ入力を照合する" },
  });
  fireEvent.click(screen.getByRole("button", { name: "発言する" }));
  await screen.findByRole("button", { name: "保存した同じ要求で確認する" });
  first.unmount();
  show();
  await open("操作");
  fireEvent.click(
    await screen.findByRole("button", { name: "保存した同じ要求で確認する" }),
  );
  await waitFor(() =>
    expect(posted.filter((p) => p.command === "say")).toHaveLength(2),
  );
  expect(posted[0]!.requestId).toBe(posted[1]!.requestId);
  expect(entries).toHaveLength(1);
});

test("満枠から消費する技能を選び、成功後の使用枠を確かめて統合を申請できる", async () => {
  view.belongings = {
    items: [],
    storages: [],
    skills: [
      { id: peer, text: "星位を測る" },
      { id: user, text: "潮流を読む" },
    ],
    skillCapacity: { usedSlots: 2, limitSlots: 2 },
  };
  const submit = vi.fn();
  server.use(
    http.post("*/api/worlds/:id/session", async ({ request }) => {
      submit(await request.json());
      return json({ state: "confirmed" });
    }),
  );
  show();
  await open("操作");
  fireEvent.click(screen.getByText("プレイコマンド", { exact: true }));
  fireEvent.click(screen.getByText("技能を習得する（2/2枠）"));
  const button = screen.getByRole("button", {
    name: "習得を申請する（1 SP）",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("星位を測る"));
  expect(screen.getByText("成功後の使用枠 2/2")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("潮流を読む"));
  expect(screen.getByText("成功後の使用枠 1/2")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("習得する技能と使える範囲"), {
    target: { value: "夜の湾内で航路を選べる" },
  });
  fireEvent.change(screen.getByLabelText("どのように身につけるか"), {
    target: { value: "湾内で夜間観測を重ねる" },
  });
  fireEvent.click(button);
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "apply",
        expectedSp: 1,
        action: {
          type: "generate",
          plans: [
            {
              text: "湾内で夜間観測を重ねる",
              operation: {
                type: "learn",
                person: actor,
                text: "夜の湾内で航路を選べる",
                basis: "湾内で夜間観測を重ねる",
                consumeSkillIds: [peer, user],
              },
            },
          ],
        },
      }),
    ),
  );
});

test("移動前に追従するNPCを確認し、手番外でもその場に残せる", async () => {
  view.departureFollowers = [{ targetId: peer, name: "渡し守" }];
  view.neighbors = [{ id: scene, label: "対岸" }];
  view.actorId = peer;
  show();
  await open("操作");
  const wait = await screen.findByRole("button", {
    name: "渡し守をここに残す",
  });
  fireEvent.click(screen.getByText("プレイコマンド", { exact: true }));
  expect(
    (
      screen.getByRole("button", { name: "移動する" }) as HTMLButtonElement
    ).closest("fieldset")?.disabled,
  ).toBe(true);
  expect(posted).toEqual([]);
  fireEvent.click(wait);
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "渡し守をここに残す" }),
    ).toBeNull(),
  );
  expect(posted.map(({ command }) => command)).toEqual(["companion-wait"]);
});

test("コマンド欄はJSONとコマンドの形式を検証し、入力中の発言と分けて送る", async () => {
  show();
  await open("操作");
  const speech = await screen.findByLabelText("発言・ターンコメント");
  fireEvent.change(speech, { target: { value: "観測を続ける" } });
  fireEvent.click(screen.getByText("プレイコマンド", { exact: true }));
  fireEvent.click(screen.getByText("JSONでコマンドを実行", { exact: true }));
  const input = screen.getByLabelText("コマンドのJSON");
  const execute = screen.getByRole("button", { name: "コマンドを実行する" });
  for (const invalid of ["{", '{"command":"update","text":"移動する"}']) {
    fireEvent.change(input, { target: { value: invalid } });
    fireEvent.click(execute);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(posted).toHaveLength(0);
  }
  fireEvent.change(input, {
    target: {
      value: JSON.stringify({
        command: "say",
        text: "観測を続ける",
        requestId: scene,
      }),
    },
  });
  fireEvent.click(execute);
  await screen.findByText("直近の応答データ");
  expect(posted).toEqual([
    { requestId: expect.any(String), command: "say", actorId: actor },
  ]);
  expect(posted[0]?.requestId).not.toBe(scene);
  expect((speech as HTMLTextAreaElement).value).toBe("観測を続ける");
});

test("抽選器を変更するとSP見積もりを消し、確認した額と公開版で申請する", async () => {
  const versionId = "00000000-0000-4000-8000-000000000006";
  const submit = vi.fn();
  server.use(
    http.post("*/api/worlds/:id/session/quote", async ({ request }) => {
      const body = (await request.json()) as { targetId: string };
      return json(
        body.targetId === peer
          ? { expectedSp: 0, chargeWhen: "never" }
          : { expectedSp: 1, chargeWhen: "draw-saved", versionId },
      );
    }),
    http.post("*/api/worlds/:id/session", async ({ request }) => {
      submit(
        new URL(request.url).searchParams.get("expectedSp"),
        await request.json(),
      );
      return json({ state: "confirmed" });
    }),
  );
  show();
  await open("操作");
  fireEvent.click(screen.getByText("プレイコマンド", { exact: true }));
  fireEvent.click(screen.getByText("JSONでコマンドを実行", { exact: true }));
  const input = screen.getByLabelText("コマンドのJSON");
  const execute = screen.getByRole("button", { name: "コマンドを実行する" });
  const edit = (targetId: string) =>
    fireEvent.change(input, {
      target: { value: JSON.stringify({ command: "draw", targetId }) },
    });

  edit(peer);
  fireEvent.click(screen.getByRole("button", { name: "SPを確認する" }));
  await screen.findByText("0 SP。");
  expect(execute).toHaveProperty("disabled", false);

  edit(scene);
  expect(screen.queryByText("0 SP。")).toBeNull();
  expect(execute).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "SPを確認する" }));
  await screen.findByText("最大 1 SP。抽選結果を保存したときに消費します。");
  fireEvent.click(execute);
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({ command: "draw", targetId: scene, versionId }),
    ),
  );
});

test("定期更新に失敗してもログを保ち、次の更新で新しい記録を先頭へ足す", async () => {
  const row = (id: string, input: string) => ({
    id,
    payload: { entries: [{ actorId: peer, input, result: {} }] },
  });
  view.actorId = peer;
  view.characters = [
    { actorId: actor, name: "観測者", icon: null },
    { actorId: peer, name: "相手", icon: null },
  ];
  view.entries = [row("1", "最初の記録")];
  show();
  const chat = await screen.findByLabelText(
    "セッションのチャット",
    {},
    { timeout: 5000 },
  );
  const shown = (await within(chat).findByText("最初の記録")).closest(
    ".play-log-row",
  )!;
  expect(chat.firstElementChild?.textContent).toBe("相手の手番を待っています");
  server.use(
    http.get(
      "*/api/worlds/:id/session",
      () =>
        json({ code: "INTERNAL_ERROR", message: "更新に失敗しました" }, 500),
      { once: true },
    ),
  );
  await screen.findByText("更新に失敗しました", {}, { timeout: 3000 });
  expect(screen.getByLabelText("セッションのチャット")).toBe(chat);
  expect(shown.isConnected).toBe(true);
  view.entries = [row("1", "最初の記録"), row("2", "次の記録")];
  await within(chat).findByText("次の記録", {}, { timeout: 3000 });
  expect(screen.queryByText("更新に失敗しました")).toBeNull();
  const rows = [...chat.querySelectorAll<HTMLElement>(".play-log-row")];
  expect(rows.map((node) => node.dataset.fresh)).toEqual(["true", undefined]);
  expect(rows[0]!.textContent).toContain("次の記録");
  expect(rows[1]).toBe(shown);
});
