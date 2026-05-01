import { Info, LogIn, ShoppingCart, UserPlus, X } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/input";
import { NativeSelect } from "../../components/ui/native-select";
import { StreamList } from "../../components/ui/StreamList";
import { Textarea } from "../../components/ui/textarea";
import { locationRouteSummaries } from "../../domain/runtime";
import type { GestalokaRuntime } from "../../hooks/useGestalokaRuntime";
import type { NarrativeChoice, PlayLanguagePreset, PlayerProfile, WorldContext } from "../../types";

type PlayerPageProps = {
  runtime: GestalokaRuntime;
};

type TextItem = {
  key: string;
  title?: string;
  body: string;
  meta?: string;
};

const playLanguageOptions: Array<{ value: PlayLanguagePreset; label: string }> = [
  { value: "ja", label: "日本語" },
  { value: "en", label: "English" },
  { value: "zh-Hans", label: "简体中文" },
  { value: "zh-Hant", label: "繁體中文" },
  { value: "ko", label: "한국어" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "pt-BR", label: "Português do Brasil" },
  { value: "it", label: "Italiano" },
  { value: "id", label: "Bahasa Indonesia" },
  { value: "th", label: "ไทย" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "ar", label: "العربية" },
  { value: "hi", label: "हिन्दी" },
];

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

