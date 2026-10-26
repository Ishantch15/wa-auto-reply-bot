FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
# npm runs the project's postinstall script, so it must be available before
# dependencies are installed.
COPY scripts ./scripts
RUN npm ci --omit=dev
COPY . .

RUN mkdir -p /data/uploads
EXPOSE 3000
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "index.js"]
