#!/usr/bin/env bash
#
# Checks feature flags against a real database, while there are none, with a flag saved before it was retired, as
# production has:
# - `GET /api/config` has no flags, leaving out the retired one, and is never cached
# - the admin endpoints require a session
# - admins see no flags
# - switching a retired flag, or one that doesn't exist, fails
#
# Turning a flag on or off, which saves it in the database, and seeing it in `GET /api/config`, can only be checked
# again once there's a flag.

source "$(dirname "$0")/lib.sh"

readonly RETIRED='nouveau-lecteur'
sql "insert into feature_flags (id, enabled, updated_by, updated_at)
     values ('${RETIRED}', true, 'admin@example.com', now())"

echo "  the configuration has no flags, and is never cached"
request "${BASE_URL}/api/config"
expect_status 200
expect_body_contains '"features":{}'
expect_header 'Cache-Control' 'no-store'

echo "  the admin endpoints require a session"
request "${BASE_URL}/api/admin/features"
expect_status 401
request --request PUT --header 'Content-Type: application/json' --data '{"enabled":true}' \
    "${BASE_URL}/api/admin/features/${RETIRED}"
expect_status 401

login 198.51.100.20 "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
expect_status 200
cookie="$(session_cookie)"

echo "  admins see no flags"
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/features"
expect_status 200
expect_body_contains '{"ok":true,"total":0,"features":[]}'

echo "  a retired flag, or one that doesn't exist, can't be switched"
for flag in "$RETIRED" some-flag; do
    request --header "Cookie: ${cookie}" --request PUT --header 'Content-Type: application/json' \
        --data '{"enabled":true}' "${BASE_URL}/api/admin/features/${flag}"
    expect_status 404
done
