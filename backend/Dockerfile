FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl

COPY backend/package*.json ./
COPY backend/prisma ./prisma/
COPY backend/tsconfig.json ./
COPY backend/src ./src

RUN npm ci
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production

COPY backend/package*.json ./
COPY backend/prisma ./prisma/

RUN npm ci --omit=dev
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/dist ./dist

EXPOSE 5000
CMD ["node", "dist/index.js"]
