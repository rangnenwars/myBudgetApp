# Builds the web version of My Budget as a static export and serves it with
# nginx. No Expo account or network calls beyond `npm ci` are needed — this
# is purely local, matching the app's local-only, no-backend design.

# ---------- build ----------
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .

ENV CI=1
RUN npx expo export --platform web

# ---------- runtime ----------
FROM nginx:alpine AS runtime

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
