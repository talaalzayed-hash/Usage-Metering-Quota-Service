# Load test runner. Runs inside the Compose network so the results measure the
# service, not Docker Desktop's port forwarding from the host.
#
#   docker compose --profile perf run --rm perf

FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY perf ./perf
CMD ["npx", "tsx", "perf/load-test.ts"]
