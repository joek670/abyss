# ABYSS — production image.
#
# There is no build stage and no dependency install, because the application has
# no dependencies: it runs on Node's built-in node:http and node:sqlite, and the
# frontend is plain ES modules the browser loads directly. The image is
# therefore just the runtime plus this repository, which keeps it small and
# means there is no lockfile to audit and no supply chain to trust.
#
# Node 22.5+ is required for node:sqlite; 24 is used here for the current LTS
# line.

FROM node:24-alpine

# The app writes its SQLite database here. Mount a volume over it to persist
# the dive log across container restarts.
WORKDIR /app

# No `npm install` step: package.json declares no dependencies.
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY README.md ./

RUN mkdir -p /app/data && chown -R node:node /app

# Drop privileges — nothing here needs root.
USER node

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    ABYSS_DB=/app/data/abyss.db

EXPOSE 8787

# The health endpoint is the liveness signal; no shell utilities required.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.mjs"]
