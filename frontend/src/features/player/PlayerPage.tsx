import { ArrowDownToLine, BookPlus, ChevronDown, ImagePlus, Info, ListChecks, LoaderCircle, LogIn, PanelRightOpen, ShoppingCart, Trash2, UserPlus, X } from "lucide-react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/input";
import { NativeSelect } from "../../components/ui/native-select";
import { StreamList } from "../../components/ui/StreamList";
import { Textarea } from "../../components/ui/textarea";
import { locationRouteSummaries } from "../../domain/runtime";
import type { GestalokaRuntime } from "../../hooks/useGestalokaRuntime";
import { cn } from "../../lib/utils";
import type { PlayLanguagePreset, PlayerProfile, QuestSummary, StoryHistoryItem, SuggestedAction, WorldContext } from "../../types";

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

const storyRevealCharsPerSecond = 60;

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

function ProcessingOverlay({ label, testId }: { label: string; testId: string }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/78 p-4 backdrop-blur-sm"
      data-testid={testId}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="inline-flex min-w-0 items-center gap-3 rounded-md border border-border bg-card px-5 py-4 text-sm font-semibold leading-5 text-foreground shadow-lg">
        <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden="true" />
        <span>{label}</span>
      </div>
    </div>
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
        <div className="grid min-w-0 justify-items-center gap-5">
          <h1
            className="text-4xl font-bold lowercase leading-8 tracking-[0.16em] text-foreground max-[480px]:text-xl max-[480px]:leading-7"
            data-testid="first-view-brand-title"
          >
            {t("common.brandWordmark")}
          </h1>
          <div className="grid min-w-0 justify-items-center gap-3">
            <div className="h-0.5 w-10 rounded-full bg-primary" aria-hidden="true" />
          </div>
          <p className="text-xl font-semibold leading-[18px] tracking-[0.14em] text-muted-foreground" data-testid="first-view-brand-tagline">
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

type StartStep = "world" | "profileCreate" | "profileSelect";

const profileIconSize = 512;

function profileStyleLabel(profile: Pick<PlayerProfile, "narrative_preferences">, t: ReturnType<typeof useTranslation>["t"]): string {
  const styleLabel = [
    profile.narrative_preferences.perspective === "first_person" ? t("player.profile.perspective.firstPerson") : t("player.profile.perspective.thirdPerson"),
    profile.narrative_preferences.tone === "lyrical" ? t("player.profile.tone.lyrical") : t("player.profile.tone.logical"),
    profile.narrative_preferences.density === "concise" ? t("player.profile.density.concise") : t("player.profile.density.ornate"),
    profile.narrative_preferences.dialogue_style === "dialogue_forward" ? t("player.profile.dialogueStyle.dialogueForward") : t("player.profile.dialogueStyle.literary"),
  ].join(" / ");
  return styleLabel;
}

function playLanguageLabel(profile: Pick<PlayerProfile, "play_language">): string {
  const playLanguageLabel = profile.play_language.mode === "custom"
    ? profile.play_language.custom
    : (playLanguageOptions.find((item) => item.value === profile.play_language.preset)?.label ?? profile.play_language.prompt_name);
  return playLanguageLabel;
}

function genderLabel(gender: PlayerProfile["gender"], t: ReturnType<typeof useTranslation>["t"]): string {
  if (gender === "male") {
    return t("player.profile.gender.male");
  }
  if (gender === "female") {
    return t("player.profile.gender.female");
  }
  if (gender === "other") {
    return t("player.profile.gender.other");
  }
  return t("player.profile.gender.unspecified");
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = src;
  });
}

async function cropProfileIcon(file: File): Promise<string> {
  const image = await loadImage(await readFileAsDataUrl(file));
  const canvas = document.createElement("canvas");
  canvas.width = profileIconSize;
  canvas.height = profileIconSize;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is unavailable");
  }
  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.floor((image.naturalWidth - sourceSize) / 2);
  const sourceY = Math.floor((image.naturalHeight - sourceSize) / 2);
  context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, profileIconSize, profileIconSize);
  return canvas.toDataURL("image/webp", 0.88);
}

