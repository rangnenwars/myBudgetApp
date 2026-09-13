# Build context is the repo root (see docker-compose.yml), not server/ —
# this image needs ../utils/calculations.ts, ../utils/types.ts, and
# ../constants/categories.ts alongside server/, so the directory structure
# inside the image mirrors the host repo exactly.

FROM node:22-alpine
WORKDIR /app

COPY utils ./utils
COPY constants ./constants
COPY server ./server

WORKDIR /app/server
RUN npm ci
RUN chmod +x docker-entrypoint.sh

EXPOSE 4000
CMD ["./docker-entrypoint.sh"]
