# Production example: run each language's execution request inside a
# network-disconnected, unprivileged, resource-limited container like this.
# Recommended run flags:
#   docker run --rm -i --network=none --memory=256m --cpus=0.5 \
#     --pids-limit=64 --read-only --tmpfs /sandbox:rw,size=16m \
#     mihenk-python-sandbox
FROM python:3.12-slim
RUN useradd -m -u 10001 runner
USER runner
WORKDIR /sandbox
