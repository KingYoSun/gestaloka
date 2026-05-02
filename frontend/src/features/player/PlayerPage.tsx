import { ArrowDownToLine, ChevronDown, Info, ListChecks, LogIn, PanelRightOpen, ShoppingCart, UserPlus, X } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
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
import { cn } from "../../lib/utils";
import type { NarrativeChoice, PlayLanguagePreset, PlayerProfile, StoryHistoryItem, WorldContext } from "../../types";

type PlayerPageProps = {
  runtime: GestalokaRuntime;
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

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window === "undefined" ? false : window.matchMedia(query).matches));

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const update = () => setMatches(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, [query]);

  return matches;
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
  const isMobile = useMediaQuery("(max-width: 640px)");
  const [actionDrawerOpen, setActionDrawerOpen] = useState(false);
  const [statusDrawerOpen, setStatusDrawerOpen] = useState(false);

  return (
    <section
      className="grid grid-cols-[minmax(0,620px)_minmax(240px,280px)] items-start gap-6 py-5 pb-10 max-[940px]:grid-cols-1 max-[640px]:pb-24"
      aria-label={t("player.labels.playing")}
    >
      <main className="grid max-w-[620px] min-w-0 gap-4 max-[940px]:max-w-none">
        <SceneHeader runtime={runtime} />
        <StoryHistory runtime={runtime} />
        {!isMobile ? <TurnComposer runtime={runtime} /> : null}
      </main>
      {!isMobile ? (
        <aside className="grid min-w-0 gap-4" aria-label={t("player.labels.status")}>
          <StatusBlocks runtime={runtime} />
        </aside>
      ) : null}
      {isMobile ? (
        <>
          <MobilePlayBar onOpenActions={() => setActionDrawerOpen(true)} onOpenStatus={() => setStatusDrawerOpen(true)} />
          <Drawer open={actionDrawerOpen} side="bottom" title={t("player.mobile.actions")} onClose={() => setActionDrawerOpen(false)}>
            <TurnComposer runtime={runtime} />
          </Drawer>
          <Drawer open={statusDrawerOpen} side="right" title={t("player.mobile.info")} onClose={() => setStatusDrawerOpen(false)}>
            <div className="grid min-w-0 gap-4">
              <StatusBlocks runtime={runtime} />
            </div>
          </Drawer>
        </>
      ) : null}
    </section>
  );
}

function StatusBlocks({ runtime }: PlayerPageProps) {
  return (
    <>
      <QuestBlock runtime={runtime} />
      <SideLists runtime={runtime} />
    </>
  );
}

function MobilePlayBar({ onOpenActions, onOpenStatus }: { onOpenActions: () => void; onOpenStatus: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-3 py-3 shadow-lg backdrop-blur">
      <div className="mx-auto grid max-w-[620px] grid-cols-2 gap-2">
        <Button type="button" onClick={onOpenActions}>
          <ListChecks aria-hidden="true" />
          {t("player.mobile.actions")}
        </Button>
        <Button type="button" variant="secondary" onClick={onOpenStatus}>
          <PanelRightOpen aria-hidden="true" />
          {t("player.mobile.info")}
        </Button>
      </div>
    </div>
  );
}

