FROM node:24-alpine

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable

WORKDIR /app

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# Install API production dependencies
RUN pnpm install --filter=@exchequerio/api --prod --frozen-lockfile

# Copy API source
COPY apps/api/ ./apps/api/

WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3000

CMD ["pnpm", "start"]
