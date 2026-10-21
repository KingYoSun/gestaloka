FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.16.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile
ARG VITE_USER_APP_URL
ARG VITE_ADMIN_APP_URL
RUN pnpm build
RUN mkdir -p /runtime && chown node:node /runtime

FROM build AS server
ENV NODE_ENV=production
USER node
CMD ["node", "apps/api/dist/main.js"]

FROM caddy:2.11.7@sha256:685ae3d7c34d9b5f8caeddc5d14051db7bbd88ff1f5a2fa0c16bd8ca328fb7af AS web
COPY --from=build /app/apps/web/dist /srv/user
COPY --from=build /app/apps/admin/dist /srv/admin

FROM docker:29-cli@sha256:6fae2214c3121a28d5aa639d09032f61310b7c9c75ffbad1025f261a1b621800 AS docker-cli
FROM build AS controller
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
CMD ["node", "infra/production/controller.mjs"]
