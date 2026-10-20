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
  http.get("*/api/session", () =>
    hasSession
      ? json({ id: identity })
      : json({ code: "SESSION_REQUIRED", message: "必要です" }, 401),
  ),
  http.post("*/api/session", () => {
    hasSession = true;
    return json({ id: identity });
  }),
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
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  identity = A;
  hasSession = false;
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

test("初期入力を改変せず受付し、同じ世界の管理画面へ進む", async () => {
  render(
    <App
      navigation={createAppRouter(
        createMemoryHistory({ initialEntries: ["/"] }),
      )}
    />,
  );
  const field = await screen.findByLabelText("世界の初期設定"),
    text = "山と川のある村。\n村民として参加する。";
  fireEvent.change(field, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "初期世界を生成する" }));
  await screen.findByRole("heading", { name: "世界構築" });
  expect(submitted).toMatchObject({ prompt: text });
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
