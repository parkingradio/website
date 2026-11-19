#!/usr/bin/env bash
#
# The sizes of photos and flyers, made in the server's Docker image, i.e. by sharp as it's installed there (see "Photos"
# in docs/design/server/artists.md): JPEG, PNG and WebP images are served as WebP, 320 and 1280 pixels wide, upright,
# without their metadata, kept next to the image they're made from, and deleted with it. What they look like is tested
# by server/src/artists/sizes.test.ts, and who sees them by server/src/events/public.db.test.ts.

source "$(dirname "$0")/lib.sh"

readonly IP=198.51.100.34

readonly FILES="$(mktemp -d)"
trap 'rm -rf "$FILES"' EXIT

login "$IP" "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
expect_status 200
cookie="$(session_cookie)"

# expect_size <url> <format and size> -- expect the image at the URL, asked for with `cookie`, to be that, as
# `image_format` prints it, without the EXIF that `make_image` plants.
expect_size() {
    curl --silent --fail --header "Cookie: ${cookie}" --output "${FILES}/size" "$1" || fail "expected $1 to be served"
    [ "$(image_format "${FILES}/size")" = "$2" ] || fail "expected $1 to be $2, not $(image_format "${FILES}/size")"
    if grep -q PLANTED "${FILES}/size"; then fail "expected $1 to be without the EXIF of the image it's made from"; fi
}

echo "  a photo of each type is served to admins as it was sent, or at its sizes, as WebP, upright, without its EXIF"
artists="$(photos_on_disk artists)"
for type in jpeg png webp; do
    make_image "$type" 2000 1000 > "${FILES}/photo.${type}"
    grep -q PLANTED-MAKE "${FILES}/photo.${type}" || fail "expected the ${type} image to have its EXIF"
    request --header "Cookie: ${cookie}" --form-string "artist={\"name\":\"Taille ${type}\"}" \
        --form "photo=@${FILES}/photo.${type}" "${BASE_URL}/api/admin/artists"
    expect_status 200
    id="$(body_id)"
    photo="${BASE_URL}/api/admin/artists/${id}/photo"

    curl --silent --header "Cookie: ${cookie}" --output "${FILES}/sent" "$photo"
    cmp --silent "${FILES}/photo.${type}" "${FILES}/sent" || fail "expected the ${type} photo as it was sent"

    request --header "Cookie: ${cookie}" "${photo}?width=320&v=1"
    expect_status 200
    expect_header Content-Type 'image/webp$'
    expect_header Cache-Control 'private, no-cache$'
    expect_size "${photo}?width=320" 'webp 320x640'
    expect_size "${photo}?width=1280" 'webp 1000x2000'
    [ "$(photos_on_disk artists)" = $((artists + 3)) ] || fail "expected the ${type} photo's two sizes to be kept"

    json DELETE "${BASE_URL}/api/admin/artists/${id}"
    expect_status 200
    [ "$(photos_on_disk artists)" = "$artists" ] || fail "expected the ${type} photo's sizes to be deleted with it"
done

echo "  other widths are refused"
request --header "Cookie: ${cookie}" --form-string 'artist={"name":"Taille refusée"}' \
    --form "photo=@${FILES}/photo.png" "${BASE_URL}/api/admin/artists"
expect_status 200
id="$(body_id)"
for query in 'width=640' 'width=' 'width=320&width=320'; do
    request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists/${id}/photo?${query}"
    expect_status 400
    expect_body_contains '"error":"`width` must be 320 or 1280."'
done
json DELETE "${BASE_URL}/api/admin/artists/${id}"
expect_status 200

echo "  an announced session's flyer is only ever served to the public at its sizes, which browsers keep for 5 minutes"
sessions="$(photos_on_disk sessions)"
make_image png 800 600 > "${FILES}/flyer.png"
request --header "Cookie: ${cookie}" --form "flyer=@${FILES}/flyer.png" --form-string \
    'session={"start":"2991-03-01T21:00-05:00","durationMinutes":120,"type":"synth-meetup","takeover":null,"application":null,"name":"","raEvent":null,"description":""}' \
    "${BASE_URL}/api/admin/sessions"
expect_status 200
session="$(first_id)"
json PUT "${BASE_URL}/api/admin/sessions/${session}/announced" '{"announced":true}'
expect_status 200
flyer="${BASE_URL}/api/events/${session}/flyer"
request "$flyer"
expect_status 200
expect_header Content-Type 'image/webp$'
expect_header Cache-Control 'private, max-age=300$'
etag="$(header_value ETag)"
expect_size "$flyer" 'webp 600x800'
expect_size "${flyer}?width=1280" 'webp 600x800'
expect_size "${flyer}?width=320" 'webp 320x427'
request --header "If-None-Match: ${etag}" "$flyer"
expect_status 304
expect_header Cache-Control 'private, max-age=300$'
[ "$(photos_on_disk sessions)" = $((sessions + 3)) ] || fail "expected the flyer's two sizes to be kept"

echo "  replacing the flyer deletes the one it replaces, with its sizes, and so does deleting the session"
request --header "Cookie: ${cookie}" --request PUT --form "flyer=@${FILES}/photo.jpeg" \
    "${BASE_URL}/api/admin/sessions/${session}/flyer"
expect_status 200
[ "$(photos_on_disk sessions)" = $((sessions + 1)) ] || fail "expected the replaced flyer's sizes to be deleted"
request --header "If-None-Match: ${etag}" "$flyer"
expect_status 200
expect_size "$flyer" 'webp 1000x2000'
json DELETE "${BASE_URL}/api/admin/sessions/${session}"
expect_status 200
[ "$(photos_on_disk sessions)" = "$sessions" ] || fail "expected the flyer's sizes to be deleted with the session"
