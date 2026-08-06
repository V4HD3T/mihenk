# Production example C++ sandbox container.
# docker run --rm -i --network=none --memory=256m --cpus=0.5 --pids-limit=64 mihenk-cpp-sandbox
FROM gcc:13-bookworm
RUN useradd -m -u 10001 runner
USER runner
WORKDIR /sandbox
