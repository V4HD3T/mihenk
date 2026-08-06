# Production example Java sandbox container.
# docker run --rm -i --network=none --memory=384m --cpus=0.5 --pids-limit=64 mihenk-java-sandbox
FROM eclipse-temurin:21-jdk-jammy
RUN useradd -m -u 10001 runner
USER runner
WORKDIR /sandbox
