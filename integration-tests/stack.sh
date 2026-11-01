#!/usr/bin/env bash
#
# Sourced by the scripts that test the production Docker image: run.sh here, and e2e/run.sh.
#
#   [PARKING_RADIO_IMAGE=<image>] start_stack
#
# Starts the image PARKING_RADIO_IMAGE names against a throwaway Postgres, building one from the
# tree if it isn't set, and exports where the server is reachable (BASE_URL) and what it was started
# with. Everything is created here and torn down when the script that sourced this exits, so this
# behaves the same on a laptop as on a CI runner and needs neither `npm run db:up` nor a Postgres
# service container.
#
# The script that sources this must be in strict mode (`set -euo pipefail`), which is what stops it
# when starting something fails. It must not set an EXIT trap of its own either, since start_stack
# sets the one that tears everything down.

STACK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Docker objects are named uniquely for each run, so that concurrent runs (e.g. from different
# worktrees) don't remove each other's. They're also labelled, so that anything left behind by a
# run killed before its trap fired can be found with `--filter label=parking-radio-integration`.
RUN_ID="$$-${RANDOM}"
LABEL="parking-radio-integration"
NETWORK="parking-radio-integration-${RUN_ID}"
# The database's container, for tests that need to hold locks in it.
export PG="parking-radio-integration-db-${RUN_ID}"
# The image built from the tree, when PARKING_RADIO_IMAGE isn't set.
BUILT_IMAGE="parking-radio-integration:${RUN_ID}"

# What the tests are run with: the server's container (for tests that inspect or signal it), the
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
    # Its layers stay in the build cache, so the next build is just as fast.
    docker rmi "$BUILT_IMAGE" >/dev/null 2>&1 || true
}

start_stack() {
    trap cleanup EXIT

    # Started before the image is built, so that it comes up while the build runs. The same settings
    # as the development database in docker-compose.yml, and the same major version as RDS.
    echo "Starting Postgres..."
    docker network create --label "$LABEL" "$NETWORK" >/dev/null
    docker run --detach --name "$PG" --label "$LABEL" --network "$NETWORK" \
        --env POSTGRES_USER=parking_radio --env POSTGRES_PASSWORD=parking_radio \
        --env POSTGRES_DB=parking_radio \
        postgres:16 >/dev/null

    # Without PARKING_RADIO_IMAGE, build an image from the tree first, so that testing is a single
    # command from a clean checkout. CI sets it to the image it built, and so skips this.
    local image
    if [ -n "${PARKING_RADIO_IMAGE:-}" ]; then
        image="$PARKING_RADIO_IMAGE"
    else
        image="$BUILT_IMAGE"
        echo "Building ${image}..."
        docker build --label "$LABEL" --tag "$image" "${STACK_DIR}/.."
    fi

    # Over TCP, which the temporary server the image runs while initializing the database doesn't
    # listen on, so that this doesn't succeed before the real server is up.
    if ! wait_until 60 docker exec "$PG" pg_isready --host 127.0.0.1 --username parking_radio; then
        echo "Postgres never became ready" >&2
        docker logs "$PG" >&2
        exit 1
    fi

    echo "Starting ${image}..."
    # Started the way docker-compose.prod.yml.tftpl starts it in production, in particular without
    # --init, so that tests see the same process setup as production does. The configuration is
    # the development one, so that a newly required setting doesn't have to be added here too.
    #
    # It's published on a port picked by Docker, so that it can't clash with a dev server or another
    # run, and only on the loopback interface, since the admin's password is no secret.
    #
    # Without a private bucket, it keeps artists' photos in a directory it can write to.
    docker run --detach --name "$CONTAINER" --label "$LABEL" --network "$NETWORK" \
        --publish 127.0.0.1::3000 \
        --env-file "${STACK_DIR}/../.env.example" \
        --env DATABASE_URL="postgres://parking_radio:parking_radio@${PG}:5432/parking_radio" \
        --env ASSETS_DOMAIN="$ASSETS_DOMAIN" \
        --env PRIVATE_BUCKET_DIRECTORY=/tmp/private-bucket \
        "$image" >/dev/null
    BASE_URL="http://$(docker port "$CONTAINER" 3000/tcp)"
    export BASE_URL

    if ! wait_until 60 curl --silent --fail "${BASE_URL}/healthz"; then
        echo "Server never became reachable at ${BASE_URL}/healthz" >&2
        docker logs "$CONTAINER" >&2
        exit 1
    fi

    # The admin the tests log in as, created the way a deployment's first admin is: with the create-admin command (see
    # tools/create-admin), whose invite is then accepted.
    #
    # With the checks' helpers, in a subshell, so that what lib.sh sets up (e.g. its ERR trap) stays there.
    echo "Creating the admin..."
    if ! (
        source "${STACK_DIR}/lib.sh"
        create_admin "$ADMIN_EMAIL"
        expect_output "Created admin"
        accept_invite "$(invite_token)" "$ADMIN_PASSWORD"
        expect_status 200
    ); then
        echo "Couldn't create the admin" >&2
        docker logs "$CONTAINER" >&2
        exit 1
    fi
}
