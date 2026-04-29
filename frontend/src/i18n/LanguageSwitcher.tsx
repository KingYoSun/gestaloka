import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { supportedLanguages, type SupportedLanguage } from ".";

type LanguageSwitcherProps = {
  className?: string;
};

export function LanguageSwitcher({ className }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();
  const currentLanguage = i18n.resolvedLanguage === "ja" ? "ja" : "en";

  return (
    <div className={cn("flex items-center gap-1", className)} aria-label={t("language.label")}>
      <Languages className="size-[18px] text-muted-foreground" aria-hidden="true" />
      {supportedLanguages.map((language) => (
        <Button
          key={language}
          className="min-h-9 px-2.5 py-1.5 text-xs"
          variant={currentLanguage === language ? "default" : "secondary"}
          type="button"
          aria-pressed={currentLanguage === language}
          onClick={() => void i18n.changeLanguage(language)}
        >
          {language.toUpperCase()}
          <span className="sr-only">{t(`language.${language as SupportedLanguage}`)}</span>
        </Button>
      ))}
    </div>
  );
}
