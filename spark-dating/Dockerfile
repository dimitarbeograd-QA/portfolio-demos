# Spark – един образ за двата процеса (публичен сайт и администрация); режимът се задава с APP_MODE / команда.
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
COPY scripts ./scripts
# Неприложен потребител; данните са във волюми
RUN useradd --system --uid 10001 --home /app spark && mkdir -p /data /admin-data /backups && chown -R spark /data /admin-data /backups
USER spark
ENV DATA_DIR=/data
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.ADMIN_PORT&&process.env.APP_MODE==='admin'?process.env.ADMIN_PORT:(process.env.PORT||3100))+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
