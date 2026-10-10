#!/usr/bin/env bash
#
# Checks the credentials of the SoundCloud app the radio reads playlists through, against a real database. Saving them
# takes credentials SoundCloud accepts, which these tests don't have, so this only checks what comes before that:
# - the endpoints require a session
# - there are none until they're entered
# - credentials that aren't valid are refused before SoundCloud is asked about them

source "$(dirname "$0")/lib.sh"

readonly URL="${BASE_URL}/api/admin/radio/credentials"

echo "  the endpoints require a session"
request "$URL"
expect_status 401
request --request PUT --header 'Content-Type: application/json' --data '{"clientId":"id","clientSecret":"secret"}' "$URL"
expect_status 401
request --request POST --header 'Content-Type: application/json' --data '{"clientId":"id","clientSecret":"secret"}' "${URL}/check"
expect_status 401

login 198.51.100.21 "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
expect_status 200
cookie="$(session_cookie)"

echo "  there are no credentials until they're entered"
request --header "Cookie: ${cookie}" "$URL"
expect_status 200
expect_body_contains '{"ok":true,"credentials":null}'

echo "  blank credentials are refused, and can't be checked either"
request --header "Cookie: ${cookie}" --request PUT --header 'Content-Type: application/json' \
    --data '{"clientId":" ","clientSecret":"secret"}' "$URL"
expect_status 400
request --header "Cookie: ${cookie}" --request POST --header 'Content-Type: application/json' \
    --data '{"clientId":"id","clientSecret":" "}' "${URL}/check"
expect_status 400
request --header "Cookie: ${cookie}" "$URL"
expect_body_contains '{"ok":true,"credentials":null}'
