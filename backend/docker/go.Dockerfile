# Production Go sandbox container.
# docker run --rm -i --network=none --memory=256m --cpus=0.5 --pids-limit=64 codecloud-go-sandbox
FROM golang:1.23-bookworm
RUN useradd -m -u 10001 runner

# GO111MODULE=off lets a bare main.go compile without a go.mod. CGO is off so a
# submission can't reach a C toolchain, and the build stays static.
ENV GOCACHE=/gocache \
    GOPATH=/tmp/.gopath \
    GO111MODULE=off \
    CGO_ENABLED=0

# Warm the build cache at image build time.
#
# Go rebuilds the whole standard library whenever GOCACHE is empty. With a fresh
# tmpfs per run that is *every* submission: measured at 31.7s per compile on a
# --cpus=0.5 container, which blew past the compile timeout and made every Go
# submission fail. Baking the cache in (31 MB) brings it to ~0.3s. It stays
# read-only at runtime - Go only reads from it here, and writes its intermediate
# output to $WORK under the writable /tmp.
RUN mkdir -p /gocache \
 && printf 'package main\nimport "fmt"\nfunc main(){fmt.Println(1)}\n' > /tmp/warm.go \
 && go build -o /tmp/warm /tmp/warm.go \
 && rm -f /tmp/warm /tmp/warm.go \
 && chmod -R a+rX /gocache

USER runner
WORKDIR /sandbox
