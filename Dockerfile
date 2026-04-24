# ===== Build stage =====
FROM node:20-alpine AS build
WORKDIR /app

# Copia los manifiestos primero (mejor caché)
COPY package*.json ./
RUN npm ci

# Copia el resto y construye
COPY . .
RUN npm run build

# ===== Serve stage =====
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Cloud Run usa el puerto en $PORT, default 8080
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]