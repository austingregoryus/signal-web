# --- build the frontend ---
FROM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

# --- backend runtime ---
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY tsconfig.json ./
COPY src ./src
COPY --from=web /web/dist ./web/dist
EXPOSE 8090
CMD ["npx", "tsx", "src/index.ts"]
