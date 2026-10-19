# Contexto de build: a pasta sistemaPDV/ (a API serve o admin e a landing, que ficam fora de server/).
#   docker build -f server/Dockerfile -t cybhorpdv-api .
FROM node:20-alpine

# Layout espelha o repositório (server/, backend/public/admin, landing) para os caminhos relativos funcionarem.
WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/src ./src
COPY server/db ./db
COPY server/scripts ./scripts
COPY backend/public/admin /app/backend/public/admin
COPY landing /app/landing

# Instaladores publicados (montados como volume na VPS).
RUN mkdir -p /app/backend/downloads && chown -R node:node /app
USER node

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3333)+'/api/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
