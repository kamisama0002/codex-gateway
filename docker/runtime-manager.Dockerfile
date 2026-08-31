# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY patches ./patches
COPY packages/agent-runtime-contracts ./packages/agent-runtime-contracts
COPY packages/agent-runtime-manager ./packages/agent-runtime-manager

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter @codex-gateway/agent-runtime-manager...
RUN pnpm --filter @codex-gateway/agent-runtime-manager rebuild esbuild \
    && pnpm --filter @codex-gateway/agent-runtime-manager exec esbuild --version \
    && pnpm --filter @codex-gateway/agent-runtime-contracts typecheck:runtime-manager \
    && pnpm --filter @codex-gateway/agent-runtime-manager build \
    && node --input-type=module -e "await import('./packages/agent-runtime-manager/dist/http-server.js')"

FROM node:24-bookworm-slim

ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir --parents /data

WORKDIR /app
COPY --from=build /app /app

EXPOSE 8787
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "packages/agent-runtime-manager/dist/http-server.js"]
