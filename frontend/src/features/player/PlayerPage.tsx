import { LogIn, UserPlus } from "lucide-react";
import type { FormEvent } from "react";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/input";
import { NativeSelect } from "../../components/ui/native-select";
import { StreamList } from "../../components/ui/StreamList";
import { Textarea } from "../../components/ui/textarea";
import { locationRouteSummaries } from "../../domain/runtime";
import type { GestalokaRuntime } from "../../hooks/useGestalokaRuntime";
import type { NarrativeChoice, PlayerProfile, WorldContext } from "../../types";

type PlayerPageProps = {
  runtime: GestalokaRuntime;
};

type TextItem = {
  key: string;
  title?: string;
  body: string;
  meta?: string;
};

function formatOpsEventSummary(data: Record<string, unknown>): string {
  const keys = [
    "world_id",
    "session_id",
    "location_id",
    "status",
    "graph_runtime_status",
    "release_gate_verdict",
    "verdict",
    "report_id",
  ];
  const parts = keys
    .map((key) => {
      const value = data[key];
      return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? `${key}: ${value}` : "";
    })
    .filter(Boolean);
  return parts.join(" / ") || "event received";
}

function formatRoutineState(state: Record<string, unknown>): string {
  const parts = Object.entries(state)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return parts.join(" / ") || "routine state summarized";
}

export function PlayerPage({ runtime }: PlayerPageProps) {
  return (
    <section className="grid min-h-[calc(100vh-2.5rem)]" aria-label="物語">
      {!runtime.authenticated ? <FirstView runtime={runtime} /> : null}
      {runtime.authenticated && !runtime.session ? <WorldStartView runtime={runtime} /> : null}
      {runtime.session ? <PlayingView runtime={runtime} /> : null}
      <PlayerTestSurface runtime={runtime} />
    </section>
  );
}

function FirstView({ runtime }: PlayerPageProps) {
  return (
    <section className="grid min-h-[calc(100vh-2.5rem)] grid-rows-[auto_1fr] py-5" aria-label="開始">
      <p className="text-sm font-bold leading-[21px] text-foreground">GESTALOKA</p>
      <div className="grid w-full max-w-80 min-w-0 self-center gap-4 max-[480px]:max-w-none">
        <Button data-testid="sign-in" onClick={runtime.handleLogin} disabled={!runtime.ready}>
          <LogIn aria-hidden="true" />
          ログインして続ける
        </Button>
        <Button variant="secondary" onClick={runtime.handleRegister} disabled={!runtime.ready}>
          <UserPlus aria-hidden="true" />
          アカウントを作成して始める
        </Button>
      </div>
    </section>
  );
}

