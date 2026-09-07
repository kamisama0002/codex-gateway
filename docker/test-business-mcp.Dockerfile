# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY packages/test-business-mcp ./packages/test-business-mcp

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter @codex-gateway/test-business-mcp...
RUN pnpm --filter @codex-gateway/test-business-mcp rebuild esbuild \
    && pnpm --filter @codex-gateway/test-business-mcp build

FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN useradd --create-home --uid 10003 --user-group test-business-mcp
COPY --from=build /app/packages/test-business-mcp/dist/server.js ./server.js

USER 10003:10003
EXPOSE 8789
CMD ["node", "server.js"]
