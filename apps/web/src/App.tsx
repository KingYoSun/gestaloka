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
import { Button } from "./components/ui/button.js";
import { Notice } from "./presentation.js";

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
  return (
    <>
      <header className="site-header">
        <Link to="/" className="brand" aria-label="gestaloka 世界一覧">
          <Brand />
        </Link>
        <nav>
          <Link to="/">世界一覧</Link>
          <a href="/auth/claim">このブラウザーのデータを引き継ぐ</a>
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
  return <Manage key={id} id={id} />;
}
function PlayerRoute() {
  const { id } = useParams({ from: "/worlds/$id/play" });
  return <Player key={id} id={id} />;
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
  createRoute({ getParentRoute: () => root, path: "/", component: Home }),
  createRoute({
    getParentRoute: () => root,
    path: "/worlds/$id",
    component: ManageRoute,
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/worlds/$id/play",
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
      <RouterProvider router={navigation} />
    </QueryClientProvider>
  );
}
export function App({
  navigation = router,
}: {
  navigation?: ReturnType<typeof createAppRouter>;
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
    <Authorized key={`${state.id}:${state.epoch}`} navigation={navigation} />
  );
}
