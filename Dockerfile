FROM node:24-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src

EXPOSE 8090
CMD ["npx", "tsx", "src/index.ts"]
