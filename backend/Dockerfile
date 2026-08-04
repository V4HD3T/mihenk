# Production image for the API server and the grading worker.
#
# Not to be confused with docker/*.Dockerfile - those are the per-language
# sandbox images that submitted code runs inside. This is the application.
#
# One image serves both roles; the command decides which:
#   node src/server.js      the API + WebSocket server
#   node src/workerPool.js  the autoscaling grading worker pool

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --omit=dev: the image carries no test framework, linter or build tooling.
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime

# tini reaps zombies. The worker spawns `docker` processes per test case, and
# without an init process their exited children accumulate in the container.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations

# Runs unprivileged. The base image already ships a `node` user (uid 1000).
RUN mkdir -p /var/lib/codecloud/exec && chown -R node:node /var/lib/codecloud /app
USER node

ENV NODE_ENV=production
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
