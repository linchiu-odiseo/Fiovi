# syntax=docker/dockerfile:1.7

# ---------- Etapa 1: build ----------
# Compila el Angular adentro del contenedor. El host solo necesita Docker.
FROM node:22-alpine AS builder

WORKDIR /app

# Instalar deps con lockfile (mas rapido y reproducible que npm install)
COPY package.json package-lock.json ./
RUN npm ci

# Copiar el resto del codigo (respeta .dockerignore)
COPY . .

# `npm run build` corre prebuild (build-env) + ng build + postbuild (inject-ngsw)
# Lee .env del build context.
RUN npm run build

# ---------- Etapa 2: runtime ----------
# Imagen final: solo nginx + assets compilados. Sin Node, sin node_modules.
FROM nginx:alpine

COPY --from=builder /app/dist/fiovi/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3007

CMD ["nginx", "-g", "daemon off;"]
