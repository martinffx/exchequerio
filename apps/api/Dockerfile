FROM oven/bun:latest

WORKDIR /app

# Copy workspace files
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY packages/ ./packages/

# Install dependencies
RUN bun install --frozen-lockfile --production

# Copy API source
COPY apps/api/ ./apps/api/

WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "start"]