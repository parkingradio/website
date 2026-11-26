#!/usr/bin/env bash
#
# When it starts, the server makes, in the background, the sizes that the photos and flyers it keeps don't have, and
# skips those it can't read, which it logs (see "Photos" in docs/design/server/artists.md, "Private files" in
# docs/deployment.md, and server/src/artists/backfill.ts, whose tests cover the rest).
#
# Numbered in the 9xx range: this restarts the server, which then listens on another port. It waits for the server to
# be up again, so that the checks after it can still stop it.

source "$(dirname "$0")/lib.sh"

readonly IP=198.51.100.35

readonly FILES="$(mktemp -d)"
trap 'rm -rf "$FILES"' EXIT

login "$IP" "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
expect_status 200
cookie="$(session_cookie)"

# An artist's photo that has lost a size, as photos sent before there were sizes have none.
make_image jpeg 2000 1000 > "${FILES}/photo.jpg"
request --header "Cookie: ${cookie}" --form-string 'artist={"name":"Rattrapage"}' --form "photo=@${FILES}/photo.jpg" \
    "${BASE_URL}/api/admin/artists"
expect_status 200
artist="$(body_id)"
key="$(sql "select photo_key from artists where id = '${artist}'")"
docker exec "$CONTAINER" rm "/tmp/private-bucket/${key}.w320.v2.webp"
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists/${artist}/photo?width=320"
expect_status 404
expect_body_contains '"error":"The photo of this artist has no size 320 pixels wide"'

# A session's flyer that can't be read, as one sent before photos were read could be, under the key made from its
# content.
request --header "Cookie: ${cookie}" --form-string \
    'session={"start":null,"durationMinutes":60,"type":"synth-meetup","takeover":null,"application":null,"name":"","raEvent":null,"description":""}' \
    "${BASE_URL}/api/admin/sessions"
expect_status 200
session="$(first_id)"
cut_short "${FILES}/photo.jpg" > "${FILES}/cut.jpg"
flyer="sessions/$(content_name "${FILES}/cut.jpg").jpg"
docker exec --interactive "$CONTAINER" sh -c "mkdir -p /tmp/private-bucket/sessions && cat > /tmp/private-bucket/${flyer}" < "${FILES}/cut.jpg"
sql "update sessions set flyer_key = '${flyer}', flyer_type = 'image/jpeg' where id = '${session}'" > /dev/null

echo "  once the server restarts, it makes the sizes that are missing"
since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker restart "$CONTAINER" > /dev/null
BASE_URL="http://$(docker port "$CONTAINER" 3000/tcp)"
wait_until 60 curl --silent --fail "${BASE_URL}/healthz" || fail "expected the server to be up again"
# logged <message> -- whether the server logged the message since it restarted.
logged() { docker logs --since "$since" "$CONTAINER" 2>&1 | grep -qF "$1"; }
wait_until 30 logged 'Made the missing sizes of photos and flyers' || fail "expected the missing sizes to be made"
logs="$(docker logs --since "$since" "$CONTAINER" 2>&1)"
login "$IP" "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
cookie="$(session_cookie)"
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists/${artist}/photo?width=320"
expect_status 200
expect_header Content-Type 'image/webp$'

echo "  it skips a flyer it can't read, and logs it, with what it's of"
printf '%s' "$logs" | grep "Can't make the sizes of a photo or flyer: it can't be read" |
    grep -q "\"of\":\"session\",\"id\":\"${session}\"" || { printf '%s\n' "$logs" >&2; fail "expected the flyer to be logged"; }
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/sessions/${session}/flyer?width=320"
expect_status 404
expect_body_contains '"error":"The flyer of this session has no size 320 pixels wide"'
# It can still be had as it was sent, and replaced.
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/sessions/${session}/flyer"
expect_status 200

json DELETE "${BASE_URL}/api/admin/sessions/${session}"
expect_status 200
json DELETE "${BASE_URL}/api/admin/artists/${artist}"
expect_status 200
