# ---------------------------------------------------------------------------
# Pitchside web
#
# The output is a static bundle, so the runtime has no Node in it at all. The
# `VITE_*` values are compile-time, which is why they are build arguments: a
# container built for one deployment cannot be re-pointed at another by changing
# an environment variable, and that is the honest behaviour to expose rather
# than to paper over with a start-up script that rewrites the bundle.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS build

WORKDIR /build

# Copied first so a source-only change reuses the installed layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig*.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src

ARG VITE_API_BASE_URL=""
ARG VITE_SUPPORT_EMAIL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_SUPPORT_EMAIL=$VITE_SUPPORT_EMAIL

RUN npm run build


# The unprivileged image listens on 8080 and runs as a non-root user out of the
# box, so nothing here has to be undone afterwards.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY --from=build /build/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Kept out of conf.d, which nginx globs into the http block: a snippet of bare
# `add_header` lines has no business being loaded as a server of its own.
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1
