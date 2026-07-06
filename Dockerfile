# syntax=docker/dockerfile:1

# --- build the frontend ---
FROM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- backend runtime ---
FROM node:24-slim
WORKDIR /app

# better-sqlite3-multiple-ciphers ships prebuilt binaries fetched via an install
# script; allow install scripts during the build (the host's ~/.npmrc may have
# ignore-scripts=true, which would silently skip the prebuild download).
RUN printf 'ignore-scripts=false\n' > /app/.npmrc

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && rm -f /app/.npmrc
COPY tsconfig.json ./
COPY src ./src
COPY --from=web /web/dist ./web/dist

# Run as the non-root node user that node:24-slim ships (uid 1000). The data dir
# is a bind-mount; the host must chown it to 1000:1000 (covered in DEPLOY.md).
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 8090

# Liveness probe — main.ts registers GET /health -> { status: 'ok' }.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8090)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "src/index.ts"]
