# Builds the web version of My Budget as a static export and serves it with
# nginx. No Expo account or network calls beyond `npm ci` are needed; the
# bundle talks to the API at EXPO_PUBLIC_API_URL (see build arg below).

# ---------- build ----------
FROM node:26-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .

# EXPO_PUBLIC_* vars are inlined into the JS bundle at export time, so the
# API URL is fixed per image. CI passes the production URL
# (--build-arg EXPO_PUBLIC_API_URL=https://prapanji.in/api/v1); local
# `docker compose up` keeps the localhost default. .env files are excluded
# by .dockerignore, so this build arg is the only source.
ARG EXPO_PUBLIC_API_URL=http://localhost:4000/api/v1
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL

ENV CI=1
RUN npx expo export --platform web

# ---------- runtime ----------
FROM nginx:alpine AS runtime

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
