# ── Stage 1: Build ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm (required for workspace:* dependency resolution)
RUN npm install -g pnpm@9 --quiet

# Copy workspace config first (includes pnpm catalog definitions)
COPY package.json ./package.json
COPY pnpm-workspace.yaml ./pnpm-workspace.yaml

# Copy workspace lib packages that api-server depends on
COPY lib/api-zod ./lib/api-zod
COPY lib/db ./lib/db

# Copy api-server source and config
COPY artifacts/api-server/package.json ./artifacts/api-server/package.json
COPY artifacts/api-server/tsconfig.json ./artifacts/api-server/tsconfig.json
COPY artifacts/api-server/build.mjs ./artifacts/api-server/build.mjs
COPY artifacts/api-server/src ./artifacts/api-server/src

# Install dependencies (workspace-aware, no lockfile on CI is fine)
RUN pnpm install --no-frozen-lockfile --filter "@workspace/api-server..." 2>&1

# Bundle everything into a single dist/index.mjs via esbuild
WORKDIR /app/artifacts/api-server
RUN node ./build.mjs

# ── Stage 2: Production image ───────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Copy only the bundled output and the runtime node_modules that esbuild
# left external (ws, pino transports, native addons, etc.)
COPY --from=builder /app/artifacts/api-server/dist ./dist
COPY --from=builder /app/artifacts/api-server/node_modules ./node_modules

ENV NODE_ENV=production

# Railway injects PORT automatically; the server throws if it's missing.
EXPOSE 3000

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
