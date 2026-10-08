FROM node:20-slim

# Chromium + the deps puppeteer needs on Debian slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
      libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
      libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 \
      libxext6 libxfixes3 libxkbcommon0 libxrandr2 wget xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/bot
COPY package.json ./
RUN PUPPETEER_SKIP_DOWNLOAD=true npm install --omit=dev --no-audit --no-fund
COPY bot.js ./

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV APP_URL=http://feedback:3075
ENV REVIEW_INTERVAL_MS=20000

CMD ["node", "bot.js"]
