# Revive — self-contained container image.
#
# The image bundles every toolchain the demo fixtures exercise (Node, Python,
# Java, Go, Rust) so a container run can revive all five ecosystems with no
# host setup. Inside the container Docker itself is unavailable, so Revive
# selects restricted execution automatically; the container boundary is the
# outer isolation layer.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 DATABASE_URL="file:/tmp/build.db"
RUN npx prisma generate && npx next build

FROM node:22-bookworm-slim AS runtime

# Toolchains used to execute repositories, plus git for cloning.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git ca-certificates curl python3 python3-venv python-is-python3 \
      openjdk-17-jdk-headless golang-go build-essential \
 && rm -rf /var/lib/apt/lists/*

# Non-root user: repository code never runs as root.
RUN useradd --create-home --uid 10001 revive \
 && mkdir -p /data && chown -R revive:revive /data

USER revive
ENV RUSTUP_HOME=/home/revive/.rustup CARGO_HOME=/home/revive/.cargo
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
ENV PATH="/home/revive/.cargo/bin:${PATH}"

WORKDIR /app
COPY --chown=revive:revive --from=build /app ./

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL="file:/data/revive.db" \
    REVIVE_DATA_DIR=/data/revive

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s \
  CMD curl -fsS http://localhost:3000/api/health || exit 1

# predev syncs the schema and builds demo fixtures on first start.
CMD ["npm", "start"]
