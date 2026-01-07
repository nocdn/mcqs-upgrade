# Build stage
FROM oven/bun:1.2-debian AS build

WORKDIR /app

# Copy dependencies
COPY bun.lock package.json ./

RUN bun install --frozen-lockfile --production --verbose

# Copy source and compile
COPY . .

# RUN bun build
RUN bun build --compile --minify --sourcemap ./src --outfile hono-docker-app

# Our application runner
FROM gcr.io/distroless/base-debian12:nonroot AS runner

ENV NODE_ENV=production

WORKDIR /app

ARG BUILD_APP_PORT=8787
ENV APP_PORT=${BUILD_APP_PORT}
EXPOSE ${APP_PORT}

COPY --from=build /app/hono-docker-app .

ENTRYPOINT ["./hono-docker-app"]