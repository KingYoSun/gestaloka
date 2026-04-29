import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { applyDocumentTheme, resolveInitialTheme, saveTheme, type ThemeMode } from ".";

export function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const initialTheme = resolveInitialTheme();
    applyDocumentTheme(initialTheme);
    return initialTheme;
  });
  const nextTheme: ThemeMode = theme === "dark" ? "light" : "dark";
  const label = theme === "dark" ? t("theme.toggleToLight") : t("theme.toggleToDark");
  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <Button
      className="min-h-9 px-2.5 py-1.5"
      size="icon"
      variant="secondary"
      type="button"
      aria-label={label}
      aria-pressed={theme === "dark"}
      title={label}
      data-testid="theme-toggle"
      onClick={() => {
        saveTheme(nextTheme);
        setTheme(nextTheme);
      }}
    >
      <Icon aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </Button>
  );
}
