FROM node:25.6.1-bookworm-slim@sha256:34d76bac75fba8eea764d3b79b05be7a77fa0651d7b956b011b4a55837fdbc02 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev
FROM node:25.6.1-bookworm-slim@sha256:34d76bac75fba8eea764d3b79b05be7a77fa0651d7b956b011b4a55837fdbc02
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
HEALTHCHECK --interval=3s --timeout=3s CMD ["node", "-e", "require('http').get('http://127.0.0.1:'+(process.env.COLLABORATION_PORT||8091)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
