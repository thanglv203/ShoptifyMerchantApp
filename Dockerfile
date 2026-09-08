# syntax=docker/dockerfile:1.7

# Build stage: cài cả devDependencies để React Router/Vite compile app và worker.
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# Runtime stage: chỉ production dependencies + artifacts đã build.
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
RUN apk add --no-cache openssl tini \
    && addgroup -S app \
    && adduser -S -G app app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder --chown=app:app /app/build ./build
COPY --from=builder --chown=app:app /app/worker-build ./worker-build
COPY --from=builder --chown=app:app /app/prisma ./prisma
COPY --from=builder --chown=app:app /app/node_modules/.prisma ./node_modules/.prisma

USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "start"]
