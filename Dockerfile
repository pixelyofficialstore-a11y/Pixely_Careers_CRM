FROM node:20-bookworm-slim AS build

WORKDIR /app

# Copy lockfiles first so Railway can reuse this dependency layer when only
# application code changes.
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund \
  --fetch-retries=2 --fetch-retry-factor=2 \
  --fetch-retry-mintimeout=1000 --fetch-retry-maxtimeout=10000 \
  --fetch-timeout=120000

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Keep the running image lean: build tools such as tsx, Vite, and TypeScript
# remain in the build stage while the runtime receives production packages only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
  --fetch-retries=2 --fetch-retry-factor=2 \
  --fetch-retry-mintimeout=1000 --fetch-retry-maxtimeout=10000 \
  --fetch-timeout=120000

COPY --from=build /app/dist ./dist
COPY --from=build /app/uploads/avatars ./uploads/avatars

RUN chown -R node:node /app
USER node

EXPOSE 5000
CMD ["npm", "start"]