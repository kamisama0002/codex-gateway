# syntax=docker/dockerfile:1.7

ARG AGENT_RUNTIME_BASE_IMAGE=codex-agent-runtime:0.153.4-full
FROM ${AGENT_RUNTIME_BASE_IMAGE}

ARG AGENT_RUNTIME_BASE_ID=unspecified
LABEL com.qiancheng.agent.base-image=${AGENT_RUNTIME_BASE_ID}

USER root
ARG NPM_REGISTRY=https://registry.npmjs.org
COPY docker/agent-runtime-node-tools.json /tmp/agent-runtime-node-tools.json
COPY docker/agent-runtime-entrypoint.sh /usr/local/bin/agent-runtime-entrypoint
COPY docker/agent-runtime-config.mjs /usr/local/lib/agent-runtime-config.mjs
COPY docker/agent-runtime-oauth-callback.mjs /usr/local/lib/agent-runtime-oauth-callback.mjs
COPY docker/agent-runtime-secret-writer.mjs /usr/local/lib/agent-runtime-secret-writer.mjs
COPY docker/agent-runtime-healthcheck.mjs /usr/local/lib/agent-runtime-healthcheck.mjs
COPY scripts/smoke-agent-runtime.mjs /usr/local/lib/smoke-agent-runtime.mjs

RUN pnpm_version="$(node -p 'require("/tmp/agent-runtime-node-tools.json").packages.pnpm')" \
    && npm config set registry "$NPM_REGISTRY" \
    && corepack disable pnpm \
    && npm install --global "pnpm@$pnpm_version" \
    && rm -f /tmp/agent-runtime-node-tools.json \
    && chmod 0555 /usr/local/bin/agent-runtime-entrypoint \
      /usr/local/lib/agent-runtime-config.mjs \
      /usr/local/lib/agent-runtime-oauth-callback.mjs \
      /usr/local/lib/agent-runtime-secret-writer.mjs \
      /usr/local/lib/agent-runtime-healthcheck.mjs \
      /usr/local/lib/smoke-agent-runtime.mjs \
    && node /usr/local/lib/smoke-agent-runtime.mjs

USER 10001:10001
WORKDIR /workspace
