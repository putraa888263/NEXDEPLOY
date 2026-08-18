FROM nexdeploy/laravel-runtime:php-8.4

WORKDIR /var/www/html

COPY . /var/www/html

USER root

RUN mkdir -p storage bootstrap/cache \
    && chown -R nexdeploy:nexdeploy /var/www/html \
    && chmod -R ug+rwX storage bootstrap/cache

USER nexdeploy

EXPOSE 8080

CMD ["sh", "-c", "set -e; (php artisan storage:link || true); exec php artisan serve --host=0.0.0.0 --port=8080"]
