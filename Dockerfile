# FewFeww Multi-Stage Production Dockerfile
# Base: Node.js 24 Alpine LTS

# --- STAGE 1: Builder ---
FROM node:24-alpine AS builder
WORKDIR /app

# Install dependencies needed for build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

# Copy application source and build TypeScript
COPY src/ ./src/
RUN npm run build

# --- STAGE 2: Production Runtime ---
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled JavaScript and migrations
COPY --from=builder /app/dist ./dist
COPY migrations/ ./migrations/

# Run as unprivileged node user
USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
