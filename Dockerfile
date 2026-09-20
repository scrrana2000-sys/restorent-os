FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund --package-lock=false

COPY . .
RUN npm run build
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV ALLOWED_ORIGINS=https://restaurantos01.ai.studio,https://restaurantos-xqi52dpwgo-as.a.run.app
ENV PUBLIC_APP_URL=https://restaurantos01.ai.studio

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/public ./public

USER node
EXPOSE 3000
CMD ["node", "dist-server/server.cjs"]
