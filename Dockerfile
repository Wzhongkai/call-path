FROM rust:1.99-bookworm AS build
WORKDIR /build
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/schema.sql ./schema.sql
COPY backend/src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN groupadd --gid 10001 callpath && useradd --uid 10001 --gid callpath --no-create-home callpath \
    && mkdir -p /app/data && chown callpath:callpath /app/data
WORKDIR /app
COPY --from=build /build/target/release/callpath-server /usr/local/bin/callpath-server
COPY dist ./dist
USER callpath
ENV BIND=0.0.0.0:8080 DATABASE_PATH=/app/data/callpath.sqlite3 STATIC_DIR=/app/dist
EXPOSE 8080
VOLUME ["/app/data"]
ENTRYPOINT ["callpath-server"]
