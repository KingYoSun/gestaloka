import { FormEvent, useEffect, useRef, useState } from "react";
import keycloak from "./lib/keycloak";

type AppRoute = "game" | "admin";

type AuthMe = {
  sub: string;
  email: string;
  name: string;
  preferred_username: string;
};

type HealthPayload = {
  status: string;
  database: string;
  projection: {
    backend: string;
    space: string;
    pending_outbox: number;
    failed_outbox: number;
    projected_outbox: number;
    projection_records: number;
    graph_read_mode: string;
    last_error: string | null;
  };
  projection_runtime: {
    graph_runtime_status: string;
    graph_runtime_error: string | null;
  };
  sp: {
    default_balance: number;
    turn_cost: number;
    economy_status: string;
  };
  oidc_mode: string;
};

type SessionInfo = {
  session_id: string;
  world_id: string;
  player_actor_id: string;
  npc_actor_id: string;
  location_id: string;
  websocket_url: string;
};

type TurnResponse = {
  turn_id: string;
  event_id: string;
  memory_ids: string[];
  narrative: string;
  npc_reaction: string;
  sp_delta: number;
  sp_balance: number;
  sp_ledger_id: string;
};

type EventItem = {
  id: string;
  narrative: string;
  event_type: string;
  location_id: string | null;
  payload: Record<string, unknown>;
};

type MemoryItem = {
  id: string;
  scope: string;
  text: string;
  actor_id: string | null;
  location_id: string | null;
  salience: number;
};

type SPLedgerItem = {
  id: string;
  user_sub: string;
  world_id: string | null;
  actor_id: string | null;
  delta: number;
  reason_code: string;
  reference_type: string;
  reference_id: string;
  balance_after: number;
  created_by_sub: string | null;
  note: string | null;
  created_at: string;
};

type SPWallet = {
  user_sub: string;
  balance: number;
  turn_cost: number;
  recent_entries: SPLedgerItem[];
};

type ProjectionStatus = {
  backend: string;
  space: string;
  pending: number;
  failed: number;
  projected: number;
  last_error: string | null;
  graph_read_mode: string;
  graph_runtime_status: string;
  recent_failures: Array<{
    id: string;
    event_id: string;
    world_id: string;
    projection_type: string;
    last_error: string | null;
    attempts: number;
  }>;
};

type GraphSummary = {
  world_id: string;
  vertex_count: number;
  edge_count: number;
  recent_records: Array<{
    entity_key: string;
    projection_type: string;
    kind: string;
    label: string;
  }>;
  neighborhood_summary: string[];
};

type RebuildSummary = {
  world_id: string;
  records: number;
  completed_at: string;
  vertex_count: number;
  edge_count: number;
};

type SPOverview = {
  default_balance: number;
  turn_cost: number;
  total_accounts: number;
  total_ledger_entries: number;
  recent_adjustments: SPLedgerItem[];
};

type SPAdjustmentResponse = {
  ledger_entry_id: string;
  user_sub: string;
  delta: number;
  balance: number;
};

type ActivityMessage = {
  event: string;
  data: Record<string, unknown>;
};

type APIError = Error & {
  status?: number;
  body?: unknown;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

function resolveRoute(): AppRoute {
  return window.location.pathname.startsWith("/admin") ? "admin" : "game";
}

async function apiFetch<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? undefined);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    let body: unknown = null;
    let message = `Request failed: ${response.status}`;
    if (contentType.includes("application/json")) {
      body = (await response.json()) as unknown;
      if (typeof body === "object" && body !== null && "detail" in body) {
        const detail = (body as { detail?: unknown }).detail;
        if (typeof detail === "string") {
          message = detail;
        }
      }
    } else {
      const text = await response.text();
      if (text) {
        message = text;
      }
    }
    const error = new Error(message) as APIError;
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return (await response.json()) as T;
}

function formatError(error: unknown): string {
  const typed = error as APIError;
  if (typed.status === 409 && typed.body && typeof typed.body === "object") {
    const body = typed.body as {
      detail?: string;
      balance?: number;
      required?: number;
      turn_cost?: number;
    };
    if (typeof body.detail === "string") {
      return `${body.detail} (balance: ${body.balance ?? "?"}, required: ${body.required ?? body.turn_cost ?? "?"})`;
    }
  }
  if (typed.message) {
    return typed.message;
  }
  return String(error);
}

