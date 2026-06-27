# syntax=docker/dockerfile:1

# ── Build stage: install + build the whole monorepo ──────────────────────────
# The full node:20 image bundles git (snapshots/branches shell out to it), so no
# apt step is needed.
FROM node:20 AS base
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

# ── Server image: Fastify API + sync WebSocket ───────────────────────────────
# Inherits the built monorepo (incl. node_modules and git, which snapshots use).
FROM base AS server
ENV NODE_ENV=production \
    MAKEDOWN_WORKSPACES_ROOT=/app/examples \
    HOST=0.0.0.0 \
    PORT=4000
COPY docker/server-entrypoint.sh /usr/local/bin/server-entrypoint.sh
RUN chmod +x /usr/local/bin/server-entrypoint.sh
EXPOSE 4000
ENTRYPOINT ["/usr/local/bin/server-entrypoint.sh"]

# ── Web image: static build served + reverse-proxied by nginx ────────────────
FROM nginx:1.27-alpine AS web
COPY --from=base /app/packages/web/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
