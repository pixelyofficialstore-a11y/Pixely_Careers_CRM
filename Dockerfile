FROM node:20-bookworm-slim AS application-build

WORKDIR /app
ARG BUILD_DEPENDENCY_EPOCH=20260820-1935-single-install

# Copy lockfiles first so Railway can reuse this dependency layer when only
# application code changes.
COPY package.json package-lock.json ./
RUN echo "Installing build dependencies (epoch ${BUILD_DEPENDENCY_EPOCH})" \
  && rm -rf node_modules \
  && npm ci --include=dev --no-audit --no-fund \
  --fetch-retries=2 --fetch-retry-factor=2 \
  --fetch-retry-mintimeout=1000 --fetch-retry-maxtimeout=10000 \
  --fetch-timeout=120000 \
  && test -x node_modules/.bin/tsx \
  && test -x node_modules/.bin/vite

COPY . .
RUN test -x node_modules/.bin/tsx && npm run build
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

# The build stage prunes its verified dependency installation after compiling,
# avoiding a second, concurrent npm install on constrained remote builders.
COPY package.json package-lock.json ./
COPY --from=application-build /app/node_modules ./node_modules
COPY --from=application-build /app/dist ./dist
COPY --from=application-build /app/uploads/avatars ./uploads/avatars

RUN chown -R node:node /app
USER node

EXPOSE 5000
CMD ["npm", "start"]