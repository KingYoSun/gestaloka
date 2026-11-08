// @vitest-environment jsdom
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { App, createAppRouter } from "../../apps/web/src/App.js";
import { createMemoryHistory } from "@tanstack/react-router";
import { resetSession } from "../../apps/web/src/api.js";
import {
  WORLD_DAY_MS,
  type PlayerStatus,
  type PlayRun,
  type SceneStatus,
} from "@gestaloka/contracts";
import type { z } from "zod";

const A = "00000000-0000-4000-8000-000000000001",
  B = "00000000-0000-4000-8000-000000000002",
  W = "00000000-0000-4000-8000-000000000003",
  V = "00000000-0000-4000-8000-000000000004";
let identity = A,
  hasSession = false,
  created = false,
  actionPosts = 0,
  adminReads = 0,
  submitted: unknown;
const commands: unknown[] = [];
const world = {
  id: W,
  prompt: "村の設定",
  createdAt: "2026-10-19T00:00:00.000Z",
  state: "ready",
  at: 0,
  target: 0,
  hasParticipant: true,
  error: null,
  publication: {
    title: "村",
    description: "",
    published: false,
    accepting: false,
  },
};
let player: z.infer<typeof PlayerStatus>, run: z.infer<typeof PlayRun> | null;
let scene: z.infer<typeof SceneStatus> | null;
const sceneFixture = (
  state: z.infer<typeof SceneStatus>["state"] = "active",
): z.infer<typeof SceneStatus> => ({
  id: W,
  requestId: W,
  viewerId: V,
  at: 0,
  state,
  synopsis: "道端で村民と向き合うシーンです。",
  result: null,
  error: null,
  messages: [],
  actions: [],
  recordIds: [],
  nextPurpose: null,
});
const json = (body: Parameters<typeof HttpResponse.json>[0], status = 200) =>
  HttpResponse.json(body, {
    status,
    headers: { "X-Gestaloka-Subject": identity },
  });
