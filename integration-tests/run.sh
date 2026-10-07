#!/usr/bin/env bash
#
# Integration tests for the production Docker image.
#
#   ./run.sh [IMAGE]
#
# Starts IMAGE against a throwaway Postgres and runs every numbered check in this directory
# against it, in order. Everything is created here and torn down on exit, so this behaves the
# same on a laptop as on a CI runner and needs neither `npm run db:up` nor a Postgres service
# container.
#
# Checks source lib.sh for strict mode and test helpers. They run in filename order and are
# independent, with one exception: anything that stops the server has to sort last, which is
# what the numeric prefixes are for. Such checks use the 9xx range, which is reserved for them.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Docker objects are named uniquely for each run, so that concurrent runs (e.g. from different
# worktrees) don't remove each other's. They're also labelled, so that anything left behind by a
# run killed before its trap fired can be found with `--filter label=parking-radio-integration`.
RUN_ID="$$-${RANDOM}"
LABEL="parking-radio-integration"
NETWORK="parking-radio-integration-${RUN_ID}"
PG="parking-radio-integration-db-${RUN_ID}"

# What every check is run with: its container (for checks that inspect or signal it), the
# configuration it was started with, and where the server is reachable (BASE_URL, exported once
# the server is started).
export CONTAINER="parking-radio-integration-app-${RUN_ID}"
export ASSETS_DOMAIN="assets.integration.test"
export ADMIN_EMAIL="admin@integration.test"
export ADMIN_PASSWORD="integration-password"

# wait_until <tries> <command...> -- run command once a second until it succeeds.
wait_until() {
    local tries="$1"
    shift
    for _ in $(seq 1 "$tries"); do
        "$@" >/dev/null 2>&1 && return 0
        sleep 1
    done
    return 1
}

cleanup() {
    docker rm --force "$CONTAINER" "$PG" >/dev/null 2>&1 || true
    docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Started before the image is built, so that it comes up while the build runs. The same settings
# as the development database in docker-compose.yml, and the same major version as RDS.
echo "Starting Postgres..."
docker network create --label "$LABEL" "$NETWORK" >/dev/null
docker run --detach --name "$PG" --label "$LABEL" --network "$NETWORK" \
    --env POSTGRES_USER=parking_radio --env POSTGRES_PASSWORD=parking_radio \
    --env POSTGRES_DB=parking_radio \
    postgres:16 >/dev/null

# With no argument, build the image from the tree first, so that `npm run test:integration` is
# a single command from a clean checkout. CI passes the tag it just built, and so skips this.
if [ $# -ge 1 ]; then
    IMAGE="$1"
else
    IMAGE="parking-radio:integration"
    echo "Building ${IMAGE}..."
    docker build --tag "$IMAGE" "${HERE}/.."
fi

# Over TCP, which the temporary server the image runs while initializing the database doesn't
# listen on, so that this doesn't succeed before the real server is up.
if ! wait_until 60 docker exec "$PG" pg_isready --host 127.0.0.1 --username parking_radio; then
    echo "Postgres never became ready" >&2
    docker logs "$PG" >&2
    exit 1
fi

echo "Starting ${IMAGE}..."
# Started the way docker-compose.prod.yml.tftpl starts it in production, in particular without
# --init, so that checks see the same process setup as production does. The configuration is
# the development one, so that a newly required setting doesn't have to be added here too.
#
# It's published on a port picked by Docker, so that it can't clash with a dev server or another
# run, and only on the loopback interface, since the bootstrap admin's password is no secret.
#
# Without a private bucket, it keeps artists' photos in a directory it can write to.
docker run --detach --name "$CONTAINER" --label "$LABEL" --network "$NETWORK" \
    --publish 127.0.0.1::3000 \
    --env-file "${HERE}/../.env.example" \
    --env DATABASE_URL="postgres://parking_radio:parking_radio@${PG}:5432/parking_radio" \
    --env BOOTSTRAP_ADMIN_EMAIL="$ADMIN_EMAIL" \
    --env BOOTSTRAP_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    --env ASSETS_DOMAIN="$ASSETS_DOMAIN" \
    --env PRIVATE_BUCKET_DIRECTORY=/tmp/private-bucket \
    "$IMAGE" >/dev/null
BASE_URL="http://$(docker port "$CONTAINER" 3000/tcp)"
export BASE_URL

if ! wait_until 60 curl --silent --fail "${BASE_URL}/healthz"; then
    echo "Server never became reachable at ${BASE_URL}/healthz" >&2
    docker logs "$CONTAINER" >&2
    exit 1
fi

group_start() { [ -n "${GITHUB_ACTIONS:-}" ] && echo "::group::$1" || echo "--- $1"; }
group_end() { [ -n "${GITHUB_ACTIONS:-}" ] && echo "::endgroup::" || true; }

passed=0
failed=()
for check in "$HERE"/[0-9]*.sh; do
    name="$(basename "$check")"
    group_start "$name"
    # Checks report their own diagnostics on stderr; fold it into stdout so it stays next to
    # the check it belongs to rather than surfacing wherever the two streams happen to meet.
    status=0
    bash "$check" 2>&1 || status=$?
    group_end
    if [ "$status" -eq 0 ]; then
        echo "PASS  $name"
        passed=$((passed + 1))
    else
        echo "FAIL  $name"
        failed+=("$name")
    fi
done

# Container log first, summary last: whatever a failure left on screen should be the list of
# what failed, not a page of request log scrolled past it.
if [ ${#failed[@]} -gt 0 ]; then
    group_start "container log (last 20 lines)"
    docker logs --tail 20 "$CONTAINER" 2>&1 | sed 's/^/  /'
    group_end
fi

echo
echo "${passed} passed, ${#failed[@]} failed"
if [ ${#failed[@]} -gt 0 ]; then
    printf '  FAILED: %s\n' "${failed[@]}"
    exit 1
fi
