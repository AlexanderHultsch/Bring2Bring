# syntax=docker/dockerfile:1

FROM node:24.19.0-alpine3.24 AS build

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24.19.0-alpine3.24

ENV NODE_ENV=production

WORKDIR /app

RUN mkdir -p /app/data && chown node:node /app/data

COPY --from=build /app/node_modules ./node_modules
COPY . .

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
