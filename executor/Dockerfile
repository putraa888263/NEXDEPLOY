FROM node:22-alpine

RUN apk add --no-cache \
    unzip \
    docker-cli

WORKDIR /app

COPY src ./src
COPY tpl ./tpl
COPY package.json ./package.json

EXPOSE 8787

CMD ["node", "src/index.mjs"]