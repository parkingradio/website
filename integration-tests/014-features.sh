#!/usr/bin/env bash
#
# Checks feature flags against a real database, with the flag of the new "Appliquer" form:
# - `GET /api/config` reads them from the database, off until they're turned on, and is never cached
# - the admin endpoints require a session
# - turning a flag on or off is saved, and shows in `GET /api/config` right away
# - switching a flag that doesn't exist fails

source "$(dirname "$0")/lib.sh"

readonly FLAG='nouveau-formulaire-candidature'

echo "  the configuration has every flag, off until it's turned on, and is never cached"
request "${BASE_URL}/api/config"
expect_status 200
expect_body_contains "\"features\":{\"${FLAG}\":false}"
expect_header 'Cache-Control' 'no-store'

echo "  the admin endpoints require a session"
request "${BASE_URL}/api/admin/features"
expect_status 401
request --request PUT --header 'Content-Type: application/json' --data '{"enabled":true}' \
    "${BASE_URL}/api/admin/features/${FLAG}"
expect_status 401

login 198.51.100.20 "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
expect_status 200
cookie="$(session_cookie)"

# switch <flag> <true|false> -- turn a flag on or off, as the admin.
switch() {
    request --header "Cookie: ${cookie}" --request PUT --header 'Content-Type: application/json' --data "{\"enabled\":$2}" \
        "${BASE_URL}/api/admin/features/$1"
}

echo "  admins see every flag"
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/features"
expect_status 200
expect_body_contains "{\"ok\":true,\"features\":[{\"id\":\"${FLAG}\",\"enabled\":false,\"updatedBy\":null,\"updatedAt\":null}]}"

echo "  a flag that's turned on is on for every page loaded after that, and so is one turned off"
switch "$FLAG" true
expect_status 200
expect_body_contains "\"enabled\":true,\"updatedBy\":\"${ADMIN_EMAIL}\""
request "${BASE_URL}/api/config"
expect_body_contains "\"features\":{\"${FLAG}\":true}"
switch "$FLAG" false
expect_status 200
request "${BASE_URL}/api/config"
expect_body_contains "\"features\":{\"${FLAG}\":false}"
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/features"
expect_body_contains "\"enabled\":false,\"updatedBy\":\"${ADMIN_EMAIL}\""

echo "  a flag that doesn't exist can't be switched"
switch some-flag true
expect_status 404
