# Production image for the Fastify API (ADR-0017). Docker runtime on Render, built
# with the repo root as context so the npm workspace and packages/shared are in scope.
#
# The image runs the TypeScript entrypoint directly with tsx — there is no compile
# step (ADR-0017): tsx is a runtime dependency and @burgers/shared is imported as
# source. Debian slim (glibc), not alpine, so @node-rs/argon2's prebuilt gnu binary
# resolves without a native rebuild.
FROM node:22-slim

WORKDIR /app

# Production install. NODE_ENV=production also flips the app's own env schema and
# Pino output to prod (ADR-0011); the real secrets are injected by Render at runtime.
ENV NODE_ENV=production

# Manifests first, so the dependency layer is cached until a package.json changes.
# npm ci validates the whole lockfile, so every workspace manifest must be present
# even though only the API and its workspace deps are installed below.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

# Install only the API workspace (plus the linked packages/shared) and the root,
# omitting devDependencies — the web app's deps never enter this image.
RUN npm ci --omit=dev --workspace @burgers/api --include-workspace-root

# Application source. The root .env is deliberately not copied: prod secrets come
# from Render's environment, and load-env.ts tolerates its absence.
COPY packages/shared packages/shared
COPY apps/api apps/api

WORKDIR /app/apps/api

# Documentation only; Render injects PORT and routes to it (server.ts prefers PORT).
EXPOSE 3000

CMD ["npm", "run", "start"]
