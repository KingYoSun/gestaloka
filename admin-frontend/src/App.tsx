import {
  BarChart3,
  Boxes,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  RefreshCcw,
  Rocket,
  Settings,
  Users,
  WalletCards,
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch, formatError, requiresReauth } from "./api";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Checkbox } from "./components/ui/checkbox";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { NativeSelect } from "./components/ui/native-select";
import { Textarea } from "./components/ui/textarea";
import { LanguageSwitcher } from "./i18n/LanguageSwitcher";
import keycloak, { initKeycloak } from "./lib/keycloak";
import type {
  AdminUser,
  LLMSettings,
  LLMUsage,
  LLMUsageRange,
  ModelLanes,
  Overview,
  PackCatalog,
  PromptDetail,
  PromptListItem,
  ReleaseProgress,
  ReleaseSummary,
  SPOverview,
  TemplateItem,
} from "./types";

type AdminSection = "dashboard" | "packs" | "templates" | "users" | "llm" | "usage" | "lanes" | "prompts" | "sp" | "release";

type AppState = {
  overview: Overview | null;
  packs: PackCatalog | null;
  templates: TemplateItem[];
  users: AdminUser[];
  llm: LLMSettings | null;
  llmUsage: LLMUsage | null;
  lanes: ModelLanes | null;
  prompts: PromptListItem[];
  promptDetail: PromptDetail | null;
  sp: SPOverview | null;
  release: ReleaseSummary | null;
};

const emptyState: AppState = {
  overview: null,
  packs: null,
  templates: [],
  users: [],
  llm: null,
  llmUsage: null,
  lanes: null,
  prompts: [],
  promptDetail: null,
  sp: null,
  release: null,
};

const navItems: Array<{ id: AdminSection; labelKey: string; icon: ReactNode }> = [
  { id: "dashboard", labelKey: "nav.dashboard", icon: <LayoutDashboard /> },
  { id: "packs", labelKey: "nav.packs", icon: <Boxes /> },
  { id: "templates", labelKey: "nav.templates", icon: <ListChecks /> },
  { id: "users", labelKey: "nav.users", icon: <Users /> },
  { id: "llm", labelKey: "nav.llm", icon: <Settings /> },
  { id: "usage", labelKey: "nav.usage", icon: <BarChart3 /> },
  { id: "lanes", labelKey: "nav.lanes", icon: <Gauge /> },
  { id: "prompts", labelKey: "nav.prompts", icon: <MessageSquareText /> },
  { id: "sp", labelKey: "nav.sp", icon: <WalletCards /> },
  { id: "release", labelKey: "nav.release", icon: <Rocket /> },
];

