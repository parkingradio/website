#!/usr/bin/env bash
#
# The public events, artists and collectives, in the server's Docker image: they're served without a session, once a
# session is announced, with its flyer, from where the server keeps it. What's public is tested against a real database
# by the server's own tests (server/src/events/public.db.test.ts).

source "$(dirname "$0")/lib.sh"

readonly IP=198.51.100.33

readonly FILES="$(mktemp -d)"
# The smallest file that starts like a JPEG image.
printf '\xff\xd8\xff\xe0JFIF' > "${FILES}/flyer.jpg"
trap 'rm -rf "$FILES"' EXIT

login "$IP" "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
expect_status 200
cookie="$(session_cookie)"

request --header "Cookie: ${cookie}" --form-string 'artist={"name":"Aube"}' "${BASE_URL}/api/admin/artists"
expect_status 200
aube="$(body_id)"
request --header "Cookie: ${cookie}" --form-string "collective={\"name\":\"Les Marées\",\"members\":[{\"id\":\"${aube}\"}],\"email\":\"marees@events.test\"}" \
    "${BASE_URL}/api/admin/collectives"
expect_status 200
marees="$(first_id)"
request --header "Cookie: ${cookie}" --form "flyer=@${FILES}/flyer.jpg" --form-string \
    "session={\"start\":\"2990-03-01T21:00-05:00\",\"durationMinutes\":120,\"type\":\"takeover\",\"takeover\":\"${marees}\",\"application\":null,\"name\":\"\",\"raEvent\":null,\"description\":\"\",\"sets\":[{\"performers\":[{\"id\":\"${aube}\"}],\"durationMinutes\":60,\"performanceTypes\":[\"dj\"],\"otherPerformanceType\":\"\",\"genres\":[],\"soundcloudTrack\":null,\"youtubeVideo\":null,\"application\":null}]}" \
    "${BASE_URL}/api/admin/sessions"
expect_status 200
session="$(first_id)"

echo "  a session that isn't announced, its artist and its collective aren't public"
for url in "/api/artists/${aube}" "/api/collectives/${marees}" "/api/events/${session}/flyer"; do
    request "${BASE_URL}${url}"
    expect_status 404
done
request "${BASE_URL}/api/events?from=2990-03-01T00:00-05:00&to=2990-03-02T00:00-05:00"
expect_status 200
expect_body '^\{"ok":true,"upcoming":\[\],"past":\[\]\}$'

echo "  once it's announced, they're served to anyone, its flyer included"
json PUT "${BASE_URL}/api/admin/sessions/${session}/announced" '{"announced":true}'
expect_status 200
request "${BASE_URL}/api/events?from=2990-03-01T00:00-05:00&to=2990-03-02T00:00-05:00"
expect_status 200
expect_body_contains "\"upcoming\":[{\"id\":\"${session}\",\"title\":\"LES MARÉES TAKEOVER\""
expect_body_contains "\"flyer\":\"/api/events/${session}/flyer\""
request "${BASE_URL}/api/artists/${aube}"
expect_status 200
expect_body "^\\{\"ok\":true,\"artist\":\\{\"id\":\"${aube}\",\"name\":\"Aube\","
request "${BASE_URL}/api/collectives/${marees}"
expect_status 200
expect_body_contains "\"members\":[{\"id\":\"${aube}\",\"name\":\"Aube\"}]"
expect_body_lacks 'marees@events.test'
curl --silent --output "${FILES}/served" "${BASE_URL}/api/events/${session}/flyer"
cmp --silent "${FILES}/flyer.jpg" "${FILES}/served" || fail "expected the flyer as it was sent"
