FROM node:22-bookworm-slim AS build
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/scrrana2000-sys/restorent-os"

COPY package.json ./
RUN npm install --no-audit --no-fund --package-lock=false --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV ALLOWED_ORIGINS=https://restaurantos01.ai.studio,https://restaurantos-xqi52dpwgo-as.a.run.app,https://scrrana2000-sys.github.io
ENV PUBLIC_APP_URL=https://restaurantos01.ai.studio

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/public ./public

USER node
EXPOSE 3000
CMD ["node", "dist-server/server.cjs"]