function App() {
  const { t } = useTranslation();
  const [section, setSection] = useState<AdminSection>("dashboard");
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [token, setToken] = useState("");
  const [state, setState] = useState<AppState>(emptyState);
  const [llmUsageRange, setLlmUsageRange] = useState<LLMUsageRange>("24h");
  const [error, setError] = useState("");
  const [authRecoveryRequired, setAuthRecoveryRequired] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    document.title = t("common.adminTitle");
  }, [t]);

  useEffect(() => {
    initKeycloak()
      .then((isAuthenticated) => {
        setAuthenticated(isAuthenticated);
        setToken(keycloak.token ?? "");
      })
      .catch((initError) => {
        setAuthRecoveryRequired(requiresReauth(initError));
        setError(formatError(initError));
      })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    void refreshAll(token);
  }, [token]);

  async function refreshAll(currentToken = token, usageRange = llmUsageRange) {
    if (!currentToken) {
      return;
    }
    setPending(true);
    setError("");
    setAuthRecoveryRequired(false);
    try {
      const [overview, packs, templates, users, llm, llmUsage, lanes, prompts, sp, release] = await Promise.all([
        apiFetch<Overview>("/admin/overview", currentToken),
        apiFetch<PackCatalog>("/admin/packs", currentToken),
        apiFetch<{ items: TemplateItem[] }>("/admin/world-templates", currentToken),
        apiFetch<{ items: AdminUser[] }>("/admin/users", currentToken),
        apiFetch<LLMSettings>("/admin/settings/llm", currentToken),
        apiFetch<LLMUsage>(`/admin/llm-usage?range=${usageRange}`, currentToken),
        apiFetch<ModelLanes>("/admin/model-lanes", currentToken),
        apiFetch<{ items: PromptListItem[] }>("/admin/prompts", currentToken),
        apiFetch<SPOverview>("/admin/sp/overview", currentToken),
        apiFetch<ReleaseSummary>("/admin/release", currentToken),
      ]);
      setState((current) => ({
        ...current,
        overview,
        packs,
        templates: templates.items,
        users: users.items,
        llm,
        llmUsage,
        lanes,
        prompts: prompts.items,
        sp,
        release,
      }));
    } catch (requestError) {
      setAuthRecoveryRequired(requiresReauth(requestError));
      setError(formatError(requestError));
    } finally {
      setPending(false);
    }
  }

  async function login() {
    await keycloak.login(authRecoveryRequired ? { prompt: "login" } : undefined);
  }

  async function logout() {
    await keycloak.logout();
  }

  const title = t(navItems.find((item) => item.id === section)?.labelKey ?? "nav.dashboard");

  if (!ready) {
    return <div className="grid min-h-screen place-items-center p-6 text-sm text-muted-foreground">{t("common.loadingAdminSession")}</div>;
  }

  if (!authenticated) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <div className="grid w-full max-w-[360px] gap-4">
          <div className="justify-self-end">
            <LanguageSwitcher />
          </div>
          <Card className="grid min-w-0 gap-4 p-5">
            <p className="text-xs font-bold uppercase leading-[18px] text-muted-foreground">GESTALOKA Admin</p>
            <h1 className="text-2xl font-bold leading-8 text-foreground">{t("auth.heading")}</h1>
            <Button data-testid="admin-sign-in" onClick={login}>
              <KeyRound aria-hidden="true" />
              {t("auth.signIn")}
            </Button>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen grid-cols-[260px_minmax(0,1fr)] bg-background max-[900px]:grid-cols-1">
      <aside className="sticky top-0 grid h-screen grid-rows-[auto_1fr] gap-4 border-r border-border bg-background p-3 max-[900px]:static max-[900px]:h-auto">
        <div className="grid gap-0.5 px-2 pb-3">
          <span className="text-xs font-bold uppercase leading-[18px] text-muted-foreground">GESTALOKA</span>
          <strong className="text-lg leading-6 text-foreground">Admin</strong>
        </div>
        <nav className="grid content-start gap-1 max-[900px]:grid-cols-2" aria-label={t("nav.label")}>
          {navItems.map((item) => (
            <Button
              key={item.id}
              className="w-full justify-start"
              variant={section === item.id ? "default" : "ghost"}
              data-testid={`admin-nav-${item.id}`}
              onClick={() => setSection(item.id)}
            >
              {item.icon}
              <span>{t(item.labelKey)}</span>
            </Button>
          ))}
        </nav>
      </aside>
      <section className="grid min-w-0 content-start gap-4 p-6 max-[640px]:p-4">
        <header className="flex items-center justify-between gap-4 max-[640px]:items-start">
          <div>
            <p className="text-xs font-bold uppercase leading-[18px] text-muted-foreground">{t("admin.subtitle")}</p>
            <h1 className="text-2xl font-bold leading-8 text-foreground">{title}</h1>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <LanguageSwitcher />
            <Button size="icon" variant="secondary" aria-label={t("common.refresh")} data-testid="admin-refresh" onClick={() => void refreshAll()}>
              <RefreshCcw aria-hidden="true" />
            </Button>
            <Button variant="secondary" onClick={logout}>
              {t("common.logout")}
            </Button>
          </div>
        </header>
        {error ? (
          <Alert variant="destructive" data-testid="admin-error">
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>{error}</span>
              {authRecoveryRequired ? (
                <Button size="sm" variant="secondary" onClick={login}>
                  {t("common.relogin")}
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        {pending ? (
          <Alert>
            <AlertDescription>{t("admin.pending")}</AlertDescription>
          </Alert>
        ) : null}
        <AdminBody
          section={section}
          state={state}
          token={token}
          llmUsageRange={llmUsageRange}
          setLlmUsageRange={setLlmUsageRange}
          setState={setState}
          setError={setError}
          setAuthRecoveryRequired={setAuthRecoveryRequired}
          refreshAll={refreshAll}
        />
      </section>
    </main>
  );
}

function AdminBody({
  section,
  state,
  token,
  llmUsageRange,
  setLlmUsageRange,
  setState,
  setError,
  setAuthRecoveryRequired,
  refreshAll,
}: {
  section: AdminSection;
  state: AppState;
  token: string;
  llmUsageRange: LLMUsageRange;
  setLlmUsageRange: (range: LLMUsageRange) => void;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  setError: (message: string) => void;
  setAuthRecoveryRequired: (required: boolean) => void;
  refreshAll: () => Promise<void>;
}) {
  if (section === "packs") {
    return <PacksPage state={state} token={token} setError={setError} refreshAll={refreshAll} />;
  }
  if (section === "templates") {
    return <TemplatesPage state={state} token={token} setError={setError} refreshAll={refreshAll} />;
  }
  if (section === "users") {
    return <UsersPage state={state} token={token} setError={setError} refreshAll={refreshAll} />;
  }
  if (section === "llm") {
    return <LLMPage state={state} token={token} setError={setError} refreshAll={refreshAll} />;
  }
  if (section === "usage") {
    return (
      <LLMUsagePage
        state={state}
        token={token}
        range={llmUsageRange}
        setRange={setLlmUsageRange}
        setState={setState}
        setError={setError}
      />
    );
  }
  if (section === "lanes") {
    return <LanesPage state={state} token={token} setError={setError} refreshAll={refreshAll} />;
  }
  if (section === "prompts") {
    return <PromptsPage state={state} token={token} setState={setState} setError={setError} refreshAll={refreshAll} />;
  }
  if (section === "sp") {
    return <SPPage state={state} token={token} setError={setError} refreshAll={refreshAll} />;
  }
  if (section === "release") {
    return (
      <ReleasePage
        state={state}
        token={token}
        setError={setError}
        setAuthRecoveryRequired={setAuthRecoveryRequired}
        refreshAll={refreshAll}
      />
    );
  }
  return <Dashboard state={state} />;
}

function Dashboard({ state }: { state: AppState }) {
  const { t } = useTranslation();
  const overview = state.overview;
  const packSummary = overview?.packs ?? (
    state.packs
      ? {
          status: state.packs.status,
          pack_count: state.packs.pack_count,
          template_count: state.packs.template_count,
          failure_count: state.packs.failure_count,
        }
      : null
  );
  return (
    <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-1" data-testid="admin-dashboard">
      <Metric label={t("admin.packStatus")} value={packSummary?.status ?? t("common.unknown")} detail={t("admin.packCount", { count: packSummary?.pack_count ?? 0 })} />
      <Metric label={t("admin.templates")} value={String(packSummary?.template_count ?? 0)} detail={t("admin.failures", { count: packSummary?.failure_count ?? 0 })} />
      <Metric label={t("admin.graphRuntime")} value={overview?.projection.graph_runtime_status ?? t("common.unknown")} detail={t("admin.pendingCount", { count: overview?.projection.pending ?? 0 })} />
      <Metric label={t("admin.release")} value={overview?.release.verdict ?? t("common.unknown")} detail={overview?.release.canary_promote_status ?? t("common.unknown")} />
      <Panel title={t("admin.operations")}>
        <p className="text-sm leading-5 text-muted-foreground">{t("admin.operationsDescription")}</p>
      </Panel>
    </div>
  );
}

function PacksPage({ state, token, setError, refreshAll }: PageProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({ pack_id: "", display_name: "", template_id: "default", template_display_name: "Default World", summary: "" });
  const [archivePath, setArchivePath] = useState("");

  async function createPack(event: FormEvent) {
    event.preventDefault();
    try {
      await apiFetch("/admin/packs", token, { method: "POST", body: JSON.stringify(draft) });
      setDraft({ pack_id: "", display_name: "", template_id: "default", template_display_name: "Default World", summary: "" });
      await refreshAll();
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }

  async function importPack(event: FormEvent) {
    event.preventDefault();
    try {
      await apiFetch("/admin/packs/import", token, { method: "POST", body: JSON.stringify({ archive_path: archivePath, replace: true }) });
      setArchivePath("");
      await refreshAll();
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }

  async function patchPack(packId: string, publishStatus: string) {
    try {
      await apiFetch(`/admin/packs/${encodeURIComponent(packId)}`, token, {
        method: "PATCH",
        body: JSON.stringify({ publish_status: publishStatus }),
      });
      await refreshAll();
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }

  return (
    <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-1" data-testid="admin-packs">
      <Panel title={t("packs.catalog")}>
        <div className="grid gap-2">
          {(state.packs?.items ?? []).map((pack) => (
            <article key={pack.pack_id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-lg border border-border p-3 max-[900px]:grid-cols-1">
              <div className="grid min-w-0 gap-0.5">
                <strong className="truncate text-sm font-semibold text-foreground">{pack.display_name}</strong>
                <span className="truncate text-xs leading-5 text-muted-foreground">{pack.pack_id} / {pack.version}</span>
              </div>
              <Status value={`${pack.visibility} / ${pack.publish_status}`} />
              <Button variant="secondary" onClick={() => void patchPack(pack.pack_id, pack.publish_status === "playable" ? "draft" : "playable")}>
                {pack.publish_status === "playable" ? "Draft" : "Playable"}
              </Button>
            </article>
          ))}
        </div>
      </Panel>
      <Panel title={t("packs.create")}>
        <form className="grid gap-2.5" onSubmit={createPack}>
          <Field label={t("packs.packId")}><Input value={draft.pack_id} onChange={(event) => setDraft({ ...draft, pack_id: event.target.value })} /></Field>
          <Field label={t("packs.displayName")}><Input value={draft.display_name} onChange={(event) => setDraft({ ...draft, display_name: event.target.value })} /></Field>
          <Field label={t("packs.templateId")}><Input value={draft.template_id} onChange={(event) => setDraft({ ...draft, template_id: event.target.value })} /></Field>
          <Field label={t("packs.templateName")}><Input value={draft.template_display_name} onChange={(event) => setDraft({ ...draft, template_display_name: event.target.value })} /></Field>
          <Field label={t("packs.summary")}><Textarea value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></Field>
          <Button type="submit">{t("common.create")}</Button>
        </form>
      </Panel>
      <Panel title={t("packs.importArchive")}>
        <form className="grid gap-2.5" onSubmit={importPack}>
          <Field label={t("packs.archivePath")}><Input value={archivePath} onChange={(event) => setArchivePath(event.target.value)} /></Field>
          <Button type="submit">{t("common.import")}</Button>
        </form>
      </Panel>
    </div>
  );
}

function TemplatesPage({ state, token, setError, refreshAll }: PageProps) {
  const { t } = useTranslation();
  async function patchTemplate(template: TemplateItem, publishStatus: string) {
    try {
      await apiFetch(`/admin/world-templates/${template.pack_id}/${template.template_id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ publish_status: publishStatus }),
      });
      await refreshAll();
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }
  return (
    <Panel title={t("nav.templates")}>
      <div className="grid gap-2" data-testid="admin-world-templates">
        {state.templates.map((template) => (
          <article key={`${template.pack_id}-${template.template_id}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-lg border border-border p-3 max-[900px]:grid-cols-1">
            <div className="grid min-w-0 gap-0.5">
              <strong className="truncate text-sm font-semibold text-foreground">{template.display_name}</strong>
              <span className="truncate text-xs leading-5 text-muted-foreground">{template.pack_display_name} / {template.template_id}</span>
            </div>
            <Status value={`${template.effective_visibility} / ${template.effective_publish_status}`} />
            <Button variant="secondary" onClick={() => void patchTemplate(template, template.effective_publish_status === "playable" ? "draft" : "playable")}>
              {template.effective_publish_status === "playable" ? "Draft" : "Playable"}
            </Button>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function UsersPage({ state, token, setError, refreshAll }: PageProps) {
  const { t } = useTranslation();
  const [userSub, setUserSub] = useState("");
  const [role, setRole] = useState<AdminUser["role"]>("operator");
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await apiFetch(`/admin/users/${encodeURIComponent(userSub)}/permissions`, token, {
        method: "PATCH",
        body: JSON.stringify({ role, status: "active", permissions: {} }),
      });
      setUserSub("");
      await refreshAll();
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }
  return (
    <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-1" data-testid="admin-users">
      <Panel title={t("users.users")}>
        <div className="grid gap-2">
          {state.users.map((user) => (
            <article key={user.user_sub} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border p-3 max-[900px]:grid-cols-1">
              <div className="grid min-w-0 gap-0.5">
                <strong className="truncate text-sm font-semibold text-foreground">{user.display_name || user.user_sub}</strong>
                <span className="truncate text-xs leading-5 text-muted-foreground">{user.user_sub}</span>
              </div>
              <Status value={`${user.role} / ${user.status}`} />
            </article>
          ))}
        </div>
      </Panel>
      <Panel title={t("users.grantPermission")}>
        <form className="grid gap-2.5" onSubmit={submit}>
          <Field label={t("users.userSub")}><Input value={userSub} onChange={(event) => setUserSub(event.target.value)} /></Field>
          <Field label={t("users.role")}>
            <NativeSelect value={role} onChange={(event) => setRole(event.target.value as AdminUser["role"])}>
              <option value="operator">operator</option>
              <option value="admin">admin</option>
              <option value="viewer">viewer</option>
            </NativeSelect>
          </Field>
          <Button type="submit">{t("common.save")}</Button>
        </form>
      </Panel>
    </div>
  );
}

function LLMPage({ state, token, setError, refreshAll }: PageProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<LLMSettings | null>(null);
  useEffect(() => setDraft(state.llm), [state.llm]);
  if (!draft) {
    return <Panel title={t("llm.settings")}><p>{t("llm.loading")}</p></Panel>;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await apiFetch("/admin/settings/llm", token, { method: "PUT", body: JSON.stringify(draft) });
      await refreshAll();
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }
  return (
    <Panel title={t("llm.providerSettings")}>
      <form className="grid gap-2.5" data-testid="admin-llm-settings" onSubmit={submit}>
        <Field label={t("llm.provider")}><Input value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value })} /></Field>
        <Field label={t("llm.baseUrlSecretRef")}><Input value={draft.base_url_secret_ref} onChange={(event) => setDraft({ ...draft, base_url_secret_ref: event.target.value })} /></Field>
        <Field label={t("llm.apiKeySecretRef")}><Input value={draft.api_key_secret_ref} onChange={(event) => setDraft({ ...draft, api_key_secret_ref: event.target.value })} /></Field>
        <Field label={t("llm.embeddingProvider")}><Input value={draft.embedding_provider} onChange={(event) => setDraft({ ...draft, embedding_provider: event.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm leading-5 text-foreground">
          <Checkbox checked={draft.admin_debug_enabled} onCheckedChange={(checked) => setDraft({ ...draft, admin_debug_enabled: checked === true })} />
          {t("llm.diagnostics")}
        </label>
        <Button type="submit">{t("common.save")}</Button>
      </form>
    </Panel>
  );
}

const chartColors = ["#65785f", "#c6922e", "#7bcfd0", "#b22323", "#d13e5c", "#0b2034"];

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "n/a";
  }
  return `${Math.round(value * 1000) / 10}%`;
}

function LLMUsagePage({
  state,
  token,
  range,
  setRange,
  setState,
  setError,
}: {
  state: AppState;
  token: string;
  range: LLMUsageRange;
  setRange: (range: LLMUsageRange) => void;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  setError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const usage = state.llmUsage;

  async function changeRange(nextRange: LLMUsageRange) {
    setRange(nextRange);
    try {
      const payload = await apiFetch<LLMUsage>(`/admin/llm-usage?range=${nextRange}`, token);
      setState((current) => ({ ...current, llmUsage: payload }));
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }

  return (
    <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-1" data-testid="admin-llm-usage">
      <Metric label={t("usage.totalTokens")} value={formatNumber(usage?.totals.total_tokens ?? 0)} detail={t("usage.promptCompletion", { prompt: formatNumber(usage?.totals.prompt_tokens ?? 0), completion: formatNumber(usage?.totals.completion_tokens ?? 0) })} />
      <Metric label={t("usage.cacheHitRate")} value={formatRate(usage?.totals.cache_hit_rate)} detail={t("usage.cacheTokens", { hit: formatNumber(usage?.totals.cache_hit_tokens ?? 0), miss: formatNumber(usage?.totals.cache_miss_tokens ?? 0) })} />
      <Metric label={t("usage.runs")} value={formatNumber(usage?.totals.run_count ?? 0)} detail={t("usage.bucket", { bucket: usage?.bucket ?? "hour" })} />
      <Metric label={t("usage.missing")} value={formatNumber(usage?.totals.missing_usage_count ?? 0)} detail={t("usage.range", { range })} />
      <Panel title={t("usage.title")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex overflow-hidden rounded-lg border border-border bg-background p-1" data-testid="admin-llm-usage-range">
            {(["24h", "30d"] as LLMUsageRange[]).map((item) => (
              <Button
                key={item}
                size="sm"
                variant={range === item ? "default" : "ghost"}
                onClick={() => void changeRange(item)}
              >
                {t(`usage.ranges.${item}`)}
              </Button>
            ))}
          </div>
          <span className="text-sm leading-5 text-muted-foreground">
            {usage ? `${new Date(usage.start_at).toLocaleString()} - ${new Date(usage.end_at).toLocaleString()}` : t("common.unknown")}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
          <UsageLineChart
            title={t("usage.tokenVolume")}
            models={usage?.models ?? []}
            valueForPoint={(point) => point.total_tokens}
            valueLabel={(value) => formatNumber(value)}
          />
          <UsageLineChart
            title={t("usage.cacheRate")}
            models={usage?.models ?? []}
            valueForPoint={(point) => Math.round((point.cache_hit_rate ?? 0) * 100)}
            valueLabel={(value) => `${value}%`}
            fixedMax={100}
          />
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-[760px] w-full border-collapse text-sm leading-5">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">{t("usage.model")}</th>
                <th className="px-3 py-2 font-semibold">{t("usage.provider")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("usage.totalTokens")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("usage.promptTokens")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("usage.completionTokens")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("usage.cacheHitRate")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("usage.runs")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("usage.missing")}</th>
              </tr>
            </thead>
            <tbody>
              {(usage?.models ?? []).map((model, index) => (
                <tr className="border-t border-border" key={`${model.provider_name}-${model.model_lane}-${model.model_id}`}>
                  <td className="px-3 py-2">
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: chartColors[index % chartColors.length] }} />
                    <strong>{model.model_id}</strong>
                    <span className="ml-2 text-muted-foreground">{model.model_lane}</span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{model.provider_name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(model.total_tokens)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(model.prompt_tokens)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(model.completion_tokens)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatRate(model.cache_hit_rate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(model.run_count)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(model.missing_usage_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function UsageLineChart({
  title,
  models,
  valueForPoint,
  valueLabel,
  fixedMax,
}: {
  title: string;
  models: LLMUsage["models"];
  valueForPoint: (point: LLMUsage["models"][number]["series"][number]) => number;
  valueLabel: (value: number) => string;
  fixedMax?: number;
}) {
  const width = 720;
  const height = 260;
  const padding = { top: 22, right: 24, bottom: 34, left: 58 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = fixedMax ?? Math.max(1, ...models.flatMap((model) => model.series.map(valueForPoint)));
  const topValue = fixedMax ?? Math.max(1, Math.ceil(maxValue * 1.1));
  const firstSeriesLength = models[0]?.series.length ?? 0;

  function pointX(index: number) {
    if (firstSeriesLength <= 1) {
      return padding.left;
    }
    return padding.left + (index / (firstSeriesLength - 1)) * plotWidth;
  }

  function pointY(value: number) {
    return padding.top + plotHeight - (Math.min(value, topValue) / topValue) * plotHeight;
  }

  return (
    <div className="grid min-w-0 gap-2 rounded-lg border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-sm leading-5 text-foreground">{title}</strong>
        <span className="text-xs leading-[18px] text-muted-foreground">{valueLabel(topValue)}</span>
      </div>
      <svg className="h-[260px] w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + plotHeight} stroke="var(--border)" />
        <line x1={padding.left} y1={padding.top + plotHeight} x2={padding.left + plotWidth} y2={padding.top + plotHeight} stroke="var(--border)" />
        {[0, 0.5, 1].map((ratio) => {
          const y = padding.top + plotHeight - ratio * plotHeight;
          return (
            <g key={ratio}>
              <line x1={padding.left} y1={y} x2={padding.left + plotWidth} y2={y} stroke="var(--border)" strokeDasharray="4 6" opacity={0.65} />
              <text x={padding.left - 10} y={y + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
                {valueLabel(Math.round(topValue * ratio))}
              </text>
            </g>
          );
        })}
        {models.map((model, modelIndex) => {
          const points = model.series.map((point, index) => `${pointX(index)},${pointY(valueForPoint(point))}`).join(" ");
          return (
            <polyline
              key={`${model.provider_name}-${model.model_lane}-${model.model_id}`}
              fill="none"
              stroke={chartColors[modelIndex % chartColors.length]}
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={points}
            />
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-3">
        {models.map((model, index) => (
          <span className="inline-flex items-center gap-1.5 text-xs leading-[18px] text-muted-foreground" key={`${model.provider_name}-${model.model_lane}-${model.model_id}`}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: chartColors[index % chartColors.length] }} />
            {model.model_id}
          </span>
        ))}
      </div>
    </div>
  );
}

function LanesPage({ state, token, setError, refreshAll }: PageProps) {
  const { t } = useTranslation();
  const [modelIds, setModelIds] = useState<Record<string, string>>({});
  useEffect(() => setModelIds(state.lanes?.model_ids ?? {}), [state.lanes]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await apiFetch("/admin/model-lanes", token, { method: "PUT", body: JSON.stringify({ model_ids: modelIds }) });
      await refreshAll();
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }
  return (
    <Panel title={t("lanes.title")}>
      <form className="grid gap-2.5" data-testid="admin-model-lanes" onSubmit={submit}>
        {(state.lanes?.supported_lanes ?? ["lite_lane", "main_lane", "pro_lane"]).map((lane) => (
          <Field key={lane} label={lane}>
            <Input value={modelIds[lane] ?? ""} onChange={(event) => setModelIds({ ...modelIds, [lane]: event.target.value })} />
          </Field>
        ))}
        <Button type="submit">{t("common.save")}</Button>
      </form>
    </Panel>
  );
}

function PromptsPage({ state, token, setState, setError, refreshAll }: PageProps & { setState: React.Dispatch<React.SetStateAction<AppState>> }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState("");
  const [overrideText, setOverrideText] = useState("");
  const [enabled, setEnabled] = useState(true);
  const selectedPrompt = useMemo(() => state.prompts.find((item) => item.prompt_id === selected), [selected, state.prompts]);
  const visiblePrompts = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) {
      return state.prompts;
    }
    return state.prompts.filter((prompt) =>
      [
        prompt.prompt_id,
        prompt.owner_module,
        prompt.model_lane,
        prompt.expected_output_schema,
        prompt.override_enabled ? "override enabled" : "override disabled",
      ].some((value) => value.toLowerCase().includes(query)),
    );
  }, [filter, state.prompts]);

  async function loadPrompt(promptId: string) {
    setSelected(promptId);
    try {
      const detail = await apiFetch<PromptDetail>(`/admin/prompts/${encodeURIComponent(promptId)}`, token);
      setState((current) => ({ ...current, promptDetail: detail }));
      setOverrideText(detail.override.instructions);
      setEnabled(detail.override.enabled);
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) {
      return;
    }
    try {
      await apiFetch(`/admin/prompts/${encodeURIComponent(selected)}/override`, token, {
        method: "PUT",
        body: JSON.stringify({ enabled, instructions: overrideText }),
      });
      await refreshAll();
      await loadPrompt(selected);
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }

  return (
    <div className="grid grid-cols-[minmax(260px,360px)_minmax(0,1fr)] gap-3 max-[900px]:grid-cols-1" data-testid="admin-prompts">
      <Panel title={t("prompts.registry")}>
        <div className="grid gap-2">
          <Input
            data-testid="admin-prompts-filter"
            value={filter}
            placeholder={t("prompts.filter")}
            onChange={(event) => setFilter(event.target.value)}
          />
          {visiblePrompts.map((prompt) => (
            <Button
              key={prompt.prompt_id}
              className="grid h-auto min-h-0 w-full justify-stretch gap-0.5 px-3 py-2 text-left"
              variant={prompt.prompt_id === selected ? "default" : "secondary"}
              onClick={() => void loadPrompt(prompt.prompt_id)}
            >
              <strong className="truncate text-sm font-semibold">{prompt.prompt_id}</strong>
              <span className="truncate text-xs font-normal leading-5 opacity-80">{prompt.model_lane} / {prompt.expected_output_schema}</span>
            </Button>
          ))}
          {!visiblePrompts.length ? <p className="text-sm leading-5 text-muted-foreground">{t("prompts.noMatches")}</p> : null}
        </div>
      </Panel>
      <Panel title={selectedPrompt?.prompt_id ?? t("prompts.override")}>
        {state.promptDetail ? (
          <form className="grid gap-2.5" onSubmit={submit}>
            <p className="text-sm leading-5 text-muted-foreground">{state.promptDetail.owner_module} / {state.promptDetail.eval_dataset_ref}</p>
            <label className="flex items-center gap-2 text-sm leading-5 text-foreground">
              <Checkbox checked={enabled} onCheckedChange={(checked) => setEnabled(checked === true)} />
              {t("prompts.overrideEnabled")}
            </label>
            <Field label={t("prompts.instructions")}><Textarea rows={10} value={overrideText} onChange={(event) => setOverrideText(event.target.value)} /></Field>
            <Button type="submit">{t("common.save")}</Button>
          </form>
        ) : (
          <p className="text-sm leading-5 text-muted-foreground">{t("prompts.select")}</p>
        )}
      </Panel>
    </div>
  );
}

function SPPage({ state, token, setError, refreshAll }: PageProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({ user_sub: "", delta: "0", reason_code: "admin_adjustment", world_id: "", note: "" });
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await apiFetch("/admin/sp/adjustments", token, {
        method: "POST",
        body: JSON.stringify({ ...draft, delta: Number(draft.delta), world_id: draft.world_id || null, note: draft.note || null }),
      });
      await refreshAll();
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }
  return (
    <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-1" data-testid="admin-sp">
      <Metric label={t("sp.accounts")} value={String(state.sp?.total_accounts ?? 0)} detail={t("sp.ledgerEntries", { count: state.sp?.total_ledger_entries ?? 0 })} />
      <Panel title={t("sp.adjustment")}>
        <form className="grid gap-2.5" onSubmit={submit}>
          <Field label={t("sp.userSub")}><Input value={draft.user_sub} onChange={(event) => setDraft({ ...draft, user_sub: event.target.value })} /></Field>
          <Field label={t("sp.delta")}><Input value={draft.delta} onChange={(event) => setDraft({ ...draft, delta: event.target.value })} /></Field>
          <Field label={t("sp.reason")}><Input value={draft.reason_code} onChange={(event) => setDraft({ ...draft, reason_code: event.target.value })} /></Field>
          <Field label={t("sp.worldId")}><Input value={draft.world_id} onChange={(event) => setDraft({ ...draft, world_id: event.target.value })} /></Field>
          <Field label={t("sp.note")}><Textarea value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></Field>
          <Button type="submit">{t("common.apply")}</Button>
        </form>
      </Panel>
    </div>
  );
}

function ReleasePage({ state, token, setError, setAuthRecoveryRequired, refreshAll }: PageProps) {
  const { t } = useTranslation();
  const [checklistPending, setChecklistPending] = useState(false);
  const [progress, setProgress] = useState<ReleaseProgress | null>(null);

  async function refreshProgress() {
    const payload = await apiFetch<ReleaseProgress>("/admin/release/checklists/progress", token);
    setProgress(payload);
    return payload;
  }

  async function runChecklist() {
    let interval: number | null = null;
    try {
      setChecklistPending(true);
      setError("");
      setAuthRecoveryRequired?.(false);
      await refreshProgress().catch(() => undefined);
      interval = window.setInterval(() => {
        void refreshProgress().catch(() => undefined);
      }, 2000);
      await apiFetch("/admin/release/checklists/run", token, { method: "POST", body: JSON.stringify({ trigger_type: "manual" }) });
      await refreshProgress().catch(() => undefined);
      await refreshAll();
    } catch (requestError) {
      setAuthRecoveryRequired?.(requiresReauth(requestError));
      setError(formatError(requestError));
    } finally {
      if (interval !== null) {
        window.clearInterval(interval);
      }
      setChecklistPending(false);
    }
  }
  const visibleProgress = progress;
  const releaseChecks = state.release?.check_summaries ?? [];
  const blockedReasons = state.release?.blocked_reasons ?? [];
  return (
    <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-1" data-testid="admin-release">
      <Metric label={t("release.verdict")} value={state.release?.verdict ?? t("common.unknown")} detail={state.release?.canary_promote_status ?? t("common.unknown")} />
      <Panel title={t("release.checklist")}>
        <p className="text-sm leading-5 text-muted-foreground">{t("release.created", { value: state.release?.created_at ?? t("release.notRun") })}</p>
        <div className="grid min-w-0 gap-2" data-testid="admin-release-blocked-reasons">
          <div className="grid min-w-0 gap-2" data-testid="admin-release-blocked-summary">
            <p className="text-sm font-semibold leading-5 text-muted-foreground">{t("release.blocked")}</p>
            {blockedReasons.length ? (
              <ul className="grid min-w-0 gap-2">
                {blockedReasons.map((reason) => (
                  <li className="min-w-0 rounded-md border border-border bg-background p-3 text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]" key={reason}>
                    {reason}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm leading-5 text-muted-foreground">{t("release.none")}</p>
            )}
          </div>
          <div className="grid min-w-0 gap-2" data-testid="admin-release-check-details">
            <p className="text-sm font-semibold leading-5 text-muted-foreground">{t("release.checkDetails")}</p>
            {releaseChecks.length ? (
            <ul className="grid gap-2">
              {releaseChecks.map((check) => (
                <li className="min-w-0 rounded-md border border-border bg-background p-3 text-sm leading-5 text-muted-foreground" key={check.check_id}>
                  <strong className="block min-w-0 text-foreground [overflow-wrap:anywhere]">
                    {t("release.checkStatus", {
                      label: check.label || check.check_id,
                      status: check.status,
                      elapsed: Math.floor(check.elapsed_seconds),
                    })}
                  </strong>
                  {check.reason ? <span className="block min-w-0 [overflow-wrap:anywhere]">{check.reason}</span> : null}
                  {(check.execution_mode || check.case_count != null || check.timeout_seconds != null) ? (
                    <span className="block min-w-0 [overflow-wrap:anywhere]">
                      {t("release.checkMeta", {
                        mode: check.execution_mode ?? t("common.unknown"),
                        cases: check.case_count ?? t("common.unknown"),
                        timeout: check.timeout_seconds ?? t("common.unknown"),
                      })}
                    </span>
                  ) : null}
                  {check.run_id ? <span className="block min-w-0 [overflow-wrap:anywhere]">run: {check.run_id}</span> : null}
                </li>
              ))}
            </ul>
            ) : (
              <p className="text-sm leading-5 text-muted-foreground">{t("release.none")}</p>
            )}
          </div>
        </div>
        <p className="text-sm leading-5 text-muted-foreground" data-testid="admin-release-progress">
          {t("release.progress", {
            status: visibleProgress?.status ?? (checklistPending ? t("release.running") : t("release.idle")),
            currentCheck: visibleProgress?.current_check ? ` / ${visibleProgress.current_check}` : "",
            elapsed: visibleProgress ? ` / ${Math.floor(visibleProgress.elapsed_seconds)}s` : "",
          })}
        </p>
        {visibleProgress?.error ? <p className="text-sm leading-5 text-destructive">{t("release.error", { message: visibleProgress.error })}</p> : null}
        <Button className="max-w-full whitespace-normal text-left max-[480px]:w-full" onClick={() => void runChecklist()} disabled={checklistPending}>
          {checklistPending ? t("release.runningChecklist") : t("release.run")}
        </Button>
      </Panel>
    </div>
  );
}

type PageProps = {
  state: AppState;
  token: string;
  setError: (message: string) => void;
  setAuthRecoveryRequired?: (required: boolean) => void;
  refreshAll: () => Promise<void>;
};

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="col-span-full min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card className="grid min-w-0 gap-1 p-4">
      <span className="text-sm leading-5 text-muted-foreground">{label}</span>
      <strong className="truncate text-[22px] font-bold leading-[30px] text-foreground">{value}</strong>
      <small className="truncate text-sm leading-5 text-muted-foreground">{detail}</small>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label>
      <span>{label}</span>
      {children}
    </Label>
  );
}

function Status({ value }: { value: string }) {
  return <Badge variant="outline">{value}</Badge>;
}

export default App;
