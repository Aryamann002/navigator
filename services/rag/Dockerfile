FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY core.js server.js ./
ENV NODE_ENV=production
USER node
EXPOSE 8080
CMD ["node", "server.js"]
