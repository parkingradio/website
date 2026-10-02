#!/usr/bin/env bash
#
# Deep links and hard refreshes resolve to the client rather than 404ing: any GET that is not the
# API and not a file of the build falls through to index.html, query string included.

source "$(dirname "$0")/lib.sh"

for path in /synth-meetups /programmation /admin /admin/rotation '/accept-invite?token=abc'; do
    request "${BASE_URL}${path}"
    expect_status 200
    expect_body '<title>parking.radio</title>'
done
