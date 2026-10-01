#!/usr/bin/env bash
#
# A content-hashed asset referenced by index.html is actually served. Its path is resolved from
# index.html rather than hardcoded: it is the thing most likely to break when the image layout
# changes, and nothing else covers it.

source "$(dirname "$0")/lib.sh"

request "${BASE_URL}/"
expect_status 200
expect_body '/assets/[^"]*\.js'
asset="$(printf '%s' "$BODY" | grep -o '/assets/[^"]*\.js' | head -1)"
echo "  asset: $asset"

request "${BASE_URL}${asset}"
expect_status 200
expect_header Content-Type 'application/javascript|text/javascript'

# A hashed asset that does *not* exist, like a stale bundle requested by a tab opened before a
# deploy, stays a 404. Serving index.html under a script URL turns that into a MIME-type error
# rather than a clean miss.
request "${BASE_URL}/assets/index-STALEHASH.js"
expect_status 404
