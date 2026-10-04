# Builds the web version of Prapanji as a static export and serves it with
# nginx. No Expo account or network calls beyond `npm ci` are needed; the
# bundle talks to the API at EXPO_PUBLIC_API_URL (see build arg below).

# ---------- build ----------
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .

# EXPO_PUBLIC_* vars are inlined into the JS bundle at export time, so the
# API URL is fixed per image. The default is same-origin (/api/v1): Caddy
# routes it to the server in production and nginx.conf does for local
# `docker compose up`, so the CSP never has to allow another host. CI may
# still pass an absolute URL. .env files are excluded by .dockerignore, so
# this build arg is the only source.
ARG EXPO_PUBLIC_API_URL=/api/v1
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL

ENV CI=1
RUN npx expo export --platform web

# ---------- runtime ----------
FROM nginx:alpine AS runtime

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
