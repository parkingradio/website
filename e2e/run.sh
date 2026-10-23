#!/usr/bin/env bash
#
# Browser tests for the production Docker image.
#
#   [PARKING_RADIO_IMAGE=<image>] ./run.sh [PLAYWRIGHT ARGS...]
#
# Starts the image PARKING_RADIO_IMAGE names against a throwaway Postgres (see
# integration-tests/stack.sh), building one from the tree if it isn't set, and runs Playwright
# against it, which seeds it first (see global-setup.ts). Arguments are Playwright's, e.g.
# `--project mobile`, `--headed` or the name of a test file.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${HERE}/../integration-tests/stack.sh"
start_stack

# Not `exec`, which would skip the trap that tears down what start_stack started.
cd "$HERE"
status=0
npx playwright test "$@" || status=$?

# The report only has the browser's side of a failure. The server's log goes next to it, so that CI
# uploads it too, and its end is shown here, as integration-tests/run.sh shows it.
if [ "$status" -ne 0 ]; then
    mkdir -p playwright-report
    docker logs "$CONTAINER" > playwright-report/server.log 2>&1
    echo "Server log (last 20 lines, all of it in e2e/playwright-report/server.log):"
    tail -n 20 playwright-report/server.log | sed 's/^/  /'
fi
exit "$status"
