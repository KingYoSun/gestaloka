import { FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import keycloak, { initKeycloak, isKeycloakConfigured } from "../lib/keycloak";
import { apiFetch, formatError, requiresReauth } from "../api/client";
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
  PlayLanguage,
  PlayLanguagePreset,
  PlayerProfile,
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

const playLanguagePromptNames: Record<PlayLanguagePreset, string> = {
  ja: "Japanese",
  en: "English",
  "zh-Hans": "Simplified Chinese",
  "zh-Hant": "Traditional Chinese",
  ko: "Korean",
  es: "Spanish",
  fr: "French",
  de: "German",
  "pt-BR": "Brazilian Portuguese",
  it: "Italian",
  id: "Indonesian",
  th: "Thai",
  vi: "Vietnamese",
  ar: "Arabic",
  hi: "Hindi",
};

const playLanguagePresets = Object.keys(playLanguagePromptNames) as PlayLanguagePreset[];

function normalizeBrowserPreset(language: string): PlayLanguagePreset | null {
  const normalized = language.toLowerCase();
  if (normalized.startsWith("pt-br")) {
    return "pt-BR";
  }
  if (normalized.startsWith("zh-hant") || normalized.includes("-tw") || normalized.includes("-hk")) {
    return "zh-Hant";
  }
  if (normalized.startsWith("zh")) {
    return "zh-Hans";
  }
  const base = normalized.split("-", 1)[0] as PlayLanguagePreset;
  return playLanguagePresets.includes(base) ? base : null;
}

function browserLanguageName(language: string): string {
  const fallback = language.trim() || "Japanese";
  try {
    const DisplayNames = (Intl as unknown as {
      DisplayNames?: new (locales: string[], options: { type: "language" }) => { of(language: string): string | undefined };
    }).DisplayNames;
    if (!DisplayNames) {
      return fallback;
    }
    const displayNames = new DisplayNames([language, "en"], { type: "language" });
    return displayNames.of(language) || fallback;
  } catch {
    return fallback;
  }
}

function playLanguageFromBrowser(): PlayLanguage {
  const browserLanguage = window.navigator.languages?.[0] ?? window.navigator.language ?? "";
  const preset = normalizeBrowserPreset(browserLanguage);
  if (preset) {
    return {
      mode: "preset",
      preset,
      custom: "",
      prompt_name: playLanguagePromptNames[preset],
    };
  }
  const custom = browserLanguageName(browserLanguage).replace(/\s+/g, " ").trim().slice(0, 80);
  return {
    mode: "custom",
    preset: null,
    custom: custom || "Japanese",
    prompt_name: custom || "Japanese",
  };
}

function createDefaultProfileDraft() {
  return {
  display_name: "",
  gender: "unspecified" as PlayerProfile["gender"],
  background: "",
  free_text: "",
  narrative_preferences: {
    perspective: "third_person",
    tone: "lyrical",
    density: "concise",
    dialogue_style: "literary",
  } as PlayerProfile["narrative_preferences"],
    play_language: playLanguageFromBrowser(),
  };
}

export function useGestalokaRuntime() {
  const { t } = useTranslation();
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
  const [playerProfiles, setPlayerProfiles] = useState<PlayerProfile[]>([]);
  const [selectedPlayerActorId, setSelectedPlayerActorId] = useState("");
  const [editingPlayerActorId, setEditingPlayerActorId] = useState("");
  const [profileDraft, setProfileDraft] = useState(() => createDefaultProfileDraft());
  const [profilePending, setProfilePending] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [turnInputMode, setTurnInputMode] = useState<"choice" | "free_text">("choice");
  const [freeTextInput, setFreeTextInput] = useState(() => t("player.defaults.freeTextInput"));
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
  const [memorySearchQuery, setMemorySearchQuery] = useState(() => t("player.defaults.memorySearchQuery"));
  const [memorySearchResult, setMemorySearchResult] = useState<MemorySearchResponse | null>(null);
  const [ledgerUserFilter, setLedgerUserFilter] = useState("");
  const [ledgerWorldFilter, setLedgerWorldFilter] = useState("");
  const [adjustUserSub, setAdjustUserSub] = useState("");
  const [adjustDelta, setAdjustDelta] = useState("-1");
  const [adjustReason, setAdjustReason] = useState("admin_adjustment");
  const [adjustWorldId, setAdjustWorldId] = useState("");
  const [adjustNote, setAdjustNote] = useState("Phase E admin adjustment");
  const [error, setError] = useState("");
  const [authRecoveryRequired, setAuthRecoveryRequired] = useState(false);
  const [turnPending, setTurnPending] = useState(false);
  const [turnProgressPhase, setTurnProgressPhase] = useState<"idle" | "submitting" | "resolving" | "refreshing">("idle");
  const [turnProgressElapsedSeconds, setTurnProgressElapsedSeconds] = useState(0);
  const [turnProgressStartedAt, setTurnProgressStartedAt] = useState<number | null>(null);
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
  const activeWorldId = session?.world_id ?? worldId;
  const activeQuest = sessionState?.quests.find((item) => item.status === "active") ?? sessionState?.quests[0] ?? null;
  const selectedWorld = playableWorlds.find((item) => item.world_id === worldId) ?? null;
  const selectedPlayerProfile = playerProfiles.find((item) => item.actor_id === selectedPlayerActorId) ?? null;
  const editingPlayerProfile = playerProfiles.find((item) => item.actor_id === editingPlayerActorId) ?? null;
  const editingProfileLocked = editingPlayerProfile?.locked ?? false;
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
    if (!turnProgressStartedAt || turnProgressPhase === "idle") {
      setTurnProgressElapsedSeconds(0);
      return;
    }
    const updateElapsed = () => {
      setTurnProgressElapsedSeconds(Math.max(Math.floor((Date.now() - turnProgressStartedAt) / 1000), 0));
    };
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(interval);
  }, [turnProgressPhase, turnProgressStartedAt]);

  useEffect(() => {
    void refreshHealth();

    initKeycloak()
      .then((isAuthenticated: boolean) => {
        setAuthenticated(isAuthenticated);
        setToken(keycloak.token ?? "");
      })
      .catch((initError: unknown) => {
        const message = String(initError);
        if (!message.includes("3rd party check iframe")) {
          setError(message);
        }
      })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!authenticated || !token) {
      setMe(null);
      setWallet(null);
      setPlayableWorlds([]);
      setWorldCatalogStatus("unknown");
      setPlayerProfiles([]);
      setSelectedPlayerActorId("");
      setEditingPlayerActorId("");
      setProfileDraft(createDefaultProfileDraft());
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

    void ensureFreshToken(token).then((currentToken) => Promise.all([
      apiFetch<AuthMe>("/auth/me", currentToken),
      apiFetch<SPWallet>("/economy/sp/me", currentToken),
      apiFetch<PlayableWorldCatalog>("/worlds/playable", currentToken),
    ]))
      .then(([mePayload, walletPayload, worldPayload]) => {
        setMe(mePayload);
        setWallet(walletPayload);
        setPlayableWorlds(worldPayload.items);
        setWorldCatalogStatus(worldPayload.status);
        if (worldPayload.status === "error") {
          setError(t("errors.worldCatalogUnavailable"));
        }
        const firstPlayableWorld = worldPayload.items.find((item) => item.status === "playable") ?? worldPayload.items[0];
        setWorldId((current) =>
          worldPayload.items.some((item) => item.world_id === current) ? current : (firstPlayableWorld?.world_id ?? ""),
        );
        setLedgerUserFilter((current) => current || walletPayload.user_sub);
        setAdjustUserSub((current) => current || walletPayload.user_sub);
      })
      .catch((requestError: unknown) => showRequestError(requestError));
  }, [authenticated, token]);

  useEffect(() => {
    if (!playableWorlds.length || playableWorlds.some((item) => item.world_id === worldId)) {
      return;
    }
    setWorldId(playableWorlds[0].world_id);
  }, [playableWorlds, worldId]);

  useEffect(() => {
    if (!authenticated || !token || !worldId || worldCatalogUnavailable) {
      setPlayerProfiles([]);
      setSelectedPlayerActorId("");
      return;
    }
    void refreshPlayerProfiles(worldId, token);
  }, [authenticated, token, worldId, worldCatalogUnavailable]);

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
      setError(t("errors.websocketFailed"));
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

  async function ensureFreshToken(currentToken = token) {
    if (!currentToken || !isKeycloakConfigured()) {
      return currentToken;
    }
    try {
      await keycloak.updateToken(30);
      const freshToken = keycloak.token ?? currentToken;
      if (freshToken !== token) {
        setToken(freshToken);
      }
      setAuthRecoveryRequired(false);
      return freshToken;
    } catch (refreshError) {
      setAuthRecoveryRequired(true);
      throw refreshError;
    }
  }

  function showRequestError(requestError: unknown) {
    setAuthRecoveryRequired(requiresReauth(requestError));
    setError(formatError(requestError));
  }

  async function refreshWallet(currentToken: string) {
    currentToken = await ensureFreshToken(currentToken);
    const payload = await apiFetch<SPWallet>("/economy/sp/me", currentToken);
    setWallet(payload);
    return payload;
  }

  async function refreshPlayerProfiles(currentWorldId: string, currentToken: string) {
    currentToken = await ensureFreshToken(currentToken);
    const payload = await apiFetch<{ items: PlayerProfile[] }>(
      `/worlds/${currentWorldId}/player-profiles`,
      currentToken,
    );
    setPlayerProfiles(payload.items);
    setSelectedPlayerActorId((current) =>
      payload.items.some((item) => item.actor_id === current) ? current : (payload.items[0]?.actor_id ?? ""),
    );
    return payload.items;
  }

  async function refreshWorldState(currentSession: SessionInfo, currentToken: string) {
    currentToken = await ensureFreshToken(currentToken);
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
    currentToken = await ensureFreshToken(currentToken);

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
    window.history.pushState({}, "", "/");
    setRoute(nextRoute);
  }

  async function handleLogin() {
    if (!isKeycloakConfigured()) {
      setError(t("errors.authNotConfigured"));
      return;
    }
    await keycloak.login();
  }

  async function handleRegister() {
    if (!isKeycloakConfigured()) {
      setError(t("errors.authNotConfigured"));
      return;
    }
    await keycloak.register();
  }

  async function handleLogout() {
    if (!isKeycloakConfigured()) {
      setError("");
      return;
    }
    await keycloak.logout({ redirectUri: `${window.location.origin}/` });
  }

  async function handleCreatePlayerProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !worldId) {
      setError(t("errors.signInBeforeProfile"));
      return;
    }
    if (!profileDraft.display_name.trim()) {
      setError(t("errors.nameRequired"));
      return;
    }
    try {
      setProfilePending(true);
      setError("");
      const currentToken = await ensureFreshToken(token);
      const path = editingPlayerActorId
        ? `/worlds/${worldId}/player-profiles/${editingPlayerActorId}`
        : `/worlds/${worldId}/player-profiles`;
      const requestBody = editingProfileLocked
        ? {
            narrative_preferences: profileDraft.narrative_preferences,
            play_language: profileDraft.play_language,
          }
        : {
            ...profileDraft,
            display_name: profileDraft.display_name.trim(),
            background: profileDraft.background.trim(),
            free_text: profileDraft.free_text.trim(),
          };
      const saved = await apiFetch<PlayerProfile>(path, currentToken, {
        method: editingPlayerActorId ? "PATCH" : "POST",
        body: JSON.stringify(requestBody),
      });
      setPlayerProfiles((current) =>
        editingPlayerActorId
          ? current.map((item) => (item.actor_id === saved.actor_id ? saved : item))
          : [...current, saved],
      );
      setSelectedPlayerActorId(saved.actor_id);
      setProfileDraft(createDefaultProfileDraft());
      setEditingPlayerActorId("");
    } catch (requestError) {
      showRequestError(requestError);
    } finally {
      setProfilePending(false);
    }
  }

  function beginProfileEdit(profile: PlayerProfile) {
    setEditingPlayerActorId(profile.actor_id);
    setProfileDraft({
      display_name: profile.display_name,
      gender: profile.gender,
      background: profile.background,
      free_text: profile.free_text,
      narrative_preferences: profile.narrative_preferences,
      play_language: profile.play_language,
    });
  }

  function cancelProfileEdit() {
    setEditingPlayerActorId("");
    setProfileDraft(createDefaultProfileDraft());
  }

  async function handleStartSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError(t("errors.signInBeforeSession"));
      return;
    }
    if (worldCatalogUnavailable) {
      setError(t("errors.playableWorldCatalogUnavailable"));
      return;
    }
    if (!selectedWorld || selectedWorld.status !== "playable") {
      setError(t("errors.chooseWorldBeforeSession"));
      return;
    }
    if (!selectedPlayerProfile) {
      setError(t("errors.profileRequired"));
      return;
    }

    try {
      setError("");
      setActivity([]);
      setLatestNarrative("");
      setLatestReaction("");
      setLatestConsequenceSummary("");
      setLastRebuild(null);
      const currentToken = await ensureFreshToken(token);
      const created = await apiFetch<SessionInfo>("/sessions", currentToken, {
        method: "POST",
        body: JSON.stringify({
          world_id: worldId,
          player_actor_id: selectedPlayerProfile.actor_id,
        }),
      });
      setSession(created);
      setPlayerProfiles((current) =>
        current.map((item) => (item.actor_id === created.player_profile.actor_id ? created.player_profile : item)),
      );
      setOpsWorldId(created.world_id);
      setLedgerWorldFilter(created.world_id);
      setAdjustWorldId(created.world_id);
      await Promise.all([
        refreshWorldState(created, currentToken),
        refreshWallet(currentToken),
        refreshAdminData(currentToken, created.world_id, ledgerUserFilter || me?.sub, created.world_id, created.session_id),
        refreshHealth(),
      ]);
    } catch (requestError) {
      showRequestError(requestError);
    }
  }

  async function submitTurnRequest(
    payload:
      | { input_mode: "choice"; choice_id: "safe" | "progress" | "explore" }
      | { input_mode: "free_text"; input_text: string },
  ) {
    if (!token || !session) {
      setError(t("errors.startSessionFirst"));
      return;
    }

    const setTurnPhase = (phase: "submitting" | "resolving" | "refreshing") => {
      setTurnProgressPhase(phase);
      setTurnProgressStartedAt((current) => current ?? Date.now());
    };

    try {
      setTurnPending(true);
      setTurnProgressStartedAt(Date.now());
      setTurnProgressElapsedSeconds(0);
      setTurnProgressPhase("submitting");
      setError("");
      const currentToken = await ensureFreshToken(token);
      setTurnPhase("resolving");
      const response = await apiFetch<TurnResponse>("/turns", currentToken, {
        method: "POST",
        body: JSON.stringify({
          session_id: session.session_id,
          ...payload,
        }),
      }, { timeoutMs: 120_000 });
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
      setTurnPhase("refreshing");
      await refreshWorldState(session, currentToken);
      const backgroundRefresh = Promise.all([
        refreshWallet(currentToken),
        refreshAdminData(
          currentToken,
          session.world_id,
          ledgerUserFilter || me?.sub,
          ledgerWorldFilter || session.world_id,
          session.session_id,
        ),
        refreshHealth(),
      ]).catch((requestError: unknown) => {
        showRequestError(requestError);
      });
      void backgroundRefresh;
      return;
    } catch (requestError) {
      showRequestError(requestError);
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
      ]).catch(() => undefined);
      return;
    } finally {
      setTurnPending(false);
      setTurnProgressPhase("idle");
      setTurnProgressStartedAt(null);
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
      setError(t("errors.chooseWorldBeforeGraph"));
      return;
    }

    try {
      setRebuildPending(true);
      setError("");
      const currentToken = await ensureFreshToken(token);
      const rebuilt = await apiFetch<RebuildSummary>("/ops/projection/rebuild", currentToken, {
        method: "POST",
        body: JSON.stringify({ world_id: activeWorldId }),
      });
      setLastRebuild(rebuilt);
      setActivity((current) => [
        { event: "ops.projection.rebuild", data: rebuilt },
        ...current,
      ].slice(0, 40));
      await Promise.all([
        refreshAdminData(currentToken, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId, session?.session_id),
        refreshHealth(),
      ]);
    } catch (requestError) {
      showRequestError(requestError);
    } finally {
      setRebuildPending(false);
    }
  }

  async function handleIdlePass() {
    if (!token || !activeWorldId) {
      setError(t("errors.chooseWorldBeforeIdlePass"));
      return;
    }

    try {
      setIdlePassPending(true);
      setError("");
      const currentToken = await ensureFreshToken(token);
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
      }>(`/ops/worlds/${activeWorldId}/idle-pass`, currentToken, { method: "POST" });
      setActivity((current) => [
        { event: "ops.idle-pass", data: response },
        ...current,
      ].slice(0, 40));
      await Promise.all([
        session ? refreshWorldState(session, currentToken) : Promise.resolve(),
        refreshAdminData(currentToken, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId, session?.session_id),
      ]);
    } catch (requestError) {
      showRequestError(requestError);
    } finally {
      setIdlePassPending(false);
    }
  }

  async function runMemorySearch(currentToken: string, currentWorldId: string) {
    currentToken = await ensureFreshToken(currentToken);
    const response = await apiFetch<MemorySearchResponse>(
      `/ops/worlds/${currentWorldId}/memory-search?query=${encodeURIComponent(memorySearchQuery)}&limit=6`,
      currentToken,
    );
    setMemorySearchResult(response);
  }

  async function handleMemorySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !activeWorldId) {
      setError(t("errors.chooseWorldBeforeMemorySearch"));
      return;
    }

    try {
      setMemorySearchPending(true);
      setError("");
      await runMemorySearch(token, activeWorldId);
    } catch (requestError) {
      showRequestError(requestError);
    } finally {
      setMemorySearchPending(false);
    }
  }

  async function handleMemoryReindex() {
    if (!token || !activeWorldId) {
      setError(t("errors.chooseWorldBeforeReindex"));
      return;
    }

    try {
      setMemoryReindexPending(true);
      setError("");
      const currentToken = await ensureFreshToken(token);
      const response = await apiFetch<MemoryReindexResult>("/ops/memories/reindex", currentToken, {
        method: "POST",
        body: JSON.stringify({ world_id: activeWorldId, limit: 100 }),
      });
      setLastMemoryReindex(response);
      await refreshAdminData(currentToken, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId, session?.session_id);
      await runMemorySearch(currentToken, activeWorldId);
      await refreshHealth();
    } catch (requestError) {
      showRequestError(requestError);
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
      showRequestError(requestError);
    }
  }

  async function handleAdjustmentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError(t("errors.signInBeforeAdjustments"));
      return;
    }

    try {
      setAdjustPending(true);
      setError("");
      const currentToken = await ensureFreshToken(token);
      const response = await apiFetch<SPAdjustmentResponse>("/ops/sp/adjustments", currentToken, {
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
        refreshWallet(currentToken),
        refreshAdminData(
          currentToken,
          activeWorldId,
          ledgerUserFilter || adjustUserSub,
          ledgerWorldFilter || adjustWorldId,
          session?.session_id,
        ),
        refreshHealth(),
      ]);
    } catch (requestError) {
      showRequestError(requestError);
    } finally {
      setAdjustPending(false);
    }
  }

  async function handleEvalRun(source: "dataset" | "shadow_replay", datasetName?: string) {
    if (!token) {
      setError(t("errors.signInBeforeEvals"));
      return;
    }

    try {
      setEvalPending(true);
      setError("");
      const currentToken = await ensureFreshToken(token);
      const run = await apiFetch<EvalRunItem & { results?: unknown[] }>("/ops/evals/run", currentToken, {
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
          currentToken,
        ),
      );
      await refreshAdminData(currentToken, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId, session?.session_id);
    } catch (requestError) {
      showRequestError(requestError);
    } finally {
      setEvalPending(false);
    }
  }

  async function handleReleaseChecklistRun() {
    if (!token) {
      setError(t("errors.signInBeforeRelease"));
      return;
    }

    try {
      setChecklistPending(true);
      setError("");
      const currentToken = await ensureFreshToken(token);
      await apiFetch<ReleaseGateReport>("/ops/release/checklists/run", currentToken, {
        method: "POST",
        body: JSON.stringify({ trigger_type: "manual" }),
      });
      await refreshAdminData(currentToken, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId, session?.session_id);
      await refreshHealth();
    } catch (requestError) {
      showRequestError(requestError);
    } finally {
      setChecklistPending(false);
    }
  }

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
    playerProfiles,
    selectedPlayerActorId,
    selectedPlayerProfile,
    setSelectedPlayerActorId,
    editingPlayerActorId,
    editingProfileLocked,
    profileDraft,
    setProfileDraft,
    profilePending,
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
    authRecoveryRequired,
    turnPending,
    turnProgressPhase,
    turnProgressElapsedSeconds,
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
    handleRegister,
    handleLogout,
    handleCreatePlayerProfile,
    beginProfileEdit,
    cancelProfileEdit,
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
