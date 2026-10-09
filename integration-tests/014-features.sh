#!/usr/bin/env bash
#
# Checks feature flags against a real database. There are no flags for now (FEATURES is empty in
# shared/src/features.ts), so this checks that:
# - `GET /api/config` reads them from the database, which has their table, and is never cached
# - the admin endpoints require a session, and list no flags
# - switching a flag that doesn't exist fails
#
# Once there's a flag, this should also check that switching it is saved and shows in `GET /api/config`.

source "$(dirname "$0")/lib.sh"

echo "  the configuration has every flag, and is never cached"
request "${BASE_URL}/api/config"
expect_status 200
expect_body_contains '"features":{}'
expect_header 'Cache-Control' 'no-store'

echo "  the admin endpoints require a session"
request "${BASE_URL}/api/admin/features"
expect_status 401
request --request PUT --header 'Content-Type: application/json' --data '{"enabled":true}' \
    "${BASE_URL}/api/admin/features/some-flag"
expect_status 401

login 198.51.100.20 "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
expect_status 200
cookie="$(session_cookie)"

echo "  admins see every flag"
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/features"
expect_status 200
expect_body_contains '{"ok":true,"features":[]}'

echo "  a flag that doesn't exist can't be switched"
request --header "Cookie: ${cookie}" --request PUT --header 'Content-Type: application/json' --data '{"enabled":true}' \
    "${BASE_URL}/api/admin/features/some-flag"
expect_status 404