class Source {
  static instances: Source[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  constructor(readonly url: string) {
    Source.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  update(id = "1") {
    for (const fn of this.listeners.get("update") ?? [])
      fn({
        data: JSON.stringify({ id, worldId: W, type: "invalidate" }),
        lastEventId: id,
      } as MessageEvent);
  }
}
class Observer {
  constructor(readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [
        {
          target,
          borderBoxSize: [{ inlineSize: 620, blockSize: 500 }],
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

const server = setupServer(
  http.post("*/api/worlds/:id/presence", async ({ request }) => {
    const body = (await request.json()) as {
      connectionId: string;
      active: boolean;
    };
    return json({
      ...body,
      kind: "human",
      expiresAt: new Date(Date.now() + 90000).toISOString(),
    });
  }),
  http.get("*/api/worlds/:id/scene/inbox", () =>
    json({ viewerId: V, items: [], invitations: [], next: null }),
  ),
  http.get("*/api/account", () =>
    json({ member: { id: identity, role: "admin", banned: false } }),
  ),
  http.post("*/api/operations", async ({ request }) => {
    const body = (await request.json()) as { command: { operation: string } };
    return json({
      result:
        body.command.operation === "worldBudgets.read"
          ? {
              version: 1,
              limitUsd: 20,
              upperCostUsd: 0,
              since: "2026-10-21T00:00:00Z",
              historyScope: "all",
            }
          : {
              items:
                body.command.operation === "worlds.list" && created
                  ? [{ id: W }]
                  : [],
              next: null,
            },
    });
  }),
  http.get("*/api/catalog/worlds", () => json({ items: [], next: null })),
  http.get("*/api/session", () =>
    hasSession
      ? json({ id: identity })
      : json({ code: "SESSION_REQUIRED", message: "必要です" }, 401),
  ),
  http.get("*/api/worlds", () => json(created ? [{ id: W }] : [])),
  http.post("*/api/worlds", async ({ request }) => {
    submitted = await request.json();
    created = true;
    return json(world, 202);
  }),
  http.get("*/api/worlds/:id", () => json(world)),
  http.post("*/api/worlds/:id/commands", async ({ request }) => {
    commands.push(await request.json());
    return json(world, 202);
  }),
  http.get("*/api/worlds/:id/cursor", () => json({ cursor: "0" })),
  http.get("*/api/worlds/:id/records", () => {
    adminReads++;
    return json({
      items: [
        {
          id: "initial",
          at: 0,
          summary: "PRIVATE_ADMIN",
          continuation: null,
          counts: { nodes: 1, edges: 1 },
        },
      ],
      next: null,
      previous: null,
    });
  }),
  http.get("*/api/worlds/:id/play", () => json(player)),
  http.get("*/api/worlds/:id/scene", () => json({ scene })),
  http.get("*/api/worlds/:id/scene/records", ({ request }) => {
    const actions = new URL(request.url).searchParams.get("kind") === "actions";
    return json({
      viewerId: V,
      items: actions
        ? (scene?.actions ?? [])
            .map((a) => ({
              ...a,
              at: null,
              kind: "action",
              continuation: null,
            }))
            .reverse()
        : (scene?.messages ?? [])
            .map((m) => ({ ...m, at: 0, kind: "message", continuation: null }))
            .reverse(),
      next: null,
      previous: null,
    });
  }),
  http.post("*/api/worlds/:id/scene", async ({ request }) => {
    const body = (await request.json()) as {
      requestId: string;
      command: string;
      actionText?: string;
    };
    submitted = body;
    if (body.command === "prepare")
      scene = { ...sceneFixture("ready"), id: body.requestId };
    else if (body.command === "start") scene = { ...scene!, state: "active" };
    else if (body.command === "act") {
      actionPosts++;
      scene = {
        ...scene!,
        state: "acting",
        actions: [
          ...scene!.actions,
          { id: body.requestId, text: body.actionText!, state: "running" },
        ],
      };
    } else if (body.command === "finish")
      scene = { ...scene!, state: "reflecting" };
    scene = { ...scene!, requestId: body.requestId };
    return json({ scene }, 202);
  }),
  http.get("*/api/worlds/:id/knowledge", () =>
    json({
      viewerId: V,
      at: 0,
      items: [{ id: V, kind: "observation", text: "公開された景色", from: 0 }],
      next: null,
      previous: null,
    }),
  ),
  http.post("*/api/worlds/:id/actions", async ({ request }) => {
    actionPosts++;
    const body = (await request.json()) as {
      requestId: string;
      actionText: string;
    };
    submitted = body;
    player = { ...player, runId: body.requestId, state: "running" };
    run = {
      id: body.requestId,
      worldId: W,
      viewerId: V,
      actionText: body.actionText,
      startedAt: 0,
      at: 0,
      state: "running",
      error: null,
    };
    return json(player, 202);
  }),
  http.get("*/api/runs/:id", () => json(run)),
  http.get("http://localhost/api/health", () =>
    HttpResponse.json({ service: "gestaloka", status: "ok" }),
  ),
);
beforeAll(async () => {
  server.listen({ onUnhandledRequest: "error" });
  await import("../../apps/web/src/screens.js");
});
beforeEach(() => {
  identity = A;
  hasSession = true;
  created = false;
  actionPosts = 0;
  adminReads = 0;
  submitted = undefined;
  commands.length = 0;
  run = null;
  scene = null;
  player = {
    id: W,
    viewerId: V,
    runId: null,
    state: "ready",
    at: 0,
    error: null,
  };
  localStorage.clear();
  resetSession();
  Source.instances = [];
  vi.stubGlobal("EventSource", Source);
  vi.stubGlobal("ResizeObserver", Observer);
  vi.stubGlobal("scrollTo", vi.fn());
  HTMLElement.prototype.scrollTo = function (
    options?: ScrollToOptions | number,
    y?: number,
  ) {
    this.scrollTop =
      typeof options === "number" ? (y ?? options) : (options?.top ?? 0);
  };
});
afterEach(() => {
  cleanup();
  resetSession();
  server.resetHandlers();
  vi.unstubAllGlobals();
});
afterAll(() => server.close());

test("Reactを描画し、生成されたHTTPクライアント型を通信に使用できる", async () => {
  const { api } = await import("../../apps/web/src/api.js");
  render(
    <App
      surface="admin"
      navigation={createAppRouter(
        createMemoryHistory({ initialEntries: ["/"] }),
      )}
    />,
  );
  await screen.findByRole("heading", { name: "世界を始める" });
  const { data } = await api.GET("/api/health", {
    baseUrl: "http://localhost",
  });
  expect(data?.status).toBe("ok");
});

test("進行の受付直後は状態の再取得まで次の構築操作を有効にしない", async () => {
  let accepted = false,
    refetching = false,
    release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.get("*/api/worlds/:id", async () => {
      if (accepted) {
        refetching = true;
        await gate;
      }
      return json({ ...world, state: accepted ? "running" : "ready" });
    }),
    http.post("*/api/worlds/:id/commands", () => {
      accepted = true;
      return json({ ...world, state: "running" }, 202);
    }),
  );
  render(
    <App
      surface="admin"
      navigation={createAppRouter(
        createMemoryHistory({ initialEntries: [`/worlds/${W}`] }),
      )}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "試遊を進める" }));
  try {
    await waitFor(() => expect(refetching).toBe(true));
    expect(
      (
        screen.getByRole("button", {
          name: "世界構築を完了する",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  } finally {
    release();
  }
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "世界構築を完了する" }),
    ).toBeNull(),
  );
});

test("未認証では匿名セッションを作らずログインへ案内する", async () => {
  hasSession = false;
  render(
    <App
      navigation={createAppRouter(
        createMemoryHistory({ initialEntries: ["/"] }),
      )}
    />,
  );
  expect(
    (
      await screen.findByRole("link", { name: "ログイン・利用登録へ" })
    ).getAttribute("href"),
  ).toBe("/auth/register");
  expect(screen.queryByRole("heading", { name: "世界を始める" })).toBeNull();
});

test("一般ユーザーは公開一覧を開き、管理アプリでは管理用データを取得しない", async () => {
  server.use(
    http.get("*/api/account", () =>
      json({ member: { id: identity, role: "user", banned: false } }),
    ),
  );
  const user = render(
    <App
      navigation={createAppRouter(
        createMemoryHistory({ initialEntries: ["/"] }),
      )}
    />,
  );
  await screen.findByRole("heading", { name: "参加する世界を選ぶ" });
  expect(screen.queryByLabelText("世界の初期設定")).toBeNull();
  expect(screen.queryByRole("link", { name: "管理画面" })).toBeNull();
  user.unmount();
  render(
    <App
      surface="admin"
      navigation={createAppRouter(
        createMemoryHistory({ initialEntries: [`/worlds/${W}`] }),
      )}
    />,
  );
  await screen.findByRole("alert");
  expect(screen.getByText("管理者の権限が必要です。")).toBeTruthy();
  expect(adminReads).toBe(0);
});

test("選択した人物をシーン・知識・配信の照会と送信へ引き継ぐ", async () => {
  const scoped: string[] = [];
  server.events.on("request:start", ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith(`/api/worlds/${W}/`))
      scoped.push(url.searchParams.get("actorId") ?? "");
  });
  render(
    <App
      navigation={createAppRouter(
        createMemoryHistory({
          initialEntries: [`/worlds/${W}/play?actorId=${V}`],
        }),
      )}
    />,
  );
  const input = await screen.findByLabelText("次のシーンで何をしたいですか");
  fireEvent.change(input, { target: { value: "道を歩く" } });
  fireEvent.click(
    screen.getByRole("button", { name: "シーンのあらすじを準備する" }),
  );
  await screen.findByRole("button", { name: "シーンを始める" });
  expect(scoped.length).toBeGreaterThan(3);
  expect(scoped.every((id) => id === V)).toBe(true);
  expect(
    Source.instances
      .filter((s) => !s.closed)
      .every((s) => s.url.includes(`actorId=${V}`)),
  ).toBe(true);
  server.events.removeAllListeners("request:start");
});

test("初期入力を改変せず受付し、同じ世界の管理画面へ進む", async () => {
  render(
    <App
      surface="admin"
      navigation={createAppRouter(
        createMemoryHistory({ initialEntries: ["/"] }),
      )}
    />,
  );
  const field = await screen.findByLabelText("世界の初期設定"),
    text = "山と川のある村。\n村民として参加する。";
  fireEvent.change(field, { target: { value: text } });
  fireEvent.change(screen.getByLabelText("この世界の予算上限（USD）"), {
    target: { value: "20" },
  });
  fireEvent.click(screen.getByRole("button", { name: "初期世界を生成する" }));
  await screen.findByRole("heading", { name: "世界構築" });
  expect(submitted).toMatchObject({ prompt: text, budgetUsd: 20 });
});

test("IMEの確定を送信にせず、本人の入力と公開知識だけを表示する", async () => {
  scene = sceneFixture();
  render(
    <App
      navigation={createAppRouter(
        createMemoryHistory({ initialEntries: [`/worlds/${W}/play`] }),
      )}
    />,
  );
  const field = await screen.findByLabelText("どう行動しますか");
  const text = "周囲を見渡す。\n返答を待つ。";
  fireEvent.change(field, { target: { value: text } });
  fireEvent.compositionStart(field);
  fireEvent.keyDown(field, {
    key: "Enter",
    ctrlKey: true,
    keyCode: 229,
    isComposing: true,
  });
  fireEvent.compositionEnd(field);
  expect(actionPosts).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "この行動を送る" }));
  await waitFor(() => expect(actionPosts).toBe(1));
  expect(submitted).toMatchObject({ actionText: text });
  await screen.findByText(
    (_content, element) =>
      element?.tagName === "P" && element.textContent === text,
  );
  expect(adminReads).toBe(0);
  expect(document.body.textContent).not.toContain("PRIVATE_ADMIN");
});

