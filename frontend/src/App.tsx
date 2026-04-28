import { Cpu, Gamepad2 } from "lucide-react";
import { RouteTabs } from "./components/ui/RouteTabs";
import { AdminPage } from "./features/admin/AdminPage";
import { PlayerPage } from "./features/player/PlayerPage";
import { useGestalokaRuntime } from "./hooks/useGestalokaRuntime";

function App() {
  const runtime = useGestalokaRuntime();
  const {
    route,
    ready,
    authenticated,
    me,
    health,
    wallet,
    worldId,
    setWorldId,
    playableWorlds,
    worldCatalogStatus,
    session,
    statusText,
    socketState,
    worldCatalogUnavailable,
    selectedWorld,
    handleLogin,
    handleLogout,
    handleStartSession,
    navigate,
    error,
  } = runtime;

  return (
    <main className="shell">
      <header className="hero">
        <div className="hero-top">
          <div>
            <p className="eyebrow">GESTALOKA v2</p>
            <h1>Same-world release gate runtime</h1>
            <p className="lede">
              OIDC login, one-world turn play, SP debit rules, Nebula projection monitoring, and eval-driven
              release gating now share the same v2 runtime surface.
            </p>
          </div>
          <RouteTabs
            items={[
              {
                active: route === "game",
                icon: <Gamepad2 className="nav-icon" aria-hidden="true" />,
                label: "Game",
                onClick: () => navigate("game"),
                testId: "nav-game",
              },
              {
                active: route === "admin",
                icon: <Cpu className="nav-icon" aria-hidden="true" />,
                label: "Admin",
                onClick: () => navigate("admin"),
                testId: "nav-admin",
              },
            ]}
          />
        </div>
      </header>

      <section className="grid">
        <article className="card">
          <h2>1. Login</h2>
          <p data-testid="auth-status">Status: {statusText}</p>
          <p data-testid="api-health">
            API health: {health?.status ?? "unreachable"} / DB: {health?.database ?? "unknown"}
          </p>
          <p data-testid="socket-status">Socket: {socketState}</p>
          <p data-testid="sp-balance">
            SP balance: {wallet?.balance ?? "unknown"} / Choice cost:{" "}
            {wallet?.choice_turn_cost ?? health?.sp?.choice_turn_cost ?? wallet?.turn_cost ?? health?.sp?.turn_cost ?? "?"} / Free text cost:{" "}
            {wallet?.free_text_turn_cost ?? health?.sp?.free_text_turn_cost ?? "?"}
          </p>
          <p data-testid="sp-budget-note">
            SP is execution budget only. It is not in-world currency and does not buy quest, faction, or item power.
          </p>
          {me ? (
            <dl className="meta">
              <div>
                <dt>Name</dt>
                <dd>{me.name}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{me.email}</dd>
              </div>
              <div>
                <dt>Sub</dt>
                <dd>{me.sub}</dd>
              </div>
            </dl>
          ) : (
            <p>Use the demo Keycloak user to enter the v2 slice.</p>
          )}
          <div className="actions">
            <button data-testid="sign-in" onClick={handleLogin} disabled={!ready || authenticated}>
              Sign in
            </button>
            <button data-testid="sign-out" onClick={handleLogout} disabled={!authenticated}>
              Sign out
            </button>
          </div>
        </article>

        <article className="card">
          <h2>2. World start</h2>
          <form onSubmit={handleStartSession} className="stack">
            <label>
              World
              <select
                data-testid="world-select"
                value={worldId}
                onChange={(event) => setWorldId(event.target.value)}
                disabled={worldCatalogUnavailable || !playableWorlds.length}
              >
                <option value="" disabled>
                  Select a world
                </option>
                {playableWorlds.map((item) => (
                  <option key={item.world_id} value={item.world_id} disabled={item.status !== "playable"}>
                    {item.display_name}
                  </option>
                ))}
              </select>
            </label>
            <button
              data-testid="start-session"
              type="submit"
              disabled={!authenticated || worldCatalogUnavailable || !selectedWorld || selectedWorld.status !== "playable"}
            >
              Start session
            </button>
          </form>
          <p data-testid="world-catalog-status">World catalog: {worldCatalogStatus}</p>
          {session ? (
            <dl className="meta">
              <div>
                <dt>World</dt>
                <dd>
                  {session.world_name} ({session.world_id})
                </dd>
              </div>
              <div>
                <dt>Pack</dt>
                <dd data-testid="session-pack">
                  {session.world_context.pack_display_name} ({session.pack_id}) / {session.world_context.world_template_display_name}
                </dd>
              </div>
              <div>
                <dt>Session</dt>
                <dd>{session.session_id}</dd>
              </div>
              <div>
                <dt>Guide NPC</dt>
                <dd>{session.npc_actor_id}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd data-testid="session-location">{session.location_id}</dd>
              </div>
            </dl>
          ) : (
            <p>No session started yet.</p>
          )}
        </article>

        {route === "game" ? <PlayerPage runtime={runtime} /> : <AdminPage runtime={runtime} />}
      </section>

      {error ? (
        <aside className="error" data-testid="error-banner">
          {error}
        </aside>
      ) : null}
    </main>
  );
}
export default App;
