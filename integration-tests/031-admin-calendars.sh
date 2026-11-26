#!/usr/bin/env bash
#
# Admins' calendars, in the server's Docker image (see docs/design/server/admin-calendars.md):
# - the token's endpoints require a session, and give the admin the same token until it's replaced
# - the calendars refuse requests without an admin's token, with a 403 that doesn't quote it
# - the calendar of sessions has the sessions, announced or not, marked, and is never kept
# - the calendar of occupations is empty without feeds, fails with 503 until a feed of occupations that's added behind the
#   server's back has been read, and then has that feed, whose read failed, but never waits for or has a feed of holds
# - the calendar of available time is empty without a feed of holds, even while a feed of occupations hasn't been read,
#   fails with 503 until every feed has been read once there's one, and then has the feeds whose read failed, of either kind
# - replacing the token, or revoking the admin, makes the links stop working
# - the tokens are never logged
# What the calendars give is tested by the server's own tests (server/src/admin-calendars).

source "$(dirname "$0")/lib.sh"

readonly IP=198.51.100.31
readonly URL="${BASE_URL}/api/admin/ics-subscription-token"
since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "  the token's endpoints require a session"
request "$URL"
expect_status 401
request --request POST "$URL"
expect_status 401

cookie="$(session_of "$ADMIN_EMAIL" "$ADMIN_PASSWORD")"

# token -- the token of the admin of `cookie`, which has to be given.
token() {
    json GET "$URL"
    expect_status 200
    body_field token
}

echo "  an admin gets the same token until it's replaced"
token="$(token)"
[[ "$token" =~ ^[0-9a-f]{64}$ ]] || fail "expected a token of 64 hexadecimal digits, got: ${token}"
[ "$(token)" = "$token" ] || fail "expected the same token again"

echo "  the calendars refuse requests without an admin's token"
readonly OTHER="$(openssl rand -hex 32)"
for feed in sessions occupations availability; do
    for query in '' '?token=' "?token=${OTHER}" "?token=${token}&token=${token}"; do
        request "${BASE_URL}/${feed}.ics${query}"
        expect_status 403
        expect_body "^\\{\"ok\":false,\"error\":\"[^\"]*\"\\}$"
        expect_body_lacks "$OTHER"
        expect_body_lacks "$token"
    done
done

echo "  the calendar of sessions has every session, announced or not, marked, and is never kept"
# Years from now, so that the sessions of other tests are in neither.
readonly ANNOUNCED='5b7e2c1d-3a4f-4b6c-8d9e-0f1a2b3c4d01'
readonly CANCELLED='5b7e2c1d-3a4f-4b6c-8d9e-0f1a2b3c4d02'
sql "insert into sessions (id, created_by, start_at, duration_minutes, type, name, status, announced)
     values ('${ANNOUNCED}', '${ADMIN_EMAIL}', '2032-05-01 21:00-04', 60, 'other', 'Annoncée', 'planned', true),
            ('${CANCELLED}', '${ADMIN_EMAIL}', '2032-05-02 21:00-04', 60, 'other', 'Annulée', 'cancelled', false),
            ('5b7e2c1d-3a4f-4b6c-8d9e-0f1a2b3c4d03', '${ADMIN_EMAIL}', null, 60, 'other', 'Sans date', 'planned', false)"
request "${BASE_URL}/sessions.ics?token=${token}"
expect_status 200
expect_header content-type 'text/calendar; charset=utf-8'
expect_header cache-control 'no-store'
expect_body_contains "UID:session-${ANNOUNCED}@parking.radio"
expect_body_contains 'SUMMARY:Annoncée'
expect_body_contains "UID:session-${CANCELLED}@parking.radio"
expect_body_contains 'SUMMARY:[CANCELLED] [UNANNOUNCED] Annulée'
expect_body_lacks 'Sans date'
sql "delete from sessions where id::text like '5b7e2c1d-3a4f-4b6c-8d9e-0f1a2b3c4d0%'"

echo "  the calendar of occupations is empty without feeds"
request "${BASE_URL}/occupations.ics?token=${token}"
expect_status 200
expect_header cache-control 'no-store'
expect_body_contains 'X-WR-CALNAME:Parking Radio (development) · occupations'
expect_body_lacks 'BEGIN:VEVENT'

echo "  the calendar of available time is empty without feeds"
request "${BASE_URL}/availability.ics?token=${token}"
expect_status 200
expect_header content-type 'text/calendar; charset=utf-8'
expect_header cache-control 'no-store'
expect_body_contains 'X-WR-CALNAME:Parking Radio (development) · disponibilités'
expect_body_lacks 'BEGIN:VEVENT'

