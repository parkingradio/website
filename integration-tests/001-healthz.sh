#!/usr/bin/env bash
#
# /healthz answers {"ok":true} when the server can reach the database. It is what the deploy
# workflow and `start_stack` (see stack.sh) poll, so it is checked on its own before anything else.

source "$(dirname "$0")/lib.sh"

request "${BASE_URL}/healthz"
expect_status 200
expect_body '^\{"ok":true\}$'
