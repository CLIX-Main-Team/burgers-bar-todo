# Production image for the SPA (2026-08 VPS move). On Vercel the build and the static
# hosting were the platform's job; on the VPS they are ours, so this is a two-stage
# build: node builds the bundle, nginx serves it. Nothing from stage one survives into
# the shipped image — no node, no source, no dependency tree, just the built files.

FROM node:22-slim AS build
WORKDIR /app

# Manifests first so the dependency layer caches until a package.json changes. npm ci
# validates the whole lockfile, so every workspace manifest must be present even though
# only the web workspace is installed (same constraint as apps/api/Dockerfile).
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/whatsapp-digest/package.json apps/whatsapp-digest/package.json

# NODE_ENV is deliberately NOT production here: vite and typescript are devDependencies
# and the build cannot run without them.
RUN npm ci --workspace @burgers/web --include-workspace-root

# The build runs tsc, and apps/web/tsconfig.json extends this root file — without it
# tsc falls back to ES3 and the build fails on every Map/Set iteration.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

# The API origin is baked into the bundle at build time, not read at runtime, so it has
# to be decided here. `/api` is a relative path on purpose: the API answers on this same
# host behind Traefik, so the browser never makes a cross-origin request and CORS,
# preflights, and the CSP connect-src exception all stop applying. The mobile build is
# the exception and keeps an absolute URL (apps/web/.env.mobile) because Capacitor serves
# the bundle from capacitor://localhost, where a relative path would resolve to the phone.
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build --workspace @burgers/web

# Pinned, never :latest — the same rule the local compose file states, for the same
# reason: a silent major jump should not arrive with an unrelated deploy.
FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/nginx-headers.conf /etc/nginx/nginx-headers.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
