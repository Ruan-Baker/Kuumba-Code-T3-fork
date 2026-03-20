FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY src/ ./src/
EXPOSE 4400
CMD ["node", "src/index.ts"]
