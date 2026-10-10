FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN npm ci

FROM deps AS client-build
COPY shared shared
COPY client client
RUN npm run build -w client

FROM deps AS server-build
COPY shared shared
COPY server server
RUN npm run build -w server

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN npm ci --omit=dev -w server
COPY --from=server-build /app/server/dist server/dist
# The server runs shared's sources (see shared/README.md).
COPY shared/src shared/src
COPY server/drizzle server/drizzle
COPY --from=client-build /app/client/dist client/dist
# Drop root privileges. The app can read its files (which are owned by root), but not modify them.
USER node
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
