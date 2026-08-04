# Production image for the frontend: builds the SPA, then serves it from nginx.
#
# nginx also fronts the API, so the browser talks to a single origin. That makes
# VITE_API_URL a relative path, which in turn means the built assets carry no
# hostname and the same image works in every environment - no rebuild to change
# the API address.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Relative, so requests go to whatever origin served the page.
ENV VITE_API_URL=/api
RUN npm run build

FROM nginx:1.27-alpine AS runtime

# Drop nginx's default site; ours is mounted by compose or baked in below.
RUN rm /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/codecloud.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
