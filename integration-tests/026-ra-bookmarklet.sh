#!/usr/bin/env bash
#
# The script of the bookmarklet that publishes sessions' events on RA is served at a path that doesn't change, as
# JavaScript rather than as the app, and checked again each time, so that the bookmarklet, which RA's pages load it from
# (see docs/design/client/admin/publier-sur-ra.md), always gets the latest one.

source "$(dirname "$0")/lib.sh"

request "${BASE_URL}/ra-bookmarklet.js?1794319166924"
expect_status 200
expect_header Content-Type 'application/javascript|text/javascript'
expect_body_contains 'Parking Radio → RA'
expect_body_lacks '<!doctype html>'
expect_header Cache-Control 'public, max-age=0'
