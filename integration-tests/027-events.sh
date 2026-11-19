#!/usr/bin/env bash
#
# The public events, artists and collectives, in the server's Docker image: they're served without a session, once a
# session is announced, with its flyer, at one of its sizes, and the calendar feed has it. What's public is tested against
# a real database by the server's own tests (server/src/events/public.db.test.ts), the feed itself by
# server/src/events/calendar.test.ts, and the sizes of flyers by 028-photo-sizes.sh.

source "$(dirname "$0")/lib.sh"

readonly IP=198.51.100.33

readonly FILES="$(mktemp -d)"
trap 'rm -rf "$FILES"' EXIT
make_image jpeg 200 100 > "${FILES}/flyer.jpg"

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
request "${BASE_URL}/calendar.ics"
expect_status 200
expect_body_lacks "UID:${session}@parking.radio"

echo "  once it's announced, they're served to anyone, its flyer included"
json PUT "${BASE_URL}/api/admin/sessions/${session}/announced" '{"announced":true}'
expect_status 200
request "${BASE_URL}/api/events?from=2990-03-01T00:00-05:00&to=2990-03-02T00:00-05:00"
expect_status 200
expect_body_contains "\"upcoming\":[{\"id\":\"${session}\",\"title\":\"LES MARÉES TAKEOVER\""
expect_body_contains "\"flyer\":\"/api/events/${session}/flyer\""
expect_body_contains "\"lineup\":[{\"id\":\"${aube}\",\"name\":\"Aube\"}]"
request "${BASE_URL}/api/artists/${aube}"
expect_status 200
expect_body "^\\{\"ok\":true,\"artist\":\\{\"id\":\"${aube}\",\"name\":\"Aube\","
request "${BASE_URL}/api/collectives/${marees}"
expect_status 200
expect_body_contains "\"members\":[{\"id\":\"${aube}\",\"name\":\"Aube\"}]"
expect_body_lacks 'marees@events.test'
curl --silent --output "${FILES}/served" "${BASE_URL}/api/events/${session}/flyer"
[ "$(image_format "${FILES}/served")" = 'webp 100x200' ] || fail "expected the flyer's size, upright, as WebP"

echo "  the calendar feed has it, as iCalendar, which can be kept for 5 minutes"
request "${BASE_URL}/calendar.ics"
expect_status 200
expect_header 'Content-Type' 'text/calendar; charset=utf-8$'
expect_header 'Cache-Control' 'public, max-age=300$'
expect_body $'^BEGIN:VCALENDAR\r$'
expect_body_contains $'X-WR-CALNAME:Parking Radio\r'
expect_body_contains $'UID:'"${session}"$'@parking.radio\r'
expect_body $'^SUMMARY:LES MARÉES TAKEOVER\r$'
