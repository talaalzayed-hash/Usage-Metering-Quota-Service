# Docs Co example client: builds the React page, then runs the small
# backend that serves it and calls the metering service.

FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
USER node
EXPOSE 8080
CMD ["npx", "tsx", "server/index.ts"]
