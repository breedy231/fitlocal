FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .
RUN npx tsc

EXPOSE 3001

CMD ["node", "dist/server.js"]
