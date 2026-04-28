import {
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
import { apiFetch, formatError } from "./api";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Checkbox } from "./components/ui/checkbox";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { NativeSelect } from "./components/ui/native-select";
import { Textarea } from "./components/ui/textarea";
import keycloak, { initKeycloak } from "./lib/keycloak";
import type {
  AdminUser,
  LLMSettings,
  ModelLanes,
  Overview,
  PackCatalog,
  PromptDetail,
  PromptListItem,
  ReleaseSummary,
  SPOverview,
  TemplateItem,
} from "./types";

type AdminSection = "dashboard" | "packs" | "templates" | "users" | "llm" | "lanes" | "prompts" | "sp" | "release";

type AppState = {
  overview: Overview | null;
  packs: PackCatalog | null;
  templates: TemplateItem[];
  users: AdminUser[];
  llm: LLMSettings | null;
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
  lanes: null,
  prompts: [],
  promptDetail: null,
  sp: null,
  release: null,
};

const navItems: Array<{ id: AdminSection; label: string; icon: ReactNode }> = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard /> },
  { id: "packs", label: "Packs", icon: <Boxes /> },
  { id: "templates", label: "World Templates", icon: <ListChecks /> },
  { id: "users", label: "Users & Permissions", icon: <Users /> },
  { id: "llm", label: "LLM Settings", icon: <Settings /> },
  { id: "lanes", label: "Model Lanes", icon: <Gauge /> },
  { id: "prompts", label: "Prompts", icon: <MessageSquareText /> },
  { id: "sp", label: "SP", icon: <WalletCards /> },
  { id: "release", label: "Release", icon: <Rocket /> },
];

function App() {
  const [section, setSection] = useState<AdminSection>("dashboard");
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [token, setToken] = useState("");
  const [state, setState] = useState<AppState>(emptyState);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    initKeycloak()
      .then((isAuthenticated) => {
        setAuthenticated(isAuthenticated);
        setToken(keycloak.token ?? "");
      })
      .catch((initError) => setError(formatError(initError)))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    void refreshAll(token);
  }, [token]);

  async function refreshAll(currentToken = token) {
    if (!currentToken) {
      return;
    }
    setPending(true);
    setError("");
    try {
      const [overview, packs, templates, users, llm, lanes, prompts, sp, release] = await Promise.all([
        apiFetch<Overview>("/admin/overview", currentToken),
        apiFetch<PackCatalog>("/admin/packs", currentToken),
        apiFetch<{ items: TemplateItem[] }>("/admin/world-templates", currentToken),
        apiFetch<{ items: AdminUser[] }>("/admin/users", currentToken),
        apiFetch<LLMSettings>("/admin/settings/llm", currentToken),
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
        lanes,
        prompts: prompts.items,
        sp,
        release,
      }));
    } catch (requestError) {
      setError(formatError(requestError));
    } finally {
      setPending(false);
    }
  }

  async function login() {
    await keycloak.login();
  }

  async function logout() {
    await keycloak.logout();
  }

  const title = navItems.find((item) => item.id === section)?.label ?? "Dashboard";

  if (!ready) {
    return <div className="grid min-h-screen place-items-center p-6 text-sm text-muted-foreground">Loading admin session</div>;
  }

  if (!authenticated) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <Card className="grid w-full max-w-[360px] gap-4 p-5">
          <p className="text-xs font-bold uppercase leading-[18px] text-muted-foreground">GESTALOKA Admin</p>
          <h1 className="text-2xl font-bold leading-8 text-foreground">運用管理</h1>
          <Button data-testid="admin-sign-in" onClick={login}>
            <KeyRound aria-hidden="true" />
            ログイン
          </Button>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </Card>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen grid-cols-[260px_minmax(0,1fr)] bg-muted max-[900px]:grid-cols-1">
      <aside className="sticky top-0 grid h-screen grid-rows-[auto_1fr] gap-4 border-r border-border bg-card p-3 max-[900px]:static max-[900px]:h-auto">
        <div className="grid gap-0.5 px-2 pb-3">
          <span className="text-xs font-bold uppercase leading-[18px] text-muted-foreground">GESTALOKA</span>
          <strong className="text-lg leading-6 text-foreground">Admin</strong>
        </div>
        <nav className="grid content-start gap-1 max-[900px]:grid-cols-2" aria-label="Admin sections">
          {navItems.map((item) => (
            <Button
              key={item.id}
              className="w-full justify-start"
              variant={section === item.id ? "default" : "ghost"}
              data-testid={`admin-nav-${item.id}`}
              onClick={() => setSection(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </Button>
          ))}
        </nav>
      </aside>
      <section className="grid min-w-0 content-start gap-4 p-6 max-[640px]:p-4">
        <header className="flex items-center justify-between gap-4 max-[640px]:items-start">
          <div>
            <p className="text-xs font-bold uppercase leading-[18px] text-muted-foreground">運用管理</p>
            <h1 className="text-2xl font-bold leading-8 text-foreground">{title}</h1>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="icon" variant="secondary" aria-label="Refresh" data-testid="admin-refresh" onClick={() => void refreshAll()}>
              <RefreshCcw aria-hidden="true" />
            </Button>
            <Button variant="secondary" onClick={logout}>
              ログアウト
            </Button>
          </div>
        </header>
        {error ? (
          <Alert variant="destructive" data-testid="admin-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {pending ? (
          <Alert>
            <AlertDescription>更新中</AlertDescription>
          </Alert>
        ) : null}
        <AdminBody section={section} state={state} token={token} setState={setState} setError={setError} refreshAll={refreshAll} />
      </section>
    </main>
  );
}

