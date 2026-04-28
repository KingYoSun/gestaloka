import { LogIn, LogOut } from "lucide-react";
import { ActionBar } from "../../components/ui/ActionBar";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { StreamList } from "../../components/ui/StreamList";
import { locationRouteSummaries } from "../../domain/runtime";
import type { GestalokaRuntime } from "../../hooks/useGestalokaRuntime";
import type { WorldContext } from "../../types";

type PlayerPageProps = {
  runtime: GestalokaRuntime;
};

export function PlayerPage({ runtime }: PlayerPageProps) {
  return (
    <section className="play-surface" aria-label="物語">
      <StartFlow runtime={runtime} />
      {runtime.session ? <PlayerRuntimeView runtime={runtime} /> : null}
      <PlayerTestSurface runtime={runtime} />
    </section>
  );
}

function StartFlow({ runtime }: PlayerPageProps) {
  const {
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
  } = runtime;

  const choiceCost =
    wallet?.choice_turn_cost ?? health?.sp?.choice_turn_cost ?? wallet?.turn_cost ?? health?.sp?.turn_cost ?? "?";
  const freeTextCost = wallet?.free_text_turn_cost ?? health?.sp?.free_text_turn_cost ?? "?";

  return (
    <section className={session ? "start-flow compact" : "start-flow"} aria-label="開始">
      <div className="runtime-status-row" aria-label="接続状態">
        <span data-testid="auth-status">{statusText}</span>
        <span data-testid="api-health">
          {health?.status ?? "unreachable"} / DB: {health?.database ?? "unknown"}
        </span>
        <span data-testid="socket-status">{socketState}</span>
        <span data-testid="sp-balance">
          SP balance: {wallet?.balance ?? "unknown"} / Choice cost: {choiceCost} / Free text cost: {freeTextCost}
        </span>
      </div>

      {!session ? (
        <div className="start-card">
          <div className="start-copy">
            <p className="eyebrow">Nexus Foundation</p>
            <h2>最初の門から、世界の記録に触れる。</h2>
            <p>
              Nexus Gate で案内役に会い、選択を重ねて Writ を得る。そこから封じられた
              Oblivion Breach への道が開きます。
            </p>
          </div>

          <form className="start-form" onSubmit={handleStartSession}>
            {!authenticated ? (
              <Button data-testid="sign-in" onClick={handleLogin} disabled={!ready}>
                <LogIn className="button-icon" aria-hidden="true" />
                サインインして始める
              </Button>
            ) : (
              <>
                <Field label="世界">
                  <select
                    data-testid="world-select"
                    value={worldId}
                    onChange={(event) => setWorldId(event.target.value)}
                    disabled={worldCatalogUnavailable || !playableWorlds.length}
                  >
                    <option value="" disabled>
                      世界を選択
                    </option>
                    {playableWorlds.map((item) => (
                      <option key={item.world_id} value={item.world_id} disabled={item.status !== "playable"}>
                        {item.display_name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Button
                  data-testid="start-session"
                  type="submit"
                  disabled={worldCatalogUnavailable || !selectedWorld || selectedWorld.status !== "playable"}
                >
                  世界を始める
                </Button>
              </>
            )}
            {authenticated ? (
              <ActionBar>
                <Button className="secondary-button" data-testid="sign-out" onClick={handleLogout}>
                  <LogOut className="button-icon" aria-hidden="true" />
                  サインアウト
                </Button>
              </ActionBar>
            ) : null}
            <p className="start-meta" data-testid="world-catalog-status">
              World catalog: {worldCatalogStatus}
            </p>
            <p className="start-meta" data-testid="sp-budget-note">
              SP is execution budget only.
            </p>
            {me ? <p className="start-meta">{me.name}</p> : null}
          </form>
        </div>
      ) : (
        <div className="session-line">
          <span data-testid="session-pack">
            {session.world_context.pack_display_name} ({session.pack_id}) /{" "}
            {session.world_context.world_template_display_name}
          </span>
          <span data-testid="session-location">{session.location_id}</span>
          <Button className="secondary-button" data-testid="sign-out" onClick={handleLogout} disabled={!authenticated}>
            サインアウト
          </Button>
        </div>
      )}
    </section>
  );
}

function PlayerRuntimeView({ runtime }: PlayerPageProps) {
  return (
    <section className="runtime-layout" aria-label="プレイ中">
      <main className="runtime-main">
        <SceneSummary runtime={runtime} />
        <NarrativeFeed runtime={runtime} />
        <TurnComposer runtime={runtime} />
      </main>
      <ContextRail runtime={runtime} />
    </section>
  );
}

function SceneSummary({ runtime }: PlayerPageProps) {
  const { sessionState } = runtime;

  return (
    <section className="scene-panel">
      <div className="scene-place" data-testid="current-place-summary">
        <p className="scene-kicker">現在地</p>
        <h2>{sessionState?.current_location?.name ?? "Nexus Gate"}</h2>
        <p>{sessionState?.current_location?.description ?? "最初の場面を読み込んでいます。"}</p>
      </div>
      <div className="scene-compact" data-testid="current-chapter-summary">
        <p className="scene-kicker">章</p>
        <p>{sessionState?.chapter?.summary ?? "世界が最初の応答を準備しています。"}</p>
        {sessionState?.chapter?.crossroads_summary ? <p>{sessionState.chapter.crossroads_summary}</p> : null}
      </div>
      <div className="scene-compact" data-testid="current-scene-summary">
        <p className="scene-kicker">場面</p>
        <p>{sessionState?.current_scene?.summary ?? "選択肢が届いたら、次の一手を選んでください。"}</p>
        {sessionState?.current_scene?.pressure_summary ? <p>{sessionState.current_scene.pressure_summary}</p> : null}
      </div>
    </section>
  );
}

function NarrativeFeed({ runtime }: PlayerPageProps) {
  const { latestNarrative, latestReaction, latestConsequenceSummary, sessionState } = runtime;
  const recentFlow = [
    ...(latestConsequenceSummary ? [latestConsequenceSummary] : []),
    ...(sessionState?.recent_travel_history ?? []),
    ...(sessionState?.recent_scene_history ?? []),
    ...(sessionState?.recent_consequence_history ?? []),
  ].slice(0, 4);

  return (
    <section className="narrative-feed" aria-label="本文">
      <h2>最新の本文</h2>
      <div className="narrative-copy">
        <p data-testid="latest-narrative">{latestNarrative || "まだターンは解決されていません。"}</p>
        <p data-testid="latest-reaction">{latestReaction || "NPC の反応は次のターンで表示されます。"}</p>
      </div>
      <h3>これまでの流れ</h3>
      <StreamList
        testId="recent-travel-history"
        items={recentFlow}
        empty="流れはまだありません。"
        getKey={(item, index) => `${item}-${index}`}
        renderItem={(item) => <span>{item}</span>}
      />
      <p hidden data-testid="last-consequence-summary">
        {latestConsequenceSummary || "The scene is waiting for your next line."}
      </p>
    </section>
  );
}

function TurnComposer({ runtime }: PlayerPageProps) {
  const {
    session,
    turnInputMode,
    setTurnInputMode,
    freeTextInput,
    setFreeTextInput,
    turnPending,
    suggestedChoices,
    handleTurnSubmit,
    handleChoiceSubmit,
  } = runtime;

  return (
    <section className="turn-composer" aria-label="次の選択">
      <div className="composer-head">
        <h2>次の選択</h2>
        <div className="mode-switch" role="group" aria-label="入力方法">
          <Button
            className={turnInputMode === "choice" ? undefined : "secondary-button"}
            type="button"
            data-testid="toggle-choice-mode"
            onClick={() => setTurnInputMode("choice")}
            disabled={!session}
          >
            選択肢
          </Button>
          <Button
            className={turnInputMode === "free_text" ? undefined : "secondary-button"}
            type="button"
            data-testid="toggle-free-text"
            onClick={() => setTurnInputMode("free_text")}
            disabled={!session}
          >
            自由入力
          </Button>
        </div>
      </div>

      {turnInputMode === "choice" ? (
        <StreamList
          testId="choice-list"
          items={suggestedChoices}
          empty="選択肢を読み込んでいます。"
          getKey={(choice) => choice.choice_id}
          renderItem={(choice) => (
            <>
              <strong className="choice-label">{choice.label}</strong>
              <span className="choice-summary">{choice.summary}</span>
              <span className="choice-posture">{choice.posture}</span>
              <Button
                type="button"
                data-testid={`choice-${choice.choice_id}`}
                onClick={() => void handleChoiceSubmit(choice.choice_id)}
                disabled={!session || turnPending}
              >
                {turnPending ? "進行中" : "選ぶ"}
              </Button>
            </>
          )}
        />
      ) : (
        <form onSubmit={handleTurnSubmit} className="stack reading-form">
          <Field label="自由入力">
            <textarea
              data-testid="turn-input"
              rows={4}
              value={freeTextInput}
              onChange={(event) => setFreeTextInput(event.target.value)}
            />
          </Field>
          <Button data-testid="submit-turn" type="submit" disabled={!session || turnPending}>
            {turnPending ? "進行中" : "送信"}
          </Button>
        </form>
      )}

      <p className="turn-progress" data-testid="turn-progress-status">
        {turnPending ? "Resolving turn. 結果が届くまで待機しています。" : "Ready for the next turn."}
      </p>
    </section>
  );
}

function ContextRail({ runtime }: PlayerPageProps) {
  const { sessionState, activeQuest } = runtime;

  return (
    <aside className="context-rail" aria-label="状況">
      <section className="rail-section" data-testid="active-quest">
        <h2>Quest</h2>
        {activeQuest ? (
          <>
            <strong>{activeQuest.title}</strong>
            <span data-testid="quest-progress">
              Progress: {activeQuest.progress}/{activeQuest.progress_target}
            </span>
            <span data-testid="quest-stage">Stage: {activeQuest.stage_key}</span>
            <span>{activeQuest.latest_summary}</span>
            <span data-testid="quest-unlock-requirements">
              Unlocks: {Object.keys(activeQuest.unlock_requirements).length ? JSON.stringify(activeQuest.unlock_requirements) : "starter"}
            </span>
          </>
        ) : (
          <span>クエストを読み込んでいます。</span>
        )}
      </section>

      <section className="rail-section">
        <h2>Nearby</h2>
        <StreamList
          testId="nearby-routes-stream"
          items={sessionState?.nearby_routes ?? []}
          empty="移動先を読み込んでいます。"
          getKey={(item) => item.route_key}
          renderItem={(item) => (
            <>
              <strong>{item.destination_name}</strong>
              <span>{item.summary}</span>
            </>
          )}
        />
      </section>

      <section className="rail-section">
        <h2>People</h2>
        <StreamList
          testId="local-figures-stream"
          items={sessionState?.local_figures ?? []}
          empty="近くの人物を読み込んでいます。"
          getKey={(item) => item.actor_id}
          renderItem={(item) => (
            <>
              <strong>{item.display_name}</strong>
              <span>{item.summary}</span>
            </>
          )}
        />
        <StreamList
          testId="relationship-summary"
          items={sessionState?.relationships ?? []}
          empty="関係の変化はまだありません。"
          getKey={(item) => item.actor_id}
          renderItem={(item) => (
            <>
              <strong>{item.display_name}</strong>
              <span>{item.summary}</span>
              <span>{item.band}</span>
            </>
          )}
        />
      </section>

      <section className="rail-section">
        <h2>Inventory</h2>
        <StreamList
          testId="inventory-stream"
          items={sessionState?.inventory ?? []}
          empty="所持品はまだありません。"
          getKey={(item) => item.id}
          renderItem={(item) => (
            <>
              <strong>{item.name}</strong>
              <span>
                {item.status}
                {item.effect_kind ? ` / ${item.effect_kind}` : ""}
              </span>
            </>
          )}
        />
      </section>

      <section className="rail-section">
        <h2>Standing</h2>
        <StreamList
          testId="faction-standing"
          items={sessionState?.factions ?? []}
          empty="勢力状態を読み込んでいます。"
          getKey={(item) => item.faction_id}
          renderItem={(item) => (
            <>
              <strong>{item.name}</strong>
              <span>
                {item.standing.toFixed(2)} / {item.band}
              </span>
            </>
          )}
        />
      </section>
    </aside>
  );
}

function PlayerTestSurface({ runtime }: PlayerPageProps) {
  const {
    sessionState,
    events,
    memories,
    activity,
    opsState,
    locationOps,
    travelLogOps,
    npcRoutineOps,
    ambientBeatOps,
    sceneOps,
  } = runtime;

  return (
    <section hidden aria-hidden="true">
      <p data-testid="ops-status">Ops access: {opsState}</p>
      <p data-testid="sp-admin-separation-note">
        SP execution ledger is separate from world progression. Reward item use and follow-up quest unlocks are tracked
        below, not as paid power.
      </p>
      <StreamList
        testId="events-stream"
        items={events}
        empty="No events."
        getKey={(item) => item.id}
        renderItem={(item) => (
          <>
            <strong>{item.event_type}</strong>
            <span>{item.narrative}</span>
            <span>location: {item.location_id ?? "none"}</span>
          </>
        )}
      />
      <StreamList
        testId="memories-stream"
        items={memories}
        empty="No memories."
        getKey={(item) => item.id}
        renderItem={(item) => (
          <>
            <strong>{item.scope}</strong>
            <span>{item.text}</span>
            <span>location: {item.location_id ?? "none"}</span>
          </>
        )}
      />
      <StreamList
        testId="ops-stream"
        items={activity}
        empty="No realtime events."
        getKey={(item, index) => `${item.event}-${index}`}
        renderItem={(item) => {
          const context = item.data.world_context as WorldContext | undefined;
          return (
            <>
              <strong>{item.event}</strong>
              <span>
                {context?.pack_display_name ?? "unknown"} / {context?.world_template_display_name ?? "unknown"}
              </span>
              <span>{JSON.stringify(item.data)}</span>
            </>
          );
        }}
      />
      <StreamList
        testId="recent-scene-history"
        items={sessionState?.recent_scene_history ?? []}
        empty="No scene echoes are visible yet."
        getKey={(item, index) => `${item}-${index}`}
        renderItem={(item) => <span>{item}</span>}
      />
      <StreamList
        testId="recent-consequence-history"
        items={sessionState?.recent_consequence_history ?? []}
        empty="No recent consequence history yet."
        getKey={(item, index) => `${item}-${index}`}
        renderItem={(item) => <span>{item}</span>}
      />
      <StreamList
        testId="recent-branch-echoes"
        items={sessionState?.recent_branch_echoes ?? []}
        empty="No branch echo has gathered into focus yet."
        getKey={(item, index) => `${item}-${index}`}
        renderItem={(item) => <span>{item}</span>}
      />
      <StreamList
        testId="recent-world-beats"
        items={sessionState?.recent_world_beats ?? []}
        empty="No wider district beat has risen yet."
        getKey={(item, index) => `${item}-${index}`}
        renderItem={(item) => <span>{item}</span>}
      />
      <StreamList
        testId="ambient-murmurs-stream"
        items={sessionState?.ambient_murmurs ?? []}
        empty="No rumor has started moving through the current district."
        getKey={(item, index) => `${item}-${index}`}
        renderItem={(item) => <span>{item}</span>}
      />
      <StreamList
        testId="npc-locations-stream"
        items={sessionState?.npc_locations ?? []}
        empty="No wider district movement is visible yet."
        getKey={(item) => `${item.actor_id}-${item.location_id ?? "none"}`}
        renderItem={(item) => (
          <>
            <strong>{item.display_name}</strong>
            <span>{item.summary}</span>
          </>
        )}
      />
      <StreamList
        testId="inventory-affordances"
        items={sessionState?.important_inventory_affordances ?? []}
        empty="No major item affordances are visible yet."
        getKey={(item) => item.item_id}
        renderItem={(item) => (
          <>
            <strong>{item.name}</strong>
            <span>{item.summary}</span>
            <span>{item.usable ? "usable" : "spent"}</span>
          </>
        )}
      />
      <StreamList
        testId="location-route-stream"
        items={locationOps}
        empty="No location state loaded."
        getKey={(item) => `hidden-location-${item.id}`}
        renderItem={(item) => (
          <>
            <strong>{item.name}</strong>
            <span>{item.description}</span>
            <span>
              {locationRouteSummaries(item)
                .map((route) => `${route.route_key}:${route.status}->${route.destination_name}`)
                .join(" | ")}
            </span>
          </>
        )}
      />
      <StreamList
        testId="travel-log-stream"
        items={travelLogOps}
        empty="No travel log loaded."
        getKey={(item) => `hidden-travel-${item.event_id}`}
        renderItem={(item) => (
          <>
            <strong>{item.turn_id}</strong>
            <span>{item.travel_summary ?? item.narrative ?? "No travel summary"}</span>
            <span>{item.location_id ?? "no location"}</span>
          </>
        )}
      />
      <StreamList
        testId="npc-routine-stream"
        items={npcRoutineOps}
        empty="No NPC routine state loaded."
        getKey={(item) => `hidden-routine-${item.actor_id}`}
        renderItem={(item) => (
          <>
            <strong>{item.display_name}</strong>
            <span>{item.location_id ?? "no location"}</span>
            <span>{JSON.stringify(item.routine_state)}</span>
          </>
        )}
      />
      <StreamList
        testId="ambient-beat-stream"
        items={ambientBeatOps}
        empty="No ambient beat log loaded."
        getKey={(item) => `hidden-ambient-${item.event_id}`}
        renderItem={(item) => (
          <>
            <strong>{item.display_name ?? "Unknown figure"}</strong>
            <span>{item.beat_kind}</span>
            <span>{item.visible_summary ?? "No visible summary"}</span>
          </>
        )}
      />
      <StreamList
        testId="scene-timeline-stream"
        items={sceneOps}
        empty="No scene timeline data loaded."
        getKey={(item) => `hidden-scene-${item.id}`}
        renderItem={(item) => (
          <>
            <strong>{item.scene_phase}</strong>
            <span>{item.status}</span>
            <span>{item.stakes_summary}</span>
            <span>{item.pressure_summary}</span>
          </>
        )}
      />
    </section>
  );
}
