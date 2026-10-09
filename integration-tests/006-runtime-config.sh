#!/usr/bin/env bash
#
# The client builds asset URLs from the domain the server is configured with at runtime, which
# is what lets the same image serve every environment.

source "$(dirname "$0")/lib.sh"

request "${BASE_URL}/api/config"
expect_status 200
expect_body_contains "\"assetsDomain\":\"${ASSETS_DOMAIN}\""
# The Turnstile site key, which the "Appliquer" form will need. Its value comes from .env.example.
expect_body '"turnstileSiteKey":"[^"]+"'
