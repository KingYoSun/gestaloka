import { BookOpenText, Settings } from "lucide-react";
import { AppShell } from "./components/ui/AppShell";
import { RouteTabs } from "./components/ui/RouteTabs";
import { AdminPage } from "./features/admin/AdminPage";
import { PlayerPage } from "./features/player/PlayerPage";
import { useGestalokaRuntime } from "./hooks/useGestalokaRuntime";

function App() {
  const runtime = useGestalokaRuntime();
  const { route, navigate, error } = runtime;
  const header =
    route === "admin" ? (
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand-block">
            <p className="eyebrow">GESTALOKA</p>
            <h1>運用</h1>
          </div>
          <RouteTabs
            items={[
              {
                active: false,
                icon: <BookOpenText className="nav-icon" aria-hidden="true" />,
                label: "物語",
                onClick: () => navigate("game"),
                testId: "nav-game",
              },
              {
                active: route === "admin",
                icon: <Settings className="nav-icon" aria-hidden="true" />,
                label: "運用",
                onClick: () => navigate("admin"),
                testId: "nav-admin",
              },
            ]}
          />
        </div>
      </header>
    ) : null;

  return (
    <AppShell
      header={header}
      error={
        error ? (
          <aside className="error" data-testid="error-banner">
            {error}
          </aside>
        ) : null
      }
    >
      {route === "game" ? <PlayerPage runtime={runtime} /> : <AdminPage runtime={runtime} />}
    </AppShell>
  );
}

export default App;
