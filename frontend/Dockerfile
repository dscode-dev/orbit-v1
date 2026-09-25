# ERP Frontend (Next.js 15) — serves both Platform (/) and Operator (/operator).
# Multi-stage build using Next standalone output.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* are inlined at build time. O .dockerignore exclui o .env de
# propósito, então TODA variável pública precisa entrar como build arg aqui e
# ser repassada pelo docker-compose — senão chega vazia no bundle do navegador.
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
# Google Ads (landing page): sem o id, o banner de cookies e a tag não montam.
ARG NEXT_PUBLIC_GOOGLE_ADS_ID
ENV NEXT_PUBLIC_GOOGLE_ADS_ID=$NEXT_PUBLIC_GOOGLE_ADS_ID
ARG NEXT_PUBLIC_GOOGLE_ADS_WHATSAPP_LABEL
ENV NEXT_PUBLIC_GOOGLE_ADS_WHATSAPP_LABEL=$NEXT_PUBLIC_GOOGLE_ADS_WHATSAPP_LABEL
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
RUN apk add --no-cache dumb-init

# Standalone server + static assets + public (brand/icons).
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

USER node
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
