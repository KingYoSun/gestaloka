import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AppShell } from "./components/ui/AppShell";
import { PlayerPage } from "./features/player/PlayerPage";
import { useGestalokaRuntime } from "./hooks/useGestalokaRuntime";
import { LanguageSwitcher } from "./i18n/LanguageSwitcher";
import { ThemeToggle } from "./theme/ThemeToggle";

function App() {
  const { t } = useTranslation();
  const runtime = useGestalokaRuntime();
  const { authRecoveryRequired, error } = runtime;

  useEffect(() => {
    document.title = t("common.appTitle");
  }, [t]);

  return (
    <AppShell
      header={
        <header className="flex items-center justify-between gap-2 pt-3">
          {runtime.session ? (
            <p className="text-sm font-bold lowercase leading-[21px] tracking-[0.16em] text-foreground">{t("common.brandWordmark")}</p>
          ) : (
            <span aria-hidden="true" />
          )}
          <div className="flex items-center justify-end gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
          </div>
        </header>
      }
      error={
        error ? (
          <aside
            className="sticky bottom-4 z-10 mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm leading-5 text-destructive shadow-sm"
            data-testid="error-banner"
          >
            <span>{error}</span>
            {authRecoveryRequired ? (
              <button
                className="ml-3 rounded-md border border-destructive/30 bg-background px-3 py-1 text-xs font-bold text-foreground"
                type="button"
                onClick={runtime.handleLogin}
              >
                {t("auth.relogin")}
              </button>
            ) : null}
          </aside>
        ) : null
      }
    >
      <PlayerPage runtime={runtime} />
    </AppShell>
  );
}

export default App;