test("応答の主体が変わった場合は旧キャッシュと画面を破棄する", async () => {
  render(
    <App
      navigation={createAppRouter(
        createMemoryHistory({ initialEntries: [`/worlds/${W}/play`] }),
      )}
    />,
  );
  await screen.findByRole("heading", { name: "村民として" });
  await waitFor(() =>
    expect(Source.instances.some((source) => !source.closed)).toBe(true),
  );
  identity = B;
  Source.instances.find((source) => !source.closed)!.update();
  await screen.findByRole("button", { name: "世界一覧から開く" });
  expect(screen.queryByRole("heading", { name: "村民として" })).toBeNull();
});

test("あらすじを読んで開始し、確定後だけリザルトを表示する", async () => {
  render(
    <App
      navigation={createAppRouter(
        createMemoryHistory({ initialEntries: [`/worlds/${W}/play`] }),
      )}
    />,
  );
  const purpose = await screen.findByLabelText("次のシーンで何をしたいですか");
  fireEvent.change(purpose, { target: { value: "道端で村人と話す" } });
  fireEvent.click(
    screen.getByRole("button", { name: "シーンのあらすじを準備する" }),
  );
  await screen.findByRole("heading", { name: "シーンのあらすじ" });
  expect(screen.queryByLabelText("どう行動しますか")).toBeNull();
  expect(actionPosts).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "シーンを始める" }));
  await screen.findByLabelText("どう行動しますか");
  fireEvent.click(
    screen.getByRole("button", { name: "シーンを終えてリザルトを見る" }),
  );
  await screen.findByText("このシーンが世界に残した影響をまとめています。");
  expect(screen.queryByRole("heading", { name: "リザルト" })).toBeNull();
  scene = { ...scene!, state: "reflecting", result: "まだ表示できない候補" };
  Source.instances.find((s) => !s.closed)!.update("1");
  await waitFor(() => expect(submitted).toMatchObject({ command: "finish" }));
  expect(screen.queryByText("まだ表示できない候補")).toBeNull();
  scene = {
    ...scene!,
    state: "paused",
    error: "1操作の処理上限に達しました。再開すると枠を追加します。",
  };
  Source.instances.find((s) => !s.closed)!.update("2");
  await screen.findByText(
    "1操作の処理上限に達しました。再開すると枠を追加します。",
  );
  expect(
    screen.getByRole("button", { name: "保存したシーンから再開する" }),
  ).toBeTruthy();
  expect(screen.queryByText("まだ表示できない候補")).toBeNull();
  scene = {
    ...scene!,
    state: "result",
    result: "村民へ質問が届き、相談の続きが残りました。",
  };
  Source.instances.find((s) => !s.closed)!.update("3");
  await screen.findByRole("heading", { name: "リザルト" });
  expect(
    screen.getByText("村民へ質問が届き、相談の続きが残りました。"),
  ).toBeTruthy();
  expect(actionPosts).toBe(0);
});

