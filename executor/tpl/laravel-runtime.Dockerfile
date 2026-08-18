FROM composer:2 AS composer-bin

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

COPY --from=composer-bin \
    /usr/bin/composer \
    /usr/local/bin/composer

WORKDIR /var/www/html

RUN adduser -D -u 1000 nexdeploy \
    && mkdir -p /home/nexdeploy/.composer/cache \
    && chown -R nexdeploy:nexdeploy /home/nexdeploy

# PENTING:
# Tidak memakai USER nexdeploy di base image.
# Image ini juga dipakai sebagai Composer/build environment,
# sehingga build step harus dapat menulis ke release volume root-owned.
#
# Container aplikasi final akan berpindah ke USER nexdeploy
# di executor/tpl/laravel.Dockerfile.

EXPOSE 8080