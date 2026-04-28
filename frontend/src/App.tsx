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
          <aside
            className="sticky bottom-4 z-10 mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm leading-5 text-destructive shadow-sm"
            data-testid="error-banner"
          >
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
