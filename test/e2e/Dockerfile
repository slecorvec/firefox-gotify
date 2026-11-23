# Test runner image: Node + Firefox ESR (Debian) + geckodriver (pinned, checksum-verified).
FROM node:26-trixie-slim

ARG GECKODRIVER_VERSION=0.37.1
ARG GECKODRIVER_SHA256=e815130ea95983e162ae91843b48d3a3ce991735635fce83a647afde21e09f7e

SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends firefox-esr ca-certificates curl \
 && curl -fsSLo /tmp/gd.tgz "https://github.com/mozilla/geckodriver/releases/download/v${GECKODRIVER_VERSION}/geckodriver-v${GECKODRIVER_VERSION}-linux64.tar.gz" \
 && echo "${GECKODRIVER_SHA256}  /tmp/gd.tgz" | sha256sum -c - \
 && tar -xzf /tmp/gd.tgz -C /usr/local/bin geckodriver \
 && rm /tmp/gd.tgz \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY test ./test

USER 1000:1000
# One-shot test runner, not a service: nothing to health-check (Trivy DS-0026).
HEALTHCHECK NONE
CMD ["sh", "-c", "npm run --silent lint:ext && npm run --silent test:e2e"]
