#!/usr/bin/env bash
#
# Integration tests for the production Docker image.
#
#   [PARKING_RADIO_IMAGE=<image>] ./run.sh
#
# Starts the image PARKING_RADIO_IMAGE names against a throwaway Postgres (see stack.sh), building
# one from the tree if it isn't set, and runs every numbered check in this directory against it, in
# order.
#
# Checks source lib.sh for strict mode and test helpers. They run in filename order and are
# independent, with one exception: anything that stops the server has to sort last, which is
# what the numeric prefixes are for. Such checks use the 9xx range, which is reserved for them.

set -euo pipefail

# The image used to be an argument. It's PARKING_RADIO_IMAGE now: refuse arguments rather than
# silently ignoring one.
if [ $# -ne 0 ]; then
    echo "usage: [PARKING_RADIO_IMAGE=<image>] $0" >&2
    exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${HERE}/stack.sh"
start_stack

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
