# Production example JavaScript (Node) sandbox container.
# docker run --rm -i --network=none --memory=256m --cpus=0.5 --pids-limit=64 mihenk-javascript-sandbox
FROM node:20-slim
RUN useradd -m -u 10001 runner
USER runner
WORKDIR /sandbox
