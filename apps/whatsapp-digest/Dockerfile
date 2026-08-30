# Production image for the WhatsApp daily group digest (ADR-0026, 2026-08 VPS move). Built with
# the repo root as context so the npm workspace and the lockfile are in scope. It ships as its
# own container beside the API and the SPA: the digest shares this repo and nothing else — no
# route, no database, no import from the API.
#
# The image runs the TypeScript entrypoint directly with tsx — there is no compile step
# (ADR-0017), which is why tsx is a runtime dependency and not a dev one: --omit=dev below
# would otherwise strip the only thing that can run the source. Debian slim (glibc), not
# alpine, and pinned, never :latest — the same rule the other images state, for the same
# reason: a silent major jump should not arrive with an unrelated deploy.
FROM node:22-slim

WORKDIR /app

# Pinned for parity with the other images and because npm itself reads it; the app's own env
# schema carries NODE_ENV but nothing in the job branches on it.
ENV NODE_ENV=production

# Manifests first, so the dependency layer is cached until a package.json changes.
# npm ci validates the whole lockfile, so every workspace manifest must be present
# even though only the digest and its workspace deps are installed below.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/whatsapp-digest/package.json apps/whatsapp-digest/package.json

# Install only the digest workspace and the root, omitting devDependencies — vitest and the
# API's and web app's dependency trees never enter this image.
RUN npm ci --omit=dev --workspace @burgers/whatsapp-digest --include-workspace-root

# Application source, and only this app's: the digest imports nothing from packages/shared,
# deliberately, so it stays deployable on its own. tsconfig.base.json is not copied either —
# tsx runs the source without typechecking it (ADR-0017), so only the web image, whose build
# actually runs tsc, needs that file. The root .env is deliberately not copied: prod config
# arrives through env_file from the VPS's own .env.prod, and load-env.ts tolerates its absence.
COPY apps/whatsapp-digest apps/whatsapp-digest

WORKDIR /app/apps/whatsapp-digest

# No EXPOSE and no HEALTHCHECK, on purpose: this job has no inbound surface at all — nothing
# listens, and there is no webhook — so there is no port to document and nothing to probe.
# Its liveness is read from `docker logs burgers-bar-whatsapp-digest-1`, which is also where a
# fail-fast boot on missing GREEN_API_* credentials shows up, since the deploy script's health
# wait only ever inspects burgers-bar-api-1.
CMD ["npm", "run", "start"]
