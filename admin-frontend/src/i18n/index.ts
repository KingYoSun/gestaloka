import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import resources from "./resources";

export const localeStorageKey = "gestaloka.locale";
export const supportedLanguages = ["ja", "en"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

function normalizeLanguage(value: string | null | undefined): SupportedLanguage | null {
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase();
  if (normalized.startsWith("ja")) {
    return "ja";
  }
  if (normalized.startsWith("en")) {
    return "en";
  }
  return null;
}

function detectInitialLanguage(): SupportedLanguage {
  const saved = normalizeLanguage(window.localStorage.getItem(localeStorageKey));
  if (saved) {
    return saved;
  }
  return normalizeLanguage(window.navigator.language) ?? "en";
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLanguage(),
  fallbackLng: "en",
  supportedLngs: supportedLanguages,
  interpolation: {
    escapeValue: false,
  },
});

function applyDocumentLanguage(language: string) {
  const normalized = normalizeLanguage(language) ?? "en";
  document.documentElement.lang = normalized;
  window.localStorage.setItem(localeStorageKey, normalized);
}

applyDocumentLanguage(i18n.language);
i18n.on("languageChanged", applyDocumentLanguage);

export default i18n;
