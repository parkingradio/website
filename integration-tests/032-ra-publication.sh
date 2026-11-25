#!/usr/bin/env bash
#
# Publishing a session's event on RA, in the server's Docker image (see docs/design/server/ra-publication.md):
# - an admin gets a token for a session, which gives its event, as RA's EventInput, from the database
# - RA's pages can read it, after a preflight, and it's never kept
# - choosing a new password, or being revoked, ends the token, and deleting the session makes it give 404
# - the tokens are never logged
# What's refused, and the event's content, are tested by the server's own tests (server/src/ra-publication).

source "$(dirname "$0")/lib.sh"

readonly IP=198.51.100.32
readonly URL="${BASE_URL}/api/ra-publication"
readonly EMAIL='publisher@integration.test'
since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

new_admin "$EMAIL" publisher-password
cookie="$(session_of "$EMAIL" publisher-password)"

request --header "Cookie: ${cookie}" --form-string 'artist={"name":"Brume"}' "${BASE_URL}/api/admin/artists"
expect_status 200
brume="$(body_id)"
request --header "Cookie: ${cookie}" --form-string \
    "session={\"start\":\"2026-11-14T21:00-05:00\",\"durationMinutes\":240,\"type\":\"other\",\"takeover\":null,\"application\":null,\"name\":\"NUIT BRUME\",\"raEvent\":null,\"description\":\"Une nuit.\",\"sets\":[{\"performers\":[{\"id\":\"${brume}\"}],\"durationMinutes\":60,\"performanceTypes\":[\"dj\"],\"otherPerformanceType\":\"\",\"genres\":[],\"soundcloudTrack\":null,\"youtubeVideo\":null,\"application\":null}]}" \
    "${BASE_URL}/api/admin/sessions"
expect_status 200
session="$(first_id)"
readonly TOKENS="${BASE_URL}/api/admin/sessions/${session}/ra-publication"

# token -- a new token for the session, as the admin of `cookie`.
token() {
    json POST "$TOKENS"
    expect_status 200
    body_field token
}

echo "  the token's endpoint requires a session"
request --request POST "$TOKENS"
expect_status 401

echo "  a token gives the session's event, as RA takes it, to RA's pages, and it's never kept"
token="$(token)"
request --header "Authorization: Bearer ${token}" --header 'Origin: https://fr.ra.co' "$URL"
expect_status 200
expect_body "^\\{\"ok\":true,\"environment\":\"[a-z]+\",\"session\":\"${session}\",\"event\":\\{\"title\":\"NUIT BRUME\",\"startTime\":\"2026-11-14T21:00:00.000\",\"endTime\":\"2026-11-15T01:00:00.000\",\"lineup\":\"Brume\",\"venueId\":\"288529\",\"promoterIds\":\\[\"183980\"\\],\"content\":\"Une nuit.\","
expect_body_contains '"playerLinks":[{"sourceId":"https://www.youtube.com/@parkingdotradio"},{"sourceId":"https://soundcloud.com/parkingdotradio"}],"submissionSource":"SUBMITEVENTPAGE"}}'
expect_header Access-Control-Allow-Origin 'https://fr\.ra\.co$'
expect_header Cache-Control 'no-store'
request --request OPTIONS --header 'Origin: https://fr.ra.co' --header 'Access-Control-Request-Method: GET' \
    --header 'Access-Control-Request-Headers: authorization' "$URL"
expect_status 204
expect_header Access-Control-Allow-Origin 'https://fr\.ra\.co$'
expect_header Access-Control-Allow-Headers 'Authorization$'
expect_header Access-Control-Allow-Methods 'GET$'

echo "  choosing a new password ends the admin's tokens"
create_admin "$EMAIL"
expect_output 'this link resets their password'
accept_invite "$(invite_token)" another-password
expect_status 200
request --header "Authorization: Bearer ${token}" "$URL"
expect_status 403
expect_header Cache-Control 'no-store'

echo "  so does revoking the admin"
cookie="$(session_of "$EMAIL" another-password)"
revoked="$(token)"
request --header "Authorization: Bearer ${revoked}" "$URL"
expect_status 200
cookie="$(session_of "$ADMIN_EMAIL" "$ADMIN_PASSWORD")"
json DELETE "${BASE_URL}/api/admin/admins/$(sql "select id from users where email = '${EMAIL}'")"
expect_status 200
request --header "Authorization: Bearer ${revoked}" "$URL"
expect_status 403

echo "  a token gives 404 once its session is deleted"
deleted="$(token)"
json DELETE "${BASE_URL}/api/admin/sessions/${session}"
expect_status 200
request --header "Authorization: Bearer ${deleted}" "$URL"
expect_status 404
json DELETE "${BASE_URL}/api/admin/artists/${brume}"
expect_status 200

echo "  the tokens are never logged"
for logged in "$token" "$revoked" "$deleted"; do
    if docker logs --since "$since" "$CONTAINER" 2>&1 | grep -qF "$logged"; then fail "the server logged a token"; fi
done