echo "  a feed of holds doesn't count; it fails with 503 until a feed of occupations added behind the server's back has been read, then has it"
readonly FEED='7a2d4e6f-8b1c-4d3e-9f5a-6b7c8d9e0f12'
readonly SECRET='private-5d1e8a3c9b7f'
readonly HOLDS='7a2d4e6f-8b1c-4d3e-9f5a-6b7c8d9e0f13'
add_holds() {
    sql "insert into calendar_feeds (id, name, kind, link, created_by)
         values ('${HOLDS}', 'Loft', 'holds', 'https://calendar.invalid/${SECRET}-loft.ics', '${ADMIN_EMAIL}')"
}
add_holds
request "${BASE_URL}/occupations.ics?token=${token}"
expect_status 200
expect_body_lacks 'BEGIN:VEVENT'
echo "  the calendar of available time fails with 503 while a feed of holds hasn't been read"
request "${BASE_URL}/availability.ics?token=${token}"
expect_status 503
expect_header cache-control 'no-store'
expect_body_contains '{"ok":false,"error":'
sql "delete from calendar_feeds where id = '${HOLDS}'"
sql "insert into calendar_feeds (id, name, kind, link, created_by)
     values ('${FEED}', 'Séjours', 'occupations', 'https://calendar.invalid/${SECRET}.ics', '${ADMIN_EMAIL}')"
request "${BASE_URL}/occupations.ics?token=${token}"
expect_status 503
expect_header cache-control 'no-store'
expect_body_contains '{"ok":false,"error":'
echo "  without a feed of holds, the calendar of available time doesn't wait for a feed of occupations"
request "${BASE_URL}/availability.ics?token=${token}"
expect_status 200
expect_body_lacks 'BEGIN:VEVENT'
add_holds
request "${BASE_URL}/availability.ics?token=${token}"
expect_status 503
json POST "${BASE_URL}/api/admin/calendar/feeds/refresh"
expect_status 200
expect_body_contains "\"readAt\":null,\"error\":\"The link can't be read: its server can't be found\""
request "${BASE_URL}/occupations.ics?token=${token}"
expect_status 200
expect_body_contains "UID:feed-${FEED}@parking.radio"
expect_body_contains 'SUMMARY:[REFRESH ERROR] Séjours'
expect_body_contains "can't be found"
expect_body_lacks "$SECRET"
expect_body_lacks 'Loft'
echo "  then it has the feeds whose read failed, of either kind"
request "${BASE_URL}/availability.ics?token=${token}"
expect_status 200
expect_body_contains "UID:availability-feed-${FEED}@parking.radio"
expect_body_contains "UID:availability-feed-${HOLDS}@parking.radio"
expect_body_contains 'SUMMARY:[REFRESH ERROR] Séjours'
expect_body_contains 'SUMMARY:[REFRESH ERROR] Loft'
expect_body_lacks 'SUMMARY:disponible'
expect_body_lacks "$SECRET"
json DELETE "${BASE_URL}/api/admin/calendar/feeds/${FEED}"
expect_status 200
json DELETE "${BASE_URL}/api/admin/calendar/feeds/${HOLDS}"
expect_status 200

echo "  replacing the token makes the previous links stop working"
json POST "$URL"
expect_status 200
replaced="$(body_field token)"
[ "$replaced" != "$token" ] || fail "expected a new token"
[ "$(token)" = "$replaced" ] || fail "expected the new token from then on"
request "${BASE_URL}/sessions.ics?token=${token}"
expect_status 403
request "${BASE_URL}/sessions.ics?token=${replaced}"
expect_status 200

echo "  revoking an admin makes their links stop working"
readonly REVOKED_EMAIL='subscriber@integration.test'
new_admin "$REVOKED_EMAIL" subscriber-password
admin_cookie="$cookie"
cookie="$(session_of "$REVOKED_EMAIL" subscriber-password)"
revoked_token="$(token)"
request "${BASE_URL}/sessions.ics?token=${revoked_token}"
expect_status 200
cookie="$admin_cookie"
json DELETE "${BASE_URL}/api/admin/admins/$(sql "select id from users where email = '${REVOKED_EMAIL}'")"
expect_status 200
request "${BASE_URL}/sessions.ics?token=${revoked_token}"
expect_status 403

echo "  the tokens are never logged"
for logged in "$token" "$replaced" "$revoked_token" "$SECRET"; do
    if docker logs --since "$since" "$CONTAINER" 2>&1 | grep -qF "$logged"; then fail "the server logged a token or a feed's link"; fi
done
