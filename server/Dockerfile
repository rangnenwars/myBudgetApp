# Build context is the repo root (see docker-compose.yml), not server/ —
# this image needs ../utils/calculations.ts, ../utils/types.ts, and
# ../constants/categories.ts alongside server/, so the directory structure
# inside the image mirrors the host repo exactly.

# ---------- quality gate ----------
# Every build runs the server type check and the tests that need no database. A
# failure stops the build, so a broken change never becomes an image. The database
# tests run with `npm run check` and in the commit hook (a build has no database).
# Emergency skip: RUN_QUALITY=0 docker compose build
FROM node:22-alpine AS quality
ARG RUN_QUALITY=1
ENV RUN_QUALITY=$RUN_QUALITY
WORKDIR /app
COPY utils ./utils
COPY constants ./constants
COPY server ./server
WORKDIR /app/server
RUN npm ci
RUN sh scripts/docker-quality.sh

# ---------- runtime ----------
FROM node:22-alpine
WORKDIR /app

COPY utils ./utils
COPY constants ./constants
COPY server ./server
# Ties this image to the quality stage: BuildKit only builds stages the final image uses.
COPY --from=quality /tmp/quality-passed /tmp/quality-passed

WORKDIR /app/server
RUN npm ci
RUN chmod +x docker-entrypoint.sh

# Don't run the API as root: a compromise of the Node process then can't
# write to the image or install anything. The node user ships with the image.
USER node

EXPOSE 4000
CMD ["./docker-entrypoint.sh"]