function formatOpsEventSummary(data: Record<string, unknown>): string {
  const keys = [
    "id",
    "event_id",
    "turn_id",
    "world_id",
    "session_id",
    "location_id",
    "phase",
    "status",
    "elapsed_ms",
    "role_elapsed_ms",
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
  const { t } = useTranslation();
  return (
    <section className="grid min-h-[calc(100vh-2.5rem)]" aria-label={t("player.labels.story")}>
      {!runtime.authenticated ? <FirstView runtime={runtime} /> : null}
      {runtime.authenticated && !runtime.session ? <WorldStartView runtime={runtime} /> : null}
      {runtime.session ? <PlayingView runtime={runtime} /> : null}
      <PlayerTestSurface runtime={runtime} />
    </section>
  );
}

function FirstView({ runtime }: PlayerPageProps) {
  const { t } = useTranslation();
  return (
    <section className="grid min-h-[calc(100vh-5rem)] place-items-center py-8" aria-label={t("player.labels.start")}>
      <div className="grid w-full min-w-0 justify-items-center gap-5 text-center">
        <img
          className="brand-mark size-36 object-contain max-[480px]:size-28"
          src="/brand/logo.png"
          alt=""
          aria-hidden="true"
        />
        <div className="grid min-w-0 justify-items-center gap-3">
          <h1 className="max-w-full text-[4.5rem] font-normal leading-none tracking-normal text-foreground max-[480px]:text-[3rem] max-[360px]:text-[2.5rem]">
            {t("common.brandWordmark")}
          </h1>
          <div className="h-0.5 w-10 rounded-full bg-primary" aria-hidden="true" />
          <p className="text-sm font-semibold uppercase leading-5 tracking-[0.32em] text-muted-foreground max-[480px]:text-xs max-[480px]:tracking-[0.22em]">
            {t("common.tagline")}
          </p>
        </div>
        <div className="mt-3 grid w-full max-w-sm min-w-0 gap-3 max-[480px]:max-w-none">
          <Button data-testid="sign-in" onClick={runtime.handleLogin} disabled={!runtime.ready}>
            <LogIn aria-hidden="true" />
            {t("auth.signIn")}
          </Button>
          <Button variant="secondary" onClick={runtime.handleRegister} disabled={!runtime.ready}>
            <UserPlus aria-hidden="true" />
            {t("auth.register")}
          </Button>
        </div>
      </div>
    </section>
  );
}

function WorldStartView({ runtime }: PlayerPageProps) {
  const { t } = useTranslation();
  const {
    beginProfileEdit,
    cancelProfileEdit,
    editingPlayerActorId,
    editingProfileLocked,
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
    ? t("player.world.unavailable")
    : (!playableWorlds.length && worldCatalogStatus !== "ready" ? t("common.loading") : "");

  return (
    <section className="grid min-h-[calc(100vh-2.5rem)] grid-rows-[auto_1fr] py-5" aria-label={t("player.labels.worldStart")}>
      <p className="text-sm font-bold lowercase leading-[21px] tracking-[0.16em] text-foreground">{t("common.brandWordmark")}</p>
      <div className="grid min-w-0 grid-cols-[minmax(0,320px)_minmax(0,620px)] items-start gap-4 self-center max-[940px]:grid-cols-1">
        <div className="grid min-w-0 gap-3">
          <Field label={t("player.labels.world")}>
            <NativeSelect
              data-testid="world-select"
              value={worldId}
              onChange={(event) => setWorldId(event.target.value)}
              disabled={worldCatalogUnavailable || !playableWorlds.length}
            >
              <option value="" disabled>
                {t("player.world.select")}
              </option>
              {playableWorlds.map((item) => (
                <option key={item.world_id} value={item.world_id} disabled={item.status !== "playable"}>
                  {item.display_name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <p className="text-[28px] font-bold leading-9 tracking-[1.12px] text-foreground max-[480px]:text-2xl max-[480px]:leading-8">
            {selectedWorld?.display_name ?? t("player.world.select")}
          </p>
          {catalogStateLabel ? <p className="text-xs font-semibold leading-[18px] text-muted-foreground">{catalogStateLabel}</p> : null}
          {wallet ? <SPBalanceDisplay wallet={wallet} /> : null}
          <WalletError runtime={runtime} />
        </div>
        <div className="grid min-w-0 gap-3">
          {playerProfiles.length ? (
            <Field label={t("player.labels.player")}>
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
            editingProfileLocked={editingProfileLocked}
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
              {t("player.world.start")}
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}

function ProfileSummary({ onEdit, profile }: { onEdit: (profile: PlayerProfile) => void; profile: PlayerProfile }) {
  const { t } = useTranslation();
  const styleLabel = [
    profile.narrative_preferences.perspective === "first_person" ? t("player.profile.perspective.firstPerson") : t("player.profile.perspective.thirdPerson"),
    profile.narrative_preferences.tone === "lyrical" ? t("player.profile.tone.lyrical") : t("player.profile.tone.logical"),
    profile.narrative_preferences.density === "concise" ? t("player.profile.density.concise") : t("player.profile.density.ornate"),
    profile.narrative_preferences.dialogue_style === "dialogue_forward" ? t("player.profile.dialogueStyle.dialogueForward") : t("player.profile.dialogueStyle.literary"),
  ].join(" / ");
  const playLanguageLabel = profile.play_language.mode === "custom"
    ? profile.play_language.custom
    : (playLanguageOptions.find((item) => item.value === profile.play_language.preset)?.label ?? profile.play_language.prompt_name);
  return (
    <Card>
      <CardContent className="grid gap-1 p-3">
        <p className="text-base font-bold leading-6 text-foreground">{profile.display_name}</p>
        <p className="text-xs font-semibold leading-[18px] text-muted-foreground">{styleLabel}</p>
        <p className="text-xs font-semibold leading-[18px] text-muted-foreground">{t("player.labels.playLanguage")}: {playLanguageLabel}</p>
        <Button className="mt-1 w-fit" variant="secondary" type="button" onClick={() => onEdit(profile)}>
          {t("common.edit")}
        </Button>
      </CardContent>
    </Card>
  );
}

function ProfileForm({
  onSubmit,
  editingPlayerActorId,
  editingProfileLocked,
  onCancelEdit,
  profileDraft,
  profilePending,
  setProfileDraft,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  editingPlayerActorId: string;
  editingProfileLocked: boolean;
  onCancelEdit: () => void;
  profileDraft: GestalokaRuntime["profileDraft"];
  profilePending: boolean;
  setProfileDraft: GestalokaRuntime["setProfileDraft"];
}) {
  const { t } = useTranslation();
  const playLanguageSelectValue = profileDraft.play_language.mode === "custom" ? "custom" : (profileDraft.play_language.preset ?? "ja");
  return (
    <form className="grid min-w-0 gap-3" onSubmit={onSubmit}>
      <Field label={t("player.labels.name")}>
        <Input
          data-testid="profile-display-name"
          value={profileDraft.display_name}
          maxLength={40}
          disabled={editingProfileLocked}
          onChange={(event) => setProfileDraft((current) => ({ ...current, display_name: event.target.value }))}
        />
      </Field>
      <Field label={t("player.labels.gender")}>
        <NativeSelect
          value={profileDraft.gender}
          disabled={editingProfileLocked}
          onChange={(event) =>
            setProfileDraft((current) => ({ ...current, gender: event.target.value as PlayerProfile["gender"] }))
          }
        >
          <option value="unspecified">{t("player.profile.gender.unspecified")}</option>
          <option value="male">{t("player.profile.gender.male")}</option>
          <option value="female">{t("player.profile.gender.female")}</option>
          <option value="other">{t("player.profile.gender.other")}</option>
        </NativeSelect>
      </Field>
      <Field label={t("player.labels.background")}>
        <Textarea
          rows={3}
          value={profileDraft.background}
          maxLength={1200}
          disabled={editingProfileLocked}
          onChange={(event) => setProfileDraft((current) => ({ ...current, background: event.target.value }))}
        />
      </Field>
      <Field label={t("player.labels.freeTextProfile")}>
        <Textarea
          rows={3}
          value={profileDraft.free_text}
          maxLength={2000}
          disabled={editingProfileLocked}
          onChange={(event) => setProfileDraft((current) => ({ ...current, free_text: event.target.value }))}
        />
      </Field>
      <div className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)] gap-3 max-[640px]:grid-cols-1">
        <Field label={t("player.labels.playLanguage")}>
          <NativeSelect
            data-testid="profile-play-language"
            value={playLanguageSelectValue}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "custom") {
                setProfileDraft((current) => ({
                  ...current,
                  play_language: {
                    mode: "custom",
                    preset: null,
                    custom: current.play_language.custom || current.play_language.prompt_name,
                    prompt_name: current.play_language.custom || current.play_language.prompt_name,
                  },
                }));
                return;
              }
              const preset = value as PlayLanguagePreset;
              setProfileDraft((current) => ({
                ...current,
                play_language: {
                  mode: "preset",
                  preset,
                  custom: "",
                  prompt_name: playLanguagePromptNames[preset],
                },
              }));
            }}
          >
            {playLanguageOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            <option value="custom">{t("player.profile.playLanguage.custom")}</option>
          </NativeSelect>
        </Field>
        <p className="self-end text-xs font-semibold leading-[18px] text-muted-foreground">
          {t("player.profile.playLanguage.helper")}
        </p>
        {profileDraft.play_language.mode === "custom" ? (
          <Field label={t("player.profile.playLanguage.custom")}>
            <Input
              data-testid="profile-play-language-custom"
              value={profileDraft.play_language.custom}
              maxLength={80}
              onChange={(event) => {
                const custom = event.target.value;
                setProfileDraft((current) => ({
                  ...current,
                  play_language: {
                    mode: "custom",
                    preset: null,
                    custom,
                    prompt_name: custom,
                  },
                }));
              }}
            />
          </Field>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 max-[480px]:grid-cols-1">
        <Field label={t("player.labels.perspective")}>
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
            <option value="third_person">{t("player.profile.perspective.thirdPerson")}</option>
            <option value="first_person">{t("player.profile.perspective.firstPerson")}</option>
          </NativeSelect>
        </Field>
        <Field label={t("player.labels.tone")}>
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
            <option value="lyrical">{t("player.profile.tone.lyrical")}</option>
            <option value="logical">{t("player.profile.tone.logical")}</option>
          </NativeSelect>
        </Field>
        <Field label={t("player.labels.density")}>
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
            <option value="concise">{t("player.profile.density.concise")}</option>
            <option value="ornate">{t("player.profile.density.ornate")}</option>
          </NativeSelect>
        </Field>
        <Field label={t("player.labels.sentence")}>
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
            <option value="literary">{t("player.profile.dialogueStyle.literary")}</option>
            <option value="dialogue_forward">{t("player.profile.dialogueStyle.dialogueForward")}</option>
          </NativeSelect>
        </Field>
      </div>
      <div className="flex flex-wrap gap-3 max-[480px]:grid max-[480px]:grid-cols-1">
        <Button data-testid="create-player-profile" type="submit" disabled={profilePending || !profileDraft.display_name.trim()}>
          {editingPlayerActorId ? t("common.save") : t("common.create")}
        </Button>
        {editingPlayerActorId ? (
          <Button variant="secondary" type="button" onClick={onCancelEdit} disabled={profilePending}>
            {t("common.cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function PlayingView({ runtime }: PlayerPageProps) {
  const { t } = useTranslation();
  return (
    <section
      className="grid grid-cols-[minmax(0,620px)_minmax(240px,280px)] items-start gap-6 py-5 pb-10 max-[940px]:grid-cols-1"
      aria-label={t("player.labels.playing")}
    >
      <main className="grid max-w-[620px] min-w-0 gap-4 max-[940px]:max-w-none">
        <SceneHeader runtime={runtime} />
        <LatestStory runtime={runtime} />
        <TurnComposer runtime={runtime} />
      </main>
      <aside className="grid min-w-0 gap-4" aria-label={t("player.labels.status")}>
        <QuestBlock runtime={runtime} />
        <SideLists runtime={runtime} />
      </aside>
    </section>
  );
}

function SceneHeader({ runtime }: PlayerPageProps) {
  const { t } = useTranslation();
  const { session, sessionState } = runtime;
  const location = sessionState?.current_location ?? sessionState?.location ?? null;
  const chapter = sessionState?.chapter;
  const scene = sessionState?.current_scene;

  return (
    <Card className="grid min-w-0 gap-4 p-6 max-[480px]:p-4" aria-label={t("player.labels.scene")}>
      <p className="text-sm font-bold lowercase leading-[21px] tracking-[0.16em] text-foreground">{t("common.brandWordmark")}</p>
      <p className="text-xs font-semibold leading-[18px] text-muted-foreground" data-testid="session-location">
        {location?.name ?? session?.world_name ?? t("player.world.startLocation")}
      </p>
      <h1 className="text-[32px] font-bold leading-[48px] tracking-[1.28px] text-foreground max-[480px]:text-[28px] max-[480px]:leading-9" data-testid="current-place-summary">
        {location?.name ?? t("player.world.startLocation")}
      </h1>
      {chapter?.summary ? <p className="text-lg leading-9 text-foreground" data-testid="current-chapter-summary">{chapter.summary}</p> : null}
      {scene?.summary ? <p className="text-lg leading-9 text-foreground" data-testid="current-scene-summary">{scene.summary}</p> : null}
    </Card>
  );
}

function LatestStory({ runtime }: PlayerPageProps) {
  const { t } = useTranslation();
  const storyItems = buildStoryItems(runtime, t);

  return (
    <Card className="min-w-0 p-6 max-[480px]:p-4" aria-label={t("player.labels.body")}>
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

function buildStoryItems(runtime: GestalokaRuntime, t: TFunction): TextItem[] {
  const { latestConsequenceSummary, latestNarrative, latestReaction, sessionState } = runtime;
  const scene = sessionState?.current_scene;
  const location = sessionState?.current_location ?? sessionState?.location ?? null;
  const items: TextItem[] = [];

  if (latestNarrative) {
    items.push({ key: "latest-narrative", body: latestNarrative });
  } else {
    items.push({
      key: "latest-narrative",
      body: scene?.summary ?? location?.description ?? t("player.story.inProgress"),
    });
  }

  if (latestReaction) {
    items.push({ key: "latest-reaction-visible", title: t("player.story.reaction"), body: latestReaction });
  }
  if (latestConsequenceSummary) {
    items.push({ key: "latest-consequence-visible", title: t("player.story.consequence"), body: latestConsequenceSummary });
  }

  return items;
}

function TurnComposer({ runtime }: PlayerPageProps) {
  const { t } = useTranslation();
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const {
    freeTextInput,
    handleChoiceSubmit,
    handleTurnSubmit,
    health,
    session,
    setFreeTextInput,
    setTurnInputMode,
    suggestedChoices,
    turnInputMode,
    turnPending,
    turnProgressElapsedSeconds,
    turnProgressLiveLabel,
    turnProgressPhase,
    turnProvisionalMessage,
    wallet,
  } = runtime;
  const choiceCost = wallet?.choice_turn_cost ?? health?.sp?.choice_turn_cost ?? wallet?.turn_cost ?? health?.sp?.turn_cost ?? "?";
  const freeTextCost = wallet?.free_text_turn_cost ?? health?.sp?.free_text_turn_cost ?? "?";
  const activeCostNote =
    turnInputMode === "choice"
      ? t("player.turn.choiceCost", { cost: choiceCost })
      : t("player.turn.freeTextCost", { cost: freeTextCost });
  const phaseLabel =
    turnProgressPhase === "submitting"
      ? t("player.turn.submitting")
      : turnProgressPhase === "resolving"
        ? t("player.turn.resolving")
        : turnProgressPhase === "refreshing"
          ? t("player.turn.refreshing")
          : t("player.turn.waiting");
  const progressStatus = turnPending
    ? t("player.turn.progress", { phase: turnProgressLiveLabel || phaseLabel, seconds: turnProgressElapsedSeconds })
    : t("player.turn.waiting");

  return (
    <Card className="grid min-w-0 gap-4 p-6 max-[480px]:p-4" aria-label={t("player.labels.next")}>
      <div className="flex flex-wrap gap-2 max-[480px]:grid max-[480px]:grid-cols-1" role="group" aria-label={t("player.labels.input")}>
        <Button
          variant={turnInputMode === "choice" ? "default" : "secondary"}
          type="button"
          data-testid="toggle-choice-mode"
          onClick={() => setTurnInputMode("choice")}
          disabled={!session || turnPending}
        >
          {t("player.turn.choice")}
        </Button>
        <Button
          variant={turnInputMode === "free_text" ? "default" : "secondary"}
          type="button"
          data-testid="toggle-free-text"
          onClick={() => setTurnInputMode("free_text")}
          disabled={!session || turnPending}
        >
          {t("player.turn.freeText")}
        </Button>
        {wallet ? <SPBalanceDisplay className="min-h-11 px-3" wallet={wallet} /> : null}
        <WalletError runtime={runtime} />
        <Button
          variant="secondary"
          type="button"
          data-testid="sp-purchase-button"
          onClick={() => setPurchaseOpen(true)}
          disabled={!session || turnPending}
        >
          <ShoppingCart aria-hidden="true" />
          {t("player.sp.purchase")}
        </Button>
      </div>

      <p className="inline-flex min-w-0 items-center gap-1 text-xs font-semibold leading-[18px] text-muted-foreground" data-testid="turn-cost-note">
        {activeCostNote}
        <TooltipIcon label={t("player.sp.plannedCostTooltip")} />
      </p>

      {turnInputMode === "choice" ? (
        <ChoiceList choices={suggestedChoices} onChoose={handleChoiceSubmit} disabled={!session || turnPending} />
      ) : (
        <form onSubmit={handleTurnSubmit} className="grid gap-4">
          <Field label={t("player.labels.freeText")}>
            <Textarea
              data-testid="turn-input"
              rows={4}
              value={freeTextInput}
              onChange={(event) => setFreeTextInput(event.target.value)}
              disabled={turnPending}
            />
          </Field>
          <Button data-testid="submit-turn" type="submit" disabled={!session || turnPending}>
            {turnPending ? t("player.story.inProgress") : t("common.submit")}
          </Button>
        </form>
      )}

      <p className="text-xs font-semibold leading-[18px] text-muted-foreground" data-testid="turn-progress-status" role="status" aria-live="polite">
        {progressStatus}
      </p>
      {turnPending && turnProvisionalMessage ? (
        <p className="rounded-md border border-border bg-muted p-3 text-xs font-semibold leading-[18px] text-muted-foreground" data-testid="turn-provisional-status">
          {turnProvisionalMessage}
        </p>
      ) : null}
      {turnPending && turnProgressElapsedSeconds >= 30 ? (
        <p className="rounded-md border border-border bg-muted p-3 text-xs font-semibold leading-[18px] text-muted-foreground" data-testid="turn-retry-guidance">
          {t("player.turn.retryGuidance")}
        </p>
      ) : null}
      {purchaseOpen ? <SPPurchaseDialog runtime={runtime} onClose={() => setPurchaseOpen(false)} /> : null}
    </Card>
  );
}

function TooltipIcon({ label }: { label: string }) {
  return (
    <span
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground"
      title={label}
      aria-label={label}
      tabIndex={0}
    >
      <Info aria-hidden="true" className="size-4" />
    </span>
  );
}

function SPBalanceDisplay({ className = "", wallet }: { className?: string; wallet: NonNullable<GestalokaRuntime["wallet"]> }) {
  const { t } = useTranslation();
  return (
    <div
      className={`inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-card text-xs font-semibold leading-[18px] text-muted-foreground ${className}`}
      data-testid="sp-bucket-balance"
    >
      <span className="inline-flex items-center gap-1">
        <span>{t("player.sp.paid")}</span>
        <span className="text-foreground" data-testid="paid-sp-balance">{wallet.paid_sp}</span>
        <TooltipIcon label={t("player.sp.paidTooltip")} />
      </span>
      <span aria-hidden="true">/</span>
      <span className="inline-flex items-center gap-1">
        <span>{t("player.sp.bonus")}</span>
        <span className="text-foreground" data-testid="bonus-sp-balance">{wallet.bonus_sp}</span>
        <TooltipIcon label={t("player.sp.bonusTooltip")} />
      </span>
    </div>
  );
}

function WalletError({ runtime }: PlayerPageProps) {
  const { t } = useTranslation();
  if (!runtime.walletError) {
    return null;
  }
  return (
    <div className="grid min-w-0 gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs font-semibold leading-[18px] text-destructive" data-testid="sp-wallet-error">
      <p>{runtime.walletError}</p>
      <Button className="w-fit" type="button" variant="secondary" onClick={() => void runtime.handleWalletRetry()}>
        {t("player.sp.retryWallet")}
      </Button>
    </div>
  );
}

function SPPurchaseDialog({ onClose, runtime }: { onClose: () => void; runtime: GestalokaRuntime }) {
  const { t } = useTranslation();
  const purchaseOptions = [5, 15, 30, 60, 120];
  const [selectedAmount, setSelectedAmount] = useState(purchaseOptions[0]);
  const [pending, setPending] = useState(false);
  const [completedAmount, setCompletedAmount] = useState<number | null>(null);

  async function handlePurchase() {
    setPending(true);
    const response = await runtime.handleMockSpPurchase(selectedAmount);
    setPending(false);
    if (response) {
      setCompletedAmount(response.amount);
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-background/70 p-4" role="presentation">
      <section
        aria-modal="true"
        role="dialog"
        aria-label={t("player.sp.purchaseDialog")}
        className="grid w-full max-w-md min-w-0 gap-4 rounded-lg border border-border bg-card p-5 shadow-lg"
        data-testid="sp-purchase-dialog"
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="grid min-w-0 gap-2">
            <h2 className="text-base font-semibold leading-6 text-foreground">{t("player.sp.purchaseDialog")}</h2>
            {runtime.wallet ? <SPBalanceDisplay wallet={runtime.wallet} /> : null}
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label={t("common.close")}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="grid grid-cols-5 gap-2 max-[420px]:grid-cols-2" role="radiogroup" aria-label={t("player.sp.purchaseAmount")}>
          {purchaseOptions.map((amount) => (
            <Button
              key={amount}
              type="button"
              variant={selectedAmount === amount ? "default" : "secondary"}
              onClick={() => setSelectedAmount(amount)}
              disabled={pending || completedAmount !== null}
              aria-pressed={selectedAmount === amount}
              data-testid={`sp-purchase-option-${amount}`}
            >
              {amount}
            </Button>
          ))}
        </div>
        {completedAmount !== null ? (
          <p className="rounded-md border border-success/30 bg-success/10 p-3 text-sm font-semibold leading-5 text-success" data-testid="sp-purchase-complete">
            {t("player.sp.purchaseComplete", {
              amount: completedAmount,
              paid: runtime.wallet?.paid_sp ?? 0,
              bonus: runtime.wallet?.bonus_sp ?? 0,
            })}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2 max-[420px]:grid max-[420px]:grid-cols-1">
          {completedAmount !== null ? (
            <Button type="button" onClick={onClose}>
              {t("common.close")}
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
                {t("common.cancel")}
              </Button>
              <Button type="button" onClick={() => void handlePurchase()} disabled={pending}>
                <ShoppingCart aria-hidden="true" />
                {pending ? t("common.loading") : t("player.sp.purchase")}
              </Button>
            </>
          )}
        </div>
      </section>
    </div>
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
  const { t } = useTranslation();
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
        <li className="text-muted-foreground">{t("player.story.inProgress")}</li>
      )}
    </ul>
  );
}

function QuestBlock({ runtime }: PlayerPageProps) {
  const { t } = useTranslation();
  const { activeQuest } = runtime;

  return (
    <Card className="grid min-w-0 gap-3 p-4" data-testid="active-quest">
      <h2 className="text-base font-semibold leading-6 text-foreground">{t("player.side.quest")}</h2>
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
        <p className="text-sm leading-5 text-muted-foreground">{t("player.story.inProgress")}</p>
      )}
    </Card>
  );
}

function SideLists({ runtime }: PlayerPageProps) {
  const { t } = useTranslation();
  const { sessionState } = runtime;

  return (
    <>
      <Card className="grid min-w-0 gap-3 p-4">
        <h2 className="text-base font-semibold leading-6 text-foreground">{t("player.side.figures")}</h2>
        <StreamList
          testId="local-figures-stream"
          items={sessionState?.local_figures ?? []}
          empty={t("player.story.inProgress")}
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
        <h2 className="text-base font-semibold leading-6 text-foreground">{t("player.side.routes")}</h2>
        <StreamList
          testId="nearby-routes-stream"
          items={sessionState?.nearby_routes ?? []}
          empty={t("player.story.inProgress")}
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
        <h2 className="text-base font-semibold leading-6 text-foreground">{t("player.side.inventory")}</h2>
        <StreamList
          testId="inventory-stream"
          items={sessionState?.inventory ?? []}
          empty={t("common.none")}
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
        SP balance: {wallet?.balance ?? "unknown"} / Paid: {wallet?.paid_sp ?? "unknown"} / Bonus: {wallet?.bonus_sp ?? "unknown"} / Choice cost: {choiceCost} / Free text cost: {freeTextCost}
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
            <span>event_id: {item.id}</span>
            <span>turn_id: {item.turn_id ?? "none"}</span>
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
