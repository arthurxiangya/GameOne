# syntax=docker/dockerfile:1

# ---- Build: compile the client bundle and the server bundle ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build
# The server's package.json lists the internal workspace package as a dev dependency, and
# npm resolves dev dependencies even with --omit=dev. Give the runtime image a manifest
# with only the real runtime dependencies so it never looks for @lanternwood/* on the registry.
RUN node -e "const p = require('./packages/server/package.json'); \
  require('fs').writeFileSync('runtime-package.json', JSON.stringify({ name: p.name, version: p.version, private: true, type: p.type, dependencies: p.dependencies }, null, 2));"

# ---- Runtime: only the bundled server, its one runtime dependency, and static client files ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/runtime-package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/packages/server/dist ./dist
COPY --from=build /app/packages/client/dist ./public
RUN mkdir -p /data && chown node:node /data
ENV HOST=0.0.0.0 PORT=8080 DATA_DIR=/data CLIENT_DIST=/app/public
VOLUME ["/data"]
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "--enable-source-maps", "dist/main.js"]
