FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY apps ./apps
RUN npm run build

# Development/demo images; Vite preview is not a production web server.
FROM build AS api
USER node
EXPOSE 3000
CMD ["sh", "-c", "npm run db:migrate --workspace @aerqyn/api && node apps/api/dist/index.js"]

FROM build AS worker
USER node
EXPOSE 3001
CMD ["node", "apps/worker/dist/index.js"]

FROM build AS web
# Vite bundles its config into this cache at preview startup.
RUN mkdir -p /app/apps/web/node_modules/.vite-temp \
    && chown -R node:node /app/apps/web/node_modules/.vite-temp
USER node
EXPOSE 5173
CMD ["npm", "run", "start", "--workspace", "@aerqyn/web"]
