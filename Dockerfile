FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY scripts/agent-server.mjs ./scripts/
EXPOSE 3080
CMD ["node", "scripts/agent-server.mjs"]