function AdminBody({
  section,
  state,
  token,
  setState,
  setError,
  refreshAll,
}: {
  section: AdminSection;
  state: AppState;
  token: string;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  setError: (message: string) => void;
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
    return <ReleasePage state={state} token={token} setError={setError} refreshAll={refreshAll} />;
  }
  return <Dashboard state={state} />;
}

function Dashboard({ state }: { state: AppState }) {
  const overview = state.overview;
  return (
    <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-1" data-testid="admin-dashboard">
      <Metric label="Pack status" value={overview?.packs.status ?? "unknown"} detail={`${overview?.packs.pack_count ?? 0} packs`} />
      <Metric label="Templates" value={String(overview?.packs.template_count ?? 0)} detail={`${overview?.packs.failure_count ?? 0} failures`} />
      <Metric label="Graph runtime" value={overview?.projection.graph_runtime_status ?? "unknown"} detail={`${overview?.projection.pending ?? 0} pending`} />
      <Metric label="Release" value={overview?.release.verdict ?? "unknown"} detail={overview?.release.canary_promote_status ?? "unknown"} />
      <Panel title="Operations">
        <p className="text-sm leading-5 text-muted-foreground">Admin は pack、ユーザー権限、LLM 設定、prompt、SP、release 操作を扱います。</p>
      </Panel>
    </div>
  );
}

function PacksPage({ state, token, setError, refreshAll }: PageProps) {
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
      <Panel title="Pack Catalog">
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
      <Panel title="Create Pack">
        <form className="grid gap-2.5" onSubmit={createPack}>
          <Field label="Pack ID"><Input value={draft.pack_id} onChange={(event) => setDraft({ ...draft, pack_id: event.target.value })} /></Field>
          <Field label="Display Name"><Input value={draft.display_name} onChange={(event) => setDraft({ ...draft, display_name: event.target.value })} /></Field>
          <Field label="Template ID"><Input value={draft.template_id} onChange={(event) => setDraft({ ...draft, template_id: event.target.value })} /></Field>
          <Field label="Template Name"><Input value={draft.template_display_name} onChange={(event) => setDraft({ ...draft, template_display_name: event.target.value })} /></Field>
          <Field label="Summary"><Textarea value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></Field>
          <Button type="submit">作成</Button>
        </form>
      </Panel>
      <Panel title="Import Archive">
        <form className="grid gap-2.5" onSubmit={importPack}>
          <Field label="Archive Path"><Input value={archivePath} onChange={(event) => setArchivePath(event.target.value)} /></Field>
          <Button type="submit">Import</Button>
        </form>
      </Panel>
    </div>
  );
}

function TemplatesPage({ state, token, setError, refreshAll }: PageProps) {
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
    <Panel title="World Templates">
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
      <Panel title="Users">
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
      <Panel title="Grant Permission">
        <form className="grid gap-2.5" onSubmit={submit}>
          <Field label="User sub"><Input value={userSub} onChange={(event) => setUserSub(event.target.value)} /></Field>
          <Field label="Role">
            <NativeSelect value={role} onChange={(event) => setRole(event.target.value as AdminUser["role"])}>
              <option value="operator">operator</option>
              <option value="admin">admin</option>
              <option value="viewer">viewer</option>
            </NativeSelect>
          </Field>
          <Button type="submit">保存</Button>
        </form>
      </Panel>
    </div>
  );
}

