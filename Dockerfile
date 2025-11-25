FROM oven/bun:latest

COPY . /app
WORKDIR /app

RUN bun install --prod --frozen-lockfile

ENV NODE_ENV production
EXPOSE 3000

CMD ["bun","start"]