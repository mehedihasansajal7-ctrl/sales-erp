# =============================================================================
# Integrated Sales / Order / Inventory / Delivery ERP — production image
# Multi-stage: deps -> build (prisma generate + next build) -> runner.
# =============================================================================
FROM node:20-slim AS base
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates postgresql-client \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --- dependencies ------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
# `--ignore-scripts` keeps the build reproducible; Prisma's engines are fetched
# by the explicit `prisma generate` below instead of a postinstall hook.
RUN npm ci --include=dev --ignore-scripts

# --- build -------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# --- runner ------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3001

# Applies migrations, (optionally) seeds demo data, then serves the app.
ENTRYPOINT ["./docker-entrypoint.sh"]
