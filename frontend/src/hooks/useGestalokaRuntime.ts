import { FormEvent, useEffect, useRef, useState } from "react";
import keycloak, { initKeycloak } from "../lib/keycloak";
import { apiFetch, formatError } from "../api/client";
import {
  buildQuery,
  mergeTurnResponseIntoSessionState,
  packContextMatches,
  packFailureSeverityRank,
  packScopeMatches,
  resolveRoute,
  traceMatchesOpsScope,
} from "../domain/runtime";
import type {
  ActivityMessage,
  AmbientBeatOpsItem,
  AppRoute,
  APIError,
  AuthMe,
  ChapterBranchOpsItem,
  ChapterOpsItem,
  ConsequenceThreadOpsItem,
  CouncilTurnTrace,
  EmbeddingStatus,
  EvalRunDetail,
  EvalRunItem,
  EventItem,
  GraphSummary,
  HealthPayload,
  LocationOpsItem,
  MemoryItem,
  MemoryReindexResult,
  MemorySearchResponse,
  NPCLocationSummary,
  NPCRoutineOpsItem,
  ObservabilitySnapshotItem,
  ObservabilitySnapshotList,
  ObservabilitySummary,
  OpsWorldItem,
  OpsWorldPackCatalog,
  PlayableWorldCatalog,
  PlayableWorldItem,
  ProjectionStatus,
  RebuildSummary,
  RelationshipOpsItem,
  ReleaseGateReport,
  RoutePressureOpsItem,
  SceneOpsItem,
  SessionInfo,
  SessionState,
  SPAdjustmentResponse,
  SPLedgerItem,
  SPOverview,
  SPWallet,
  TravelLogItem,
  TurnResponse,
  WorldContext,
  WorldTickItem,
} from "../types";

