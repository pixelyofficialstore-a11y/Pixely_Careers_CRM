FROM node:20.20.2-bookworm-slim AS build

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Railway's bundled npm 10.8.2 crashes while resolving this app's dependency
# graph. Bootstrap the pinned pnpm release instead of invoking npm to install
# or launch the application.
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false --reporter=append-only \
  && test -x node_modules/.bin/tsx \
  && test -x node_modules/.bin/vite

COPY . .
RUN pnpm run build && pnpm prune --prod

FROM node:20.20.2-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/uploads/avatars ./uploads/avatars

RUN chown -R node:node /app
USER node

EXPOSE 5000
CMD ["node", "dist/index.cjs"]