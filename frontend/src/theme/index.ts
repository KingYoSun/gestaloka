export const themeStorageKey = "gestaloka.theme";
export const supportedThemes = ["light", "dark"] as const;
export type ThemeMode = (typeof supportedThemes)[number];

function normalizeTheme(value: string | null | undefined): ThemeMode | null {
  return value === "light" || value === "dark" ? value : null;
}

function detectSystemTheme(): ThemeMode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function readStoredTheme(): ThemeMode | null {
  return normalizeTheme(window.localStorage.getItem(themeStorageKey));
}

export function resolveInitialTheme(): ThemeMode {
  return readStoredTheme() ?? detectSystemTheme();
}

export function applyDocumentTheme(theme: ThemeMode) {
  document.documentElement.classList.remove("theme-light", "theme-dark");
  document.documentElement.classList.add(`theme-${theme}`);
  document.documentElement.style.colorScheme = theme;
}

export function saveTheme(theme: ThemeMode) {
  window.localStorage.setItem(themeStorageKey, theme);
  applyDocumentTheme(theme);
}

applyDocumentTheme(resolveInitialTheme());
