export function oryConfiguration(env) {
  const providers = [
    {
      id: "google",
      provider: "google",
      client_id: env.ORY_GOOGLE_CLIENT_ID,
      client_secret: env.ORY_GOOGLE_CLIENT_SECRET,
      scope: ["openid", "profile"],
      mapper_url: "file:///etc/config/social.jsonnet",
    },
    {
      id: "twitter",
      provider: "x",
      client_id: env.ORY_X_API_KEY,
      client_secret: env.ORY_X_API_SECRET,
      mapper_url: "file:///etc/config/social.jsonnet",
    },
  ];
  // An unconfigured provider is omitted, so readiness never implies external login works.
  const configured = providers.filter((p) => p.client_id && p.client_secret);
  const kratos = {
    serve: {
      public: { base_url: env.ORY_KRATOS_PUBLIC_URL },
      admin: { base_url: "http://kratos:4434" },
    },
    session: { lifespan: "24h", cookie: { same_site: "Lax" } },
    selfservice: {
      default_browser_return_url: `${env.ORY_APP_URL}/`,
      allowed_return_urls: [
        env.ORY_APP_URL,
        env.ORY_ADMIN_APP_URL,
        env.ORY_AUTH_URL,
      ],
      methods: {
        oidc: {
          enabled: configured.length > 0,
          config: { providers: configured },
        },
      },
      flows: {
        error: { ui_url: `${env.ORY_AUTH_URL}/error` },
        login: { ui_url: `${env.ORY_AUTH_URL}/login`, lifespan: "10m" },
        registration: {
          ui_url: `${env.ORY_AUTH_URL}/registration`,
          lifespan: "10m",
          after: { oidc: { hooks: [{ hook: "session" }] } },
        },
        settings: {
          ui_url: `${env.ORY_AUTH_URL}/settings`,
          privileged_session_max_age: "15m",
          after: { default_browser_return_url: `${env.ORY_AUTH_URL}/settings` },
        },
        logout: {
          after: { default_browser_return_url: `${env.ORY_APP_URL}/` },
        },
      },
    },
    identity: {
      default_schema_id: "default",
      schemas: [
        { id: "default", url: "file:///etc/config/identity.schema.json" },
      ],
    },
    ciphers: { algorithm: "xchacha20-poly1305" },
    log: { level: "info", format: "json", leak_sensitive_values: false },
  };
  const hydra = {
    urls: {
      self: { issuer: env.ORY_HYDRA_PUBLIC_URL },
      login: `${env.ORY_AUTH_URL}/oauth/login`,
      consent: `${env.ORY_AUTH_URL}/oauth/consent`,
      logout: `${env.ORY_AUTH_URL}/oauth/logout`,
      identity_provider: {
        url: "http://kratos:4434",
        publicUrl: "http://kratos:4433",
      },
    },
    serve: { cookies: { same_site_mode: "Lax" } },
    oidc: { subject_identifiers: { supported_types: ["public", "pairwise"] } },
    log: { level: "info", format: "json", leak_sensitive_values: false },
  };

  if (env.ORY_COOKIE_DOMAIN) {
    kratos.cookies = { domain: env.ORY_COOKIE_DOMAIN };
    kratos.session.cookie.domain = env.ORY_COOKIE_DOMAIN;
  }
  return { kratos, hydra, configured };
}