export function useGestalokaRuntime() {
  const [route, setRoute] = useState<AppRoute>(() => resolveRoute());
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [token, setToken] = useState("");
  const [me, setMe] = useState<AuthMe | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [wallet, setWallet] = useState<SPWallet | null>(null);
  const [worldId, setWorldId] = useState("");
  const [opsWorldId, setOpsWorldId] = useState("");
  const [playableWorlds, setPlayableWorlds] = useState<PlayableWorldItem[]>([]);
  const [worldCatalogStatus, setWorldCatalogStatus] = useState("unknown");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [turnInputMode, setTurnInputMode] = useState<"choice" | "free_text">("choice");
  const [freeTextInput, setFreeTextInput] = useState("広場で旅人を助け、周囲の様子を確かめる");
  const [latestNarrative, setLatestNarrative] = useState("");
  const [latestReaction, setLatestReaction] = useState("");
  const [latestConsequenceSummary, setLatestConsequenceSummary] = useState("");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [activity, setActivity] = useState<ActivityMessage[]>([]);
  const [projectionStatus, setProjectionStatus] = useState<ProjectionStatus | null>(null);
  const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingStatus | null>(null);
  const [graphSummary, setGraphSummary] = useState<GraphSummary | null>(null);
  const [relationshipOps, setRelationshipOps] = useState<RelationshipOpsItem[]>([]);
  const [consequenceThreadOps, setConsequenceThreadOps] = useState<ConsequenceThreadOpsItem[]>([]);
  const [chapterOps, setChapterOps] = useState<ChapterOpsItem[]>([]);
  const [routePressureOps, setRoutePressureOps] = useState<RoutePressureOpsItem[]>([]);
  const [chapterBranchOps, setChapterBranchOps] = useState<ChapterBranchOpsItem[]>([]);
  const [sceneOps, setSceneOps] = useState<SceneOpsItem[]>([]);
  const [locationOps, setLocationOps] = useState<LocationOpsItem[]>([]);
  const [travelLogOps, setTravelLogOps] = useState<TravelLogItem[]>([]);
  const [npcRoutineOps, setNpcRoutineOps] = useState<NPCRoutineOpsItem[]>([]);
  const [ambientBeatOps, setAmbientBeatOps] = useState<AmbientBeatOpsItem[]>([]);
  const [worldTickOps, setWorldTickOps] = useState<WorldTickItem[]>([]);
  const [npcLocationOps, setNpcLocationOps] = useState<NPCLocationSummary[]>([]);
  const [offstageBeatOps, setOffstageBeatOps] = useState<AmbientBeatOpsItem[]>([]);
  const [opsWorlds, setOpsWorlds] = useState<OpsWorldItem[]>([]);
  const [opsPackCatalog, setOpsPackCatalog] = useState<OpsWorldPackCatalog | null>(null);
  const [opsPackFilter, setOpsPackFilter] = useState("");
  const [opsTemplateFilter, setOpsTemplateFilter] = useState("");
  const [observability, setObservability] = useState<ObservabilitySummary | null>(null);
  const [observabilitySnapshots, setObservabilitySnapshots] = useState<ObservabilitySnapshotItem[]>([]);
  const [spOverview, setSpOverview] = useState<SPOverview | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<SPLedgerItem[]>([]);
  const [evalRuns, setEvalRuns] = useState<EvalRunItem[]>([]);
  const [evalRunDetail, setEvalRunDetail] = useState<EvalRunDetail | null>(null);
  const [releaseGate, setReleaseGate] = useState<ReleaseGateReport | null>(null);
  const [councilTurns, setCouncilTurns] = useState<CouncilTurnTrace[]>([]);
  const [opsState, setOpsState] = useState("idle");
  const [lastRebuild, setLastRebuild] = useState<RebuildSummary | null>(null);
  const [lastMemoryReindex, setLastMemoryReindex] = useState<MemoryReindexResult | null>(null);
  const [lastAdjustment, setLastAdjustment] = useState<SPAdjustmentResponse | null>(null);
  const [memorySearchQuery, setMemorySearchQuery] = useState("旅人を助けた");
  const [memorySearchResult, setMemorySearchResult] = useState<MemorySearchResponse | null>(null);
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
  const [memorySearchPending, setMemorySearchPending] = useState(false);
  const [memoryReindexPending, setMemoryReindexPending] = useState(false);
  const [adjustPending, setAdjustPending] = useState(false);
  const [evalPending, setEvalPending] = useState(false);
  const [checklistPending, setChecklistPending] = useState(false);
  const [idlePassPending, setIdlePassPending] = useState(false);
  const [socketState, setSocketState] = useState("idle");
  const socketRef = useRef<WebSocket | null>(null);

  const statusText = !ready ? "initializing" : authenticated ? "authenticated" : "signed-out";
  const activeWorldId = route === "admin" ? (opsWorldId || session?.world_id || worldId) : (session?.world_id ?? worldId);
  const activeQuest = sessionState?.quests.find((item) => item.status === "active") ?? sessionState?.quests[0] ?? null;
  const selectedWorld = playableWorlds.find((item) => item.world_id === worldId) ?? null;
  const worldCatalogUnavailable = worldCatalogStatus === "error";
  const visibleOpsWorlds = opsWorlds.filter((item) => {
    const context = item.world_context;
    return (
      (!opsPackFilter || context.pack_id === opsPackFilter) &&
      (!opsTemplateFilter || context.world_template_id === opsTemplateFilter)
    );
  });
  const opsTemplateOptions = (
    opsPackFilter
      ? (opsPackCatalog?.items.find((item) => item.pack_id === opsPackFilter)?.world_templates ?? [])
      : (opsPackCatalog?.items.flatMap((item) => item.world_templates) ?? [])
  ).filter(
    (template, index, templates) =>
      templates.findIndex((item) => item.template_id === template.template_id) === index,
  );
  const activeWorldContext =
    graphSummary?.world_context ??
    opsWorlds.find((item) => item.world_context.world_id === activeWorldId)?.world_context ??
    sessionState?.world_context ??
    session?.world_context ??
    null;
  const opsScopeLabel = `${opsPackFilter || "all packs"} / ${opsTemplateFilter || "all templates"}`;
  const opsCatalogStatus = opsPackCatalog?.status ?? health?.world_packs?.status ?? "unknown";
  const opsCatalogPackCount = opsPackCatalog?.pack_count ?? health?.world_packs?.pack_count ?? 0;
  const opsCatalogTemplateCount = opsPackCatalog?.template_count ?? health?.world_packs?.template_count ?? 0;
  const opsCatalogFailureCount = opsPackCatalog?.failure_count ?? health?.world_packs?.failure_count ?? 0;
  const selectedAdminWorldLabel = activeWorldContext
    ? `${activeWorldContext.world_name} / ${activeWorldContext.pack_display_name} / ${activeWorldContext.world_template_display_name}`
    : (activeWorldId || "none");
  const sortedOpsPackFailures = [...(opsPackCatalog?.failures ?? [])].sort((left, right) => {
    const severityDelta = packFailureSeverityRank(left.severity) - packFailureSeverityRank(right.severity);
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return `${left.pack_id ?? ""}${left.error}`.localeCompare(`${right.pack_id ?? ""}${right.error}`);
  });
  const filteredReleasePackRegressions = Object.entries(releaseGate?.checks?.pack_regressions ?? {}).filter(([, check]) =>
    packScopeMatches(check.pack_scope, opsPackFilter, opsTemplateFilter),
  );
  const filteredShadowFailures = (releaseGate?.shadow_failures ?? []).filter((item) =>
    packContextMatches(item.pack_context, opsPackFilter, opsTemplateFilter),
  );
  const filteredRecentTraces = (observability?.recent_traces ?? []).filter((item) =>
    traceMatchesOpsScope(item.attributes, opsPackFilter, opsTemplateFilter),
  );
  const visibleObservabilitySnapshots = observabilitySnapshots.filter((item) =>
    packContextMatches(
      {
        pack_id: item.pack_id ?? "",
        world_template_id: item.world_template_id ?? "",
      },
      opsPackFilter,
      opsTemplateFilter,
    ),
  );
  const suggestedChoices = sessionState?.next_choices ?? [];
  const latestRetrievalTrace = (councilTurns[0]?.resolved_output?.retrieval_trace ?? null) as
    | {
        status?: string;
        query_text_hash?: string;
        retrieved_memory_ids?: string[];
        top_scores?: number[];
        used_fallback?: boolean;
      }
    | null;

  useEffect(() => {
    const handlePopState = () => setRoute(resolveRoute());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    void refreshHealth();

    initKeycloak()
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
      setPlayableWorlds([]);
      setWorldCatalogStatus("unknown");
      setSessionState(null);
      setProjectionStatus(null);
      setEmbeddingStatus(null);
      setGraphSummary(null);
      setRelationshipOps([]);
      setConsequenceThreadOps([]);
      setChapterOps([]);
      setRoutePressureOps([]);
      setChapterBranchOps([]);
      setSceneOps([]);
      setLocationOps([]);
      setTravelLogOps([]);
      setNpcRoutineOps([]);
      setAmbientBeatOps([]);
      setWorldTickOps([]);
      setNpcLocationOps([]);
      setOffstageBeatOps([]);
      setOpsWorlds([]);
      setOpsPackCatalog(null);
      setOpsPackFilter("");
      setOpsTemplateFilter("");
      setObservability(null);
      setObservabilitySnapshots([]);
      setSpOverview(null);
      setLedgerEntries([]);
      setEvalRuns([]);
      setEvalRunDetail(null);
      setReleaseGate(null);
      setCouncilTurns([]);
      setMemorySearchResult(null);
      setOpsState("idle");
      return;
    }

    void Promise.all([
      apiFetch<AuthMe>("/auth/me", token),
      apiFetch<SPWallet>("/economy/sp/me", token),
      apiFetch<PlayableWorldCatalog>("/worlds/playable", token),
    ])
      .then(([mePayload, walletPayload, worldPayload]) => {
        setMe(mePayload);
        setWallet(walletPayload);
        setPlayableWorlds(worldPayload.items);
        setWorldCatalogStatus(worldPayload.status);
        if (worldPayload.status === "error") {
          setError("Playable world catalog unavailable");
        }
        const firstPlayableWorld = worldPayload.items.find((item) => item.status === "playable") ?? worldPayload.items[0];
        setWorldId((current) =>
          worldPayload.items.some((item) => item.world_id === current) ? current : (firstPlayableWorld?.world_id ?? ""),
        );
        setLedgerUserFilter((current) => current || walletPayload.user_sub);
        setAdjustUserSub((current) => current || walletPayload.user_sub);
      })
      .catch((requestError: unknown) => setError(formatError(requestError)));
  }, [authenticated, token]);

  useEffect(() => {
    if (!playableWorlds.length || playableWorlds.some((item) => item.world_id === worldId)) {
      return;
    }
    setWorldId(playableWorlds[0].world_id);
  }, [playableWorlds, worldId]);

  useEffect(() => {
    setAdjustWorldId(session?.world_id ?? worldId);
  }, [session, worldId]);

  useEffect(() => {
    if (opsWorldId && visibleOpsWorlds.some((item) => item.world_context.world_id === opsWorldId)) {
      return;
    }
    const sessionWorldIsVisible = visibleOpsWorlds.some((item) => item.world_context.world_id === session?.world_id);
    const nextWorldId = !opsWorlds.length
      ? (session?.world_id ?? "")
      : ((sessionWorldIsVisible ? session?.world_id : visibleOpsWorlds[0]?.world_context.world_id) || "");
    if (nextWorldId !== opsWorldId) {
      setOpsWorldId(nextWorldId);
      setLedgerWorldFilter(nextWorldId);
      setAdjustWorldId(nextWorldId);
    }
  }, [opsWorldId, opsPackFilter, opsTemplateFilter, opsWorlds, session?.world_id]);

  useEffect(() => {
    if (!session || !token) {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      if (!session) {
        setSessionState(null);
      }
      setSocketState("idle");
      return;
    }

    setSocketState("connecting");
    const socket = new WebSocket(`${session.websocket_url}?token=${encodeURIComponent(token)}`);
    socket.onopen = () => setSocketState("open");
    socket.onmessage = (message) => {
      const parsed = JSON.parse(message.data) as ActivityMessage;
      setActivity((current) => [parsed, ...current].slice(0, 40));
      if (parsed.event === "turn.resolved") {
        const data = parsed.data as Partial<TurnResponse>;
        if (data.narrative) {
          setLatestNarrative(data.narrative);
        }
        if (data.npc_reaction) {
          setLatestReaction(data.npc_reaction);
        }
        if (data.consequence_summary) {
          setLatestConsequenceSummary(data.consequence_summary);
        }
        if (data.scene_summary && !latestConsequenceSummary) {
          setLatestConsequenceSummary(data.scene_summary);
        }
      }
      if (parsed.event === "graph.projection.updated") {
        void refreshAdminData(
          token,
          session.world_id,
          ledgerUserFilter,
          ledgerWorldFilter || session.world_id,
          session.session_id,
        );
      }
      if (parsed.event === "idle.updated") {
        void Promise.all([
          refreshWorldState(session, token),
          refreshAdminData(
            token,
            session.world_id,
            ledgerUserFilter,
            ledgerWorldFilter || session.world_id,
            session.session_id,
          ),
        ]);
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
    const [eventsResponse, memoriesResponse, stateResponse] = await Promise.all([
      apiFetch<{ items: EventItem[] }>(`/worlds/${currentSession.world_id}/events`, currentToken),
      apiFetch<{ items: MemoryItem[] }>(`/worlds/${currentSession.world_id}/memories`, currentToken),
      apiFetch<SessionState>(`/sessions/${currentSession.session_id}/state`, currentToken),
    ]);
    setEvents(eventsResponse.items);
    setMemories(memoriesResponse.items);
    setSessionState(stateResponse);
  }

  async function refreshAdminData(
    currentToken: string,
    currentWorldId?: string,
    currentLedgerUserFilter?: string,
    currentLedgerWorldFilter?: string,
    currentSessionId?: string,
    currentPackFilter = opsPackFilter,
    currentTemplateFilter = opsTemplateFilter,
  ) {
    if (!currentToken) {
      setProjectionStatus(null);
      setEmbeddingStatus(null);
      setGraphSummary(null);
      setRelationshipOps([]);
      setConsequenceThreadOps([]);
      setChapterOps([]);
      setRoutePressureOps([]);
      setChapterBranchOps([]);
      setSceneOps([]);
      setObservability(null);
      setObservabilitySnapshots([]);
      setSpOverview(null);
      setLedgerEntries([]);
      setCouncilTurns([]);
      setMemorySearchResult(null);
      setOpsState("idle");
      return;
    }

    try {
      const scopeQuery = {
        pack_id: currentPackFilter,
        world_template_id: currentTemplateFilter,
      };
      const scopedSessionId = currentSessionId && session?.world_id === currentWorldId ? currentSessionId : undefined;
      const [
        statusPayload,
        embeddingPayload,
        observabilityPayload,
        overviewPayload,
        ledgerPayload,
        evalRunsPayload,
        gatePayload,
        councilPayload,
        worldsPayload,
        packCatalogPayload,
      ] = await Promise.all([
        apiFetch<ProjectionStatus>("/ops/projection/status", currentToken),
        apiFetch<EmbeddingStatus>("/ops/memories/status", currentToken),
        apiFetch<ObservabilitySummary>(`/ops/observability/summary${buildQuery(scopeQuery)}`, currentToken),
        apiFetch<SPOverview>("/ops/sp/overview", currentToken),
        apiFetch<{ items: SPLedgerItem[] }>(
          `/ops/sp/ledger?limit=20${currentLedgerUserFilter ? `&user_sub=${encodeURIComponent(currentLedgerUserFilter)}` : ""}${currentLedgerWorldFilter ? `&world_id=${encodeURIComponent(currentLedgerWorldFilter)}` : ""}`,
          currentToken,
        ),
        apiFetch<{ items: EvalRunItem[] }>(`/ops/evals/runs${buildQuery({ limit: 8, ...scopeQuery })}`, currentToken),
        apiFetch<ReleaseGateReport>(`/ops/release/checklists/latest${buildQuery(scopeQuery)}`, currentToken),
        apiFetch<{ items: CouncilTurnTrace[] }>(
          `/ops/council/turns${buildQuery({ limit: 8, world_id: currentWorldId, session_id: scopedSessionId })}`,
          currentToken,
        ),
        apiFetch<{ items: OpsWorldItem[] }>(`/ops/worlds${buildQuery(scopeQuery)}`, currentToken),
        apiFetch<OpsWorldPackCatalog>("/ops/world-packs", currentToken),
      ]);
      const snapshotsPayload = await apiFetch<ObservabilitySnapshotList>(
        `/ops/observability/snapshots${buildQuery({ limit: 12, ...scopeQuery })}`,
        currentToken,
      );
      setProjectionStatus(statusPayload);
      setEmbeddingStatus(embeddingPayload);
      setObservability(observabilityPayload);
      setObservabilitySnapshots(snapshotsPayload.items);
      setSpOverview(overviewPayload);
      setLedgerEntries(ledgerPayload.items);
      setEvalRuns(evalRunsPayload.items);
      const latestEvalRunId = evalRunsPayload.items[0]?.id;
      setEvalRunDetail(
        latestEvalRunId
          ? await apiFetch<EvalRunDetail>(`/ops/evals/runs/${latestEvalRunId}${buildQuery(scopeQuery)}`, currentToken)
          : null,
      );
      setReleaseGate(gatePayload);
      setCouncilTurns(councilPayload.items);
      setOpsWorlds(worldsPayload.items);
      setOpsPackCatalog(packCatalogPayload);
      setOpsState("ready");
    } catch (requestError) {
      const typedError = requestError as APIError;
      if (typedError.status === 403) {
        setOpsState("restricted");
        setProjectionStatus(null);
        setEmbeddingStatus(null);
        setGraphSummary(null);
        setRelationshipOps([]);
        setConsequenceThreadOps([]);
        setChapterOps([]);
        setRoutePressureOps([]);
        setChapterBranchOps([]);
        setSceneOps([]);
        setLocationOps([]);
        setTravelLogOps([]);
        setNpcRoutineOps([]);
        setAmbientBeatOps([]);
        setWorldTickOps([]);
        setNpcLocationOps([]);
        setOffstageBeatOps([]);
        setOpsWorlds([]);
        setOpsPackCatalog(null);
        setObservability(null);
        setObservabilitySnapshots([]);
        setSpOverview(null);
        setLedgerEntries([]);
        setEvalRuns([]);
        setEvalRunDetail(null);
        setReleaseGate(null);
        setCouncilTurns([]);
        setMemorySearchResult(null);
        return;
      }
      setOpsState("unavailable");
      setProjectionStatus(null);
      setEmbeddingStatus(null);
      setGraphSummary(null);
      setRelationshipOps([]);
      setConsequenceThreadOps([]);
      setChapterOps([]);
      setRoutePressureOps([]);
      setChapterBranchOps([]);
      setSceneOps([]);
      setNpcRoutineOps([]);
      setAmbientBeatOps([]);
      setOpsPackCatalog(null);
      setObservability(null);
      setObservabilitySnapshots([]);
      setSpOverview(null);
      setLedgerEntries([]);
      setEvalRuns([]);
      setEvalRunDetail(null);
      setReleaseGate(null);
      setCouncilTurns([]);
      setMemorySearchResult(null);
      return;
    }

    if (!currentWorldId) {
      setGraphSummary(null);
      setRelationshipOps([]);
      setConsequenceThreadOps([]);
      setChapterOps([]);
      setRoutePressureOps([]);
      setChapterBranchOps([]);
      setSceneOps([]);
      setLocationOps([]);
      setTravelLogOps([]);
      setNpcRoutineOps([]);
      setAmbientBeatOps([]);
      setWorldTickOps([]);
      setNpcLocationOps([]);
      setOffstageBeatOps([]);
      setOpsWorlds([]);
      return;
    }

    try {
      const [
        summaryPayload,
        relationshipPayload,
        threadPayload,
        chapterPayload,
        chapterBranchPayload,
        routePressurePayload,
        scenePayload,
        locationPayload,
        travelLogPayload,
        npcRoutinePayload,
        ambientBeatPayload,
        worldTickPayload,
        npcLocationPayload,
        offstageBeatPayload,
      ] = await Promise.all([
        apiFetch<GraphSummary>(`/ops/worlds/${currentWorldId}/graph-summary`, currentToken),
        apiFetch<{ items: RelationshipOpsItem[] }>(`/ops/worlds/${currentWorldId}/relationships`, currentToken),
        apiFetch<{ items: ConsequenceThreadOpsItem[] }>(`/ops/worlds/${currentWorldId}/consequence-threads`, currentToken),
        apiFetch<{ items: ChapterOpsItem[] }>(`/ops/worlds/${currentWorldId}/chapters`, currentToken),
        apiFetch<{ items: ChapterBranchOpsItem[] }>(`/ops/worlds/${currentWorldId}/chapter-branches`, currentToken),
        apiFetch<{ items: RoutePressureOpsItem[] }>(`/ops/worlds/${currentWorldId}/route-pressures`, currentToken),
        apiFetch<{ items: SceneOpsItem[] }>(`/ops/worlds/${currentWorldId}/scenes`, currentToken),
        apiFetch<{ items: LocationOpsItem[] }>(`/ops/worlds/${currentWorldId}/locations`, currentToken),
        apiFetch<{ items: TravelLogItem[] }>(`/ops/worlds/${currentWorldId}/travel-log`, currentToken),
        apiFetch<{ items: NPCRoutineOpsItem[] }>(`/ops/worlds/${currentWorldId}/npc-routines`, currentToken),
        apiFetch<{ items: AmbientBeatOpsItem[] }>(`/ops/worlds/${currentWorldId}/ambient-beats`, currentToken),
        apiFetch<{ items: WorldTickItem[] }>(`/ops/worlds/${currentWorldId}/world-ticks`, currentToken),
        apiFetch<{ items: NPCLocationSummary[] }>(`/ops/worlds/${currentWorldId}/npc-locations`, currentToken),
        apiFetch<{ items: AmbientBeatOpsItem[] }>(`/ops/worlds/${currentWorldId}/offstage-beats`, currentToken),
      ]);
      setGraphSummary(summaryPayload);
      setRelationshipOps(relationshipPayload.items);
      setConsequenceThreadOps(threadPayload.items);
      setChapterOps(chapterPayload.items);
      setChapterBranchOps(chapterBranchPayload.items);
      setRoutePressureOps(routePressurePayload.items);
      setSceneOps(scenePayload.items);
      setLocationOps(locationPayload.items);
      setTravelLogOps(travelLogPayload.items);
      setNpcRoutineOps(npcRoutinePayload.items);
      setAmbientBeatOps(ambientBeatPayload.items);
      setWorldTickOps(worldTickPayload.items);
      setNpcLocationOps(npcLocationPayload.items);
      setOffstageBeatOps(offstageBeatPayload.items);
    } catch (requestError) {
      const typedError = requestError as APIError;
      if (typedError.status === 403) {
        setOpsState("restricted");
      } else {
        setOpsState("unavailable");
      }
      setGraphSummary(null);
      setRelationshipOps([]);
      setConsequenceThreadOps([]);
      setChapterOps([]);
      setRoutePressureOps([]);
      setChapterBranchOps([]);
      setSceneOps([]);
      setLocationOps([]);
      setTravelLogOps([]);
      setNpcRoutineOps([]);
      setAmbientBeatOps([]);
      setWorldTickOps([]);
      setNpcLocationOps([]);
      setOffstageBeatOps([]);
      setOpsWorlds([]);
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
    if (worldCatalogUnavailable) {
      setError("Playable world catalog is unavailable");
      return;
    }
    if (!selectedWorld || selectedWorld.status !== "playable") {
      setError("Choose a playable world before starting a session");
      return;
    }

    try {
      setError("");
      setActivity([]);
      setLatestNarrative("");
      setLatestReaction("");
      setLatestConsequenceSummary("");
      setLastRebuild(null);
      const created = await apiFetch<SessionInfo>("/sessions", token, {
        method: "POST",
        body: JSON.stringify({
          world_id: worldId,
        }),
      });
      setSession(created);
      setOpsWorldId(created.world_id);
      setLedgerWorldFilter(created.world_id);
      setAdjustWorldId(created.world_id);
      await Promise.all([
        refreshWorldState(created, token),
        refreshWallet(token),
        refreshAdminData(token, created.world_id, ledgerUserFilter || me?.sub, created.world_id, created.session_id),
        refreshHealth(),
      ]);
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }

  async function submitTurnRequest(
    payload:
      | { input_mode: "choice"; choice_id: "safe" | "progress" | "explore" }
      | { input_mode: "free_text"; input_text: string },
  ) {
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
          ...payload,
        }),
      });
      setLatestNarrative(response.narrative);
      setLatestReaction(response.npc_reaction);
      setLatestConsequenceSummary(response.consequence_summary);
      setTurnInputMode("choice");
      setSessionState((current) => mergeTurnResponseIntoSessionState(current, response));
      setWallet((current) =>
        current
          ? {
              ...current,
              balance: response.sp_balance,
            }
          : current,
      );
      setTurnPending(false);
      await refreshWorldState(session, token);
      const backgroundRefresh = Promise.all([
        refreshWallet(token),
        refreshAdminData(
          token,
          session.world_id,
          ledgerUserFilter || me?.sub,
          ledgerWorldFilter || session.world_id,
          session.session_id,
        ),
        refreshHealth(),
      ]).catch((requestError: unknown) => {
        setError(formatError(requestError));
      });
      void backgroundRefresh;
      return;
    } catch (requestError) {
      setError(formatError(requestError));
      setTurnPending(false);
      await Promise.all([
        refreshWallet(token),
        refreshAdminData(
          token,
          session.world_id,
          ledgerUserFilter || me?.sub,
          ledgerWorldFilter || session.world_id,
          session.session_id,
        ),
        refreshHealth(),
      ]);
      return;
    }
  }

  async function handleTurnSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitTurnRequest({ input_mode: "free_text", input_text: freeTextInput });
  }

  async function handleChoiceSubmit(choiceId: "safe" | "progress" | "explore") {
    await submitTurnRequest({ input_mode: "choice", choice_id: choiceId });
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
        { event: "ops.projection.rebuild", data: rebuilt },
        ...current,
      ].slice(0, 40));
      await Promise.all([
        refreshAdminData(token, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId, session?.session_id),
        refreshHealth(),
      ]);
    } catch (requestError) {
      setError(formatError(requestError));
    } finally {
      setRebuildPending(false);
    }
  }

  async function handleIdlePass() {
    if (!token || !activeWorldId) {
      setError("Choose a world before triggering an idle pass");
      return;
    }

    try {
      setIdlePassPending(true);
      setError("");
      const response = await apiFetch<{
        world_id: string;
        tick: {
          tick_id: string;
          status: string;
          summary: string;
          location_id: string | null;
          langfuse_status: string;
        };
        idle_updates: Array<Record<string, unknown>>;
        world_context: WorldContext;
      }>(`/ops/worlds/${activeWorldId}/idle-pass`, token, { method: "POST" });
      setActivity((current) => [
        { event: "ops.idle-pass", data: response },
        ...current,
      ].slice(0, 40));
      await Promise.all([
        session ? refreshWorldState(session, token) : Promise.resolve(),
        refreshAdminData(token, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId, session?.session_id),
      ]);
    } catch (requestError) {
      setError(formatError(requestError));
    } finally {
      setIdlePassPending(false);
    }
  }

  async function runMemorySearch(currentToken: string, currentWorldId: string) {
    const response = await apiFetch<MemorySearchResponse>(
      `/ops/worlds/${currentWorldId}/memory-search?query=${encodeURIComponent(memorySearchQuery)}&limit=6`,
      currentToken,
    );
    setMemorySearchResult(response);
  }

  async function handleMemorySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !activeWorldId) {
      setError("Choose a world before running memory search");
      return;
    }

    try {
      setMemorySearchPending(true);
      setError("");
      await runMemorySearch(token, activeWorldId);
    } catch (requestError) {
      setError(formatError(requestError));
    } finally {
      setMemorySearchPending(false);
    }
  }

  async function handleMemoryReindex() {
    if (!token || !activeWorldId) {
      setError("Choose a world before reindexing memories");
      return;
    }

    try {
      setMemoryReindexPending(true);
      setError("");
      const response = await apiFetch<MemoryReindexResult>("/ops/memories/reindex", token, {
        method: "POST",
        body: JSON.stringify({ world_id: activeWorldId, limit: 100 }),
      });
      setLastMemoryReindex(response);
      await refreshAdminData(token, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId, session?.session_id);
      await runMemorySearch(token, activeWorldId);
      await refreshHealth();
    } catch (requestError) {
      setError(formatError(requestError));
    } finally {
      setMemoryReindexPending(false);
    }
  }

  async function handleLedgerRefresh(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }
    try {
      setError("");
      await refreshAdminData(token, activeWorldId, ledgerUserFilter, ledgerWorldFilter, session?.session_id);
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
        refreshAdminData(
          token,
          activeWorldId,
          ledgerUserFilter || adjustUserSub,
          ledgerWorldFilter || adjustWorldId,
          session?.session_id,
        ),
        refreshHealth(),
      ]);
    } catch (requestError) {
      setError(formatError(requestError));
    } finally {
      setAdjustPending(false);
    }
  }

  async function handleEvalRun(source: "dataset" | "shadow_replay", datasetName?: string) {
    if (!token) {
      setError("Sign in before running evals");
      return;
    }

    try {
      setEvalPending(true);
      setError("");
      const run = await apiFetch<EvalRunItem & { results?: unknown[] }>("/ops/evals/run", token, {
        method: "POST",
        body: JSON.stringify(
          source === "dataset"
            ? { source, dataset_name: datasetName }
            : { source, limit: 5 },
        ),
      });
      setEvalRuns((current) => [run, ...current.filter((item) => item.id !== run.id)].slice(0, 8));
      setEvalRunDetail(
        await apiFetch<EvalRunDetail>(
          `/ops/evals/runs/${run.id}${buildQuery({ pack_id: opsPackFilter, world_template_id: opsTemplateFilter })}`,
          token,
        ),
      );
      await refreshAdminData(token, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId, session?.session_id);
    } catch (requestError) {
      setError(formatError(requestError));
    } finally {
      setEvalPending(false);
    }
  }

  async function handleReleaseChecklistRun() {
    if (!token) {
      setError("Sign in before running release checklists");
      return;
    }

    try {
      setChecklistPending(true);
      setError("");
      await apiFetch<ReleaseGateReport>("/ops/release/checklists/run", token, {
        method: "POST",
        body: JSON.stringify({ trigger_type: "manual" }),
      });
      await refreshAdminData(token, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId, session?.session_id);
      await refreshHealth();
    } catch (requestError) {
      setError(formatError(requestError));
    } finally {
      setChecklistPending(false);
    }
  }

  useEffect(() => {
    if (route !== "admin" || !token) {
      return;
    }
    void refreshAdminData(token, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId, session?.session_id);
    if (activeWorldId) {
      void runMemorySearch(token, activeWorldId);
    }
  }, [route, token, activeWorldId, session?.session_id, opsPackFilter, opsTemplateFilter]);

  return {
    route,
    ready,
    authenticated,
    token,
    me,
    health,
    wallet,
    worldId,
    setWorldId,
    opsWorldId,
    setOpsWorldId,
    playableWorlds,
    worldCatalogStatus,
    session,
    sessionState,
    turnInputMode,
    setTurnInputMode,
    freeTextInput,
    setFreeTextInput,
    latestNarrative,
    latestReaction,
    latestConsequenceSummary,
    events,
    memories,
    activity,
    projectionStatus,
    embeddingStatus,
    graphSummary,
    relationshipOps,
    consequenceThreadOps,
    chapterOps,
    routePressureOps,
    chapterBranchOps,
    sceneOps,
    locationOps,
    travelLogOps,
    npcRoutineOps,
    ambientBeatOps,
    worldTickOps,
    npcLocationOps,
    offstageBeatOps,
    opsWorlds,
    opsPackCatalog,
    opsPackFilter,
    setOpsPackFilter,
    opsTemplateFilter,
    setOpsTemplateFilter,
    observability,
    spOverview,
    ledgerEntries,
    evalRuns,
    evalRunDetail,
    releaseGate,
    councilTurns,
    opsState,
    lastRebuild,
    lastMemoryReindex,
    lastAdjustment,
    memorySearchQuery,
    setMemorySearchQuery,
    memorySearchResult,
    ledgerUserFilter,
    setLedgerUserFilter,
    ledgerWorldFilter,
    setLedgerWorldFilter,
    adjustUserSub,
    setAdjustUserSub,
    adjustDelta,
    setAdjustDelta,
    adjustReason,
    setAdjustReason,
    adjustWorldId,
    setAdjustWorldId,
    adjustNote,
    setAdjustNote,
    error,
    turnPending,
    rebuildPending,
    memorySearchPending,
    memoryReindexPending,
    adjustPending,
    evalPending,
    checklistPending,
    idlePassPending,
    socketState,
    statusText,
    activeWorldId,
    activeQuest,
    selectedWorld,
    worldCatalogUnavailable,
    visibleOpsWorlds,
    opsTemplateOptions,
    activeWorldContext,
    opsScopeLabel,
    opsCatalogStatus,
    opsCatalogPackCount,
    opsCatalogTemplateCount,
    opsCatalogFailureCount,
    selectedAdminWorldLabel,
    sortedOpsPackFailures,
    filteredReleasePackRegressions,
    filteredShadowFailures,
    filteredRecentTraces,
    visibleObservabilitySnapshots,
    suggestedChoices,
    latestRetrievalTrace,
    navigate,
    handleLogin,
    handleLogout,
    handleStartSession,
    handleTurnSubmit,
    handleChoiceSubmit,
    handleRebuildGraph,
    handleIdlePass,
    handleMemorySearch,
    handleMemoryReindex,
    handleLedgerRefresh,
    handleAdjustmentSubmit,
    handleEvalRun,
    handleReleaseChecklistRun,
    refreshAdminData,
    runMemorySearch,
  };
}

export type GestalokaRuntime = ReturnType<typeof useGestalokaRuntime>;
