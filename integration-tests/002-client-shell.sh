#!/usr/bin/env bash
#
# The image serves the built client at the root. This is what proves the client bundle actually
# made it into the image, rather than the server coming up with nothing to serve.

source "$(dirname "$0")/lib.sh"

request "${BASE_URL}/"
expect_status 200
expect_header Content-Type 'text/html'
expect_body '<title>parking.radio</title>'

# Other sites can't show it in a frame, so that they can't trick admins into clicking its buttons.
expect_header X-Frame-Options 'DENY'
expect_header Content-Security-Policy "frame-ancestors 'none'"