test("共有は明示選択し、顔ぶれの確定後もあらすじを読んで開始する", async () => {
  const heartbeats: boolean[] = [];
  server.use(
    http.post("*/api/worlds/:id/presence", async ({ request }) => {
      const body = (await request.json()) as {
        connectionId: string;
        active: boolean;
      };
      heartbeats.push(body.active);
      return json({
        ...body,
        kind: "human",
        expiresAt: new Date(Date.now() + 90000).toISOString(),
      });
    }),
    http.post("*/api/worlds/:id/scene", async ({ request }) => {
      const body = (await request.json()) as {
        requestId: string;
        command: string;
        shared?: boolean;
      };
      submitted = body;
      scene = {
        ...sceneFixture("preparing"),
        requestId: body.requestId,
        synopsis: null,
        shared: {
          owner: true,
          requestIds: [body.requestId],
          phase: "inviting",
          pending: 2,
          deadline: new Date(Date.now() + 60000).toISOString(),
        },
      };
      return json({ scene }, 202);
    }),
  );
  const view = render(
    <App
      navigation={createAppRouter(
        createMemoryHistory({ initialEntries: [`/worlds/${W}/play`] }),
      )}
    />,
  );
  const shared = (await screen.findByLabelText(
    "共有シーンとして参加を求める",
  )) as HTMLInputElement;
  expect(shared.checked).toBe(false);
  fireEvent.click(shared);
  fireEvent.change(screen.getByLabelText("次のシーンで何をしたいですか"), {
    target: { value: "近くの相手と話す" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "シーンのあらすじを準備する" }),
  );
  await screen.findByText(
    "同席の返答を待っています。回答が揃うか、締切を迎えたらあらすじを準備します。",
  );
  expect(submitted).toMatchObject({ command: "prepare", shared: true });
  expect(screen.queryByRole("button", { name: "シーンを始める" })).toBeNull();
  await waitFor(() => expect(heartbeats).toContain(true));
  scene = {
    ...scene!,
    state: "ready",
    synopsis: "参加者が確定した場面",
    shared: { ...scene!.shared!, phase: "settled", pending: 0 },
  };
  Source.instances.find((s) => !s.closed)!.update();
  await screen.findByRole("button", { name: "シーンを始める" });
  expect(screen.queryByLabelText("どう行動しますか")).toBeNull();
  view.unmount();
  await waitFor(() => expect(heartbeats).toContain(false));
});

