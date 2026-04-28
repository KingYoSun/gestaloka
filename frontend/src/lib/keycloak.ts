import Keycloak from "keycloak-js";

const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL,
  realm: import.meta.env.VITE_KEYCLOAK_REALM,
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
});

let initPromise: Promise<boolean> | null = null;

export function isKeycloakConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_KEYCLOAK_URL &&
      import.meta.env.VITE_KEYCLOAK_REALM &&
      import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
  );
}

export function initKeycloak(): Promise<boolean> {
  if (!isKeycloakConfigured()) {
    return Promise.resolve(false);
  }
  if (!initPromise) {
    initPromise = keycloak.init({
      onLoad: "check-sso",
      pkceMethod: "S256",
    });
  }
  return initPromise;
}

export default keycloak;
