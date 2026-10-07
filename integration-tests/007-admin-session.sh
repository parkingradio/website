#!/usr/bin/env bash
#
# The bootstrap admin can log in, use the session and log out, end to end against a real
# database. The server's unit tests mock the database, so this is what covers the migrations,
# the bootstrap admin created at startup, password hashing and the session cookie together.

source "$(dirname "$0")/lib.sh"

readonly IP=198.51.100.7
upper_email="$(printf '%s' "$ADMIN_EMAIL" | tr '[:lower:]' '[:upper:]')"

echo "  a wrong password is rejected"
login "$IP" "$ADMIN_EMAIL" not-the-password
expect_status 401

echo "  the bootstrap admin logs in, whatever the case of the email"
login "$IP" "$upper_email" "$ADMIN_PASSWORD"
expect_status 200
expect_body_contains "\"email\":\"${ADMIN_EMAIL}\""
expect_header Set-Cookie 'session=[^;]+;.*HttpOnly'

cookie="$(session_cookie)"

echo "  the session authenticates admin requests"
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/me"
expect_status 200
expect_body_contains "\"email\":\"${ADMIN_EMAIL}\""

echo "  inviting an address that's already an admin is refused, whatever its case"
request --header "Cookie: ${cookie}" --header 'Content-Type: application/json' \
    --data "{\"email\":\"${upper_email}\"}" "${BASE_URL}/api/admin/invite"
expect_status 409

echo "  admin requests without a session are refused"
request "${BASE_URL}/api/admin/me"
expect_status 401

echo "  logging out clears the cookie"
request --request POST --header "Cookie: ${cookie}" "${BASE_URL}/api/auth/logout"
expect_status 200
expect_header Set-Cookie 'session=;'
