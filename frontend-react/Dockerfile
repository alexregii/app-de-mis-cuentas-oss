FROM node:20.19.5-alpine@sha256:6178e78b972f79c335df281f4b7674a2d85071aae2af020ffa39f0a770265435 AS build
WORKDIR /app
ARG MOBILE_REVIEW_PREVIEW=false
ENV VITE_MOBILE_REVIEW_PREVIEW=$MOBILE_REVIEW_PREVIEW
COPY package*.json ./
RUN npm ci
COPY . .
RUN test ! -e /app/.e2e \
  && test -z "$(find /app -type d -name .e2e -print -quit)" \
  && test -z "$(find /app -type d -name secrets -print -quit)" \
  && test -z "$(find /app -type f \( -name '.env*' -o -name '*.env' -o -name '*.pem' -o -name '*.p12' -o -name '*.pfx' -o -name '*.key' -o -name 'credentials.*' -o -name '*-credentials.*' -o -name '*.sqlite' -o -name '*.sqlite-*' -o -name '*.sqlite3' -o -name '*.sqlite3-*' -o -name '*.db' -o -name '*.db-*' \) -print -quit)"
RUN npm run build

FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10
ARG SOURCE_REVISION=unversioned
ARG MOBILE_REVIEW_PREVIEW=false
LABEL org.opencontainers.image.revision=$SOURCE_REVISION \
  com.app.mobile-review=$MOBILE_REVIEW_PREVIEW
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
RUN chmod -R a+rX /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/healthz || exit 1
