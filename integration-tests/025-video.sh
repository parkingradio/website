#!/usr/bin/env bash
#
# Checks the video the site shows, and the YouTube credentials it's read with, against a real database. Saving them takes
# a key YouTube accepts, which these tests don't have, so this only checks what comes before that:
# - there's no video until the credentials are entered
# - the credentials' endpoints require a session
# - there are none until they're entered
# - credentials that aren't valid are refused before YouTube is asked about them

source "$(dirname "$0")/lib.sh"

readonly URL="${BASE_URL}/api/admin/video/credentials"
readonly CHANNEL_ID='UCvMw4qUIPPwkcZmBRRS0vNA'

echo "  there's no video until the credentials are entered"
request "${BASE_URL}/api/video"
expect_status 502
expect_body_contains '{"ok":false,"error":"The video is unavailable right now"}'

echo "  the credentials' endpoints require a session"
request "$URL"
expect_status 401
request --request PUT --header 'Content-Type: application/json' --data "{\"channelId\":\"${CHANNEL_ID}\",\"apiKey\":\"key\"}" "$URL"
expect_status 401
request --request POST --header 'Content-Type: application/json' --data "{\"channelId\":\"${CHANNEL_ID}\",\"apiKey\":\"key\"}" "${URL}/check"
expect_status 401

login 198.51.100.31 "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
expect_status 200
cookie="$(session_cookie)"

echo "  there are no credentials until they're entered"
request --header "Cookie: ${cookie}" "$URL"
expect_status 200
expect_body_contains '{"ok":true,"credentials":null}'

echo "  a blank key, or a channel id that isn't one, is refused, and can't be checked either"
request --header "Cookie: ${cookie}" --request PUT --header 'Content-Type: application/json' \
    --data "{\"channelId\":\"${CHANNEL_ID}\",\"apiKey\":\" \"}" "$URL"
expect_status 400
request --header "Cookie: ${cookie}" --request PUT --header 'Content-Type: application/json' \
    --data '{"channelId":"@parkingradio","apiKey":"key"}' "$URL"
expect_status 400
expect_body_contains 'Not a YouTube channel'
request --header "Cookie: ${cookie}" --request POST --header 'Content-Type: application/json' \
    --data "{\"channelId\":\"${CHANNEL_ID},${CHANNEL_ID}\",\"apiKey\":\"key\"}" "${URL}/check"
expect_status 400
request --header "Cookie: ${cookie}" "$URL"
expect_body_contains '{"ok":true,"credentials":null}'
