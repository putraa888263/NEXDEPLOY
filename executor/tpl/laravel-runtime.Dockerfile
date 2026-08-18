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

COPY --from=composer-bin /usr/bin/composer /usr/local/bin/composer

WORKDIR /var/www/html

RUN adduser -D -H -u 1000 nexdeploy

USER nexdeploy

EXPOSE 8080