function Drawer({
  children,
  onClose,
  open,
  side,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
  side: "bottom" | "right";
  title: string;
}) {
  const { t } = useTranslation();
  if (!open) {
    return null;
  }
  return (
    <div className="fixed inset-0 z-40 bg-background/70" role="presentation" onMouseDown={onClose}>
      <section
        aria-modal="true"
        role="dialog"
        aria-label={title}
        className={cn(
          "absolute grid min-w-0 gap-4 border-border bg-card p-4 shadow-lg",
          side === "bottom"
            ? "inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto rounded-t-lg border-t"
            : "bottom-0 right-0 top-0 w-[min(88vw,340px)] overflow-y-auto border-l",
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h2 className="text-base font-semibold leading-6 text-foreground">{title}</h2>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label={t("common.close")}>
            <X aria-hidden="true" />
          </Button>
        </div>
        {children}
      </section>
    </div>
  );
}

function SceneHeader({ runtime }: PlayerPageProps) {
  const { t } = useTranslation();
  const { session, sessionState } = runtime;
  const location = sessionState?.current_location ?? sessionState?.location ?? null;
  const chapter = sessionState?.chapter;
  const scene = sessionState?.current_scene;

  return (
    <Card className="grid min-w-0 gap-3 p-5 max-[480px]:p-4" aria-label={t("player.labels.scene")}>
      <p
        className="text-xs font-semibold leading-[18px] text-muted-foreground"
        data-testid="current-place-summary"
        id="scene-summary-heading"
      >
        {location?.name ?? session?.world_name ?? t("player.world.startLocation")}
      </p>
      <p hidden data-testid="session-location">
        {location?.name ?? t("player.world.startLocation")}
      </p>
      <details className="group grid min-w-0 gap-3" open>
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-border bg-secondary px-3 py-2 text-sm font-semibold leading-5 text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/80 [&::-webkit-details-marker]:hidden">
          <span>{t("player.story.sceneDetails")}</span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="grid gap-3 pt-1">
          {chapter?.summary ? <p className="text-lg leading-9 text-foreground" data-testid="current-chapter-summary">{chapter.summary}</p> : null}
          {scene?.summary ? <p className="text-lg leading-9 text-foreground" data-testid="current-scene-summary">{scene.summary}</p> : null}
        </div>
      </details>
    </Card>
  );
}

function StoryHistory({ runtime }: PlayerPageProps) {
  const { t } = useTranslation();
  const [heightPreset, setHeightPreset] = useState<"small" | "medium" | "large">(() => {
    if (typeof window === "undefined") {
      return "medium";
    }
    const stored = window.localStorage.getItem("gestaloka.storyHeight");
    return stored === "small" || stored === "large" ? stored : "medium";
  });
  const [isAtBottom, setIsAtBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const storyItems = runtime.storyItems.length ? runtime.storyItems : fallbackStoryItems(runtime, t("player.story.inProgress"));
  const latestStory = storyItems[storyItems.length - 1] ?? null;
  const heightClass =
    heightPreset === "small"
      ? "h-[min(42vh,360px)]"
      : heightPreset === "large"
        ? "h-[min(72vh,680px)]"
        : "h-[min(56vh,520px)]";

  useEffect(() => {
    window.localStorage.setItem("gestaloka.storyHeight", heightPreset);
  }, [heightPreset]);

  useEffect(() => {
    if (!isAtBottom) {
      return;
    }
    const scrollNode = scrollRef.current;
    if (!scrollNode) {
      return;
    }
    scrollNode.scrollTop = scrollNode.scrollHeight;
  }, [isAtBottom, storyItems.length]);

  function updateBottomState() {
    const scrollNode = scrollRef.current;
    if (!scrollNode) {
      return;
    }
    setIsAtBottom(scrollNode.scrollHeight - scrollNode.scrollTop - scrollNode.clientHeight < 32);
  }

  async function handleScroll() {
    updateBottomState();
    const scrollNode = scrollRef.current;
    if (!scrollNode || scrollNode.scrollTop > 24 || !runtime.storyHasOlder || runtime.storyLoading) {
      return;
    }
    const previousHeight = scrollNode.scrollHeight;
    const added = await runtime.handleLoadOlderStory();
    if (added > 0) {
      window.requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight - previousHeight + scrollRef.current.scrollTop;
        }
      });
    }
  }

  function scrollToLatest() {
    const scrollNode = scrollRef.current;
    if (!scrollNode) {
      return;
    }
    scrollNode.scrollTo({ top: scrollNode.scrollHeight, behavior: "smooth" });
    setIsAtBottom(true);
  }

  return (
    <Card className="relative grid min-w-0 gap-3 p-4" aria-label={t("player.labels.body")}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-border bg-secondary p-1" role="group" aria-label={t("player.story.height")}>
          {(["small", "medium", "large"] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              className={cn(
                "min-h-9 rounded px-3 text-sm font-semibold leading-5 text-muted-foreground outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/80",
                heightPreset === preset ? "bg-primary text-primary-foreground" : "hover:bg-card hover:text-foreground",
              )}
              aria-pressed={heightPreset === preset}
              onClick={() => setHeightPreset(preset)}
            >
              {t(`player.story.heightPresets.${preset}`)}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={scrollRef}
        className={cn("min-w-0 overflow-y-auto pr-2", heightClass)}
        data-testid="story-scroll"
        onScroll={() => void handleScroll()}
      >
        <div className="grid gap-4">
          {runtime.storyLoading ? <p className="text-xs font-semibold leading-[18px] text-muted-foreground">{t("common.loading")}</p> : null}
          {storyItems.map((item) => (
            <StoryEntry key={item.event_id || item.turn_id || item.occurred_at} item={item} latest={item === latestStory} />
          ))}
        </div>
      </div>
      {!isAtBottom ? (
        <Button
          className="absolute bottom-6 right-6 shadow-md"
          type="button"
          size="icon"
          variant="secondary"
          onClick={scrollToLatest}
          aria-label={t("player.story.scrollToLatest")}
          title={t("player.story.scrollToLatest")}
          data-testid="story-scroll-to-latest"
        >
          <ArrowDownToLine aria-hidden="true" />
        </Button>
      ) : null}
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

function StoryEntry({ item, latest }: { item: StoryHistoryItem; latest: boolean }) {
  const { t } = useTranslation();
  return (
    <article className="grid gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <p className="text-lg leading-9 text-foreground" data-testid={latest ? "latest-narrative" : undefined}>
        {item.narrative || item.scene_summary}
      </p>
      {item.reaction ? (
        <div className="grid gap-2">
          <h2 className="text-base font-semibold leading-6 text-foreground">{t("player.story.reaction")}</h2>
          <p className="text-lg leading-9 text-foreground">{item.reaction}</p>
        </div>
      ) : null}
      {item.consequence ? (
        <div className="grid gap-2">
          <h2 className="text-base font-semibold leading-6 text-foreground">{t("player.story.consequence")}</h2>
          <p className="text-lg leading-9 text-foreground">{item.consequence}</p>
        </div>
      ) : null}
    </article>
  );
}

function fallbackStoryItems(runtime: GestalokaRuntime, fallbackText: string): StoryHistoryItem[] {
  const { latestConsequenceSummary, latestNarrative, latestReaction, sessionState } = runtime;
  const scene = sessionState?.current_scene;
  const location = sessionState?.current_location ?? sessionState?.location ?? null;
  return [
    {
      event_id: "fallback",
      turn_id: null,
      canonical_sequence: null,
      occurred_at: new Date(0).toISOString(),
      input_mode: "",
      narrative: latestNarrative || scene?.summary || location?.description || fallbackText,
      reaction: latestReaction,
      consequence: latestConsequenceSummary,
      scene_summary: scene?.summary ?? "",
    },
  ];
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 max-[640px]:items-end max-[640px]:p-0" role="presentation">
      <section
        aria-modal="true"
        role="dialog"
        aria-label={t("player.sp.purchaseDialog")}
        className="grid w-full max-w-md min-w-0 gap-4 rounded-lg border border-border bg-card p-5 shadow-lg max-[640px]:max-w-none max-[640px]:rounded-b-none max-[640px]:border-b-0"
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
  const { activeQuest, sessionState, turnPending, handleQuestAction } = runtime;
  const journal = sessionState?.quest_journal ?? [];
  const displayLabel = sessionState?.quest_display_state?.label || t("player.quest.exploring");
  const visibleQuests = journal.filter((item) => item.status === "offered" || item.status === "active" || item.status === "paused");
  const primaryQuest = activeQuest ?? visibleQuests[0] ?? null;

  return (
    <Card className="grid min-w-0 gap-3 p-4" data-testid="active-quest">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h2 className="text-base font-semibold leading-6 text-foreground">{t("player.side.quest")}</h2>
        <span className="text-xs font-semibold uppercase leading-5 text-muted-foreground">{displayLabel}</span>
      </div>
      {primaryQuest ? (
        <div className="grid gap-3">
          <p className="font-bold leading-6 text-foreground">{primaryQuest.title}</p>
          <p className="text-sm leading-5 text-muted-foreground" data-testid="quest-progress">
            {primaryQuest.progress}/{primaryQuest.progress_target}
          </p>
          {primaryQuest.latest_summary ? <p className="text-sm leading-5 text-muted-foreground">{primaryQuest.latest_summary}</p> : null}
          {primaryQuest.chapters?.length ? (
            <ul className="grid gap-2">
              {primaryQuest.chapters.slice(-3).map((chapter) => (
                <li className="text-sm leading-5 text-muted-foreground" key={chapter.id}>
                  {chapter.summary}
                </li>
              ))}
            </ul>
          ) : null}
          {primaryQuest.available_actions?.length ? (
            <div className="flex flex-wrap gap-2">
              {primaryQuest.available_actions.map((action) => (
                <Button
                  key={action}
                  type="button"
                  variant={action === "decline_quest" ? "secondary" : "default"}
                  disabled={turnPending}
                  onClick={() => void handleQuestAction(action as "accept_quest" | "decline_quest" | "leave_quest" | "resume_quest", primaryQuest.assignment_id)}
                >
                  <ListChecks aria-hidden="true" />
                  {t(`player.quest.actions.${action}`)}
                </Button>
              ))}
            </div>
          ) : null}
          <p hidden data-testid="quest-stage">
            {primaryQuest.stage_key}
          </p>
          <p hidden data-testid="quest-unlock-requirements">
            {Object.keys(primaryQuest.unlock_requirements).length ? JSON.stringify(primaryQuest.unlock_requirements) : "dynamic"}
          </p>
        </div>
      ) : (
        <p className="text-sm leading-5 text-muted-foreground">{displayLabel}</p>
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