function WorldStartView({ runtime }: PlayerPageProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<StartStep>("world");
  const [selectedWorldCardId, setSelectedWorldCardId] = useState("");
  const {
    beginProfileEdit,
    cancelProfileEdit,
    editingPlayerActorId,
    editingProfileLocked,
    handleCreatePlayerProfile,
    handleStartSession,
    playableWorlds,
    playerProfiles,
    playerProfilesLoading,
    playerProfilesWorldId,
    profileDraft,
    profilePending,
    selectedPlayerActorId,
    selectedPlayerProfile,
    setProfileDraft,
    setSelectedPlayerActorId,
    setWorldId,
    wallet,
    worldCatalogUnavailable,
    worldCatalogStatus,
    worldId,
  } = runtime;
  const catalogStateLabel = worldCatalogUnavailable
    ? t("player.world.unavailable")
    : (!playableWorlds.length && worldCatalogStatus !== "ready" ? t("common.loading") : "");
  const selectedWorldCard = playableWorlds.find((item) => item.world_id === selectedWorldCardId) ?? null;
  const selectedPlayableWorld = selectedWorldCard?.status === "playable" ? selectedWorldCard : null;
  const selectedWorldProfilesReady = Boolean(selectedWorldCardId) && playerProfilesWorldId === selectedWorldCardId && !playerProfilesLoading;
  const worldContinueLabel = playerProfilesLoading || playerProfiles.length ? t("player.world.proceedSelect") : t("player.world.proceedCreate");

  function handleWorldCardSelect(nextWorldId: string) {
    setSelectedWorldCardId(nextWorldId);
    setWorldId(nextWorldId);
  }

  function handleWorldContinue() {
    if (!selectedPlayableWorld || !selectedWorldProfilesReady) {
      return;
    }
    cancelProfileEdit();
    setStep(playerProfiles.length ? "profileSelect" : "profileCreate");
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    const saved = await handleCreatePlayerProfile(event);
    if (saved) {
      setStep("profileSelect");
    }
    return saved;
  }

  function handleCreateFromSelection() {
    cancelProfileEdit();
    setStep("profileCreate");
  }

  function handleEditProfile(profile: PlayerProfile) {
    beginProfileEdit(profile);
    setStep("profileCreate");
  }

  if (step === "profileCreate") {
    return (
      <section className="grid min-h-[calc(100vh-2.5rem)] content-center py-5" aria-label={t("player.profile.createTitle")}>
        <div className="mx-auto grid w-full max-w-[720px] min-w-0 gap-4">
          <div className="flex min-w-0 items-center justify-between gap-3 max-[520px]:grid">
            <h1 className="text-[28px] font-bold leading-9 tracking-[1.12px] text-foreground max-[480px]:text-2xl max-[480px]:leading-8">
              {t("player.profile.createTitle")}
            </h1>
            {playerProfiles.length ? (
              <Button type="button" variant="secondary" onClick={() => setStep("profileSelect")}>
                {t("player.profile.selectTitle")}
              </Button>
            ) : null}
          </div>
          <Card className="grid min-w-0 gap-4 p-5">
            <ProfileForm
              editingPlayerActorId={editingPlayerActorId}
              editingProfileLocked={editingProfileLocked}
              onCancelEdit={() => {
                cancelProfileEdit();
                setStep(playerProfiles.length ? "profileSelect" : "world");
              }}
              profileDraft={profileDraft}
              profilePending={profilePending}
              setProfileDraft={setProfileDraft}
              onSubmit={handleProfileSubmit}
            />
          </Card>
        </div>
      </section>
    );
  }

  if (step === "profileSelect") {
    return (
      <section className="grid min-h-[calc(100vh-2.5rem)] content-center py-5" aria-label={t("player.profile.selectTitle")}>
        <div className="grid min-w-0 gap-4">
          <div className="flex min-w-0 items-center justify-between gap-3 max-[520px]:grid">
            <h1 className="text-[28px] font-bold leading-9 tracking-[1.12px] text-foreground max-[480px]:text-2xl max-[480px]:leading-8">
              {t("player.profile.selectTitle")}
            </h1>
            <Button type="button" variant="secondary" onClick={() => setStep("world")} disabled={runtime.sessionStarting}>
              {t("player.world.select")}
            </Button>
          </div>
          <div className="flex min-w-0 flex-wrap gap-3" role="list" aria-label={t("player.profile.selectTitle")}>
            {playerProfiles.map((profile) => (
              <CharacterSelectCard
                key={profile.actor_id}
                profile={profile}
                selected={selectedPlayerActorId === profile.actor_id}
                onEdit={handleEditProfile}
                onSelect={() => {
                  if (!runtime.sessionStarting) {
                    setSelectedPlayerActorId(profile.actor_id);
                  }
                }}
              />
            ))}
            <button
              type="button"
              className="grid min-h-[220px] w-[min(100%,280px)] place-items-center rounded-lg border border-dashed border-border bg-card p-5 text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/80"
              onClick={handleCreateFromSelection}
              disabled={runtime.sessionStarting}
              aria-label={t("player.profile.add")}
              data-testid="create-character-card"
            >
              <BookPlus className="size-8 text-muted-foreground" aria-hidden="true" />
            </button>
          </div>
          <form onSubmit={handleStartSession}>
            <Button data-testid="start-session" type="submit" disabled={!selectedPlayerProfile || runtime.sessionStarting}>
              {t("player.world.start")}
            </Button>
          </form>
          {runtime.sessionStarting ? <ProcessingOverlay label={t("player.world.starting")} testId="session-starting-overlay" /> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="grid min-h-[calc(100vh-2.5rem)] content-center py-5" aria-label={t("player.world.select")}>
      <div className="grid min-w-0 gap-4">
        <div className="flex min-w-0 items-start justify-between gap-3 max-[520px]:grid">
          <div className="grid min-w-0 gap-2">
            <h1 className="text-[28px] font-bold leading-9 tracking-[1.12px] text-foreground max-[480px]:text-2xl max-[480px]:leading-8">
              {t("player.world.select")}
            </h1>
            {catalogStateLabel ? <p className="text-xs font-semibold leading-[18px] text-muted-foreground">{catalogStateLabel}</p> : null}
          </div>
          <div className="grid justify-items-end gap-2 max-[520px]:justify-items-start">
            {wallet ? <SPBalanceDisplay wallet={wallet} /> : null}
            <WalletError runtime={runtime} />
          </div>
        </div>
        <select
          className="sr-only"
          data-testid="world-select"
          value={worldId}
          onChange={(event) => handleWorldCardSelect(event.target.value)}
          disabled={worldCatalogUnavailable || !playableWorlds.length}
          aria-label={t("player.world.select")}
        >
          <option value="" disabled>
            {t("player.world.select")}
          </option>
          {playableWorlds.map((item) => (
            <option key={item.world_id} value={item.world_id} disabled={item.status !== "playable"}>
              {item.display_name}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1" role="list" aria-label={t("player.world.select")}>
          {playableWorlds.map((world) => {
            const selected = world.world_id === selectedPlayableWorld?.world_id;
            const playable = world.status === "playable";
            return (
              <button
                key={world.world_id}
                type="button"
                className={cn(
                  "grid min-h-[160px] min-w-0 gap-3 rounded-lg border bg-card p-5 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/80",
                  selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:bg-muted",
                  playable ? "cursor-pointer" : "cursor-not-allowed opacity-60",
                )}
                disabled={!playable}
                onClick={() => handleWorldCardSelect(world.world_id)}
                aria-pressed={selected}
                data-testid={`world-card-${world.world_id}`}
              >
                <span className="text-base font-semibold leading-6 text-foreground">{world.display_name}</span>
                <span className="text-sm leading-5 text-muted-foreground">{world.summary}</span>
              </button>
            );
          })}
        </div>
        <Button
          className="w-fit max-[520px]:w-full"
          type="button"
          data-testid="continue-to-character"
          disabled={!selectedPlayableWorld || !selectedWorldProfilesReady}
          onClick={handleWorldContinue}
        >
          {worldContinueLabel}
        </Button>
      </div>
    </section>
  );
}

function CharacterSelectCard({
  onEdit,
  onSelect,
  profile,
  selected,
}: {
  onEdit: (profile: PlayerProfile) => void;
  onSelect: () => void;
  profile: PlayerProfile;
  selected: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card
      className={cn(
        "grid w-[min(100%,280px)] min-w-0 gap-3 p-4 transition-colors",
        selected ? "border-primary ring-2 ring-primary/30" : "",
      )}
      role="listitem"
    >
      <button
        type="button"
        className="grid min-w-0 gap-3 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/80"
        onClick={onSelect}
        aria-pressed={selected}
        data-testid={`character-card-${profile.actor_id}`}
      >
        {profile.icon_image_data_url ? (
          <img
            className="size-20 rounded-md border border-border object-cover"
            src={profile.icon_image_data_url}
            alt=""
            aria-hidden="true"
          />
        ) : null}
        <span className="text-base font-semibold leading-6 text-foreground">{profile.display_name}</span>
        <span className="grid min-w-0 gap-1 text-xs font-semibold leading-[18px] text-muted-foreground">
          <span>{t("player.labels.gender")}: {genderLabel(profile.gender, t)}</span>
          {profile.background ? <span>{t("player.labels.background")}: {profile.background}</span> : null}
          {profile.free_text ? <span>{t("player.labels.freeTextProfile")}: {profile.free_text}</span> : null}
          <span>{profileStyleLabel(profile, t)}</span>
          <span>{t("player.labels.playLanguage")}: {playLanguageLabel(profile)}</span>
        </span>
      </button>
      <Button className="w-fit" variant="secondary" size="sm" type="button" onClick={() => onEdit(profile)}>
        {t("common.edit")}
      </Button>
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
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<PlayerProfile | null>;
  editingPlayerActorId: string;
  editingProfileLocked: boolean;
  onCancelEdit: () => void;
  profileDraft: GestalokaRuntime["profileDraft"];
  profilePending: boolean;
  setProfileDraft: GestalokaRuntime["setProfileDraft"];
}) {
  const { t } = useTranslation();
  const [iconPending, setIconPending] = useState(false);
  const [iconError, setIconError] = useState("");
  const playLanguageSelectValue = profileDraft.play_language.mode === "custom" ? "custom" : (profileDraft.play_language.preset ?? "ja");

  async function handleIconChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      setIconPending(true);
      setIconError("");
      const dataUrl = await cropProfileIcon(file);
      setProfileDraft((current) => ({ ...current, icon_image_data_url: dataUrl }));
    } catch {
      setIconError(t("player.profile.iconError"));
    } finally {
      setIconPending(false);
    }
  }

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
      <Field label={t("player.profile.icon")}>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {profileDraft.icon_image_data_url ? (
            <img
              className="size-24 rounded-md border border-border object-cover"
              src={profileDraft.icon_image_data_url}
              alt=""
              aria-hidden="true"
              data-testid="profile-icon-preview"
            />
          ) : null}
          <div className="flex min-w-0 flex-wrap gap-2">
            <label
              className={cn(
                "inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-base font-semibold leading-6 text-foreground transition-colors hover:bg-muted focus-within:ring-[3px] focus-within:ring-ring/80",
                iconPending ? "pointer-events-none opacity-50" : "",
              )}
            >
              <ImagePlus aria-hidden="true" className="size-[18px]" />
              {iconPending ? t("common.loading") : t("player.profile.iconChoose")}
              <input
                className="sr-only"
                data-testid="profile-icon-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => void handleIconChange(event)}
                disabled={iconPending}
              />
            </label>
            {profileDraft.icon_image_data_url ? (
              <Button
                variant="secondary"
                type="button"
                onClick={() => setProfileDraft((current) => ({ ...current, icon_image_data_url: null }))}
              >
                <Trash2 aria-hidden="true" />
                {t("player.profile.iconRemove")}
              </Button>
            ) : null}
          </div>
        </div>
        {iconError ? <p className="text-xs font-semibold leading-[18px] text-destructive">{iconError}</p> : null}
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

  useEffect(() => {
    if (runtime.turnNarrativeStreaming) {
      setActionDrawerOpen(false);
    }
  }, [runtime.turnNarrativeStreaming]);

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
      {runtime.questCompletionNotice ? (
        <QuestCompletionDialog notice={runtime.questCompletionNotice} onClose={runtime.dismissQuestCompletionNotice} />
      ) : null}
      {runtime.playHydrating ? <ProcessingOverlay label={t("player.story.preparing")} testId="play-hydrating-overlay" /> : null}
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
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-lg backdrop-blur">
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
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    setVisible(false);
    const timeout = window.setTimeout(() => setMounted(false), 360);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!mounted || !open) {
      return;
    }
    setVisible(false);
    let nestedAnimationFrame = 0;
    const animationFrame = window.requestAnimationFrame(() => {
      nestedAnimationFrame = window.requestAnimationFrame(() => setVisible(true));
    });
    return () => {
      window.cancelAnimationFrame(animationFrame);
      if (nestedAnimationFrame) {
        window.cancelAnimationFrame(nestedAnimationFrame);
      }
    };
  }, [mounted, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (open) {
      return;
    }
    setVisible(false);
  }, [open]);

  if (!mounted) {
    return null;
  }
  return (
    <div
      className={cn(
        "fixed inset-0 z-40 bg-background/70",
        visible ? "" : "pointer-events-none",
      )}
      role="presentation"
      onMouseDown={() => {
        if (open) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-label={title}
        className={cn(
          "absolute grid min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-border bg-card shadow-lg transition-transform duration-200 ease-out",
          side === "bottom"
            ? cn("inset-x-0 bottom-0 max-h-[min(82dvh,720px)] rounded-t-lg border-t", visible ? "translate-y-0" : "translate-y-full")
            : cn("bottom-0 right-0 top-0 max-h-[100dvh] w-[min(88vw,340px)] border-l", visible ? "translate-x-0" : "translate-x-full"),
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="text-base font-semibold leading-6 text-foreground">{title}</h2>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label={t("common.close")}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="scrollbar-gestaloka min-h-0 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </section>
    </div>
  );
}

function SceneHeader({ runtime }: PlayerPageProps) {
  const { t } = useTranslation();
  const [sceneDetailsOpen, setSceneDetailsOpen] = useState(true);
  const { session, sessionState } = runtime;
  const location = sessionState?.current_location ?? sessionState?.location ?? null;
  const chapter = sessionState?.chapter;
  const scene = sessionState?.current_scene;
  const sceneDetailsId = "scene-details-panel";

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
      <div className="grid min-w-0 overflow-hidden rounded-md border border-border bg-secondary">
        <button
          type="button"
          className="flex min-h-10 cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-sm font-semibold leading-5 text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/80"
          aria-controls={sceneDetailsId}
          aria-expanded={sceneDetailsOpen}
          onClick={() => setSceneDetailsOpen((current) => !current)}
        >
          <span>{t("player.story.sceneDetails")}</span>
          <ChevronDown
            className={cn("size-4 text-muted-foreground transition-transform duration-200 ease-out", sceneDetailsOpen ? "rotate-180" : "")}
            aria-hidden="true"
          />
        </button>
        <div
          id={sceneDetailsId}
          className={cn(
            "grid min-w-0 transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
            sceneDetailsOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="min-h-0 min-w-0 overflow-hidden">
            <div className="grid min-w-0 gap-3 border-t border-border bg-card p-3">
              {chapter?.summary ? <p className="min-w-0 break-words text-lg leading-9 text-foreground" data-testid="current-chapter-summary">{chapter.summary}</p> : null}
              {scene?.summary ? <p className="min-w-0 break-words text-lg leading-9 text-foreground" data-testid="current-scene-summary">{scene.summary}</p> : null}
            </div>
          </div>
        </div>
      </div>
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
  const baseStoryItems = runtime.storyItems.length ? runtime.storyItems : fallbackStoryItems(runtime, t("player.story.noTurnsYet"));
  const showGeneratingIndicator = runtime.turnPending && !runtime.turnNarrativeStreaming;
  const streamingStoryItems =
    runtime.streamingStoryItem && !baseStoryItems.some((item) => item.turn_id && item.turn_id === runtime.streamingStoryItem?.turn_id)
      ? [...baseStoryItems, runtime.streamingStoryItem]
      : baseStoryItems;
  const storyItems = showGeneratingIndicator
    ? [
        ...streamingStoryItems,
        {
          event_id: "story-generating-pending",
          turn_id: null,
          canonical_sequence: null,
          occurred_at: "story-generating-pending",
          narrative: "",
          reaction: "",
          consequence: "",
          scene_summary: "",
        },
      ]
    : streamingStoryItems;
  const latestStory = storyItems[storyItems.length - 1] ?? null;
  const latestNarrativeLength = latestStory?.narrative.length ?? 0;
  const latestStoryIsNewTurn = Boolean(latestStory?.turn_id && latestStory.turn_id === runtime.animatedTurnId);
  const latestAnimatedTextLength = Array.from(
    `${latestStory?.narrative || latestStory?.scene_summary || ""}${latestStory?.reaction ?? ""}${latestStory?.consequence ?? ""}`,
  ).length;
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
  }, [isAtBottom, latestNarrativeLength, storyItems.length]);

  useEffect(() => {
    if (!isAtBottom || !latestStoryIsNewTurn) {
      return;
    }
    const scrollNode = scrollRef.current;
    if (!scrollNode) {
      return;
    }
    const followDurationMs = Math.max((latestAnimatedTextLength / storyRevealCharsPerSecond) * 1000 + 600, 1000);
    const interval = window.setInterval(() => {
      scrollNode.scrollTop = scrollNode.scrollHeight;
    }, 100);
    const timeout = window.setTimeout(() => window.clearInterval(interval), followDurationMs);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [isAtBottom, latestAnimatedTextLength, latestStoryIsNewTurn]);

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
        className={cn("scrollbar-gestaloka min-w-0 overflow-y-auto pr-2", heightClass)}
        data-testid="story-scroll"
        onScroll={() => void handleScroll()}
      >
        <div className="grid gap-4">
          {runtime.storyLoading ? <p className="text-xs font-semibold leading-[18px] text-muted-foreground">{t("common.loading")}</p> : null}
          {storyItems.map((item) => {
            const latest = item === latestStory;
            const animateLatestStory = latest && latestStoryIsNewTurn;
            return (
              <StoryEntry
                key={storyItemKey(item)}
                item={item}
                latest={latest}
                showGeneratingIndicator={item.event_id === "story-generating-pending"}
                animateNarrative={animateLatestStory}
                animateReaction={animateLatestStory}
                animateConsequence={animateLatestStory}
              />
            );
          })}
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

function StoryEntry({
  animateConsequence,
  animateNarrative,
  animateReaction,
  item,
  latest,
  showGeneratingIndicator,
}: {
  animateConsequence: boolean;
  animateNarrative: boolean;
  animateReaction: boolean;
  item: StoryHistoryItem;
  latest: boolean;
  showGeneratingIndicator: boolean;
}) {
  const { t } = useTranslation();
  const animationBaseKey = item.turn_id || item.event_id || item.occurred_at;
  return (
    <article className="grid gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      {item.narrative || item.scene_summary ? (
        <StoryText
          text={item.narrative || item.scene_summary}
          testId={latest ? "latest-narrative" : undefined}
          animate={animateNarrative}
          animationKey={`${animationBaseKey}:narrative`}
        />
      ) : null}
      {showGeneratingIndicator ? <GeneratingStoryIndicator /> : null}
      {item.reaction ? (
        <div className="grid gap-2">
          <h2 className="text-base font-semibold leading-6 text-foreground">{t("player.story.reaction")}</h2>
          <StoryText text={item.reaction} animate={animateReaction} animationKey={`${animationBaseKey}:reaction`} />
        </div>
      ) : null}
      {item.consequence ? (
        <div className="grid gap-2">
          <h2 className="text-base font-semibold leading-6 text-foreground">{t("player.story.consequence")}</h2>
          <StoryText text={item.consequence} animate={animateConsequence} animationKey={`${animationBaseKey}:consequence`} />
        </div>
      ) : null}
    </article>
  );
}

function StoryText({ animate, animationKey, text, testId }: { animate: boolean; animationKey: string; text: string; testId?: string }) {
  const reducedMotion = usePrefersReducedMotion();
  const textUnits = Array.from(text);
  const [visibleLength, setVisibleLength] = useState(() => (animate && !reducedMotion ? 0 : textUnits.length));
  const visibleLengthRef = useRef(visibleLength);
  const animationKeyRef = useRef(animationKey);
  const displayText = animate && !reducedMotion ? textUnits.slice(0, visibleLength).join("") : text;
  const paragraphs = displayText
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);

  useEffect(() => {
    if (!animate || reducedMotion) {
      animationKeyRef.current = animationKey;
      visibleLengthRef.current = textUnits.length;
      setVisibleLength(textUnits.length);
      return;
    }

    if (animationKeyRef.current !== animationKey) {
      animationKeyRef.current = animationKey;
      visibleLengthRef.current = 0;
      setVisibleLength(0);
    } else {
      visibleLengthRef.current = Math.min(visibleLengthRef.current, textUnits.length);
      setVisibleLength(visibleLengthRef.current);
    }

    if (visibleLengthRef.current >= textUnits.length) {
      return;
    }

    let frame = 0;
    let lastTimestamp = performance.now();
    let pendingChars = 0;

    const tick = (timestamp: number) => {
      pendingChars += ((timestamp - lastTimestamp) / 1000) * storyRevealCharsPerSecond;
      lastTimestamp = timestamp;
      const charsToReveal = Math.floor(pendingChars);
      if (charsToReveal > 0) {
        pendingChars -= charsToReveal;
        visibleLengthRef.current = Math.min(textUnits.length, visibleLengthRef.current + charsToReveal);
        setVisibleLength(visibleLengthRef.current);
      }
      if (visibleLengthRef.current < textUnits.length) {
        frame = window.requestAnimationFrame(tick);
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [animate, animationKey, reducedMotion, textUnits.length]);

  return (
    <div className="grid gap-3 text-lg leading-9 text-foreground" data-testid={testId}>
      {(paragraphs.length ? paragraphs : [displayText]).map((paragraph, index) => (
        <p key={`${paragraph}-${index}`}>{paragraph}</p>
      ))}
    </div>
  );
}

function GeneratingStoryIndicator() {
  const { t } = useTranslation();
  return (
    <p className="text-lg leading-9 text-muted-foreground" data-testid="story-generating-indicator" role="status" aria-live="polite">
      <span>{t("player.story.generating")}</span>
      <span className="story-generating-dots" aria-hidden="true" />
    </p>
  );
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => setReducedMotion(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return reducedMotion;
}

function storyItemKey(item: StoryHistoryItem): string {
  return item.turn_id || item.event_id || item.occurred_at;
}

function fallbackStoryItems(runtime: GestalokaRuntime, fallbackText: string): StoryHistoryItem[] {
  const { latestConsequenceSummary, latestNarrative, latestReaction } = runtime;
  return [
    {
      event_id: "fallback",
      turn_id: null,
      canonical_sequence: null,
      occurred_at: new Date(0).toISOString(),
      narrative: latestNarrative || fallbackText,
      reaction: latestReaction,
      consequence: latestConsequenceSummary,
      scene_summary: "",
    },
  ];
}

function TurnComposer({ runtime }: PlayerPageProps) {
  const { t } = useTranslation();
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const {
    freeTextInput,
    handleChoiceSubmit,
    handleQuestAction,
    handleTurnSubmit,
    health,
    session,
    sessionState,
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
  const inlineQuest = (sessionState?.quest_journal ?? []).find(
    (quest) => quest.status === "offered" && (quest.available_actions ?? []).includes("ignore_quest"),
  ) ?? null;

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
        inlineQuest ? (
          <QuestDecisionPanel
            quest={inlineQuest}
            disabled={!session || turnPending}
            onQuestAction={(action, assignmentId) => void handleQuestAction(action, assignmentId)}
          />
        ) : (
          <ChoiceList choices={suggestedChoices} onChoose={handleChoiceSubmit} disabled={!session || turnPending} />
        )
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
      className="group relative inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/80"
      aria-label={label}
      tabIndex={0}
    >
      <Info aria-hidden="true" className="size-4" />
      <span
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-max max-w-[220px] -translate-x-1/2 rounded-md border border-border bg-popover px-2 py-1 text-xs font-semibold leading-[18px] text-popover-foreground shadow-lg group-hover:block group-focus:block group-focus-visible:block"
        role="tooltip"
      >
        {label}
      </span>
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

function QuestDecisionPanel({
  disabled,
  onQuestAction,
  quest,
}: {
  disabled: boolean;
  onQuestAction: (action: QuestAction, assignmentId: string) => void;
  quest: QuestSummary;
}) {
  const { t } = useTranslation();
  const summary = quest.description || quest.latest_summary || t("common.none");
  const actions = (quest.available_actions ?? []).filter((action) =>
    ["accept_quest", "decline_quest", "ignore_quest"].includes(action),
  ) as QuestAction[];

  return (
    <section className="grid gap-3 rounded-lg border border-primary/60 bg-card p-4" data-testid="inline-quest-decision">
      <div className="grid min-w-0 gap-2">
        <p className="inline-flex items-center gap-2 text-xs font-semibold leading-[18px] text-primary">
          <ListChecks className="size-4" aria-hidden="true" />
          {t("player.quest.offerDialogTitle")}
        </p>
        <h2 className="min-w-0 break-words text-base font-bold leading-6 text-foreground">{quest.title}</h2>
        <p className="min-w-0 break-words text-lg leading-9 text-muted-foreground">{summary}</p>
      </div>
      <div className="grid gap-2 max-[520px]:grid-cols-1 min-[521px]:grid-cols-3">
        {actions.map((action) => (
          <Button
            key={action}
            type="button"
            variant={action === "accept_quest" ? "default" : "secondary"}
            disabled={disabled}
            onClick={() => onQuestAction(action, quest.assignment_id)}
            data-testid={`quest-action-${action}`}
          >
            {action === "accept_quest" ? <ListChecks aria-hidden="true" /> : null}
            {t(`player.quest.actions.${action}`)}
          </Button>
        ))}
      </div>
    </section>
  );
}

function ChoiceList({
  choices,
  disabled,
  onChoose,
}: {
  choices: SuggestedAction[];
  disabled: boolean;
  onChoose: (actionText: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <ul className="grid gap-3" data-testid="choice-list">
      {choices.length ? (
        choices.map((choice, index) => {
          const actionText = choice.summary && choice.summary !== choice.label ? `${choice.label}。${choice.summary}` : choice.label;
          return (
          <li className="min-w-0" key={`${choice.label}-${index}`}>
            <button
              type="button"
              className="grid min-h-0 w-full gap-2 rounded-lg border border-border bg-card p-4 text-left text-foreground shadow-none outline-none transition-colors hover:border-border/80 hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/80 disabled:pointer-events-none disabled:opacity-50"
              data-testid={`suggested-action-${index + 1}`}
              onClick={() => void onChoose(actionText)}
              disabled={disabled}
            >
              <span className="font-bold leading-6">{choice.label}</span>
              <span className="text-lg font-normal leading-9 text-muted-foreground">{choice.summary}</span>
            </button>
          </li>
        );
        })
      ) : (
        <li className="text-muted-foreground">{t("player.story.inProgress")}</li>
      )}
    </ul>
  );
}

function QuestBlock({ runtime }: PlayerPageProps) {
  const { t } = useTranslation();
  const { activeQuest, sessionState, turnPending, handleQuestAction } = runtime;
  const [questListOpen, setQuestListOpen] = useState(false);
  const journal = sessionState?.quest_journal ?? [];
  const displayLabel = sessionState?.quest_display_state?.label || t("player.quest.exploring");
  const visibleQuests = journal.filter((item) => item.status === "offered" || item.status === "active" || item.status === "paused" || item.status === "completed");
  const primaryQuest = activeQuest ?? null;

  return (
    <Card className="grid min-w-0 gap-3 p-4" data-testid="active-quest">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h2 className="text-base font-semibold leading-6 text-foreground">{t("player.side.quest")}</h2>
        <Button type="button" variant="secondary" size="sm" onClick={() => setQuestListOpen(true)} data-testid="quest-list-open">
          <ListChecks aria-hidden="true" />
          {t("player.quest.list")}
        </Button>
      </div>
      {primaryQuest ? (
        <div className="grid min-w-0 gap-3">
          <p className="min-w-0 break-words font-bold leading-6 text-foreground">{primaryQuest.title}</p>
          <p className="text-sm leading-5 text-muted-foreground" data-testid="quest-progress">
            {primaryQuest.progress}/{primaryQuest.progress_target}
          </p>
          {primaryQuest.latest_summary ? <p className="min-w-0 break-words text-sm leading-5 text-muted-foreground">{primaryQuest.latest_summary}</p> : null}
          {primaryQuest.chapters?.length ? (
            <ul className="grid min-w-0 gap-2">
              {primaryQuest.chapters.slice(-3).map((chapter) => (
                <li className="min-w-0 break-words text-sm leading-5 text-muted-foreground" key={chapter.id}>
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
                  onClick={() => void handleQuestAction(action as QuestAction, primaryQuest.assignment_id)}
                >
                  <ListChecks aria-hidden="true" />
                  {t(`player.quest.actions.${action}`)}
                </Button>
              ))}
            </div>
          ) : null}
          <span hidden data-testid="quest-stage" data-value={primaryQuest.stage_key} />
          <span
            hidden
            data-testid="quest-unlock-requirements"
            data-value={Object.keys(primaryQuest.unlock_requirements).length ? JSON.stringify(primaryQuest.unlock_requirements) : "dynamic"}
          />
        </div>
      ) : (
        <p className="text-sm leading-5 text-muted-foreground">{displayLabel}</p>
      )}
      {questListOpen ? (
        <QuestListDialog
          quests={visibleQuests}
          turnPending={turnPending}
          onClose={() => setQuestListOpen(false)}
          onQuestAction={(action, assignmentId) => void handleQuestAction(action, assignmentId)}
        />
      ) : null}
    </Card>
  );
}

type QuestAction = "accept_quest" | "decline_quest" | "ignore_quest" | "leave_quest" | "resume_quest";
type QuestWithResult = QuestSummary & { summary?: string };

function latestChapterSummary(quest: QuestSummary): string {
  const chapters = quest.chapters ?? [];
  const completedChapter = [...chapters].reverse().find((chapter) => chapter.status === "completed" || chapter.chapter_kind === "epilogue");
  return (completedChapter ?? chapters[chapters.length - 1])?.summary?.trim() ?? "";
}

function questResultText(quest: QuestWithResult, fallback: string): string {
  return quest.summary?.trim() || quest.latest_summary.trim() || latestChapterSummary(quest) || quest.description.trim() || fallback;
}

function QuestCompletionDialog({
  notice,
  onClose,
}: {
  notice: NonNullable<GestalokaRuntime["questCompletionNotice"]>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const result = questResultText(notice.quest, t("player.quest.emptyResult"));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 max-[640px]:items-end max-[640px]:p-0" role="presentation">
      <section
        role="dialog"
        aria-labelledby="quest-completion-dialog-title"
        className="grid w-full max-w-md min-w-0 gap-4 rounded-lg border border-border bg-card p-5 text-card-foreground shadow-lg max-[640px]:max-w-none max-[640px]:rounded-b-none max-[640px]:border-b-0"
        data-testid="quest-completion-dialog"
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="grid min-w-0 gap-2">
            <p className="inline-flex items-center gap-2 text-xs font-semibold leading-[18px] text-primary">
              <ListChecks className="size-4" aria-hidden="true" />
              {t("player.quest.completionEyebrow")}
            </p>
            <h2 id="quest-completion-dialog-title" className="text-base font-semibold leading-6 text-foreground">
              {t("player.quest.completionTitle")}
            </h2>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label={t("common.close")} data-testid="quest-completion-close-icon">
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="grid min-w-0 gap-3">
          <div className="grid min-w-0 gap-1">
            <p className="text-xs font-semibold leading-[18px] text-muted-foreground">{t("player.quest.completedQuest")}</p>
            <p className="min-w-0 break-words text-lg font-bold leading-7 text-foreground">{notice.quest.title}</p>
          </div>
          <div className="grid min-w-0 gap-1 rounded-md border border-border bg-secondary p-3">
            <p className="text-xs font-semibold leading-[18px] text-muted-foreground">{t("player.quest.result")}</p>
            <p className="min-w-0 break-words text-sm leading-5 text-foreground" data-testid="quest-completion-result">
              {result}
            </p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={onClose} data-testid="quest-completion-close">
            {t("common.close")}
          </Button>
        </div>
      </section>
    </div>
  );
}

function QuestDetailAccordion({
  children,
  label,
  testId,
}: {
  children: ReactNode;
  label: string;
  testId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="grid min-w-0 border-t border-border/80">
      <button
        type="button"
        className="flex min-h-11 w-full min-w-0 items-center justify-between gap-3 bg-transparent py-2 text-left text-sm font-semibold leading-5 text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/80"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        data-testid={testId}
      >
        <span>{label}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open ? "rotate-180" : "")} aria-hidden="true" />
      </button>
      {open ? <div className="grid min-w-0 gap-2 pb-3 text-sm leading-5 text-muted-foreground">{children}</div> : null}
    </div>
  );
}

function QuestDetailContent({ quest }: { quest: QuestWithResult }) {
  const { t } = useTranslation();
  const result = questResultText(quest, t("player.quest.emptyResult"));
  const chapters = quest.chapters ?? [];

  return (
    <>
      <div className="grid min-w-0 gap-1">
        <p className="text-xs font-semibold leading-[18px] text-muted-foreground">
          {quest.status === "completed" ? t("player.quest.result") : t("player.quest.detail")}
        </p>
        <p className="min-w-0 break-words text-foreground">{result}</p>
      </div>
      {chapters.length ? (
        <ul className="grid min-w-0 gap-1">
          {chapters.slice(-3).map((chapter) => (
            <li className="min-w-0 break-words" key={chapter.id}>
              {chapter.summary}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function QuestListItem({
  onQuestAction,
  quest,
  turnPending,
}: {
  onQuestAction: (action: QuestAction, assignmentId: string) => void;
  quest: QuestWithResult;
  turnPending: boolean;
}) {
  const { t } = useTranslation();
  const actions = quest.available_actions ?? [];
  const detailLabel = quest.status === "completed" ? t("player.quest.result") : t("player.quest.detail");

  return (
    <li className="grid min-w-0 gap-3 border-b border-border py-3 last:border-b-0" data-testid={`quest-list-item-${quest.assignment_id}`}>
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="min-w-0 break-words font-bold leading-6 text-foreground">{quest.title}</p>
          <span className="rounded border border-border bg-card px-2 py-0.5 text-xs font-semibold leading-[18px] text-muted-foreground">
            {t(`player.quest.status.${quest.status}`, { defaultValue: quest.status })}
          </span>
        </div>
        <p className="text-sm leading-5 text-muted-foreground">
          {quest.progress}/{quest.progress_target}
        </p>
      </div>
      <QuestDetailAccordion label={detailLabel} testId={`quest-detail-toggle-${quest.assignment_id}`}>
        <QuestDetailContent quest={quest} />
      </QuestDetailAccordion>
      {actions.length ? (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action}
              type="button"
              variant={action === "decline_quest" ? "secondary" : "default"}
              disabled={turnPending}
              onClick={() => onQuestAction(action as QuestAction, quest.assignment_id)}
            >
              <ListChecks aria-hidden="true" />
              {t(`player.quest.actions.${action}`)}
            </Button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function QuestListDialog({
  onClose,
  onQuestAction,
  quests,
  turnPending,
}: {
  onClose: () => void;
  onQuestAction: (action: QuestAction, assignmentId: string) => void;
  quests: QuestSummary[];
  turnPending: boolean;
}) {
  const { t } = useTranslation();

  function handleAction(action: QuestAction, assignmentId: string) {
    onQuestAction(action, assignmentId);
    onClose();
  }

  const groupedQuests = [
    { key: "active", quests: quests.filter((quest) => quest.status === "active") },
    { key: "offered", quests: quests.filter((quest) => quest.status === "offered") },
    { key: "paused", quests: quests.filter((quest) => quest.status === "paused") },
    { key: "completed", quests: quests.filter((quest) => quest.status === "completed") },
  ].filter((group) => group.quests.length);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 max-[640px]:items-end max-[640px]:p-0" role="presentation">
      <section
        role="dialog"
        aria-labelledby="quest-list-dialog-title"
        className="grid max-h-[min(80vh,680px)] w-full max-w-[560px] min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-4 rounded-lg border border-border bg-card p-5 text-card-foreground shadow-lg max-[640px]:max-h-[85vh] max-[640px]:max-w-none max-[640px]:rounded-b-none max-[640px]:border-b-0"
        data-testid="quest-list-dialog"
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <h2 id="quest-list-dialog-title" className="text-base font-semibold leading-6 text-foreground">
            {t("player.quest.listTitle")}
          </h2>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label={t("common.close")} disabled={turnPending}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="scrollbar-gestaloka min-h-0 overflow-y-auto pr-1">
          {quests.length ? (
            <div className="grid gap-4">
              {groupedQuests.map((group) => (
                <section className="grid min-w-0 gap-2" key={group.key}>
                  <h3 className="text-sm font-semibold leading-5 text-muted-foreground">
                    {t(`player.quest.groups.${group.key}`)}
                  </h3>
                  <ul className="grid">
                    {group.quests.map((quest) => (
                      <QuestListItem key={quest.assignment_id} quest={quest} turnPending={turnPending} onQuestAction={handleAction} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <p className="text-sm leading-5 text-muted-foreground">{t("player.quest.empty")}</p>
          )}
        </div>
      </section>
    </div>
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

      <Card className="grid min-w-0 gap-3 p-4">
        <h2 className="text-base font-semibold leading-6 text-foreground">{t("player.side.knownFacts")}</h2>
        <StreamList
          testId="known-facts-stream"
          items={sessionState?.known_facts ?? []}
          empty={t("common.none")}
          getKey={(item) => item.id}
          renderItem={(item) => (
            <>
              <strong>{item.title}</strong>
              <span>{item.summary}</span>
            </>
          )}
        />
      </Card>

      <Card className="grid min-w-0 gap-3 p-4">
        <h2 className="text-base font-semibold leading-6 text-foreground">{t("player.side.skills")}</h2>
        <StreamList
          testId="skills-stream"
          items={sessionState?.skills ?? []}
          empty={t("common.none")}
          getKey={(item) => item.id}
          renderItem={(item) => (
            <>
              <strong>{item.title}</strong>
              <span>{item.summary}</span>
            </>
          )}
        />
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
    lastPackPreprocessRun,
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
    opsPackCatalog,
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
      <p data-testid="pack-preprocess-status">
        {(opsPackCatalog?.preprocess_statuses ?? [])
          .map((item) => `${item.pack_id ?? "pack"}/${item.world_template_id ?? "template"}:${item.status}`)
          .join(" | ") || "No pack preprocess status."}
      </p>
      <p data-testid="last-pack-preprocess-run">
        {lastPackPreprocessRun ? `${lastPackPreprocessRun.world_id}:${lastPackPreprocessRun.status}` : "No pack preprocess run."}
      </p>
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
