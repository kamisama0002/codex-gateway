# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim

LABEL com.qiancheng.codex.version=0.151.0

ENV CODEX_HOME=/codex-home
ENV CODEX_WORKSPACE=/workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 codex \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /codex-home --shell /usr/sbin/nologin codex \
    && npm install --global @openai/codex@0.151.0 \
    && npm cache clean --force \
    && mkdir --parents /workspace /tmp \
    && chown --recursive codex:codex /codex-home /workspace /tmp

COPY docker/agent-runtime-entrypoint.sh /usr/local/bin/agent-runtime-entrypoint
COPY docker/agent-runtime-healthcheck.mjs /usr/local/lib/agent-runtime-healthcheck.mjs

RUN chmod 0555 /usr/local/bin/agent-runtime-entrypoint

USER 10001:10001
WORKDIR /workspace
EXPOSE 4500
VOLUME ["/codex-home", "/workspace"]

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD ["node", "/usr/local/lib/agent-runtime-healthcheck.mjs"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/agent-runtime-entrypoint"]