test("参加回答を送信前に保存し、応答喪失後は同じ要求で照合する", async () => {
  const replies: {
    requestId: string;
    command: string;
    invitationId: string;
    accept: boolean;
  }[] = [];
  const invitation = {
    id: W,
    sceneId: W,
    deadline: new Date(Date.now() + 60000).toISOString(),
    context: ["自分が見聞きした状況"],
  };
  server.use(
    http.get("*/api/worlds/:id/scene/inbox", () =>
      json({
        viewerId: V,
        items: [],
        invitations: replies.length ? [] : [invitation],
        next: null,
      }),
    ),
    http.post("*/api/worlds/:id/scene", async ({ request }) => {
      const body = (await request.json()) as (typeof replies)[number];
      replies.push(body);
      scene = {
        ...sceneFixture("ready"),
        shared: {
          owner: false,
          requestIds: [body.requestId],
          phase: "settled",
          pending: 0,
          deadline: null,
        },
      };
      return replies.length === 1 ? HttpResponse.error() : json({ scene }, 202);
    }),
  );
  render(
    <App
      navigation={createAppRouter(
        createMemoryHistory({ initialEntries: [`/worlds/${W}/play`] }),
      )}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "同席する" }));
  const retry = await screen.findByRole("button", {
    name: "同じ参加回答で確認する",
  });
  expect(Object.keys(localStorage).some((k) => k.includes("invite"))).toBe(
    true,
  );
  fireEvent.click(retry);
  await waitFor(() => expect(replies).toHaveLength(2));
  expect(replies[0]).toEqual(replies[1]);
  await screen.findByRole("heading", { name: "シーンのあらすじ" });
  expect(screen.queryByRole("button", { name: "シーンを始める" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "同じ参加回答で確認する" }),
  ).toBeNull();
});