function LLMPage({ state, token, setError, refreshAll }: PageProps) {
  const [draft, setDraft] = useState<LLMSettings | null>(null);
  useEffect(() => setDraft(state.llm), [state.llm]);
  if (!draft) {
    return <Panel title="LLM Settings"><p>設定を読み込み中</p></Panel>;
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
    <Panel title="LLM Provider Settings">
      <form className="grid gap-2.5" data-testid="admin-llm-settings" onSubmit={submit}>
        <Field label="Provider"><Input value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value })} /></Field>
        <Field label="Base URL secret ref"><Input value={draft.base_url_secret_ref} onChange={(event) => setDraft({ ...draft, base_url_secret_ref: event.target.value })} /></Field>
        <Field label="API key secret ref"><Input value={draft.api_key_secret_ref} onChange={(event) => setDraft({ ...draft, api_key_secret_ref: event.target.value })} /></Field>
        <Field label="Embedding provider"><Input value={draft.embedding_provider} onChange={(event) => setDraft({ ...draft, embedding_provider: event.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm leading-5 text-foreground">
          <Checkbox checked={draft.admin_debug_enabled} onCheckedChange={(checked) => setDraft({ ...draft, admin_debug_enabled: checked === true })} />
          Diagnostics を有効化
        </label>
        <Button type="submit">保存</Button>
      </form>
    </Panel>
  );
}

function LanesPage({ state, token, setError, refreshAll }: PageProps) {
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
    <Panel title="Model Lanes">
      <form className="grid gap-2.5" data-testid="admin-model-lanes" onSubmit={submit}>
        {(state.lanes?.supported_lanes ?? ["lite_lane", "main_lane", "pro_lane"]).map((lane) => (
          <Field key={lane} label={lane}>
            <Input value={modelIds[lane] ?? ""} onChange={(event) => setModelIds({ ...modelIds, [lane]: event.target.value })} />
          </Field>
        ))}
        <Button type="submit">保存</Button>
      </form>
    </Panel>
  );
}

function PromptsPage({ state, token, setState, setError, refreshAll }: PageProps & { setState: React.Dispatch<React.SetStateAction<AppState>> }) {
  const [selected, setSelected] = useState("");
  const [overrideText, setOverrideText] = useState("");
  const [enabled, setEnabled] = useState(true);
  const selectedPrompt = useMemo(() => state.prompts.find((item) => item.prompt_id === selected), [selected, state.prompts]);

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
      <Panel title="Prompt Registry">
        <div className="grid gap-2">
          {state.prompts.map((prompt) => (
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
        </div>
      </Panel>
      <Panel title={selectedPrompt?.prompt_id ?? "Prompt Override"}>
        {state.promptDetail ? (
          <form className="grid gap-2.5" onSubmit={submit}>
            <p className="text-sm leading-5 text-muted-foreground">{state.promptDetail.owner_module} / {state.promptDetail.eval_dataset_ref}</p>
            <label className="flex items-center gap-2 text-sm leading-5 text-foreground">
              <Checkbox checked={enabled} onCheckedChange={(checked) => setEnabled(checked === true)} />
              Override enabled
            </label>
            <Field label="Override instructions"><Textarea rows={10} value={overrideText} onChange={(event) => setOverrideText(event.target.value)} /></Field>
            <Button type="submit">保存</Button>
          </form>
        ) : (
          <p className="text-sm leading-5 text-muted-foreground">Prompt を選択</p>
        )}
      </Panel>
    </div>
  );
}

function SPPage({ state, token, setError, refreshAll }: PageProps) {
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
      <Metric label="Accounts" value={String(state.sp?.total_accounts ?? 0)} detail={`${state.sp?.total_ledger_entries ?? 0} ledger entries`} />
      <Panel title="SP Adjustment">
        <form className="grid gap-2.5" onSubmit={submit}>
          <Field label="User sub"><Input value={draft.user_sub} onChange={(event) => setDraft({ ...draft, user_sub: event.target.value })} /></Field>
          <Field label="Delta"><Input value={draft.delta} onChange={(event) => setDraft({ ...draft, delta: event.target.value })} /></Field>
          <Field label="Reason"><Input value={draft.reason_code} onChange={(event) => setDraft({ ...draft, reason_code: event.target.value })} /></Field>
          <Field label="World ID"><Input value={draft.world_id} onChange={(event) => setDraft({ ...draft, world_id: event.target.value })} /></Field>
          <Field label="Note"><Textarea value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></Field>
          <Button type="submit">適用</Button>
        </form>
      </Panel>
    </div>
  );
}

function ReleasePage({ state, token, setError, refreshAll }: PageProps) {
  async function runChecklist() {
    try {
      await apiFetch("/admin/release/checklists/run", token, { method: "POST", body: JSON.stringify({ trigger_type: "manual" }) });
      await refreshAll();
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }
  return (
    <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-1" data-testid="admin-release">
      <Metric label="Verdict" value={state.release?.verdict ?? "unknown"} detail={state.release?.canary_promote_status ?? "unknown"} />
      <Panel title="Release Checklist">
        <p className="text-sm leading-5 text-muted-foreground">Created: {state.release?.created_at ?? "not run"}</p>
        <p className="text-sm leading-5 text-muted-foreground">Blocked: {(state.release?.blocked_reasons ?? []).join(", ") || "none"}</p>
        <Button onClick={() => void runChecklist()}>Run checklist</Button>
      </Panel>
    </div>
  );
}

type PageProps = {
  state: AppState;
  token: string;
  setError: (message: string) => void;
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
