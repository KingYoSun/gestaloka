import { ActionBar } from "../../components/ui/ActionBar";
import { Button } from "../../components/ui/Button";
import { DefinitionGrid } from "../../components/ui/DefinitionGrid";
import { Field } from "../../components/ui/Field";
import { Panel } from "../../components/ui/Panel";
import { StreamList } from "../../components/ui/StreamList";
import { formatPackContext, formatPackScope, locationRouteSummaries } from "../../domain/runtime";
import type { GestalokaRuntime } from "../../hooks/useGestalokaRuntime";

type AdminPageProps = {
  runtime: GestalokaRuntime;
};

export function AdminPage({ runtime }: AdminPageProps) {
  const {
    token,
    health,
    session,
    sessionState,
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
    rebuildPending,
    memorySearchPending,
    memoryReindexPending,
    adjustPending,
    evalPending,
    checklistPending,
    idlePassPending,
    activeWorldId,
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
    latestRetrievalTrace,
    setOpsWorldId,
    handleRebuildGraph,
    handleIdlePass,
    handleMemorySearch,
    handleMemoryReindex,
    handleLedgerRefresh,
    handleAdjustmentSubmit,
    handleEvalRun,
    handleReleaseChecklistRun,
    refreshAdminData,
  } = runtime;

  return (
    <section className="admin-layout" aria-label="運用診断">
      <Panel title="運用スコープと状態" wide>
        <p data-testid="ops-status">Ops access: {opsState}</p>
        <DefinitionGrid
          variant="scope"
          testId="ops-scope-compact-summary"
          items={[
            { label: "Scope", value: <span data-testid="ops-scope-summary">{opsScopeLabel}</span> },
            { label: "Filtered worlds", value: visibleOpsWorlds.length },
            { label: "Selected world", value: <span data-testid="ops-selected-world-summary">{selectedAdminWorldLabel}</span> },
            {
              label: "Catalog health",
              value: (
                <span data-testid="ops-catalog-health">
                  {opsCatalogStatus} / packs {opsCatalogPackCount} / templates {opsCatalogTemplateCount} / failures{" "}
                  {opsCatalogFailureCount}
                </span>
              ),
            },
            {
              label: "Release",
              value: `${releaseGate?.verdict ?? "unknown"} / ${releaseGate?.cutover_status?.promote_ready ? "ready" : "blocked"}`,
            },
            {
              label: "Runtime",
              value: projectionStatus?.graph_runtime_status ?? health?.projection_runtime?.graph_runtime_status ?? "unknown",
            },
          ]}
        />
        <form className="stack compact-form">
          <Field label="Pack Filter">
            <select
              data-testid="ops-pack-filter"
              value={opsPackFilter}
              onChange={(event) => {
                setOpsPackFilter(event.target.value);
                setOpsTemplateFilter("");
              }}
              disabled={!opsPackCatalog?.items.length}
            >
              <option value="">All packs</option>
              {(opsPackCatalog?.items ?? []).map((item) => (
                <option key={item.pack_id} value={item.pack_id}>
                  {item.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Template Filter">
            <select
              data-testid="ops-template-filter"
              value={opsTemplateFilter}
              onChange={(event) => setOpsTemplateFilter(event.target.value)}
              disabled={!opsTemplateOptions.length}
            >
              <option value="">All templates</option>
              {opsTemplateOptions.map((item) => (
                <option key={item.template_id} value={item.template_id}>
                  {item.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="運用対象世界">
            <select
              data-testid="ops-world-select"
              value={activeWorldId}
              onChange={(event) => {
                setOpsWorldId(event.target.value);
                setLedgerWorldFilter(event.target.value);
                setAdjustWorldId(event.target.value);
              }}
              disabled={!visibleOpsWorlds.length}
            >
              {visibleOpsWorlds.length ? (
                visibleOpsWorlds.map((item) => (
                  <option key={item.world_context.world_id} value={item.world_context.world_id}>
                    {item.world_context.world_name} / {item.world_context.pack_display_name}
                  </option>
                ))
              ) : (
                <option value={activeWorldId}>{activeWorldId || "No matching worlds"}</option>
              )}
            </select>
          </Field>
        </form>
        <ActionBar>
          <Button
            data-testid="refresh-admin"
            onClick={() =>
              void refreshAdminData(token, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId, session?.session_id)
            }
            disabled={!token}
          >
            更新
          </Button>
          <Button
            className="secondary-button"
            data-testid="rebuild-graph"
            onClick={handleRebuildGraph}
            disabled={!token || rebuildPending || opsState !== "ready"}
          >
            {rebuildPending ? "再構築中" : "Graph 再構築"}
          </Button>
          <Button
            className="secondary-button"
            data-testid="trigger-idle-pass"
            onClick={() => void handleIdlePass()}
            disabled={!token || idlePassPending || opsState !== "ready" || !activeWorldId}
          >
            {idlePassPending ? "実行中" : "Idle pass"}
          </Button>
        </ActionBar>
        {lastRebuild ? (
          <p data-testid="rebuild-result">
            Rebuilt {lastRebuild.records} records at {lastRebuild.completed_at}
          </p>
        ) : null}
      </Panel>

      <Panel title="Catalog" wide>
        <p data-testid="ops-pack-catalog-summary">
          Pack catalog: <strong data-testid="ops-pack-catalog-status">{opsCatalogStatus}</strong> / total packs{" "}
          {opsCatalogPackCount} / templates {opsCatalogTemplateCount} / API{" "}
          {opsPackCatalog?.engine_api_version ?? health?.world_packs?.engine_api_version ?? "unknown"} / failures{" "}
          {opsCatalogFailureCount} / filtered worlds {visibleOpsWorlds.length}
        </p>
        <p data-testid="active-world-context">
          Pack: {activeWorldContext?.pack_display_name ?? "unknown"} / Template:{" "}
          {activeWorldContext?.world_template_display_name ?? "unknown"} / World:{" "}
          {activeWorldContext?.world_name ?? activeWorldId}
        </p>
        <StreamList
          testId="ops-pack-failure-stream"
          items={sortedOpsPackFailures}
          empty="No pack catalog failures."
          getKey={(item, index) => `${item.error}-${item.pack_id ?? "pack-dir"}-${index}`}
          renderItem={(item) => (
            <>
              <strong>
                {item.severity}: {item.error}
              </strong>
              <span>{item.pack_id ?? "pack directory"}</span>
              <span>{item.message}</span>
              <span>{item.path ?? "path unavailable"}</span>
            </>
          )}
        />
        <StreamList
          testId="ops-pack-catalog-stream"
          items={opsPackCatalog?.items ?? []}
          empty="No pack catalog entries."
          getKey={(item) => item.pack_id}
          renderItem={(item) => (
            <>
              <strong>{item.display_name}</strong>
              <span>
                {item.pack_id} / {item.version} / {item.engine_api_version}
              </span>
              <span>
                visibility: {item.visibility} / publish: {item.publish_status}
              </span>
              <span>
                templates ({item.world_templates.length}):{" "}
                {item.world_templates
                  .map((template) => `${template.display_name} (${template.effective_visibility}/${template.effective_publish_status})`)
                  .join(", ")}
              </span>
            </>
          )}
        />
      </Panel>

      <Panel title="Projection / Observability" wide>
        <div className="kpi-grid">
          <p>
            Backend: {projectionStatus?.backend ?? health?.projection?.backend ?? "unknown"} / Graph read:{" "}
            {projectionStatus?.graph_read_mode ?? health?.projection?.graph_read_mode ?? "unknown"} / Runtime:{" "}
            <span data-testid="graph-runtime-status">
              {projectionStatus?.graph_runtime_status ?? health?.projection_runtime?.graph_runtime_status ?? "unknown"}
            </span>
          </p>
          <p>
            Space: {projectionStatus?.space ?? health?.projection?.space ?? "unknown"} / Pending:{" "}
            {projectionStatus?.pending ?? health?.projection?.pending_outbox ?? "unknown"} / Failed:{" "}
            {projectionStatus?.failed ?? health?.projection?.failed_outbox ?? "unknown"} / Projected:{" "}
            {projectionStatus?.projected ?? health?.projection?.projected_outbox ?? "unknown"}
          </p>
          <p data-testid="observability-summary">
            Global SLO: lag {observability?.primary.projection_lag_seconds ?? health?.observability?.projection_lag_seconds ?? 0}s /
            schema valid{" "}
            {((observability?.primary.llm_schema_valid_rate ?? health?.observability?.llm_schema_valid_rate ?? 0) * 100).toFixed(0)}%
            / fallback{" "}
            {((observability?.primary.llm_fallback_rate ?? health?.observability?.llm_fallback_rate ?? 0) * 100).toFixed(0)}%
          </p>
          <p data-testid="canary-health-status">
            Global canary: {observability?.canary.status ?? health?.observability?.canary_health?.status ?? "unknown"} /
            graph {observability?.canary.graph_runtime_status ?? health?.observability?.canary_health?.graph_runtime_status ?? "unknown"} /
            gate {observability?.canary.release_gate_verdict ?? health?.observability?.canary_health?.release_gate_verdict ?? "unknown"}
          </p>
          <p data-testid="embedding-status-summary">
            Embedding: {embeddingStatus?.provider ?? health?.embedding?.provider ?? "unknown"} / model:{" "}
            {embeddingStatus?.model ?? health?.embedding?.model ?? "unknown"} / dim:{" "}
            {embeddingStatus?.dimension ?? health?.embedding?.dimension ?? "unknown"} / pending:{" "}
            {embeddingStatus?.pending_count ?? health?.embedding?.pending_count ?? 0} / failed:{" "}
            {embeddingStatus?.failed_count ?? health?.embedding?.failed_count ?? 0} / status:{" "}
            {embeddingStatus?.runtime_status ?? health?.embedding?.runtime_status ?? "unknown"}
          </p>
          <p data-testid="langfuse-status-summary">
            LLM observability: {observability?.langfuse?.stack ?? health?.llm_observability?.stack ?? "langfuse"} / enabled:{" "}
            {String(observability?.langfuse?.enabled ?? health?.llm_observability?.enabled ?? false)} / status:{" "}
            {observability?.langfuse?.runtime_status ?? health?.llm_observability?.runtime_status ?? "unknown"} / base:{" "}
            {observability?.langfuse?.base_url ?? health?.llm_observability?.base_url ?? "unknown"}
          </p>
        </div>
        {(observability?.langfuse?.last_error ?? health?.llm_observability?.last_error) ? (
          <p data-testid="langfuse-last-error">
            Langfuse note: {observability?.langfuse?.last_error ?? health?.llm_observability?.last_error}
          </p>
        ) : null}
        <StreamList
          testId="observability-snapshot-timeline"
          items={visibleObservabilitySnapshots}
          empty="No observability snapshots match this scope."
          getKey={(item) => item.id}
          renderItem={(item) => (
            <>
              <strong>
                {item.snapshot_kind} / {item.pack_display_name ?? "all packs"} /{" "}
                {item.world_template_display_name ?? "all templates"}
              </strong>
              <span>{item.created_at}</span>
              <span>
                lag {item.primary_slo.projection_lag_seconds ?? 0}s / failed {item.primary_slo.outbox_failed_count ?? 0}
              </span>
              <span>
                schema {((item.primary_slo.llm_schema_valid_rate ?? 0) * 100).toFixed(0)}% / fallback{" "}
                {((item.primary_slo.llm_fallback_rate ?? 0) * 100).toFixed(0)}%
              </span>
              <span>
                canary {item.canary_health.status ?? "unknown"} / gate {item.canary_health.release_gate_verdict ?? "unknown"}
              </span>
            </>
          )}
        />
      </Panel>

      <Panel title="World graph" wide>
        <p data-testid="sp-admin-separation-note">
          SP execution ledger is separate from world progression. Reward item use and follow-up quest unlocks are
          tracked below, not as paid power.
        </p>
        <p data-testid="graph-vertex-count">
          Graph vertices: {graphSummary?.vertex_count ?? 0} / edges:{" "}
          <span data-testid="graph-edge-count">{graphSummary?.edge_count ?? 0}</span>
        </p>
        <p>
          Factions: <span data-testid="graph-faction-count">{graphSummary?.label_counts?.Faction ?? 0}</span> / Quests:{" "}
          <span data-testid="graph-quest-count">{graphSummary?.label_counts?.Quest ?? 0}</span> / Items:{" "}
          <span data-testid="graph-item-count">{graphSummary?.label_counts?.Item ?? 0}</span>
        </p>
        <h3>Neighborhood summary</h3>
        <StreamList
          testId="graph-summary-stream"
          items={graphSummary?.neighborhood_summary ?? []}
          empty="No graph context loaded."
          getKey={(item) => item}
          renderItem={(item) => (
            <>
              <strong>context</strong>
              <span>{item}</span>
            </>
          )}
        />
        <h3>Current world progression</h3>
        <ul className="stream" data-testid="progression-stream">
          {sessionState ? (
            <>
              {sessionState.quests.map((item) => (
                <li key={item.assignment_id}>
                  <strong>{item.title}</strong>
                  <span>
                    {item.stage_key} / {item.status} / {item.progress}/{item.progress_target}
                  </span>
                </li>
              ))}
              {sessionState.inventory.map((item) => (
                <li key={item.id}>
                  <strong>{item.name}</strong>
                  <span>
                    {item.status}
                    {item.effect_kind ? ` / ${item.effect_kind}` : ""}
                  </span>
                </li>
              ))}
            </>
          ) : (
            <li>No active world progression state loaded.</li>
          )}
        </ul>
        <OpsStreams
          relationshipOps={relationshipOps}
          consequenceThreadOps={consequenceThreadOps}
          chapterOps={chapterOps}
          chapterBranchOps={chapterBranchOps}
          routePressureOps={routePressureOps}
          sceneOps={sceneOps}
          locationOps={locationOps}
          travelLogOps={travelLogOps}
          npcRoutineOps={npcRoutineOps}
          npcLocationOps={npcLocationOps}
          ambientBeatOps={ambientBeatOps}
          worldTickOps={worldTickOps}
          offstageBeatOps={offstageBeatOps}
          activeWorldContext={activeWorldContext}
          projectionStatus={projectionStatus}
        />
      </Panel>

      <Panel title="Memory / Council traces" wide>
        <div data-testid="memory-retrieval-trace">
          <p>
            Latest retrieval: {latestRetrievalTrace?.status ?? "unknown"} / fallback:{" "}
            {String(latestRetrievalTrace?.used_fallback ?? false)}
          </p>
          <p>
            Hits: {(latestRetrievalTrace?.retrieved_memory_ids ?? []).join(", ") || "none"} / Scores:{" "}
            {(latestRetrievalTrace?.top_scores ?? []).join(", ") || "none"}
          </p>
        </div>
        <form className="stack compact-form" onSubmit={handleMemorySearch}>
          <Field label="Memory query">
            <input
              data-testid="memory-search-query"
              value={memorySearchQuery}
              onChange={(event) => setMemorySearchQuery(event.target.value)}
            />
          </Field>
          <ActionBar>
            <Button data-testid="run-memory-search" type="submit" disabled={!token || memorySearchPending || opsState !== "ready"}>
              {memorySearchPending ? "検索中" : "Search memory"}
            </Button>
            <Button
              className="secondary-button"
              data-testid="reindex-memories"
              type="button"
              onClick={() => void handleMemoryReindex()}
              disabled={!token || memoryReindexPending || opsState !== "ready"}
            >
              {memoryReindexPending ? "再索引中" : "Reindex memories"}
            </Button>
          </ActionBar>
        </form>
        {lastMemoryReindex ? (
          <p data-testid="memory-reindex-result">
            Reindexed {lastMemoryReindex.processed}/{lastMemoryReindex.queued} memories at{" "}
            {lastMemoryReindex.completed_at}
          </p>
        ) : null}
        <p data-testid="memory-search-world-context">
          Memory search pack: {memorySearchResult?.world_context.pack_display_name ?? activeWorldContext?.pack_display_name ?? "unknown"} /{" "}
          {memorySearchResult?.world_context.world_template_display_name ??
            activeWorldContext?.world_template_display_name ??
            "unknown"}
        </p>
        <StreamList
          testId="memory-search-stream"
          items={memorySearchResult?.hits ?? []}
          empty="No memory search hits."
          getKey={(item) => item.id}
          renderItem={(item) => (
            <>
              <strong>{item.scope}</strong>
              <span>{item.text}</span>
              <span>score {item.score.toFixed(4)}</span>
            </>
          )}
        />
        <h3>Council trace</h3>
        <StreamList
          testId="council-trace-stream"
          items={councilTurns}
          empty="No council turns recorded yet."
          getKey={(item) => item.turn_id}
          renderItem={(item) => (
            <>
              <strong>{item.input_text}</strong>
              <span>{formatPackContext(item.world_context)}</span>
              <span>
                {item.resolution_mode} / final lane {item.model_lane}
              </span>
              <span>
                trace:{" "}
                {item.langfuse_trace_url ? (
                  <a data-testid={`council-trace-link-${item.turn_id}`} href={item.langfuse_trace_url} target="_blank" rel="noreferrer">
                    open
                  </a>
                ) : (
                  item.langfuse_status ?? "disabled"
                )}
              </span>
              <span>
                {item.roles
                  .map(
                    (role) =>
                      `${role.stage_index}.${role.council_role}:${role.approval_status ?? "unknown"}/${role.model_lane}/${role.output_schema_status}/cache ${role.prompt_cache_hit_tokens ?? 0}:${role.prompt_cache_miss_tokens ?? 0}`,
                  )
                  .join(" | ")}
              </span>
            </>
          )}
        />
      </Panel>

      <Panel title="Eval harness / Release gate" wide>
        <p data-testid="release-scope-summary">Scope diagnostics: {opsScopeLabel}</p>
        <p data-testid="release-gate-verdict">
          Global gate verdict: {releaseGate?.verdict ?? "unknown"} / Canary promote:{" "}
          {releaseGate?.canary_promote_status ?? "unknown"}
        </p>
        <p data-testid="release-cutover-readiness">
          Product cutover: {releaseGate?.cutover_status?.promote_ready ? "ready" : "blocked"} / missing checks:{" "}
          {(releaseGate?.cutover_status?.missing_or_failed_checks ?? []).join(", ") || "none"}
        </p>
        <p>
          Trigger: {releaseGate?.trigger_type ?? "unknown"} / Created: {releaseGate?.created_at ?? "not yet run"}
        </p>
        <p data-testid="release-trace-link">
          Release trace:{" "}
          {releaseGate?.langfuse_trace_url ? (
            <a href={releaseGate.langfuse_trace_url} target="_blank" rel="noreferrer">
              open
            </a>
          ) : (
            releaseGate?.langfuse_status ?? "disabled"
          )}{" "}
          / delivery: {releaseGate?.langfuse_delivery ?? "unknown"}
        </p>
        <ActionBar>
          <Button data-testid="run-eval-smoke" onClick={() => void handleEvalRun("dataset", "turn_resolution_smoke")} disabled={!token || evalPending || opsState !== "ready"}>
            {evalPending ? "Running..." : "Run smoke"}
          </Button>
          <Button className="secondary-button" data-testid="run-eval-failure" onClick={() => void handleEvalRun("dataset", "turn_resolution_failure_injection")} disabled={!token || evalPending || opsState !== "ready"}>
            {evalPending ? "Running..." : "Run failure injection"}
          </Button>
          <Button className="secondary-button" data-testid="run-eval-shadow" onClick={() => void handleEvalRun("shadow_replay")} disabled={!token || evalPending || opsState !== "ready"}>
            {evalPending ? "Running..." : "Run shadow replay"}
          </Button>
          <Button data-testid="run-release-checklist" onClick={() => void handleReleaseChecklistRun()} disabled={!token || checklistPending || opsState !== "ready"}>
            {checklistPending ? "Running..." : "Run release checklist"}
          </Button>
        </ActionBar>
        <ReleaseStreams
          releaseGate={releaseGate}
          filteredReleasePackRegressions={filteredReleasePackRegressions}
          filteredShadowFailures={filteredShadowFailures}
          evalRuns={evalRuns}
          evalRunDetail={evalRunDetail}
          filteredRecentTraces={filteredRecentTraces}
        />
      </Panel>

      <Panel title="SP ledger" wide>
        <p data-testid="sp-world-context">
          Pack dimension: {activeWorldContext?.pack_display_name ?? "unknown"} /{" "}
          {activeWorldContext?.world_template_display_name ?? "all templates"}
        </p>
        <p data-testid="sp-overview">
          Accounts: {spOverview?.total_accounts ?? 0} / Ledger rows: {spOverview?.total_ledger_entries ?? 0}
        </p>
        <p>
          Default balance: {spOverview?.default_balance ?? health?.sp?.default_balance ?? "?"} / Choice cost:{" "}
          <span data-testid="turn-cost">
            {spOverview?.choice_turn_cost ?? health?.sp?.choice_turn_cost ?? spOverview?.turn_cost ?? health?.sp?.turn_cost ?? "?"}
          </span>{" "}
          / Free text cost: {spOverview?.free_text_turn_cost ?? health?.sp?.free_text_turn_cost ?? "?"}
        </p>
        {lastAdjustment ? (
          <p data-testid="last-adjustment">
            Last adjustment: {lastAdjustment.delta} to {lastAdjustment.user_sub}, balance {lastAdjustment.balance}
          </p>
        ) : null}
        <h3>Recent adjustments</h3>
        <StreamList
          testId="recent-adjustments-stream"
          items={spOverview?.recent_adjustments ?? []}
          empty="No recent adjustments."
          getKey={(item) => item.id}
          renderItem={(item) => (
            <>
              <strong>{item.reason_code}</strong>
              <span>{item.user_sub}</span>
              <span>{item.delta}</span>
              <span>{item.world_context?.pack_display_name ?? "unknown"}</span>
            </>
          )}
        />
        <h3>Adjustment form</h3>
        <form className="stack compact-form" onSubmit={handleAdjustmentSubmit}>
          <Field label="User sub">
            <input data-testid="adjust-user-sub" value={adjustUserSub} onChange={(event) => setAdjustUserSub(event.target.value)} />
          </Field>
          <Field label="Delta">
            <input data-testid="adjust-delta" value={adjustDelta} onChange={(event) => setAdjustDelta(event.target.value)} />
          </Field>
          <Field label="Reason code">
            <input data-testid="adjust-reason" value={adjustReason} onChange={(event) => setAdjustReason(event.target.value)} />
          </Field>
          <Field label="World ID">
            <input data-testid="adjust-world-id" value={adjustWorldId} onChange={(event) => setAdjustWorldId(event.target.value)} />
          </Field>
          <Field label="Note">
            <textarea data-testid="adjust-note" rows={3} value={adjustNote} onChange={(event) => setAdjustNote(event.target.value)} />
          </Field>
          <Button data-testid="submit-adjustment" type="submit" disabled={!token || adjustPending}>
            {adjustPending ? "Applying..." : "Apply adjustment"}
          </Button>
        </form>
        <h3>Ledger filters</h3>
        <form className="stack compact-form" onSubmit={handleLedgerRefresh}>
          <Field label="User sub">
            <input data-testid="ledger-user-filter" value={ledgerUserFilter} onChange={(event) => setLedgerUserFilter(event.target.value)} />
          </Field>
          <Field label="World ID">
            <input data-testid="ledger-world-filter" value={ledgerWorldFilter} onChange={(event) => setLedgerWorldFilter(event.target.value)} />
          </Field>
          <Button data-testid="refresh-ledger" type="submit" disabled={!token}>
            Refresh ledger
          </Button>
        </form>
        <StreamList
          testId="admin-ledger"
          items={ledgerEntries}
          empty="No ledger entries."
          getKey={(item) => item.id}
          renderItem={(item) => (
            <>
              <strong>{item.reason_code}</strong>
              <span>{item.user_sub}</span>
              <span>
                delta {item.delta} / balance {item.balance_after}
              </span>
              <span>{item.world_context?.pack_display_name ?? item.world_id ?? "unknown"}</span>
            </>
          )}
        />
      </Panel>
    </section>
  );
}

function OpsStreams({
  relationshipOps,
  consequenceThreadOps,
  chapterOps,
  chapterBranchOps,
  routePressureOps,
  sceneOps,
  locationOps,
  travelLogOps,
  npcRoutineOps,
  npcLocationOps,
  ambientBeatOps,
  worldTickOps,
  offstageBeatOps,
  activeWorldContext,
  projectionStatus,
}: Pick<
  GestalokaRuntime,
  | "relationshipOps"
  | "consequenceThreadOps"
  | "chapterOps"
  | "chapterBranchOps"
  | "routePressureOps"
  | "sceneOps"
  | "locationOps"
  | "travelLogOps"
  | "npcRoutineOps"
  | "npcLocationOps"
  | "ambientBeatOps"
  | "worldTickOps"
  | "offstageBeatOps"
  | "activeWorldContext"
  | "projectionStatus"
>) {
  return (
    <>
      <h3>Relationship ops</h3>
      <StreamList testId="relationship-ops-stream" items={relationshipOps} empty="No relationship ops data loaded." getKey={(item) => item.relationship_id} renderItem={(item) => (
        <>
          <strong>{`${item.from_actor_name} -> ${item.to_actor_name}`}</strong>
          <span>{item.relationship_type}</span>
          <span>{item.strength.toFixed(2)} / {item.band}</span>
        </>
      )} />
      <h3>Consequence threads</h3>
      <StreamList testId="consequence-thread-stream" items={consequenceThreadOps} empty="No consequence thread data loaded." getKey={(item) => item.id} renderItem={(item) => (
        <>
          <strong>{item.title}</strong>
          <span>{item.thread_type} / {item.status} / {item.pressure_band}</span>
          <span>{item.summary}</span>
        </>
      )} />
      <h3>Chapter timeline</h3>
      <StreamList testId="chapter-timeline-stream" items={chapterOps} empty="No chapter timeline data loaded." getKey={(item) => item.id} renderItem={(item) => (
        <>
          <strong>{item.chapter_key}</strong>
          <span>{item.status}</span>
          <span>{item.summary}</span>
          {item.crossroads_summary ? <span>{item.crossroads_summary}</span> : null}
        </>
      )} />
      <h3>Chapter branch status</h3>
      <StreamList testId="chapter-branch-stream" items={chapterBranchOps} empty="No chapter branch data loaded." getKey={(item) => item.chapter_id} renderItem={(item) => (
        <>
          <strong>{item.chapter_key}</strong>
          <span>{item.crossroads_status}</span>
          <span>{item.branch_key ?? "uncommitted"}</span>
          <span>{item.crossroads_summary}</span>
        </>
      )} />
      <h3>Route pressures</h3>
      <StreamList testId="route-pressure-stream" items={routePressureOps} empty="No route pressure data loaded." getKey={(item) => `${item.owner_actor_id}-${item.chapter_key}-${item.route_key}`} renderItem={(item) => (
        <>
          <strong>{item.owner_actor_name}</strong>
          <span>{item.chapter_key}</span>
          <span>{item.route_key} / {item.band} / {item.pressure.toFixed(2)}</span>
          <span>{item.last_signal}</span>
        </>
      )} />
      <h3>Scene timeline</h3>
      <StreamList testId="scene-timeline-stream" items={sceneOps} empty="No scene timeline data loaded." getKey={(item) => item.id} renderItem={(item) => (
        <>
          <strong>{item.scene_phase}</strong>
          <span>{item.status}</span>
          <span>{item.stakes_summary}</span>
          <span>{item.pressure_summary}</span>
        </>
      )} />
      <h3>Locations and route states</h3>
      <StreamList testId="location-route-stream" items={locationOps} empty="No location state loaded." getKey={(item) => item.id} renderItem={(item) => (
        <>
          <strong>{item.name}</strong>
          <span>{item.description}</span>
          <span>{locationRouteSummaries(item).map((route) => `${route.route_key}:${route.status}->${route.destination_name}`).join(" | ")}</span>
        </>
      )} />
      <h3>Travel log</h3>
      <StreamList testId="travel-log-stream" items={travelLogOps} empty="No travel log loaded." getKey={(item) => item.event_id} renderItem={(item) => (
        <>
          <strong>{item.turn_id}</strong>
          <span>{item.travel_summary ?? item.narrative ?? "No travel summary"}</span>
          <span>{item.location_id ?? "no location"}</span>
        </>
      )} />
      <h3>NPC routine state</h3>
      <StreamList testId="npc-routine-stream" items={npcRoutineOps} empty="No NPC routine state loaded." getKey={(item) => item.actor_id} renderItem={(item) => (
        <>
          <strong>{item.display_name}</strong>
          <span>{item.location_id ?? "no location"}</span>
          <span>{JSON.stringify(item.routine_state)}</span>
        </>
      )} />
      <h3>NPC current locations</h3>
      <StreamList testId="npc-location-stream" items={npcLocationOps} empty="No NPC location summary loaded." getKey={(item) => `${item.actor_id}-${item.location_id ?? "none"}`} renderItem={(item) => (
        <>
          <strong>{item.display_name}</strong>
          <span>{item.location_name}</span>
          <span>{item.summary}</span>
        </>
      )} />
      <h3>Ambient beat log</h3>
      <StreamList testId="ambient-beat-stream" items={ambientBeatOps} empty="No ambient beat log loaded." getKey={(item) => item.event_id} renderItem={(item) => (
        <>
          <strong>{item.display_name ?? "Unknown figure"}</strong>
          <span>{item.beat_kind}</span>
          <span>{item.visible_summary ?? "No visible summary"}</span>
        </>
      )} />
      <h3>World tick log</h3>
      <StreamList testId="world-tick-stream" items={worldTickOps} empty="No world tick log loaded." getKey={(item) => item.tick_id} renderItem={(item) => (
        <>
          <strong>{item.tick_kind}</strong>
          <span>{activeWorldContext?.pack_display_name ?? "unknown pack"} / {activeWorldContext?.world_template_display_name ?? "unknown template"}</span>
          <span>{item.status}</span>
          <span>{item.summary}</span>
        </>
      )} />
      <h3>Offstage beat log</h3>
      <StreamList testId="offstage-beat-stream" items={offstageBeatOps} empty="No offstage beat log loaded." getKey={(item) => item.event_id} renderItem={(item) => (
        <>
          <strong>{item.display_name ?? "Unknown figure"}</strong>
          <span>{item.beat_kind ?? "beat"}</span>
          <span>{item.visible_summary ?? "No visible summary"}</span>
        </>
      )} />
      <h3>Recent runtime failures</h3>
      <StreamList testId="recent-failures-stream" items={projectionStatus?.recent_failures ?? []} empty="No recent runtime failures." getKey={(item) => item.id} renderItem={(item) => (
        <>
          <strong>{item.projection_type}</strong>
          <span>{formatPackContext(item.world_context)}</span>
          <span>{item.world_context?.world_name ?? item.world_id}</span>
          <span>{item.last_error ?? "no error text"}</span>
        </>
      )} />
    </>
  );
}

function ReleaseStreams({
  releaseGate,
  filteredReleasePackRegressions,
  filteredShadowFailures,
  evalRuns,
  evalRunDetail,
  filteredRecentTraces,
}: Pick<
  GestalokaRuntime,
  | "releaseGate"
  | "filteredReleasePackRegressions"
  | "filteredShadowFailures"
  | "evalRuns"
  | "evalRunDetail"
  | "filteredRecentTraces"
>) {
  return (
    <>
      <h3>Blocked reasons</h3>
      <StreamList testId="release-blocked-reasons" items={releaseGate?.blocked_reasons ?? []} empty="No blocked reasons." getKey={(item) => item} renderItem={(item) => (
        <>
          <strong>blocked</strong>
          <span>{item}</span>
        </>
      )} />
      <h3>Latest checks</h3>
      <ul className="stream" data-testid="release-checks-stream">
        <li>
          <strong>smoke</strong>
          <span>present={String(releaseGate?.checks?.smoke?.present ?? false)} / current={String(releaseGate?.checks?.smoke?.current_passed ?? false)} / candidate={String(releaseGate?.checks?.smoke?.candidate_passed ?? false)}</span>
        </li>
        <li>
          <strong>failure_injection</strong>
          <span>present={String(releaseGate?.checks?.failure_injection?.present ?? false)} / current={String(releaseGate?.checks?.failure_injection?.current_passed ?? false)} / candidate={String(releaseGate?.checks?.failure_injection?.candidate_passed ?? false)}</span>
        </li>
        <li>
          <strong>shadow_replay</strong>
          <span>present={String(releaseGate?.checks?.shadow_replay?.present ?? false)} / current={String(releaseGate?.checks?.shadow_replay?.current_passed ?? false)} / candidate={String(releaseGate?.checks?.shadow_replay?.candidate_passed ?? false)}</span>
        </li>
      </ul>
      <h3>Bundled pack regressions</h3>
      <StreamList testId="release-pack-regressions-stream" items={filteredReleasePackRegressions} empty="No pack regressions match this scope." getKey={([datasetName]) => datasetName} renderItem={([datasetName, check]) => (
        <>
          <strong>{datasetName}</strong>
          <span>{formatPackScope(check.pack_scope)}</span>
          <span>present={String(check.present)} / current={String(check.current_passed)} / candidate={String(check.candidate_passed)}</span>
        </>
      )} />
      <h3>Shadow replay failures</h3>
      <StreamList testId="shadow-failures-stream" items={filteredShadowFailures} empty="No shadow failures match this scope." getKey={(item) => `${item.case_id}-${item.variant}`} renderItem={(item) => (
        <>
          <strong>{item.case_id}</strong>
          <span>{formatPackContext(item.pack_context)}</span>
          <span>{item.variant}</span>
          <span>{item.graph_context_status}</span>
          <span>{item.retrieval_status ?? "unknown"} / hits {item.retrieval_hit_count ?? 0} / required {String(item.retrieval_required ?? false)}</span>
          <span>{(item.failure_categories ?? []).join(", ") || "unclassified"}</span>
          <span>{item.failure_diagnostics ?? "no diagnostics"}</span>
          <span>{item.failure_reason ?? "none"}</span>
        </>
      )} />
      <h3>Canary and SLO</h3>
      <ul className="stream" data-testid="release-slo-stream">
        <li>
          <strong>global canary</strong>
          <span>{releaseGate?.slo_snapshot?.canary_health?.status ?? "unknown"}</span>
          <span>{releaseGate?.slo_snapshot?.canary_health?.detail ?? "no detail"}</span>
        </li>
        <li>
          <strong>global primary</strong>
          <span>lag {releaseGate?.slo_snapshot?.projection_lag_seconds ?? 0}s</span>
          <span>pending {releaseGate?.slo_snapshot?.outbox_pending_count ?? 0}</span>
          <span>failed {releaseGate?.slo_snapshot?.outbox_failed_count ?? 0}</span>
        </li>
        <li>
          <strong>llm</strong>
          <span>schema {(((releaseGate?.slo_snapshot?.llm_schema_valid_rate ?? 0) as number) * 100).toFixed(0)}%</span>
          <span>fallback {(((releaseGate?.slo_snapshot?.llm_fallback_rate ?? 0) as number) * 100).toFixed(0)}%</span>
        </li>
      </ul>
      <h3>Runbook</h3>
      <ul className="stream" data-testid="release-runbook">
        <li><strong>canary up</strong><span>{releaseGate?.runbook?.canary_up ?? "make canary-up"}</span></li>
        <li><strong>canary probe</strong><span>{releaseGate?.runbook?.canary_probe ?? "make canary-probe"}</span></li>
        <li><strong>pre-promote checklist</strong><span>{releaseGate?.runbook?.pre_promote_checklist ?? "make release-checklist"}</span></li>
        <li><strong>nightly gate</strong><span>{releaseGate?.runbook?.nightly_gate ?? "make nightly-eval"}</span></li>
        <li><strong>promote condition</strong><span>{releaseGate?.runbook?.promote_condition ?? "verdict == passed and canary_promote_status == ready"}</span></li>
        <li><strong>promote</strong><span>{releaseGate?.runbook?.promote ?? "blocked until gate passes"}</span></li>
        <li><strong>rollback</strong><span>{releaseGate?.runbook?.rollback ?? "make canary-down"}</span></li>
      </ul>
      <h3>Current vs candidate diff</h3>
      <StreamList testId="release-diff-stream" items={releaseGate?.diff_summary ?? []} empty="No release diff." getKey={(item) => item.route_id} renderItem={(item) => (
        <>
          <strong>{item.route_id}</strong>
          <span>current: {item.current?.model_ids.main_lane ?? "none"}</span>
          <span>candidate: {item.candidate?.model_ids.main_lane ?? "none"}</span>
        </>
      )} />
      <h3>Latest eval runs</h3>
      <StreamList testId="eval-runs-stream" items={evalRuns} empty="No eval runs." getKey={(item) => item.id} renderItem={(item) => (
        <>
          <strong>{item.dataset_name ?? item.source_type}</strong>
          <span>{formatPackScope(item.summary.pack_scope)}</span>
          <span>{item.status}</span>
          <span>{item.trigger_type} / {item.runtime_role}</span>
          <span>current {item.summary.variants?.current?.passed ?? 0}/{item.summary.variants?.current?.total ?? 0}</span>
          <span>candidate {item.summary.variants?.candidate?.passed ?? 0}/{item.summary.variants?.candidate?.total ?? 0}</span>
        </>
      )} />
      <h3>Latest eval case results</h3>
      <StreamList testId="eval-case-results-stream" items={(evalRunDetail?.results ?? []).slice(0, 12)} empty="No eval case results." getKey={(item) => `${item.id}-${item.variant}`} renderItem={(item) => (
        <>
          <strong>{item.case_id}</strong>
          <span>{formatPackContext(item.pack_context)}</span>
          <span>{item.variant} / {item.lane}</span>
          <span>schema={String(item.schema_valid)} / same-world={String(item.same_world_invariant)}</span>
          <span>graph={item.graph_context_status} / passed={String(item.passed)}</span>
          <span>{item.failure_reason ?? "none"}</span>
        </>
      )} />
      <h3>Recent traces</h3>
      <StreamList testId="observability-traces-stream" items={filteredRecentTraces.slice(0, 8)} empty="No traces match this scope." getKey={(item, index) => `${item.name}-${index}`} renderItem={(item) => (
        <>
          <strong>{item.name}</strong>
          <span>{JSON.stringify(item.attributes)}</span>
        </>
      )} />
    </>
  );
}
