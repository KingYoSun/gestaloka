import {
  useEffect,
  useState,
  useSyncExternalStore,
  lazy,
  Suspense,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useParams,
  type RouterHistory,
} from "@tanstack/react-router";
import { Moon, Sun } from "lucide-react";
import { z } from "zod";
import logo from "../../../designs/logo.png";
import {
  ApiFailure,
  getSession,
  openSession,
  resetSession,
  subscribeSession,
} from "./api.js";
const Home = lazy(() =>
  import("./screens.js").then((module) => ({ default: module.Home })),
);
const Manage = lazy(() =>
  import("./screens.js").then((module) => ({ default: module.Manage })),
);
const Player = lazy(() =>
  import("./screens.js").then((module) => ({ default: module.Player })),
);
const AdminOperations = lazy(() =>
  import("./admin.js").then((m) => ({ default: m.AdminOperations })),
);
import { Button } from "./components/ui/button.js";
import { Notice, Problem } from "./presentation.js";
import { $api } from "./api.js";
import {
  SurfaceContext,
  useSurface,
  userApp,
  adminApp,
  type Surface,
} from "./surface.js";
const Catalog = lazy(() =>
  import("./participation.js").then((m) => ({ default: m.Catalog })),
);
const Participation = lazy(() =>
  import("./participation.js").then((m) => ({ default: m.Participation })),
);

function ThemeButton() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("gestaloka-theme");
    return saved
      ? saved === "dark"
      : (window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("gestaloka-theme", dark ? "dark" : "light");
  }, [dark]);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={
        dark ? "ライトモードに切り替える" : "ダークモードに切り替える"
      }
      onClick={() => setDark((value) => !value)}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
function Brand() {
  return (
    <>
      <img src={logo} alt="" className="brand-image" />
      <span>gestaloka</span>
    </>
  );
}
function Shell() {
  const surface = useSurface();
  const account = $api.useQuery("get", "/api/account");
  return (
    <>
      <header className="site-header">
        <Link to="/" className="brand" aria-label="gestaloka 世界一覧">
          <Brand />
        </Link>
        <nav>
          <Link to="/">世界一覧</Link>
          {surface === "admin" && (
            <Link to="/operations/$section" params={{ section: "users" }}>
              運用管理
            </Link>
          )}
          {surface === "admin" ? (
            <a href={userApp}>ユーザー画面</a>
          ) : account.data?.member?.role === "admin" ? (
            <a href={adminApp}>管理画面</a>
          ) : null}
          <a href="/auth/claim">このブラウザーのデータを引き継ぐ</a>
          <a href="/auth/link">ログイン方法を追加</a>
          <a href="/auth/logout">ログアウト</a>
          <ThemeButton />
        </nav>
      </header>
      <Suspense
        fallback={
          <main className="page">
            <Notice>画面を読み込んでいます</Notice>
          </main>
        }
      >
        <Outlet />
      </Suspense>
    </>
  );
}
function ManageRoute() {
  const { id } = useParams({ from: "/worlds/$id" });
  return useSurface() === "admin" ? (
    <Manage key={id} id={id} />
  ) : (
    <Participation key={id} id={id} />
  );
}
function HomeRoute() {
  return useSurface() === "admin" ? <Home /> : <Catalog />;
}
function OperationsRoute() {
  const { section } = useParams({ from: "/operations/$section" });
  return useSurface() === "admin" ? (
    <AdminOperations key={section} section={section} />
  ) : (
    <main className="page">
      <p role="alert">管理者の画面から開いてください。</p>
    </main>
  );
}
function PlayerRoute() {
  const { id } = useParams({ from: "/worlds/$id/play" });
  return useSurface() === "user" ? (
    <Player key={id} id={id} />
  ) : (
    <main className="page">
      <a href={`${userApp}/worlds/${id}/play`}>ユーザー画面で開く</a>
    </main>
  );
}
const root = createRootRoute({
  component: Shell,
  notFoundComponent: () => (
    <main className="page">
      <h1>ページが見つかりません</h1>
      <Link to="/" className="text-link">
        世界一覧へ
      </Link>
    </main>
  ),
});
const routeTree = root.addChildren([
  createRoute({
    getParentRoute: () => root,
    path: "/operations/$section",
    component: OperationsRoute,
  }),
  createRoute({ getParentRoute: () => root, path: "/", component: HomeRoute }),
  createRoute({
    getParentRoute: () => root,
    path: "/worlds/$id",
    component: ManageRoute,
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/worlds/$id/play",
    validateSearch: z.object({ actorId: z.uuid().optional() }).parse,
    component: PlayerRoute,
  }),
]);
export const createAppRouter = (history?: RouterHistory) =>
  createRouter({
    routeTree,
    ...(history ? { history } : {}),
    scrollRestoration: true,
  });
