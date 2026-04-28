import { AppShell } from "./components/ui/AppShell";
import { PlayerPage } from "./features/player/PlayerPage";
import { useGestalokaRuntime } from "./hooks/useGestalokaRuntime";

function App() {
  const runtime = useGestalokaRuntime();
  const { error } = runtime;

  return (
    <AppShell
      header={null}
      error={
        error ? (
          <aside className="error" data-testid="error-banner">
            {error}
          </aside>
        ) : null
      }
    >
      <PlayerPage runtime={runtime} />
    </AppShell>
  );
}

export default App;
