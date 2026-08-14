# NEXDEPLOY generated Laravel runtime — Phase 1.
#
# Assumptions enforced by the executor before this build runs:
#   - `composer install --no-dev ...` has already been run against the
#     release directory (as a one-shot container), so vendor/ is present.
#   - `npm ci && npm run build` has already been run if package.json existed,
#     so any compiled frontend assets are present under public/build.
#   - .env has already been written into the release with APP_KEY set.
#
# This keeps the runtime image itself small and dependency-free (no Node,
# no Composer) — it only needs PHP + the extensions Laravel commonly needs.
#
# Web server: `php artisan serve` (see laravel.mjs buildEntrypointCommand).
# This is intentionally not Apache/nginx for Phase 1 — a single process is
# enough to prove ZIP -> running container -> HTTP reachable. Revisit for
# a production-grade server (php-fpm + nginx) in a later phase.

FROM php:8.3-cli-alpine

RUN apk add --no-cache \
        icu-libs \
        libzip \
        oniguruma \
        libpq \
        mariadb-connector-c \
    && apk add --no-cache --virtual .build-deps \
        icu-dev \
        libzip-dev \
        oniguruma-dev \
        postgresql-dev \
        mariadb-connector-c-dev \
        linux-headers \
    && docker-php-ext-install -j"$(nproc)" \
        pdo \
        pdo_mysql \
        pdo_pgsql \
        mbstring \
        bcmath \
        intl \
        zip \
        opcache \
        pcntl \
    && apk del .build-deps

WORKDIR /var/www/html

# Release contents (including vendor/ and any built frontend assets) are
# copied in by the executor before `docker build` runs.
COPY . /var/www/html

RUN adduser -D -H -u 1000 nexdeploy \
    && mkdir -p storage bootstrap/cache \
    && chown -R nexdeploy:nexdeploy /var/www/html \
    && chmod -R ug+rwX storage bootstrap/cache

USER nexdeploy

EXPOSE 8080

CMD ["sh", "-c", "set -e; (php artisan storage:link || true); (php artisan optimize:clear || true); exec php artisan serve --host=0.0.0.0 --port=8080"]
