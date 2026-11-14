# Zero runtime dependencies: no npm install step is needed.
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
