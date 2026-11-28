#!/usr/bin/env bash
#
# The radio's rotation of sets against a real database, with the stand-in for SoundCloud that .env.example has the server
# use (SOUNDCLOUD_STAND_IN), which accepts any credentials, and shows a track at any link to one, but gives no streams:
# - any credentials are saved
# - sets are given their tracks, private ones included
# - once its session is announced, a set can be added to the rotation, and its track read before it's added
# - the rotation is changed, its tracks read, the set whose track only has a preview skipped, and the other on air
# - what's on air never has a private link, and its streams can't be had
# The rules of the rotation are tested against a real database by the server's own tests (server/src/radio/*.db.test.ts).

source "$(dirname "$0")/lib.sh"

readonly IP=198.51.100.36
readonly SECRET='s-SeCrEt42'
readonly PRIVATE_TRACK="https://soundcloud.com/parkingdotradio/integration-rotation/${SECRET}"
readonly PREVIEW_TRACK='https://soundcloud.com/parkingdotradio/integration-rotation-preview'

login "$IP" "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
expect_status 200
cookie="$(session_cookie)"

echo "  any credentials of the SoundCloud app are saved"
json PUT "${BASE_URL}/api/admin/radio/credentials" '{"clientId":"stand-in","clientSecret":"stand-in"}'
expect_status 200
expect_body_contains "\"clientId\":\"stand-in\",\"updatedBy\":\"${ADMIN_EMAIL}\""

echo "  sets are given their tracks, private ones included"
request --header "Cookie: ${cookie}" --form-string 'artist={"name":"Rotor"}' "${BASE_URL}/api/admin/artists"
expect_status 200
rotor="$(body_id)"
set_json() {
    printf '{"performers":[{"id":"%s"}],"durationMinutes":60,"performanceTypes":["dj"],"otherPerformanceType":"","genres":[],"soundcloudTrack":"%s","youtubeVideo":"%s","application":null}' \
        "$rotor" "$1" "$2"
}
request --header "Cookie: ${cookie}" --form-string \
    "session={\"start\":\"2988-01-15T21:00-05:00\",\"durationMinutes\":120,\"type\":\"other\",\"takeover\":null,\"application\":null,\"name\":\"NUIT ROTATION\",\"raEvent\":null,\"description\":\"\",\"sets\":[$(set_json "$PRIVATE_TRACK" rOtAtIoN001),$(set_json "$PREVIEW_TRACK" rOtAtIoN002)]}" \
    "${BASE_URL}/api/admin/sessions"
expect_status 200
session="$(first_id)"
expect_body "\"soundcloudTrack\":\\{\"id\":\"[0-9]+\",\"url\":\"${PRIVATE_TRACK}\"\\}"
playable="$(sql "select id from sets where youtube_video_id = 'rOtAtIoN001'")"
preview="$(sql "select id from sets where youtube_video_id = 'rOtAtIoN002'")"

echo "  once its session is announced, a set can be added to the rotation, and its track read before it's added"
json PUT "${BASE_URL}/api/admin/sessions/${session}/announced" '{"announced":true}'
expect_status 200
json GET "${BASE_URL}/api/admin/radio/rotation/candidates"
expect_status 200
expect_body_contains "{\"id\":\"${playable}\","
expect_body_contains "{\"id\":\"${preview}\","
json GET "${BASE_URL}/api/admin/radio/rotation/candidates/${preview}"
expect_status 200
expect_body "^\\{\"ok\":true,\"set\":\\{\"id\":\"${preview}\",.*\"durationMs\":[0-9]+,\"readError\":null,\"skipped\":\\[\"preview\"\\]\\}\\}$"

echo "  the rotation is changed, its tracks read, the set whose track only has a preview skipped, and the other on air"
json PUT "${BASE_URL}/api/admin/radio/rotation" "{\"sets\":[\"${playable}\",\"${preview}\"]}"
expect_status 200
expect_body "\"current\":\\{\"setId\":\"${playable}\","
expect_body "\"durationMs\":[0-9]+,\"readError\":null,\"skipped\":\\[\\]"
expect_body_contains '"readError":null,"skipped":["preview"],"startsAt":null'

echo "  what's on air never has a private link, and its streams can't be had"
request "${BASE_URL}/api/on-air"
expect_status 200
expect_body "^\\{\"ok\":true,\"current\":\\{\"set\":\\{\"id\":\"${playable}\","
expect_body_contains '"upcoming":[]'
expect_body_lacks "$SECRET"
request "${BASE_URL}/api/radio/sets/${playable}/stream"
expect_status 502
request "${BASE_URL}/api/radio/sets/${preview}/stream"
expect_status 404