function App() {
  const [route, setRoute] = useState<AppRoute>(() => resolveRoute());
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [token, setToken] = useState("");
  const [me, setMe] = useState<AuthMe | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [wallet, setWallet] = useState<SPWallet | null>(null);
  const [worldId, setWorldId] = useState("world-alpha");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [turnInput, setTurnInput] = useState("広場で旅人を助け、周囲の様子を確かめる");
  const [latestNarrative, setLatestNarrative] = useState("");
  const [latestReaction, setLatestReaction] = useState("");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [activity, setActivity] = useState<ActivityMessage[]>([]);
  const [projectionStatus, setProjectionStatus] = useState<ProjectionStatus | null>(null);
  const [graphSummary, setGraphSummary] = useState<GraphSummary | null>(null);
  const [spOverview, setSpOverview] = useState<SPOverview | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<SPLedgerItem[]>([]);
  const [opsState, setOpsState] = useState("idle");
  const [lastRebuild, setLastRebuild] = useState<RebuildSummary | null>(null);
  const [lastAdjustment, setLastAdjustment] = useState<SPAdjustmentResponse | null>(null);
  const [ledgerUserFilter, setLedgerUserFilter] = useState("");
  const [ledgerWorldFilter, setLedgerWorldFilter] = useState("");
  const [adjustUserSub, setAdjustUserSub] = useState("");
  const [adjustDelta, setAdjustDelta] = useState("-1");
  const [adjustReason, setAdjustReason] = useState("admin_adjustment");
  const [adjustWorldId, setAdjustWorldId] = useState("");
  const [adjustNote, setAdjustNote] = useState("Phase E admin adjustment");
  const [error, setError] = useState("");
  const [turnPending, setTurnPending] = useState(false);
  const [rebuildPending, setRebuildPending] = useState(false);
  const [adjustPending, setAdjustPending] = useState(false);
  const [socketState, setSocketState] = useState("idle");
  const socketRef = useRef<WebSocket | null>(null);

  const statusText = !ready ? "initializing" : authenticated ? "authenticated" : "signed-out";
  const activeWorldId = session?.world_id ?? worldId;

  useEffect(() => {
    const handlePopState = () => setRoute(resolveRoute());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    void refreshHealth();

    keycloak
      .init({
        onLoad: "check-sso",
        pkceMethod: "S256",
      })
      .then((isAuthenticated: boolean) => {
        setAuthenticated(isAuthenticated);
        setToken(keycloak.token ?? "");
      })
      .catch((initError: unknown) => {
        setError(String(initError));
      })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!authenticated || !token) {
      setMe(null);
      setWallet(null);
      setProjectionStatus(null);
      setGraphSummary(null);
      setSpOverview(null);
      setLedgerEntries([]);
      setOpsState("idle");
      return;
    }

    void Promise.all([apiFetch<AuthMe>("/auth/me", token), apiFetch<SPWallet>("/economy/sp/me", token)])
      .then(([mePayload, walletPayload]) => {
        setMe(mePayload);
        setWallet(walletPayload);
        setLedgerUserFilter((current) => current || walletPayload.user_sub);
        setAdjustUserSub((current) => current || walletPayload.user_sub);
      })
      .catch((requestError: unknown) => setError(formatError(requestError)));
  }, [authenticated, token]);

  useEffect(() => {
    setAdjustWorldId(session?.world_id ?? worldId);
  }, [session, worldId]);

  useEffect(() => {
    if (!session || !token) {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      setSocketState("idle");
      return;
    }

    setSocketState("connecting");
    const socket = new WebSocket(`${session.websocket_url}?token=${encodeURIComponent(token)}`);
    socket.onopen = () => setSocketState("open");
    socket.onmessage = (message) => {
      const parsed = JSON.parse(message.data) as ActivityMessage;
      setActivity((current) => [parsed, ...current].slice(0, 20));
      if (parsed.event === "turn.resolved") {
        const data = parsed.data as Partial<TurnResponse>;
        if (data.narrative) {
          setLatestNarrative(data.narrative);
        }
        if (data.npc_reaction) {
          setLatestReaction(data.npc_reaction);
        }
      }
      if (parsed.event === "graph.projection.updated") {
        void refreshAdminData(token, session.world_id, ledgerUserFilter, ledgerWorldFilter || session.world_id);
      }
    };
    socket.onerror = () => {
      setSocketState("error");
      setError("WebSocket connection failed");
    };
    socket.onclose = () => {
      setSocketState("closed");
    };
    socketRef.current = socket;

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [session, token, ledgerUserFilter, ledgerWorldFilter]);

  async function refreshHealth() {
    try {
      const payload = await apiFetch<HealthPayload>("/health");
      setHealth(payload);
    } catch {
      setHealth(null);
    }
  }

  async function refreshWallet(currentToken: string) {
    const payload = await apiFetch<SPWallet>("/economy/sp/me", currentToken);
    setWallet(payload);
    return payload;
  }

  async function refreshWorldState(currentSession: SessionInfo, currentToken: string) {
    const [eventsResponse, memoriesResponse] = await Promise.all([
      apiFetch<{ items: EventItem[] }>(`/worlds/${currentSession.world_id}/events`, currentToken),
      apiFetch<{ items: MemoryItem[] }>(`/worlds/${currentSession.world_id}/memories`, currentToken),
    ]);
    setEvents(eventsResponse.items);
    setMemories(memoriesResponse.items);
  }

  async function refreshAdminData(
    currentToken: string,
    currentWorldId?: string,
    currentLedgerUserFilter?: string,
    currentLedgerWorldFilter?: string,
  ) {
    if (!currentToken) {
      setProjectionStatus(null);
      setGraphSummary(null);
      setSpOverview(null);
      setLedgerEntries([]);
      setOpsState("idle");
      return;
    }

    try {
      const [statusPayload, overviewPayload, ledgerPayload] = await Promise.all([
        apiFetch<ProjectionStatus>("/ops/projection/status", currentToken),
        apiFetch<SPOverview>("/ops/sp/overview", currentToken),
        apiFetch<{ items: SPLedgerItem[] }>(
          `/ops/sp/ledger?limit=20${currentLedgerUserFilter ? `&user_sub=${encodeURIComponent(currentLedgerUserFilter)}` : ""}${currentLedgerWorldFilter ? `&world_id=${encodeURIComponent(currentLedgerWorldFilter)}` : ""}`,
          currentToken,
        ),
      ]);
      setProjectionStatus(statusPayload);
      setSpOverview(overviewPayload);
      setLedgerEntries(ledgerPayload.items);
      setOpsState("ready");
    } catch (requestError) {
      const typedError = requestError as APIError;
      if (typedError.status === 403) {
        setOpsState("restricted");
        setProjectionStatus(null);
        setGraphSummary(null);
        setSpOverview(null);
        setLedgerEntries([]);
        return;
      }
      setOpsState("unavailable");
      setProjectionStatus(null);
      setGraphSummary(null);
      setSpOverview(null);
      setLedgerEntries([]);
      return;
    }

    if (!currentWorldId) {
      setGraphSummary(null);
      return;
    }

    try {
      const summaryPayload = await apiFetch<GraphSummary>(`/ops/worlds/${currentWorldId}/graph-summary`, currentToken);
      setGraphSummary(summaryPayload);
    } catch (requestError) {
      const typedError = requestError as APIError;
      if (typedError.status === 403) {
        setOpsState("restricted");
      } else {
        setOpsState("unavailable");
      }
      setGraphSummary(null);
    }
  }

  function navigate(nextRoute: AppRoute) {
    const path = nextRoute === "admin" ? "/admin" : "/";
    window.history.pushState({}, "", path);
    setRoute(nextRoute);
  }

  async function handleLogin() {
    await keycloak.login();
  }

  async function handleLogout() {
    await keycloak.logout({ redirectUri: `${window.location.origin}/` });
  }

  async function handleStartSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError("Sign in before starting a world session");
      return;
    }

    try {
      setError("");
      setActivity([]);
      setLatestNarrative("");
      setLatestReaction("");
      setLastRebuild(null);
      const created = await apiFetch<SessionInfo>("/sessions", token, {
        method: "POST",
        body: JSON.stringify({
          world_id: worldId,
          world_name: "Founders Reach",
        }),
      });
      setSession(created);
      setLedgerWorldFilter(created.world_id);
      setAdjustWorldId(created.world_id);
      await Promise.all([
        refreshWorldState(created, token),
        refreshWallet(token),
        refreshAdminData(token, created.world_id, ledgerUserFilter || me?.sub, created.world_id),
        refreshHealth(),
      ]);
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }

  async function handleTurnSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !session) {
      setError("Start a session first");
      return;
    }

    try {
      setTurnPending(true);
      setError("");
      const response = await apiFetch<TurnResponse>("/turns", token, {
        method: "POST",
        body: JSON.stringify({
          session_id: session.session_id,
          input_text: turnInput,
        }),
      });
      setLatestNarrative(response.narrative);
      setLatestReaction(response.npc_reaction);
      setWallet((current) =>
        current
          ? {
              ...current,
              balance: response.sp_balance,
            }
          : current,
      );
      await Promise.all([
        refreshWorldState(session, token),
        refreshWallet(token),
        refreshAdminData(token, session.world_id, ledgerUserFilter || me?.sub, ledgerWorldFilter || session.world_id),
        refreshHealth(),
      ]);
    } catch (requestError) {
      setError(formatError(requestError));
      await Promise.all([
        refreshWallet(token),
        refreshAdminData(token, session.world_id, ledgerUserFilter || me?.sub, ledgerWorldFilter || session.world_id),
        refreshHealth(),
      ]);
    } finally {
      setTurnPending(false);
    }
  }

  async function handleRebuildGraph() {
    if (!token || !activeWorldId) {
      setError("Choose a world before rebuilding the graph");
      return;
    }

    try {
      setRebuildPending(true);
      setError("");
      const rebuilt = await apiFetch<RebuildSummary>("/ops/projection/rebuild", token, {
        method: "POST",
        body: JSON.stringify({ world_id: activeWorldId }),
      });
      setLastRebuild(rebuilt);
      setActivity((current) => [
        { event: "ops.projection.rebuild", data: rebuilt as unknown as Record<string, unknown> },
        ...current,
      ].slice(0, 20));
      await Promise.all([
        refreshAdminData(token, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId),
        refreshHealth(),
      ]);
    } catch (requestError) {
      setError(formatError(requestError));
    } finally {
      setRebuildPending(false);
    }
  }

  async function handleLedgerRefresh(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }
    try {
      setError("");
      await refreshAdminData(token, activeWorldId, ledgerUserFilter, ledgerWorldFilter);
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }

  async function handleAdjustmentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError("Sign in before applying adjustments");
      return;
    }

    try {
      setAdjustPending(true);
      setError("");
      const response = await apiFetch<SPAdjustmentResponse>("/ops/sp/adjustments", token, {
        method: "POST",
        body: JSON.stringify({
          user_sub: adjustUserSub,
          delta: Number(adjustDelta),
          reason_code: adjustReason,
          world_id: adjustWorldId || null,
          actor_id: null,
          note: adjustNote || null,
        }),
      });
      setLastAdjustment(response);
      await Promise.all([
        refreshWallet(token),
        refreshAdminData(token, activeWorldId, ledgerUserFilter || adjustUserSub, ledgerWorldFilter || adjustWorldId),
        refreshHealth(),
      ]);
    } catch (requestError) {
      setError(formatError(requestError));
    } finally {
      setAdjustPending(false);
    }
  }

  useEffect(() => {
    if (route !== "admin" || !token) {
      return;
    }
    void refreshAdminData(token, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId);
  }, [route, token, activeWorldId]);

  return (
    <main className="shell">
      <header className="hero">
        <div className="hero-top">
          <div>
            <p className="eyebrow">GESTALOKA v2</p>
            <h1>Same-world runtime stabilization</h1>
            <p className="lede">
              OIDC login, one-world turn play, SP debit and refund rules, Nebula projection monitoring, and
              admin adjustments now live in the same v2 runtime.
            </p>
          </div>
          <nav className="route-nav">
            <button data-testid="nav-game" className={route === "game" ? "nav-pill active" : "nav-pill"} onClick={() => navigate("game")}>
              Game
            </button>
            <button data-testid="nav-admin" className={route === "admin" ? "nav-pill active" : "nav-pill"} onClick={() => navigate("admin")}>
              Admin
            </button>
          </nav>
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
            SP balance: {wallet?.balance ?? "unknown"} / Turn cost: {wallet?.turn_cost ?? health?.sp.turn_cost ?? "?"}
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
              World ID
              <input
                data-testid="world-id-input"
                value={worldId}
                onChange={(event) => setWorldId(event.target.value)}
              />
            </label>
            <button data-testid="start-session" type="submit" disabled={!authenticated}>
              Start session
            </button>
          </form>
          {session ? (
            <dl className="meta">
              <div>
                <dt>World</dt>
                <dd>{session.world_id}</dd>
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

        {route === "game" ? (
          <>
            <article className="card wide">
              <h2>3. Turn submission</h2>
              <form onSubmit={handleTurnSubmit} className="stack">
                <label>
                  Player action
                  <textarea
                    data-testid="turn-input"
                    rows={4}
                    value={turnInput}
                    onChange={(event) => setTurnInput(event.target.value)}
                  />
                </label>
                <button data-testid="submit-turn" type="submit" disabled={!session || turnPending}>
                  {turnPending ? "Submitting..." : "Submit turn"}
                </button>
              </form>
              <div className="result">
                <h3>Latest narrative</h3>
                <p data-testid="latest-narrative">{latestNarrative || "No turn resolved yet."}</p>
                <h3>Latest NPC reaction</h3>
                <p data-testid="latest-reaction">{latestReaction || "No NPC reaction yet."}</p>
              </div>
            </article>

            <article className="card">
              <h2>4. Results</h2>
              <h3>Events</h3>
              <ul className="stream" data-testid="events-stream">
                {events.map((item) => (
                  <li key={item.id}>
                    <strong>{item.event_type}</strong>
                    <span>{item.narrative}</span>
                    <span>location: {item.location_id ?? "none"}</span>
                  </li>
                ))}
              </ul>
              <h3>Memories</h3>
              <ul className="stream" data-testid="memories-stream">
                {memories.map((item) => (
                  <li key={item.id}>
                    <strong>{item.scope}</strong>
                    <span>{item.text}</span>
                    <span>location: {item.location_id ?? "none"}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="card wide">
              <h2>Realtime stream</h2>
              <ul className="stream" data-testid="ops-stream">
                {activity.map((item, index) => (
                  <li key={`${item.event}-${index}`}>
                    <strong>{item.event}</strong>
                    <span>{JSON.stringify(item.data)}</span>
                  </li>
                ))}
              </ul>
            </article>
          </>
        ) : (
          <>
            <article className="card wide">
              <h2>Projection runtime</h2>
              <p data-testid="ops-status">Ops access: {opsState}</p>
              <p>
                Backend: {projectionStatus?.backend ?? health?.projection.backend ?? "unknown"} / Graph read:{" "}
                {projectionStatus?.graph_read_mode ?? health?.projection.graph_read_mode ?? "unknown"} / Runtime:{" "}
                <span data-testid="graph-runtime-status">
                  {projectionStatus?.graph_runtime_status ?? health?.projection_runtime.graph_runtime_status ?? "unknown"}
                </span>
              </p>
              <p>
                Space: {projectionStatus?.space ?? health?.projection.space ?? "unknown"} / Pending:{" "}
                {projectionStatus?.pending ?? health?.projection.pending_outbox ?? "unknown"} / Failed:{" "}
                {projectionStatus?.failed ?? health?.projection.failed_outbox ?? "unknown"} / Projected:{" "}
                {projectionStatus?.projected ?? health?.projection.projected_outbox ?? "unknown"}
              </p>
              <p data-testid="graph-vertex-count">
                Graph vertices: {graphSummary?.vertex_count ?? 0} / edges:{" "}
                <span data-testid="graph-edge-count">{graphSummary?.edge_count ?? 0}</span>
              </p>
              <div className="actions">
                <button
                  data-testid="refresh-admin"
                  onClick={() => void refreshAdminData(token, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId)}
                  disabled={!token}
                >
                  Refresh admin
                </button>
                <button
                  data-testid="rebuild-graph"
                  onClick={handleRebuildGraph}
                  disabled={!token || rebuildPending || opsState !== "ready"}
                >
                  {rebuildPending ? "Rebuilding..." : "Rebuild graph"}
                </button>
              </div>
              {lastRebuild ? (
                <p data-testid="rebuild-result">
                  Rebuilt {lastRebuild.records} records at {lastRebuild.completed_at}
                </p>
              ) : null}
              <h3>Neighborhood summary</h3>
              <ul className="stream" data-testid="graph-summary-stream">
                {(graphSummary?.neighborhood_summary ?? []).map((item) => (
                  <li key={item}>
                    <strong>context</strong>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <h3>Recent runtime failures</h3>
              <ul className="stream" data-testid="recent-failures-stream">
                {(projectionStatus?.recent_failures ?? []).map((item) => (
                  <li key={item.id}>
                    <strong>{item.projection_type}</strong>
                    <span>{item.world_id}</span>
                    <span>{item.last_error ?? "no error text"}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="card">
              <h2>SP overview</h2>
              <p data-testid="sp-overview">
                Accounts: {spOverview?.total_accounts ?? 0} / Ledger rows: {spOverview?.total_ledger_entries ?? 0}
              </p>
              <p>
                Default balance: {spOverview?.default_balance ?? health?.sp.default_balance ?? "?"} / Turn cost:{" "}
                <span data-testid="turn-cost">{spOverview?.turn_cost ?? health?.sp.turn_cost ?? "?"}</span>
              </p>
              {lastAdjustment ? (
                <p data-testid="last-adjustment">
                  Last adjustment: {lastAdjustment.delta} to {lastAdjustment.user_sub}, balance {lastAdjustment.balance}
                </p>
              ) : null}
              <h3>Recent adjustments</h3>
              <ul className="stream" data-testid="recent-adjustments-stream">
                {(spOverview?.recent_adjustments ?? []).map((item) => (
                  <li key={item.id}>
                    <strong>{item.reason_code}</strong>
                    <span>{item.user_sub}</span>
                    <span>{item.delta}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="card wide">
              <h2>Ledger filters</h2>
              <form className="stack compact-form" onSubmit={handleLedgerRefresh}>
                <label>
                  User sub
                  <input
                    data-testid="ledger-user-filter"
                    value={ledgerUserFilter}
                    onChange={(event) => setLedgerUserFilter(event.target.value)}
                  />
                </label>
                <label>
                  World ID
                  <input
                    data-testid="ledger-world-filter"
                    value={ledgerWorldFilter}
                    onChange={(event) => setLedgerWorldFilter(event.target.value)}
                  />
                </label>
                <button data-testid="refresh-ledger" type="submit" disabled={!token}>
                  Refresh ledger
                </button>
              </form>
              <ul className="stream" data-testid="admin-ledger">
                {ledgerEntries.map((item) => (
                  <li key={item.id}>
                    <strong>{item.reason_code}</strong>
                    <span>{item.user_sub}</span>
                    <span>
                      delta {item.delta} / balance {item.balance_after}
                    </span>
                    <span>{item.world_id ?? "global"}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="card wide">
              <h2>Adjustment form</h2>
              <form className="stack compact-form" onSubmit={handleAdjustmentSubmit}>
                <label>
                  User sub
                  <input
                    data-testid="adjust-user-sub"
                    value={adjustUserSub}
                    onChange={(event) => setAdjustUserSub(event.target.value)}
                  />
                </label>
                <label>
                  Delta
                  <input
                    data-testid="adjust-delta"
                    value={adjustDelta}
                    onChange={(event) => setAdjustDelta(event.target.value)}
                  />
                </label>
                <label>
                  Reason code
                  <input
                    data-testid="adjust-reason"
                    value={adjustReason}
                    onChange={(event) => setAdjustReason(event.target.value)}
                  />
                </label>
                <label>
                  World ID
                  <input
                    data-testid="adjust-world-id"
                    value={adjustWorldId}
                    onChange={(event) => setAdjustWorldId(event.target.value)}
                  />
                </label>
                <label>
                  Note
                  <textarea
                    data-testid="adjust-note"
                    rows={3}
                    value={adjustNote}
                    onChange={(event) => setAdjustNote(event.target.value)}
                  />
                </label>
                <button data-testid="submit-adjustment" type="submit" disabled={!token || adjustPending}>
                  {adjustPending ? "Applying..." : "Apply adjustment"}
                </button>
              </form>
            </article>
          </>
        )}
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