export const router = createAppRouter();
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function Authorized({
  navigation,
}: {
  navigation: ReturnType<typeof createAppRouter>;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (count, error) =>
              count < 2 &&
              (!(error instanceof ApiFailure) || error.status >= 500),
            gcTime: 60000,
          },
        },
      }),
  );
  useEffect(
    () => () => {
      void client.cancelQueries();
      client.clear();
    },
    [client],
  );
  return (
    <QueryClientProvider client={client}>
      <Membership navigation={navigation} />
    </QueryClientProvider>
  );
}
function Membership({
  navigation,
}: {
  navigation: ReturnType<typeof createAppRouter>;
}) {
  const account = $api.useQuery(
    "get",
    "/api/account",
    {},
    { refetchInterval: 5000 },
  );
  const surface = useSurface();
  if (account.error)
    return (
      <main className="page">
        <Problem error={account.error} />
      </main>
    );
  if (!account.data)
    return (
      <main className="page">
        <Notice>利用登録を確認しています</Notice>
      </main>
    );
  if (!account.data.member || account.data.member.banned)
    return (
      <main className="page">
        {account.data.member?.banned && (
          <p role="alert">
            利用が停止されています（BAN）。解除後に保存状態から再開できます。
          </p>
        )}
        <a href="/auth/register">利用登録を確認する</a>
      </main>
    );
  if (surface === "admin" && account.data.member.role !== "admin")
    return (
      <main className="page">
        <p role="alert">管理者の権限が必要です。</p>
        <a href={userApp}>ユーザー画面へ</a>
      </main>
    );
  return (
    <ResourceScope key={account.data.member.role} navigation={navigation} />
  );
}
function ResourceScope({
  navigation,
}: {
  navigation: ReturnType<typeof createAppRouter>;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      }),
  );
  useEffect(
    () => () => {
      void client.cancelQueries();
      client.clear();
    },
    [client],
  );
  return (
    <QueryClientProvider client={client}>
      <RouterProvider router={navigation} />
    </QueryClientProvider>
  );
}
export function App({
  navigation = router,
  surface = "user",
}: {
  navigation?: ReturnType<typeof createAppRouter>;
  surface?: Surface;
}) {
  const state = useSyncExternalStore(subscribeSession, getSession, getSession);
  useEffect(() => {
    if (!state.id && !state.error) void openSession().catch(() => undefined);
  }, [state.id, state.error, state.epoch]);
  if (!state.id)
    return (
      <>
        <header className="site-header">
          <a className="brand" href="/">
            <Brand />
          </a>
          <ThemeButton />
        </header>
        <main className="page connection-page">
          <h1>gestaloka</h1>
          {state.error ? (
            <>
              <p role="alert">{state.error}</p>
              <a className="text-link" href="/auth/register">
                ログイン・利用登録へ
              </a>
              <Button
                onClick={() => {
                  void navigation.navigate({ to: "/" });
                  resetSession();
                }}
              >
                世界一覧から開く
              </Button>
            </>
          ) : (
            <Notice>接続を確認しています</Notice>
          )}
        </main>
      </>
    );
  return (
    <SurfaceContext.Provider value={surface}>
      <Authorized key={`${state.id}:${state.epoch}`} navigation={navigation} />
    </SurfaceContext.Provider>
  );
}
