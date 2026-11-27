# Builds Mind Palace into one image: the built app plus the server that serves
# it, relays the workspace, stores files and handles sign-in.
#
# Everything that must survive a restart lives in /app/data (saved workspaces
# and uploaded files). Mount a persistent disk there.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY server/package.json server/
RUN cd server && npm install --omit=dev --no-audit --no-fund
COPY server server
COPY --from=build /app/dist dist
VOLUME /app/data
EXPOSE 8080
CMD ["node", "server/sync-server.mjs"]
