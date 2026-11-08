// @vitest-environment jsdom
import {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
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
} from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createMemoryHistory } from "@tanstack/react-router";
import { Operation } from "@gestaloka/contracts";
import { App, createAppRouter } from "../../apps/web/src/App.js";
import { resetSession, getSession } from "../../apps/web/src/api.js";
import { userApp } from "../../apps/web/src/surface.js";
import { catalog, userOperations } from "../../apps/web/src/admin-catalog.js";
const A = "00000000-0000-4000-8000-000000000001";
const json = (value: Record<string, unknown>, status = 200) =>
  HttpResponse.json(value, { status, headers: { "X-Gestaloka-Subject": A } });
const server = setupServer(
  http.get("*/api/session", () => json({ id: A })),
  http.get("*/api/account", () =>
    json({ member: { id: A, role: "admin", banned: false } }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  localStorage.clear();
  resetSession();
  vi.stubGlobal("scrollTo", vi.fn());
});
afterEach(() => {
  cleanup();
  resetSession();
  server.resetHandlers();
  vi.unstubAllGlobals();
});
afterAll(() => server.close());
const show = (section: string) =>
  render(
    <App
      surface="admin"
      navigation={createAppRouter(
        createMemoryHistory({ initialEntries: [`/operations/${section}`] }),
      )}
    />,
  );
const choose = async (name: string) =>
  fireEvent.change(await screen.findByLabelText("操作を選択"), {
    target: { value: name },
  });

test("共通操作一覧は全て管理画面または本人の画面に対応する", () => {
  expect([...Object.keys(catalog), ...userOperations].sort()).toEqual(
    Operation.options.map((s) => s.shape.operation.value).sort(),
  );
});

test("ログインを維持して、発行した招待と公開中の資料を一つのAI向け案内にまとめる", async () => {
  const copy = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
  server.use(
    http.get("*/api/player-cli/latest", () =>
      HttpResponse.json({
        version: "0.7.0",
        node: "^24.22.1",
        sha256: "a".repeat(64),
        sizeBytes: 1,
        downloadUrl: "/api/player-cli/download/cli.tgz",
        setupUrl: "/api/player-cli/docs/0.7.0/setup.md",
      }),
    ),
    http.post("*/api/operations", async ({ request }) => {
      const body = (await request.json()) as { command: { operation: string } };
      return json({
        result:
          body.command.operation === "invites.create"
            ? { token: "private-invitation" }
            : {},
      });
    }),
  );
  show("invites");
  await choose("invites.create");
  fireEvent.change(screen.getByLabelText("有効期限"), {
    target: { value: "2030-01-01T12:00" },
  });
  fireEvent.change(screen.getByLabelText("利用可能回数"), {
    target: { value: "1" },
  });
  fireEvent.change(screen.getByLabelText("操作の理由"), {
    target: { value: "参加を案内する" },
  });
  fireEvent.click(screen.getByRole("button", { name: "内容を確認する" }));
  fireEvent.click(screen.getByRole("button", { name: "この内容で実行する" }));
  const button = await screen.findByRole("button", {
    name: "AIに渡す参加案内をコピー",
  });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  fireEvent.change(screen.getByLabelText("参加する世界のページ"), {
    target: {
      value: "https://example.test/worlds/00000000-0000-4000-8000-000000000001",
    },
  });
  fireEvent.submit(button.closest("form")!);
  await waitFor(() => expect(copy).toHaveBeenCalledOnce());
  const url = new URL(String(copy.mock.calls[0]![0]).split("\n").at(-1)!);
  expect(url.origin).toBe(new URL(userApp).origin);
  expect(url.pathname).toBe("/api/player-cli/docs/0.7.0/join.md");
  expect(url.searchParams.get("world")).toBe(A);
  expect(url.searchParams.has("invitation")).toBe(false);
  expect(new URLSearchParams(url.hash.slice(1)).get("invitation")).toBe(
    "private-invitation",
  );
  expect(getSession().id).toBe(A);
});
test("キーの応答喪失後は要求IDから復帰し、値をブラウザーに保存せず二重送信しない", async () => {
  let posts = 0,
    id = "";
  server.use(
    http.post("*/api/operations", async ({ request }) => {
      const body = (await request.json()) as {
        requestId: string;
        command: { operation: string; id?: string };
      };
      if (body.command.operation === "models.read")
        return json({
          result: { version: 0, configuration: null, credentials: [] },
        });
      if (body.command.operation === "credentials.put") {
        posts++;
        id = body.requestId;
        return HttpResponse.error();
      }
      return json({
        result: {
          id: body.command.id,
          state: posts ? "accepted" : "unreceived",
          result: posts ? { provider: "anthropic", version: 1 } : null,
        },
      });
    }),
  );
  show("models");
  await choose("credentials.put");
  fireEvent.change(screen.getByLabelText("APIサービス"), {
    target: { value: "anthropic" },
  });
  fireEvent.change(screen.getByLabelText("新しいAPIキー"), {
    target: { value: "fixture-secret-value" },
  });
  fireEvent.change(screen.getByLabelText("操作の理由"), {
    target: { value: "キーの設定" },
  });
  fireEvent.click(screen.getByRole("button", { name: "内容を確認する" }));
  expect(screen.queryByText("fixture-secret-value")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "この内容で実行する" }));
  await waitFor(() => expect(posts).toBe(1));
  expect(JSON.stringify(localStorage)).not.toContain("fixture-secret-value");
  cleanup();
  show("models");
  await choose("credentials.put");
  await screen.findByRole("button", { name: "別の操作を始める" });
  expect(screen.getByText(id)).toBeTruthy();
  expect(
    (screen.getByLabelText("新しいAPIキー") as HTMLInputElement).value,
  ).toBe("");
  expect(posts).toBe(1);
});
test("長い一覧はページを入れ替え、再送では保存した内容と要求IDを維持する", async () => {
  const sent: string[] = [],
    accepted = new Map<string, unknown>();
  server.use(
    http.post("*/api/operations", async ({ request }) => {
      const b = (await request.json()) as {
        requestId: string;
        command: { operation: string; id?: string; before?: string };
      };
      if (b.command.operation === "users.list")
        return json({
          result: {
            items: [{ id: A, role: "user" }],
            next: b.command.before ? null : A,
          },
        });
      if (b.command.operation === "requests.read")
        return json({
          result: {
            state: accepted.has(b.command.id!) ? "accepted" : "pending",
            result: accepted.get(b.command.id!) ?? null,
          },
        });
      sent.push(JSON.stringify(b));
      if (sent.length === 1)
        return json({ code: "TEMPORARY", message: "通信中断" }, 503);
      accepted.set(b.requestId, { member: { id: A, role: "admin" } });
      return json({ result: accepted.get(b.requestId) });
    }),
  );
  show("users");
  fireEvent.click(
    await screen.findByRole("button", { name: "次のページを取得" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "次のページを取得" }),
    ).toBeNull(),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "この記録を入力に使う" }),
  );
  fireEvent.change(screen.getByLabelText("操作の理由"), {
    target: { value: "管理者を任命する" },
  });
  fireEvent.click(screen.getByRole("button", { name: "内容を確認する" }));
  fireEvent.click(screen.getByRole("button", { name: "この内容で実行する" }));
  await screen.findByText("通信中断");
  cleanup();
  show("users");
  await choose("users.role");
  fireEvent.click(
    await screen.findByRole("button", { name: "同じ要求で再送する" }),
  );
  await screen.findByRole("button", { name: "別の操作を始める" });
  expect(sent[0]).toBe(sent[1]);
});
test("世界差分は対象と理由を別に確認し、JSONから別操作へ切り替えられない", async () => {
  const commands: unknown[] = [];
  server.use(
    http.post("*/api/operations", async ({ request }) => {
      const b = (await request.json()) as { command: { operation: string } };
      if (b.command.operation === "worlds.edit") commands.push(b.command);
      return json({
        result:
          b.command.operation === "requests.read"
            ? { state: "pending" }
            : { items: [], next: null },
      });
    }),
  );
  show("worlds");
  await choose("worlds.edit");
  fireEvent.change(screen.getByLabelText("世界ID"), { target: { value: A } });
  fireEvent.change(screen.getByLabelText("操作の理由"), {
    target: { value: "世界への変更理由" },
  });
  const diff = {
    at: 0,
    dependencies: [],
    changes: { nodes: [], edges: [], revisions: [], endEdges: [] },
  };
  fireEvent.change(screen.getByLabelText("LLMが作成したJSON差分"), {
    target: { value: JSON.stringify({ ...diff, operation: "backups.create" }) },
  });
  fireEvent.click(screen.getByRole("button", { name: "内容を確認する" }));
  expect(commands).toHaveLength(0);
  expect(
    screen.queryByRole("button", { name: "この内容で実行する" }),
  ).toBeNull();
  fireEvent.change(screen.getByLabelText("LLMが作成したJSON差分"), {
    target: { value: JSON.stringify(diff) },
  });
  fireEvent.click(screen.getByRole("button", { name: "内容を確認する" }));
  expect(screen.getByRole("region", { name: "操作内容の確認" })).toBeTruthy();
  expect(commands).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "この内容で実行する" }));
  await waitFor(() => expect(commands).toHaveLength(1));
  expect(commands[0]).toMatchObject({
    operation: "worlds.edit",
    worldId: A,
    reason: "世界への変更理由",
    ...diff,
  });
});
