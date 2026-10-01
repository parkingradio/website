#!/usr/bin/env bash
#
# The server shuts down by itself on SIGTERM, which is what `docker stop` and `docker compose down`
# send, rather than being killed once Docker's grace period runs out: a server that ignored it
# would be cut off mid-request, after a wait that looks exactly like a hang.
#
# Numbered last: this stops the server, so nothing can run against it afterwards.

source "$(dirname "$0")/lib.sh"

# Docker sends SIGKILL if the container is still running after the grace period, in which case
# it exits with 137 (128 + SIGKILL) rather than with the server's own exit code.
docker stop --time 5 "$CONTAINER" >/dev/null
code="$(docker inspect -f '{{.State.ExitCode}}' "$CONTAINER")"
echo "  exit code: ${code}"
[ "$code" = 0 ] || fail "expected the server to exit cleanly on SIGTERM within 5s, got exit code ${code}"
