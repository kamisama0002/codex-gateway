# syntax=docker/dockerfile:1.7

FROM docker:28.5.1-cli AS docker-cli

FROM node:24-bookworm-slim AS full

LABEL com.qiancheng.codex.version=0.153.4
LABEL com.qiancheng.agent.profile=full

ENV CODEX_HOME=/codex-home
ENV CODEX_WORKSPACE=/workspace
ENV CHROMIUM_PATH=/usr/bin/chromium
ENV NODE_PATH=/usr/local/lib/node_modules
ENV PATH=/opt/agent-python/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

ARG DEBIAN_MIRROR=
COPY docker/rewrite-debian-mirror.sh /tmp/rewrite-debian-mirror.sh
RUN sh /tmp/rewrite-debian-mirror.sh "${DEBIAN_MIRROR}" \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      chromium \
      chromium-driver \
      clang \
      cmake \
      curl \
      default-jdk-headless \
      default-mysql-client \
      dnsutils \
      fd-find \
      ffmpeg \
      file \
      ghostscript \
      gh \
      git \
      git-lfs \
      golang-go \
      gradle \
      imagemagick \
      iproute2 \
      iputils-ping \
      jq \
      less \
      libreoffice-calc \
      libreoffice-impress \
      libreoffice-writer \
      lsof \
      maven \
      netcat-openbsd \
      ninja-build \
      openssh-client \
      p7zip-full \
      pandoc \
      patch \
      pkg-config \
      poppler-utils \
      postgresql-client \
      procps \
      python3 \
      python3-dev \
      python3-pip \
      python3-venv \
      redis-tools \
      ripgrep \
      rsync \
      rustc \
      cargo \
      sqlite3 \
      tesseract-ocr \
      tesseract-ocr-chi-sim \
      tesseract-ocr-eng \
      tini \
      tmux \
      unzip \
      wget \
      zip \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 codex \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /codex-home --shell /bin/bash codex \
    && ln -s /usr/bin/fdfind /usr/local/bin/fd \
    && mkdir --parents /workspace /tmp /usr/local/share/codex-agent-runtime \
    && chown --recursive codex:codex /codex-home /workspace /tmp

RUN apt-get update \
    && apt-get install -y --no-install-recommends bubblewrap \
    && rm -rf /var/lib/apt/lists/*

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY docker/agent-runtime-node-tools.json /tmp/agent-runtime-node-tools.json
COPY docker/agent-runtime-python-requirements.txt /tmp/agent-runtime-python-requirements.txt
COPY docker/agent-runtime-tool-manifest.json /usr/local/share/codex-agent-runtime/tool-manifest.json

ARG NPM_REGISTRY=https://registry.npmjs.org
ARG PYPI_INDEX_URL=https://pypi.org/simple
RUN yarn_version="$(node -p 'require("/tmp/agent-runtime-node-tools.json").packages.yarn')" \
    && test "$(yarn --version)" = "$yarn_version" \
    && pnpm_version="$(node -p 'require("/tmp/agent-runtime-node-tools.json").packages.pnpm')" \
    && corepack disable pnpm \
    && npm config set registry "$NPM_REGISTRY" \
    && npm install --global "pnpm@$pnpm_version" \
    && node -e 'const {packages}=require("/tmp/agent-runtime-node-tools.json"); process.stdout.write(Object.entries(packages).filter(([name]) => name !== "pnpm" && name !== "yarn").map(([name, version]) => `${name}@${version}`).join("\n"))' \
      > /tmp/agent-runtime-node-tools.txt \
    && npm install --global $(cat /tmp/agent-runtime-node-tools.txt) \
    && npm cache clean --force \
    && python3 -m venv /opt/agent-python \
    && /opt/agent-python/bin/pip install --index-url "$PYPI_INDEX_URL" --no-cache-dir --upgrade pip setuptools wheel \
    && /opt/agent-python/bin/pip install --index-url "$PYPI_INDEX_URL" --no-cache-dir -r /tmp/agent-runtime-python-requirements.txt \
    && rm -f /tmp/agent-runtime-node-tools.json \
      /tmp/agent-runtime-node-tools.txt \
      /tmp/agent-runtime-python-requirements.txt

COPY docker/agent-runtime-entrypoint.sh /usr/local/bin/agent-runtime-entrypoint
COPY docker/agent-runtime-config.mjs /usr/local/lib/agent-runtime-config.mjs
COPY docker/agent-runtime-oauth-callback.mjs /usr/local/lib/agent-runtime-oauth-callback.mjs
COPY docker/agent-runtime-secret-writer.mjs /usr/local/lib/agent-runtime-secret-writer.mjs
COPY docker/agent-runtime-healthcheck.mjs /usr/local/lib/agent-runtime-healthcheck.mjs
COPY scripts/smoke-agent-runtime.mjs /usr/local/lib/smoke-agent-runtime.mjs

RUN chmod 0555 /usr/local/bin/agent-runtime-entrypoint \
      /usr/local/lib/agent-runtime-config.mjs \
      /usr/local/lib/agent-runtime-oauth-callback.mjs \
      /usr/local/lib/agent-runtime-secret-writer.mjs \
      /usr/local/lib/agent-runtime-healthcheck.mjs \
      /usr/local/lib/smoke-agent-runtime.mjs \
    && node /usr/local/lib/smoke-agent-runtime.mjs

USER 10001:10001
WORKDIR /workspace
EXPOSE 4500
VOLUME ["/codex-home", "/workspace"]

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD ["node", "/usr/local/lib/agent-runtime-healthcheck.mjs"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/agent-runtime-entrypoint"]
