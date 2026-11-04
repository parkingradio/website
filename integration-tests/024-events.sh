#!/usr/bin/env bash
#
# The events are read from Resident Advisor, which the integration tests don't depend on: only what's refused before RA
# is asked is checked here.

source "$(dirname "$0")/lib.sh"

echo "  a time range that isn't one is refused, before RA is asked"
request "${BASE_URL}/api/events?from=2026-11-14T21:00Z"
expect_status 400
expect_body_contains '{"ok":false,"error":"`from` must be a single date and time in Québec time, '

request "${BASE_URL}/api/events?from=2026-11-14T21:00-05:00&to=2026-11-14T21:00-05:00"
expect_status 400
expect_body '^\{"ok":false,"error":"`from` must be before `to`"\}$'
