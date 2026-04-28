import type { GestalokaRuntime } from "../../hooks/useGestalokaRuntime";
import { locationRouteSummaries } from "../../domain/runtime";
import type { WorldContext } from "../../types";

type PlayerPageProps = {
  runtime: GestalokaRuntime;
};

export function PlayerPage({ runtime }: PlayerPageProps) {
  const {
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
  } = runtime;

  return (
              <>
            <article className="card">
              <h2>3. Character summary</h2>
              {sessionState ? (
                <dl className="meta" data-testid="character-summary">
                  <div>
                    <dt>Rank</dt>
                    <dd>{sessionState.character.rank}</dd>
                  </div>
                  <div>
                    <dt>Vitality</dt>
                    <dd data-testid="state-band-vitality">{sessionState.narrative_state_bands.vitality}</dd>
                  </div>
                  <div>
                    <dt>Clarity</dt>
                    <dd data-testid="state-band-clarity">{sessionState.narrative_state_bands.clarity}</dd>
                  </div>
                  <div>
                    <dt>Standing tone</dt>
                    <dd data-testid="state-band-standing">{sessionState.narrative_state_bands.standing}</dd>
                  </div>
                </dl>
              ) : (
                <p>No character sheet yet.</p>
              )}
            </article>

            <article className="card">
              <h2>4. Active quest</h2>
              {activeQuest ? (
                <div data-testid="active-quest">
                  <p>
                    <strong>{activeQuest.title}</strong>
                  </p>
                  <p data-testid="quest-progress">
                    Progress: {activeQuest.progress}/{activeQuest.progress_target}
                  </p>
                  <p data-testid="quest-stage">Stage: {activeQuest.stage_key}</p>
                  <p>{activeQuest.latest_summary}</p>
                  <p>Status: {activeQuest.status}</p>
                  <p data-testid="quest-unlock-requirements">
                    Unlocks: {Object.keys(activeQuest.unlock_requirements).length ? JSON.stringify(activeQuest.unlock_requirements) : "starter"}
                  </p>
                </div>
              ) : (
                <p>No active quest.</p>
              )}
            </article>

            <article className="card">
              <h2>5. Faction standing</h2>
              <ul className="stream" data-testid="faction-standing">
                {sessionState?.factions.map((item) => (
                  <li key={item.faction_id}>
                    <strong>{item.name}</strong>
                    <span>
                      {item.standing.toFixed(2)} / {item.band}
                    </span>
                  </li>
                )) ?? <li>Faction standing unavailable.</li>}
              </ul>
            </article>

            <article className="card">
              <h2>6. Current scene</h2>
              <div data-testid="current-place-summary">
                <p>
                  <strong>Current place</strong>
                </p>
                <p>{sessionState?.current_location?.name ?? "No place is active yet."}</p>
                <p>{sessionState?.current_location?.description ?? "The scene has not opened onto a stable place yet."}</p>
              </div>
              {sessionState?.chapter ? (
                <div data-testid="current-chapter-summary">
                  <p>
                    <strong>{sessionState.chapter.summary}</strong>
                  </p>
                  <p>Chapter status: {sessionState.chapter.status}</p>
                  {sessionState.chapter.crossroads_summary ? <p>{sessionState.chapter.crossroads_summary}</p> : null}
                  {sessionState.chapter.branch_hint &&
                  sessionState.chapter.branch_hint !== sessionState.chapter.crossroads_summary ? (
                    <p>{sessionState.chapter.branch_hint}</p>
                  ) : null}
                </div>
              ) : (
                <p>No chapter frame yet.</p>
              )}
              {sessionState?.current_scene ? (
                <div data-testid="current-scene-summary">
                  <p>
                    <strong>{sessionState.current_scene.summary}</strong>
                  </p>
                  <p>{sessionState.current_scene.pressure_summary}</p>
                  <p>
                    Scene focus: {sessionState.current_scene.focus_actor?.display_name ?? "The scene"} /{" "}
                    {sessionState.current_scene.location?.name ?? "unknown location"}
                  </p>
                </div>
              ) : (
                <p>No active scene frame yet.</p>
              )}
              <h3>Recent scene echoes</h3>
              <ul className="stream" data-testid="recent-scene-history">
                {sessionState?.recent_scene_history.length ? (
                  sessionState.recent_scene_history.map((item, index) => (
                    <li key={`${item}-${index}`}>
                      <strong>echo</strong>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li>No scene echoes are visible yet.</li>
                )}
              </ul>
              <h3>Recent branch echoes</h3>
              <ul className="stream" data-testid="recent-branch-echoes">
                {sessionState?.recent_branch_echoes.length ? (
                  sessionState.recent_branch_echoes.map((item, index) => (
                    <li key={`${item}-${index}`}>
                      <strong>branch</strong>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li>No branch echo has gathered into focus yet.</li>
                )}
              </ul>
            </article>

            <article className="card">
              <h2>7. Relationship summary</h2>
              <ul className="stream" data-testid="relationship-summary">
                {sessionState?.relationships.length ? (
                  sessionState.relationships.map((item) => (
                    <li key={item.actor_id}>
                      <strong>{item.display_name}</strong>
                      <span>{item.summary}</span>
                      <span>{item.band}</span>
                    </li>
                  ))
                ) : (
                  <li>No relationship pressure is visible yet.</li>
                )}
              </ul>
              <h3>Undercurrents</h3>
              <ul className="stream" data-testid="undercurrents-stream">
                {sessionState?.active_consequence_threads.length ? (
                  sessionState.active_consequence_threads.map((item) => (
                    <li key={item.id}>
                      <strong>{item.title}</strong>
                      <span>{item.summary}</span>
                    </li>
                  ))
                ) : (
                  <li>No unresolved undercurrents are pulling at the scene.</li>
                )}
              </ul>
              <h3>Recent consequence history</h3>
              <ul className="stream" data-testid="recent-consequence-history">
                {sessionState?.recent_consequence_history.length ? (
                  sessionState.recent_consequence_history.map((item, index) => (
                    <li key={`${item}-${index}`}>
                      <strong>recent</strong>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li>No recent consequence history yet.</li>
                )}
              </ul>
            </article>

            <article className="card">
              <h2>8. Around you</h2>
              <ul className="stream" data-testid="local-figures-stream">
                {sessionState?.local_figures.length ? (
                  sessionState.local_figures.map((item) => (
                    <li key={item.actor_id}>
                      <strong>{item.display_name}</strong>
                      <span>{item.summary}</span>
                    </li>
                  ))
                ) : (
                  <li>No nearby figures have settled into focus yet.</li>
                )}
              </ul>
              <h3>Who is elsewhere</h3>
              <ul className="stream" data-testid="npc-locations-stream">
                {sessionState?.npc_locations.length ? (
                  sessionState.npc_locations.map((item) => (
                    <li key={`${item.actor_id}-${item.location_id ?? "none"}`}>
                      <strong>{item.display_name}</strong>
                      <span>{item.summary}</span>
                    </li>
                  ))
                ) : (
                  <li>No wider district movement is visible yet.</li>
                )}
              </ul>
              <h3>Nearby routes</h3>
              <ul className="stream" data-testid="nearby-routes-stream">
                {sessionState?.nearby_routes.length ? (
                  sessionState.nearby_routes.map((item) => (
                    <li key={item.route_key}>
                      <strong>{item.destination_name}</strong>
                      <span>{item.summary}</span>
                    </li>
                  ))
                ) : (
                  <li>No clear route is presenting itself yet.</li>
                )}
              </ul>
              <h3>Recent travel echoes</h3>
              <ul className="stream" data-testid="recent-travel-history">
                {sessionState?.recent_travel_history.length ? (
                  sessionState.recent_travel_history.map((item, index) => (
                    <li key={`${item}-${index}`}>
                      <strong>echo</strong>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li>No travel echo is lingering yet.</li>
                )}
              </ul>
            </article>

            <article className="card">
              <h2>9. Recent world beats</h2>
              <ul className="stream" data-testid="recent-world-beats">
                {sessionState?.recent_world_beats.length ? (
                  sessionState.recent_world_beats.map((item, index) => (
                    <li key={`${item}-${index}`}>
                      <strong>beat</strong>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li>No wider district beat has risen yet.</li>
                )}
              </ul>
              <h3>Ambient murmurs</h3>
              <ul className="stream" data-testid="ambient-murmurs-stream">
                {sessionState?.ambient_murmurs.length ? (
                  sessionState.ambient_murmurs.map((item, index) => (
                    <li key={`${item}-${index}`}>
                      <strong>murmur</strong>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li>No rumor has started moving through the current district.</li>
                )}
              </ul>
              <h3>Recent offstage beats</h3>
              <ul className="stream" data-testid="recent-offstage-beats">
                {sessionState?.recent_offstage_beats.length ? (
                  sessionState.recent_offstage_beats.map((item, index) => (
                    <li key={`${item}-${index}`}>
                      <strong>offstage</strong>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li>No offstage shift is echoing back yet.</li>
                )}
              </ul>
              <h3>Offstage murmurs</h3>
              <ul className="stream" data-testid="offstage-murmurs-stream">
                {sessionState?.offstage_murmurs.length ? (
                  sessionState.offstage_murmurs.map((item, index) => (
                    <li key={`${item}-${index}`}>
                      <strong>murmur</strong>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li>No offstage rumor has reached you yet.</li>
                )}
              </ul>
            </article>

            <article className="card">
              <h2>10. Inventory</h2>
              <ul className="stream" data-testid="inventory-stream">
                {sessionState?.inventory.length ? (
                  sessionState.inventory.map((item) => (
                    <li key={item.id}>
                      <strong>{item.name}</strong>
                      <span>{item.template_key}</span>
                      <span>
                        {item.status}
                        {item.effect_kind ? ` / ${item.effect_kind}` : ""}
                      </span>
                    </li>
                  ))
                ) : (
                  <li>No reward items yet.</li>
                )}
              </ul>
              <h3>Important affordances</h3>
              <ul className="stream" data-testid="inventory-affordances">
                {sessionState?.important_inventory_affordances.length ? (
                  sessionState.important_inventory_affordances.map((item) => (
                    <li key={item.item_id}>
                      <strong>{item.name}</strong>
                      <span>{item.summary}</span>
                      <span>{item.usable ? "usable" : "spent"}</span>
                    </li>
                  ))
                ) : (
                  <li>No major item affordances are visible yet.</li>
                )}
              </ul>
            </article>

            <article className="card wide">
              <h2>11. Suggested choices</h2>
              <p data-testid="last-consequence-summary">
                {latestConsequenceSummary || "The scene is waiting for your next line."}
              </p>
              <div className="stack">
                <div className="actions">
                  <button
                    type="button"
                    data-testid="toggle-choice-mode"
                    onClick={() => setTurnInputMode("choice")}
                    disabled={!session}
                  >
                    Choice mode
                  </button>
                  <button
                    type="button"
                    data-testid="toggle-free-text"
                    onClick={() => setTurnInputMode("free_text")}
                    disabled={!session}
                  >
                    Free text mode
                  </button>
                </div>
                <ul className="stream" data-testid="choice-list">
                  {suggestedChoices.length ? (
                    suggestedChoices.map((choice) => (
                      <li key={choice.choice_id} className="choice-item">
                        <strong className="choice-label">{choice.label}</strong>
                        <span className="choice-summary">{choice.summary}</span>
                        <span className="choice-posture">{choice.posture}</span>
                        <button
                          type="button"
                          data-testid={`choice-${choice.choice_id}`}
                          onClick={() => void handleChoiceSubmit(choice.choice_id)}
                          disabled={!session || turnPending}
                        >
                          {turnPending ? "Submitting..." : "Choose"}
                        </button>
                      </li>
                    ))
                  ) : (
                    <li>No suggested choices yet.</li>
                  )}
                </ul>
                <p className="turn-progress" data-testid="turn-progress-status">
                  {turnPending ? "Resolving turn. New choices will appear when the scene updates." : "Ready for the next turn."}
                </p>
              </div>
              {turnInputMode === "free_text" ? (
                <form onSubmit={handleTurnSubmit} className="stack">
                  <label>
                    Free text action
                    <textarea
                      data-testid="turn-input"
                      rows={4}
                      value={freeTextInput}
                      onChange={(event) => setFreeTextInput(event.target.value)}
                    />
                  </label>
                  <button data-testid="submit-turn" type="submit" disabled={!session || turnPending}>
                    {turnPending ? "Submitting..." : "Submit free text turn"}
                  </button>
                </form>
              ) : null}
              <div className="result">
                <h3>Latest narrative</h3>
                <p data-testid="latest-narrative">{latestNarrative || "No turn resolved yet."}</p>
                <h3>Latest NPC reaction</h3>
                <p data-testid="latest-reaction">{latestReaction || "No NPC reaction yet."}</p>
              </div>
            </article>

            <article className="card">
              <h2>12. Results</h2>
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
                {activity.map((item, index) => {
                  const context = item.data.world_context as WorldContext | undefined;
                  return (
                    <li key={`${item.event}-${index}`}>
                      <strong>{item.event}</strong>
                      <span>
                        {context?.pack_display_name ?? "unknown"} /{" "}
                        {context?.world_template_display_name ?? "unknown"}
                      </span>
                      <span>{JSON.stringify(item.data)}</span>
                    </li>
                  );
                })}
              </ul>
            </article>

            <section hidden aria-hidden="true">
              <p data-testid="ops-status">Ops access: {opsState}</p>
              <p data-testid="sp-admin-separation-note">
                SP execution ledger is separate from world progression. Reward item use and follow-up quest unlocks are tracked below, not as paid power.
              </p>
              <ul className="stream" data-testid="location-route-stream">
                {locationOps.length ? (
                  locationOps.map((item) => (
                    <li key={`hidden-location-${item.id}`}>
                      <strong>{item.name}</strong>
                      <span>{item.description}</span>
                      <span>
                        {locationRouteSummaries(item)
                          .map((route) => `${route.route_key}:${route.status}->${route.destination_name}`)
                          .join(" | ")}
                      </span>
                    </li>
                  ))
                ) : (
                  <li>No location state loaded.</li>
                )}
              </ul>
              <ul className="stream" data-testid="travel-log-stream">
                {travelLogOps.length ? (
                  travelLogOps.map((item) => (
                    <li key={`hidden-travel-${item.event_id}`}>
                      <strong>{item.turn_id}</strong>
                      <span>{item.travel_summary ?? item.narrative ?? "No travel summary"}</span>
                      <span>{item.location_id ?? "no location"}</span>
                    </li>
                  ))
                ) : (
                  <li>No travel log loaded.</li>
                )}
              </ul>
              <ul className="stream" data-testid="npc-routine-stream">
                {npcRoutineOps.length ? (
                  npcRoutineOps.map((item) => (
                    <li key={`hidden-routine-${item.actor_id}`}>
                      <strong>{item.display_name}</strong>
                      <span>{item.location_id ?? "no location"}</span>
                      <span>{JSON.stringify(item.routine_state)}</span>
                    </li>
                  ))
                ) : (
                  <li>No NPC routine state loaded.</li>
                )}
              </ul>
              <ul className="stream" data-testid="ambient-beat-stream">
                {ambientBeatOps.length ? (
                  ambientBeatOps.map((item) => (
                    <li key={`hidden-ambient-${item.event_id}`}>
                      <strong>{item.display_name ?? "Unknown figure"}</strong>
                      <span>{item.beat_kind}</span>
                      <span>{item.visible_summary ?? "No visible summary"}</span>
                    </li>
                  ))
                ) : (
                  <li>No ambient beat log loaded.</li>
                )}
              </ul>
              <ul className="stream" data-testid="scene-timeline-stream">
                {sceneOps.length ? (
                  sceneOps.map((item) => (
                    <li key={`hidden-scene-${item.id}`}>
                      <strong>{item.scene_phase}</strong>
                      <span>{item.status}</span>
                      <span>{item.stakes_summary}</span>
                      <span>{item.pressure_summary}</span>
                    </li>
                  ))
                ) : (
                  <li>No scene timeline data loaded.</li>
                )}
              </ul>
            </section>
          </>
  );
}
