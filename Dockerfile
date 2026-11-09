FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci

FROM deps AS client-build
COPY client client
RUN npm run build -w client

FROM deps AS server-build
COPY server server
RUN npm run build -w server

FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
RUN npm ci --omit=dev -w server
COPY --from=server-build /app/server/dist server/dist
COPY server/drizzle server/drizzle
COPY --from=client-build /app/client/dist client/dist
# The rules of the areas the MCP server's tools act on, which it gives the model (see server/src/mcp/documentation.ts).
COPY docs/design/server docs/design/server
# Drop root privileges. The app can read its files (which are owned by root), but not modify them.
USER node
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
