FROM node:20-alpine

WORKDIR /usr/src/app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# python3 is used to run scripts/inject_logs.py inside the container (log seeding)
RUN apk add --no-cache python3

COPY server.js ./

ENV PORT=3075
ENV LOG_DIR=/opt/admin/logs

EXPOSE 3075

CMD ["node", "server.js"]
