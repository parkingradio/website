#!/usr/bin/env bash
#
# Checks the calendar feeds against a real database. Adding one takes a link that gives a calendar over https, which
# these tests don't have, so this only checks what comes before reading it, and what fails to read:
# - the endpoints require a session
# - there are none until one is added
# - a link that isn't https or webcal, or fields the endpoint doesn't take, are refused before the link is read
# - a link whose server can't be found fails with 502
# - a feed that's in the database is listed, without its link, and can be removed
# - the links are never logged

source "$(dirname "$0")/lib.sh"

readonly URL="${BASE_URL}/api/admin/calendar/feeds"
readonly SECRET='private-0b9c5e1f7a3d42'
since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "  the endpoints require a session"
request "$URL"
expect_status 401
request --request POST --header 'Content-Type: application/json' \
    --data "{\"name\":\"x\",\"kind\":\"occupation\",\"link\":\"https://calendar.invalid/${SECRET}\"}" "$URL"
expect_status 401
request --request DELETE "${URL}/00000000-0000-4000-8000-000000000000"
expect_status 401

login 198.51.100.32 "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
expect_status 200
cookie="$(session_cookie)"

# add <body> -- add a feed, as the admin.
add() {
    request --header "Cookie: ${cookie}" --request POST --header 'Content-Type: application/json' --data "$1" "$URL"
}

echo "  there are none until one is added"
request --header "Cookie: ${cookie}" "$URL"
expect_status 200
expect_body_contains '{"ok":true,"total":0,"feeds":[]}'

echo "  a link that isn't https or webcal, or a field it doesn't take, is refused before it's read"
add "{\"name\":\"Team\",\"kind\":\"occupation\",\"link\":\"http://example.com/${SECRET}.ics\"}"
expect_status 400
expect_body_contains 'The link must be an https or webcal link'
add "{\"name\":\"Team\",\"kind\":\"occupation\",\"link\":\"https://example.com/${SECRET}.ics\",\"url\":\"x\"}"
expect_status 400
expect_body_contains 'Unknown field: `url`'

echo "  a link whose server can't be found fails with 502, and isn't added"
add "{\"name\":\"Team\",\"kind\":\"occupation\",\"link\":\"webcal://calendar.invalid/${SECRET}.ics\"}"
expect_status 502
expect_body_contains "The link can't be read"
request --header "Cookie: ${cookie}" "$URL"
expect_body_contains '"total":0'

echo "  a feed is listed without its link, and can be removed, once"
sql "insert into calendar_feeds (id, name, kind, link, created_by)
     values ('6f1c3c8e-1b7a-4c1e-9d3f-2a1b0c9d8e7f', 'Séjours', 'quiet-time', 'https://calendar.invalid/${SECRET}-stays.ics', '${ADMIN_EMAIL}')"
request --header "Cookie: ${cookie}" "$URL"
expect_status 200
expect_body_contains '"total":1'
expect_body_contains '"name":"Séjours","kind":"quiet-time"'
if printf '%s' "$BODY" | grep -qF "$SECRET"; then fail "the list has a feed's link"; fi
request --header "Cookie: ${cookie}" --request DELETE "${URL}/6f1c3c8e-1b7a-4c1e-9d3f-2a1b0c9d8e7f"
expect_status 200
request --header "Cookie: ${cookie}" --request DELETE "${URL}/6f1c3c8e-1b7a-4c1e-9d3f-2a1b0c9d8e7f"
expect_status 404
request --header "Cookie: ${cookie}" "$URL"
expect_body_contains '"total":0'

echo "  the links are never logged"
if docker logs --since "$since" "$CONTAINER" 2>&1 | grep -qF "$SECRET"; then fail "the server logged a feed's link"; fi
