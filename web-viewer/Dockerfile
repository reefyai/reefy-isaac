# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-FileCopyrightText: Copyright (c) 2026 Reefy AI
# SPDX-License-Identifier: Apache-2.0

# Derived from Isaac Sim v6.0.1 tools/docker/web-viewer/Dockerfile.
# Reefy changes the generated client to discover the device hostname from the
# browser at runtime and uses the standard Node image for the viewer-only
# container.

FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
    && rm -rf /var/lib/apt/lists/*

RUN echo '@nvidia:registry=https://edge.urm.nvidia.com/artifactory/api/npm/omniverse-client-npm/' >> /root/.npmrc \
    && npx --yes @nvidia/create-ov-web-rtc-app@1.14.2 --name web-viewer --sample local-sample --outputDir /app \
    && rm -f /root/.npmrc

WORKDIR /app/web-viewer

ARG ISAACSIM_SIGNAL_PORT=49100
ARG ISAACSIM_STREAM_PORT=47998

# The official viewer bakes one host address into its JavaScript. Reefy devices
# have different LAN addresses, so use the hostname from the page URL instead.
RUN sed -i "s/signalingServer: [^,]*/signalingServer: window.location.hostname/" src/main.ts \
    && sed -i "/signalingServer:/a\\    signalingPort: ${ISAACSIM_SIGNAL_PORT},\n    mediaServer: window.location.hostname,\n    mediaPort: ${ISAACSIM_STREAM_PORT},\n    forceWSS: false," src/main.ts

# Preserve browser shortcuts instead of forwarding them to the stream.
RUN sed -i '/void app.initialize/i\
const sc = document.getElementById("stream-container");\
if (sc) {\
    sc.addEventListener("keydown", (e: KeyboardEvent) => {\
        if (e.key === "F11" || e.code === "F11") { e.preventDefault(); e.stopPropagation(); if (document.fullscreenElement) { document.exitFullscreen(); } else { document.documentElement.requestFullscreen(); } return; }\
        if (e.key === "F7") { e.preventDefault(); return; }\
        if (e.key === "F5" || e.code === "F5") { e.preventDefault(); e.stopPropagation(); window.location.reload(); return; }\
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") { e.preventDefault(); e.stopPropagation(); window.location.reload(); return; }\
        if (e.key === "F12" || e.code === "F12") { e.stopPropagation(); return; }\
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && ["i","j","c"].includes(e.key.toLowerCase())) { e.stopPropagation(); return; }\
        if (e.metaKey && e.altKey && ["i","j","c"].includes(e.key.toLowerCase())) { e.stopPropagation(); return; }\
    }, true);\
}' src/main.ts

RUN npm install --ignore-scripts \
    && npm run build

FROM node:22-bookworm-slim

LABEL org.opencontainers.image.source="https://github.com/reefyai/reefy-isaac" \
      org.opencontainers.image.description="Browser WebRTC viewer for the Reefy Isaac Sim app" \
      org.opencontainers.image.licenses="Apache-2.0"

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1234 appuser \
    && useradd --uid 1234 --gid 1234 --home-dir /app --shell /usr/sbin/nologin appuser

WORKDIR /app

COPY --from=builder --chmod=755 /app/web-viewer/package.json ./

RUN echo '@nvidia:registry=https://edge.urm.nvidia.com/artifactory/api/npm/omniverse-client-npm/' >> /root/.npmrc \
    && npm install --ignore-scripts \
    && npm cache clean --force \
    && rm -f /root/.npmrc \
    && chown -R appuser:appuser /app

COPY --from=builder --chown=appuser:appuser --chmod=755 /app/web-viewer/dist ./dist

USER appuser

EXPOSE 8210

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://127.0.0.1:8210/ || exit 1

CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "8210"]