test("共有の退出後は次の準備欄を表示し、終了待ちのシーンにも戻れる", async () => {
  const posts: { requestId: string; command: string }[] = [];
  scene = {
    ...sceneFixture(),
    shared: {
      owner: false,
      requestIds: [],
      phase: "settled",
      pending: 0,
      deadline: null,
    },
  };
  server.use(
    http.get("*/api/worlds/:id/scene/inbox", () =>
      json({
        viewerId: V,
        invitations: [],
        next: null,
        items: [{ id: "1", sceneId: B, kind: "result" }],
      }),
    ),
    http.post("*/api/worlds/:id/scene", async ({ request }) => {
      const body = (await request.json()) as (typeof posts)[number];
      posts.push(body);
      scene = {
        ...scene!,
        requestId: body.requestId,
        departed: true,
        shared: { ...scene!.shared!, requestIds: [body.requestId] },
      };
      return json({ scene }, 202);
    }),
  );
  render(
    <App
      navigation={createAppRouter(
        createMemoryHistory({ initialEntries: [`/worlds/${W}/play`] }),
      )}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "この場から退出する" }),
  );
  await screen.findByLabelText("次のシーンで何をしたいですか");
  expect(posts).toHaveLength(1);
  expect(posts[0]!.command).toBe("leave");
  expect(screen.queryByLabelText("どう行動しますか")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "シーンを終えてリザルトを見る" }),
  ).toBeNull();
  fireEvent.click(screen.getByText("シーンの通知と記録"));
  expect(
    screen
      .getByRole("link", { name: "別のシーンの記録を開く" })
      .getAttribute("href"),
  ).toBe(`/worlds/${W}/play?actorId=${V}&sceneId=${B}`);
});

test("シーンIDを指定して元の終了操作を行い、確定待ちでも次を開始できる", async () => {
  let target: string | null = null;
  scene = {
    ...sceneFixture(),
    departed: true,
    shared: {
      owner: true,
      requestIds: [],
      phase: "settled",
      pending: 0,
      deadline: null,
    },
  };
  server.use(
    http.post("*/api/worlds/:id/scene", async ({ request }) => {
      target = new URL(request.url).searchParams.get("sceneId");
      const body = (await request.json()) as {
        requestId: string;
        command: string;
      };
      scene = {
        ...scene!,
        state: "reflecting",
        requestId: body.requestId,
        waitingFor: [B],
        shared: { ...scene!.shared!, requestIds: [body.requestId] },
      };
      return json({ scene }, 202);
    }),
  );
  render(
    <App
      navigation={createAppRouter(
        createMemoryHistory({
          initialEntries: [`/worlds/${W}/play?sceneId=${W}`],
        }),
      )}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "元のシーンを終えてリザルトを見る",
    }),
  );
  await waitFor(() => expect(target).toBe(W));
  expect(screen.getByLabelText("次のシーンで何をしたいですか")).toBeTruthy();
  expect(screen.getByRole("link", { name: "現在のシーンへ戻る" })).toBeTruthy();
});

test("SSEの重複を無視し、切断後は配信位置とスナップショットを取得し直す", async () => {
  let reads = 0,
    cursors = 0;
  server.use(
    http.get("*/api/worlds/:id/play", () => {
      reads++;
      return json(player);
    }),
    http.get("*/api/worlds/:id/cursor", () => {
      cursors++;
      return json({ cursor: cursors === 1 ? "0" : "10" });
    }),
  );
  render(
    <App
      navigation={createAppRouter(
        createMemoryHistory({ initialEntries: [`/worlds/${W}/play`] }),
      )}
    />,
  );
  await waitFor(() => expect(Source.instances.length).toBe(1));
  const source = Source.instances[0]!;
  source.update("1");
  await waitFor(() => expect(reads).toBeGreaterThan(1));
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "村民として" })).toBeTruthy(),
  );
  const before = reads;
  source.update("1");
  expect(reads).toBe(before);
  source.onerror?.();
  await waitFor(() => expect(Source.instances.length).toBe(2), {
    timeout: 3000,
  });
  expect(source.closed).toBe(true);
  expect(Source.instances[1]!.url).toContain("after=10");
  expect(cursors).toBe(2);
  expect(reads).toBeGreaterThan(before);
});

test("構築期間は日数で入力し、端数を送信せず整数の日数を受け付ける", async () => {
  render(
    <App
      surface="admin"
      navigation={createAppRouter(
        createMemoryHistory({ initialEntries: [`/worlds/${W}`] }),
      )}
    />,
  );
  const field = await screen.findByLabelText("さらに進める日数");
  expect((field as HTMLInputElement).value).toBe("1");
  fireEvent.change(field, { target: { value: "0.5" } });
  fireEvent.submit(field.closest("form")!);
  await screen.findByText("1日以上の整数で入力してください");
  expect(commands).toHaveLength(0);
  fireEvent.change(field, { target: { value: "2" } });
  fireEvent.submit(field.closest("form")!);
  await waitFor(() => expect(commands).toHaveLength(1));
  expect(commands[0]).toMatchObject({
    command: "advance",
    duration: WORLD_DAY_MS * 2,
  });
});