function WorldStartView({ runtime }: PlayerPageProps) {
  const {
    beginProfileEdit,
    cancelProfileEdit,
    editingPlayerActorId,
    handleCreatePlayerProfile,
    playableWorlds,
    playerProfiles,
    profileDraft,
    profilePending,
    selectedWorld,
    selectedPlayerActorId,
    selectedPlayerProfile,
    setProfileDraft,
    setSelectedPlayerActorId,
    setWorldId,
    wallet,
    worldCatalogUnavailable,
    worldCatalogStatus,
    worldId,
    handleStartSession,
  } = runtime;
  const catalogStateLabel = worldCatalogUnavailable
    ? "世界を読み込めません"
    : (!playableWorlds.length && worldCatalogStatus !== "ready" ? "読込中" : "");

  return (
    <section className="grid min-h-[calc(100vh-2.5rem)] grid-rows-[auto_1fr] py-5" aria-label="世界開始">
      <p className="text-sm font-bold leading-[21px] text-foreground">GESTALOKA</p>
      <div className="grid min-w-0 grid-cols-[minmax(0,320px)_minmax(0,620px)] items-start gap-4 self-center max-[940px]:grid-cols-1">
        <div className="grid min-w-0 gap-3">
          <Field label="世界">
            <NativeSelect
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
            </NativeSelect>
          </Field>
          <p className="text-[28px] font-bold leading-9 tracking-[1.12px] text-foreground max-[480px]:text-2xl max-[480px]:leading-8">
            {selectedWorld?.display_name ?? "世界を選択"}
          </p>
          {catalogStateLabel ? <p className="text-xs font-semibold leading-[18px] text-muted-foreground">{catalogStateLabel}</p> : null}
          {wallet ? <p className="text-xs font-semibold leading-[18px] text-muted-foreground">SP {wallet.balance}</p> : null}
        </div>
        <div className="grid min-w-0 gap-3">
          {playerProfiles.length ? (
            <Field label="プレイヤー">
              <NativeSelect
                data-testid="player-profile-select"
                value={selectedPlayerActorId}
                onChange={(event) => setSelectedPlayerActorId(event.target.value)}
              >
                {playerProfiles.map((profile) => (
                  <option key={profile.actor_id} value={profile.actor_id}>
                    {profile.display_name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          {selectedPlayerProfile ? <ProfileSummary onEdit={beginProfileEdit} profile={selectedPlayerProfile} /> : null}
          <ProfileForm
            editingPlayerActorId={editingPlayerActorId}
            onCancelEdit={cancelProfileEdit}
            profileDraft={profileDraft}
            profilePending={profilePending}
            setProfileDraft={setProfileDraft}
            onSubmit={handleCreatePlayerProfile}
          />
          <form onSubmit={handleStartSession}>
            <Button
              data-testid="start-session"
              type="submit"
              disabled={
                worldCatalogUnavailable ||
                !selectedWorld ||
                selectedWorld.status !== "playable" ||
                !selectedPlayerProfile
              }
            >
              始める
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}

function ProfileSummary({ onEdit, profile }: { onEdit: (profile: PlayerProfile) => void; profile: PlayerProfile }) {
  const styleLabel = [
    profile.narrative_preferences.perspective === "first_person" ? "一人称" : "三人称",
    profile.narrative_preferences.tone === "lyrical" ? "叙情的" : "論理的",
    profile.narrative_preferences.density === "concise" ? "簡素" : "重厚",
    profile.narrative_preferences.dialogue_style === "dialogue_forward" ? "セリフ中心" : "文語的",
  ].join(" / ");
  return (
    <Card>
      <CardContent className="grid gap-1 p-3">
        <p className="text-base font-bold leading-6 text-foreground">{profile.display_name}</p>
        <p className="text-xs font-semibold leading-[18px] text-muted-foreground">{styleLabel}</p>
        {!profile.locked ? (
          <Button className="mt-1 w-fit" variant="secondary" type="button" onClick={() => onEdit(profile)}>
            編集
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ProfileForm({
  onSubmit,
  editingPlayerActorId,
  onCancelEdit,
  profileDraft,
  profilePending,
  setProfileDraft,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  editingPlayerActorId: string;
  onCancelEdit: () => void;
  profileDraft: GestalokaRuntime["profileDraft"];
  profilePending: boolean;
  setProfileDraft: GestalokaRuntime["setProfileDraft"];
}) {
  return (
    <form className="grid min-w-0 gap-3" onSubmit={onSubmit}>
      <Field label="名前">
        <Input
          data-testid="profile-display-name"
          value={profileDraft.display_name}
          maxLength={40}
          onChange={(event) => setProfileDraft((current) => ({ ...current, display_name: event.target.value }))}
        />
      </Field>
      <Field label="性別">
        <NativeSelect
          value={profileDraft.gender}
          onChange={(event) =>
            setProfileDraft((current) => ({ ...current, gender: event.target.value as PlayerProfile["gender"] }))
          }
        >
          <option value="unspecified">未指定</option>
          <option value="male">男</option>
          <option value="female">女</option>
          <option value="other">その他</option>
        </NativeSelect>
      </Field>
      <Field label="背景">
        <Textarea
          rows={3}
          value={profileDraft.background}
          maxLength={1200}
          onChange={(event) => setProfileDraft((current) => ({ ...current, background: event.target.value }))}
        />
      </Field>
      <Field label="自由記述">
        <Textarea
          rows={3}
          value={profileDraft.free_text}
          maxLength={2000}
          onChange={(event) => setProfileDraft((current) => ({ ...current, free_text: event.target.value }))}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3 max-[480px]:grid-cols-1">
        <Field label="視点">
          <NativeSelect
            value={profileDraft.narrative_preferences.perspective}
            onChange={(event) =>
              setProfileDraft((current) => ({
                ...current,
                narrative_preferences: {
                  ...current.narrative_preferences,
                  perspective: event.target.value as PlayerProfile["narrative_preferences"]["perspective"],
                },
              }))
            }
          >
            <option value="third_person">三人称</option>
            <option value="first_person">一人称</option>
          </NativeSelect>
        </Field>
        <Field label="調子">
          <NativeSelect
            value={profileDraft.narrative_preferences.tone}
            onChange={(event) =>
              setProfileDraft((current) => ({
                ...current,
                narrative_preferences: {
                  ...current.narrative_preferences,
                  tone: event.target.value as PlayerProfile["narrative_preferences"]["tone"],
                },
              }))
            }
          >
            <option value="lyrical">叙情的</option>
            <option value="logical">論理的</option>
          </NativeSelect>
        </Field>
        <Field label="密度">
          <NativeSelect
            value={profileDraft.narrative_preferences.density}
            onChange={(event) =>
              setProfileDraft((current) => ({
                ...current,
                narrative_preferences: {
                  ...current.narrative_preferences,
                  density: event.target.value as PlayerProfile["narrative_preferences"]["density"],
                },
              }))
            }
          >
            <option value="concise">簡素</option>
            <option value="ornate">重厚</option>
          </NativeSelect>
        </Field>
        <Field label="文">
          <NativeSelect
            value={profileDraft.narrative_preferences.dialogue_style}
            onChange={(event) =>
              setProfileDraft((current) => ({
                ...current,
                narrative_preferences: {
                  ...current.narrative_preferences,
                  dialogue_style: event.target.value as PlayerProfile["narrative_preferences"]["dialogue_style"],
                },
              }))
            }
          >
            <option value="literary">文語的</option>
            <option value="dialogue_forward">セリフ中心</option>
          </NativeSelect>
        </Field>
      </div>
      <div className="flex flex-wrap gap-3 max-[480px]:grid max-[480px]:grid-cols-1">
        <Button data-testid="create-player-profile" type="submit" disabled={profilePending || !profileDraft.display_name.trim()}>
          {editingPlayerActorId ? "保存" : "作成"}
        </Button>
        {editingPlayerActorId ? (
          <Button variant="secondary" type="button" onClick={onCancelEdit} disabled={profilePending}>
            取消
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function PlayingView({ runtime }: PlayerPageProps) {
  return (
    <section
      className="grid grid-cols-[minmax(0,620px)_minmax(240px,280px)] items-start gap-6 py-5 pb-10 max-[940px]:grid-cols-1"
      aria-label="プレイ中"
    >
      <main className="grid max-w-[620px] min-w-0 gap-4 max-[940px]:max-w-none">
        <SceneHeader runtime={runtime} />
        <LatestStory runtime={runtime} />
        <TurnComposer runtime={runtime} />
      </main>
      <aside className="grid min-w-0 gap-4" aria-label="状況">
        <QuestBlock runtime={runtime} />
        <SideLists runtime={runtime} />
      </aside>
    </section>
  );
}

function SceneHeader({ runtime }: PlayerPageProps) {
  const { session, sessionState } = runtime;
  const location = sessionState?.current_location ?? sessionState?.location ?? null;
  const chapter = sessionState?.chapter;
  const scene = sessionState?.current_scene;

  return (
    <Card className="grid min-w-0 gap-4 p-6 max-[480px]:p-4" aria-label="場面">
      <p className="text-sm font-bold leading-[21px] text-foreground">GESTALOKA</p>
      <p className="text-xs font-semibold leading-[18px] text-muted-foreground" data-testid="session-location">
        {location?.name ?? session?.world_name ?? "開始地点"}
      </p>
      <h1 className="text-[32px] font-bold leading-[48px] tracking-[1.28px] text-foreground max-[480px]:text-[28px] max-[480px]:leading-9" data-testid="current-place-summary">
        {location?.name ?? "開始地点"}
      </h1>
      {chapter?.summary ? <p className="text-lg leading-9 text-foreground" data-testid="current-chapter-summary">{chapter.summary}</p> : null}
      {scene?.summary ? <p className="text-lg leading-9 text-foreground" data-testid="current-scene-summary">{scene.summary}</p> : null}
    </Card>
  );
}

function LatestStory({ runtime }: PlayerPageProps) {
  const storyItems = buildStoryItems(runtime);

  return (
    <Card className="min-w-0 p-6 max-[480px]:p-4" aria-label="本文">
      <div className="grid gap-4">
        {storyItems.map((item) => (
          <article className="grid gap-3" key={item.key}>
            {item.title ? <h2 className="text-base font-semibold leading-6 text-foreground">{item.title}</h2> : null}
            <p className="text-lg leading-9 text-foreground" data-testid={item.key === "latest-narrative" ? "latest-narrative" : undefined}>
              {item.body}
            </p>
            {item.meta ? <p className="text-xs font-semibold leading-[18px] text-muted-foreground">{item.meta}</p> : null}
          </article>
        ))}
      </div>
      <p hidden data-testid="latest-reaction">
        {runtime.latestReaction || ""}
      </p>
      <ul hidden data-testid="recent-travel-history">
        {(runtime.sessionState?.recent_travel_history ?? []).map((item, index) => (
          <li key={`${item}-${index}`}>{item}</li>
        ))}
      </ul>
    </Card>
  );
}

function buildStoryItems(runtime: GestalokaRuntime): TextItem[] {
  const { latestConsequenceSummary, latestNarrative, latestReaction, sessionState } = runtime;
  const scene = sessionState?.current_scene;
  const location = sessionState?.current_location ?? sessionState?.location ?? null;
  const items: TextItem[] = [];

  if (latestNarrative) {
    items.push({ key: "latest-narrative", body: latestNarrative });
  } else {
    items.push({
      key: "latest-narrative",
      body: scene?.summary ?? location?.description ?? "進行中",
    });
  }

  if (latestReaction) {
    items.push({ key: "latest-reaction-visible", title: "反応", body: latestReaction });
  }
  if (latestConsequenceSummary) {
    items.push({ key: "latest-consequence-visible", title: "変化", body: latestConsequenceSummary });
  }

  return items;
}

function TurnComposer({ runtime }: PlayerPageProps) {
  const {
    freeTextInput,
    handleChoiceSubmit,
    handleTurnSubmit,
    session,
    setFreeTextInput,
    setTurnInputMode,
    suggestedChoices,
    turnInputMode,
    turnPending,
    turnProgressElapsedSeconds,
    turnProgressPhase,
  } = runtime;
  const phaseLabel =
    turnProgressPhase === "submitting"
      ? "送信中"
      : turnProgressPhase === "resolving"
        ? "解決中"
        : turnProgressPhase === "refreshing"
          ? "反映中"
          : "選択待ち";
  const progressStatus = turnPending
    ? `進行中 / ${phaseLabel} / ${turnProgressElapsedSeconds}s`
    : "選択待ち";

  return (
    <Card className="grid min-w-0 gap-4 p-6 max-[480px]:p-4" aria-label="次">
      <div className="flex flex-wrap gap-2 max-[480px]:grid max-[480px]:grid-cols-1" role="group" aria-label="入力">
        <Button
          variant={turnInputMode === "choice" ? "default" : "secondary"}
          type="button"
          data-testid="toggle-choice-mode"
          onClick={() => setTurnInputMode("choice")}
          disabled={!session || turnPending}
        >
          選択肢
        </Button>
        <Button
          variant={turnInputMode === "free_text" ? "default" : "secondary"}
          type="button"
          data-testid="toggle-free-text"
          onClick={() => setTurnInputMode("free_text")}
          disabled={!session || turnPending}
        >
          自由入力
        </Button>
      </div>

      {turnInputMode === "choice" ? (
        <ChoiceList choices={suggestedChoices} onChoose={handleChoiceSubmit} disabled={!session || turnPending} />
      ) : (
        <form onSubmit={handleTurnSubmit} className="grid gap-4">
          <Field label="自由入力">
            <Textarea
              data-testid="turn-input"
              rows={4}
              value={freeTextInput}
              onChange={(event) => setFreeTextInput(event.target.value)}
              disabled={turnPending}
            />
          </Field>
          <Button data-testid="submit-turn" type="submit" disabled={!session || turnPending}>
            {turnPending ? "進行中" : "送信"}
          </Button>
        </form>
      )}

      <p className="text-xs font-semibold leading-[18px] text-muted-foreground" data-testid="turn-progress-status">
        {progressStatus}
      </p>
      {turnPending && turnProgressElapsedSeconds >= 45 ? (
        <p className="text-xs font-semibold leading-[18px] text-muted-foreground" data-testid="turn-retry-guidance">
          応答待ちが続いています。結果反映までこのまま待ち、同じ操作を再送信しないでください。
        </p>
      ) : null}
    </Card>
  );
}

function ChoiceList({
  choices,
  disabled,
  onChoose,
}: {
  choices: NarrativeChoice[];
  disabled: boolean;
  onChoose: (choiceId: NarrativeChoice["choice_id"]) => Promise<void>;
}) {
  return (
    <ul className="grid gap-3" data-testid="choice-list">
      {choices.length ? (
        choices.map((choice) => (
          <li className="min-w-0" key={choice.choice_id}>
            <button
              type="button"
              className="grid min-h-0 w-full gap-2 rounded-lg border border-border bg-card p-4 text-left text-foreground shadow-none outline-none transition-colors hover:border-border/80 hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/80 disabled:pointer-events-none disabled:opacity-50"
              data-testid={`choice-${choice.choice_id}`}
              onClick={() => void onChoose(choice.choice_id)}
              disabled={disabled}
            >
              <span className="font-bold leading-6">{choice.label}</span>
              <span className="text-lg font-normal leading-9 text-muted-foreground">{choice.summary}</span>
            </button>
          </li>
        ))
      ) : (
        <li className="text-muted-foreground">進行中</li>
      )}
    </ul>
  );
}

function QuestBlock({ runtime }: PlayerPageProps) {
  const { activeQuest } = runtime;

  return (
    <Card className="grid min-w-0 gap-3 p-4" data-testid="active-quest">
      <h2 className="text-base font-semibold leading-6 text-foreground">クエスト</h2>
      {activeQuest ? (
        <>
          <p className="font-bold leading-6 text-foreground">{activeQuest.title}</p>
          <p className="text-sm leading-5 text-muted-foreground" data-testid="quest-progress">
            {activeQuest.progress}/{activeQuest.progress_target}
          </p>
          {activeQuest.latest_summary ? <p className="text-sm leading-5 text-muted-foreground">{activeQuest.latest_summary}</p> : null}
          <p hidden data-testid="quest-stage">
            {activeQuest.stage_key}
          </p>
          <p hidden data-testid="quest-unlock-requirements">
            {Object.keys(activeQuest.unlock_requirements).length ? JSON.stringify(activeQuest.unlock_requirements) : "starter"}
          </p>
        </>
      ) : (
        <p className="text-sm leading-5 text-muted-foreground">進行中</p>
      )}
    </Card>
  );
}

function SideLists({ runtime }: PlayerPageProps) {
  const { sessionState } = runtime;

  return (
    <>
      <Card className="grid min-w-0 gap-3 p-4">
        <h2 className="text-base font-semibold leading-6 text-foreground">人物</h2>
        <StreamList
          testId="local-figures-stream"
          items={sessionState?.local_figures ?? []}
          empty="進行中"
          getKey={(item) => item.actor_id}
          renderItem={(item) => (
            <>
              <strong>{item.display_name}</strong>
              <span>{item.summary}</span>
            </>
          )}
        />
        <ul hidden data-testid="relationship-summary">
          {(sessionState?.relationships ?? []).map((item) => (
            <li key={item.actor_id}>
              {item.display_name} {item.summary} {item.band}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="grid min-w-0 gap-3 p-4">
        <h2 className="text-base font-semibold leading-6 text-foreground">移動先</h2>
        <StreamList
          testId="nearby-routes-stream"
          items={sessionState?.nearby_routes ?? []}
          empty="進行中"
          getKey={(item) => item.route_key}
          renderItem={(item) => (
            <>
              <strong>{item.destination_name}</strong>
              <span>{item.summary}</span>
            </>
          )}
        />
      </Card>

      <Card className="grid min-w-0 gap-3 p-4">
        <h2 className="text-base font-semibold leading-6 text-foreground">所持品</h2>
        <StreamList
          testId="inventory-stream"
          items={sessionState?.inventory ?? []}
          empty="なし"
          getKey={(item) => item.id}
          renderItem={(item) => (
            <>
              <strong>{item.name}</strong>
              <span>{item.status}</span>
            </>
          )}
        />
        <ul hidden data-testid="faction-standing">
          {(sessionState?.factions ?? []).map((item) => (
            <li key={item.faction_id}>
              {item.name} {item.standing.toFixed(2)} {item.band}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function PlayerTestSurface({ runtime }: PlayerPageProps) {
  const {
    activity,
    ambientBeatOps,
    events,
    health,
    latestConsequenceSummary,
    locationOps,
    memories,
    npcRoutineOps,
    opsState,
    sceneOps,
    session,
    sessionState,
    socketState,
    statusText,
    travelLogOps,
    wallet,
    worldCatalogStatus,
  } = runtime;
  const choiceCost =
    wallet?.choice_turn_cost ?? health?.sp?.choice_turn_cost ?? wallet?.turn_cost ?? health?.sp?.turn_cost ?? "?";
  const freeTextCost = wallet?.free_text_turn_cost ?? health?.sp?.free_text_turn_cost ?? "?";

  return (
    <section hidden aria-hidden="true">
      <p data-testid="auth-status">{statusText}</p>
      <p data-testid="api-health">
        {health?.status ?? "unreachable"} / DB: {health?.database ?? "unknown"}
      </p>
      <p data-testid="socket-status">{socketState}</p>
      <p data-testid="sp-balance">
        SP balance: {wallet?.balance ?? "unknown"} / Choice cost: {choiceCost} / Free text cost: {freeTextCost}
      </p>
      <p data-testid="world-catalog-status">World catalog: {worldCatalogStatus}</p>
      <p data-testid="sp-budget-note">SP is execution budget only.</p>
      <p data-testid="session-pack">
        {session
          ? `${session.world_context.pack_display_name} (${session.pack_id}) / ${session.world_context.world_template_display_name}`
          : ""}
      </p>
      <p data-testid="ops-status">Ops access: {opsState}</p>
      <p data-testid="last-consequence-summary">{latestConsequenceSummary || "The scene is waiting for your next line."}</p>
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
              <span>{formatOpsEventSummary(item.data)}</span>
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
            <span>{formatRoutineState(item.routine_state)}</span>
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
