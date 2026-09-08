# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY packages/search-mcp ./packages/search-mcp

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter @codex-gateway/search-mcp...
RUN pnpm --filter @codex-gateway/search-mcp rebuild esbuild \
    && pnpm --filter @codex-gateway/search-mcp build

FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN useradd --create-home --uid 10002 --user-group search-mcp
COPY --from=build /app/packages/search-mcp/dist/server.js ./server.js

USER 10002:10002
EXPOSE 8788
CMD ["node", "server.js"]
