#!/usr/bin/env bash
#
# The admin routes for artists work against a real database. The server's unit tests mock the database and the
# photos, so this is what covers the artists table, emails being unique whatever their case, artists listed by name,
# the transaction that changes an artist, profiles read back from the database, and photos kept on disk, then deleted,
# or no photo at all. It also covers profiles that leave out what only admins can leave out, as the database keeps
# them, including any number of artists without an email.

source "$(dirname "$0")/lib.sh"

readonly IP=198.51.100.11
readonly NOBODY=00000000-0000-4000-8000-000000000000
readonly PROFILE='{"name":"DJ Test","country":"CA","city":"Québec","genres":["techno","acid"],
"bio":"Une bio.","links":{"soundcloud":"https://soundcloud.com/parkingdotradio/wobbla"},
"email":"artiste@integration.test","phone":"418 555-0123"}'

# The smallest files that start like a JPEG and a PNG image.
readonly PHOTOS="$(mktemp -d)"
trap 'rm -rf "$PHOTOS"' EXIT
printf '\xff\xd8\xff\xe0JFIF' > "${PHOTOS}/photo.jpg"
printf '\x89PNG\r\n\x1a\nIHDR' > "${PHOTOS}/photo.png"

login "$IP" "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
expect_status 200
cookie="$(session_cookie)"

# artist <method> <url> <profile> [<photo file>] -- add or change an artist.
artist() {
    local photo=()
    if [ -n "${4:-}" ]; then photo=(--form "photo=@$4"); fi
    request --header "Cookie: ${cookie}" --request "$1" --form-string "artist=$3" ${photo[@]+"${photo[@]}"} "$2"
}

echo "  artists can't be listed without a session"
request "${BASE_URL}/api/admin/artists"
expect_status 401

echo "  there are no artists yet"
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists"
expect_status 200
expect_body_contains '"total":0,"artists":[]'

echo "  an invalid profile is explained, in French"
artist POST "${BASE_URL}/api/admin/artists" '{"name":"DJ Test","country":"XX"}' "${PHOTOS}/photo.jpg"
expect_status 400
expect_body_contains 'Choisissez le pays.'

echo "  an artist is added, and read back as they were sent"
artist POST "${BASE_URL}/api/admin/artists" "$PROFILE" "${PHOTOS}/photo.jpg"
expect_status 200
id="$(body_id)"
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists/${id}"
expect_status 200
expect_body_contains '"genres":["techno","acid"]'
expect_body_contains '"links":{"soundcloud":"parkingdotradio"}'
expect_body_contains "\"createdBy\":\"${ADMIN_EMAIL}\""
expect_body_contains '"updatedBy":null'

echo "  their photo is served as it was sent, with the type it was checked to have"
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists/${id}/photo"
expect_status 200
expect_header Content-Type 'image/jpeg'
# BODY can't hold every byte, so the photo is downloaded again to compare it.
curl --silent --header "Cookie: ${cookie}" --output "${PHOTOS}/served" "${BASE_URL}/api/admin/artists/${id}/photo"
cmp --silent "${PHOTOS}/photo.jpg" "${PHOTOS}/served" || fail "expected the photo as it was sent"
[ "$(photos_on_disk)" = 1 ] || fail "expected the artist's photo on disk"

echo "  another artist can't have the same email, whatever its case, and the photo sent with it is deleted"
artist POST "${BASE_URL}/api/admin/artists" "${PROFILE/artiste@integration.test/ARTISTE@integration.test}" "${PHOTOS}/photo.png"
expect_status 409
[ "$(photos_on_disk)" = 1 ] || fail "expected the refused photo to be deleted"
other="${PROFILE/artiste@integration.test/other@integration.test}"
artist POST "${BASE_URL}/api/admin/artists" "${other/DJ Test/ana}" "${PHOTOS}/photo.png"
expect_status 200
artist PUT "${BASE_URL}/api/admin/artists/${id}" "${PROFILE/artiste@integration.test/Other@integration.test}"
expect_status 409

echo "  artists are listed by name, whatever its case"
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists"
expect_status 200
expect_body '"name":"ana".*"name":"DJ Test"'

echo "  an artist is changed, keeping their photo, then with another one, which replaces it"
artist PUT "${BASE_URL}/api/admin/artists/${id}" "${PROFILE/Une bio./Une nouvelle bio.}"
expect_status 200
expect_body_contains '"bio":"Une nouvelle bio."'
expect_body_contains "\"updatedBy\":\"${ADMIN_EMAIL}\""
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists/${id}/photo"
expect_header Content-Type 'image/jpeg'
artist PUT "${BASE_URL}/api/admin/artists/${id}" "$PROFILE" "${PHOTOS}/photo.png"
expect_status 200
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists/${id}/photo"
expect_header Content-Type 'image/png'
[ "$(photos_on_disk)" = 2 ] || fail "expected the replaced photo to be deleted"

echo "  some of an artist's fields are changed as JSON, keeping the others and their photo, or removing it"
json PATCH "${BASE_URL}/api/admin/artists/${id}" '{"bio":"Une bio changée.","phone":null}'
expect_status 200
expect_body_contains '"bio":"Une bio changée."'
expect_body_contains '"email":"artiste@integration.test","phone":""'
expect_body_contains '"links":{"soundcloud":"parkingdotradio"}'
expect_body_contains '"hasPhoto":true'
json PATCH "${BASE_URL}/api/admin/artists/${id}" '{"email":"OTHER@integration.test"}'
expect_status 409
json PATCH "${BASE_URL}/api/admin/artists/${id}" '{"bio":"x","hasPhoto":false}'
expect_status 400
expect_body_contains 'Unknown field: `hasPhoto`'
artist PUT "${BASE_URL}/api/admin/artists/${id}" "${PROFILE%\}},\"hasPhoto\":false}"
expect_status 400
expect_body_contains 'Unknown field: `hasPhoto`'
photos="$(photos_on_disk)"
json PATCH "${BASE_URL}/api/admin/artists/${id}" '{"removePhoto":true}'
expect_status 200
expect_body_contains '"bio":"Une bio changée."'
expect_body_contains '"hasPhoto":false'
[ "$(photos_on_disk)" = "$((photos - 1))" ] || fail "expected the removed photo to be deleted"

echo "  an artist is deleted, with their photo"
request --header "Cookie: ${cookie}" --request DELETE "${BASE_URL}/api/admin/artists/${id}"
expect_status 200
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists/${id}"
expect_status 404
[ "$(photos_on_disk)" = 1 ] || fail "expected the deleted artist's photo to be deleted"

echo "  an artist is added without a photo, given one, then has it removed"
photos="$(photos_on_disk)"
photoless="${PROFILE/artiste@integration.test/nophoto@integration.test}"
artist POST "${BASE_URL}/api/admin/artists" "$photoless"
expect_status 200
expect_body_contains '"hasPhoto":false'
id="$(body_id)"
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists/${id}/photo"
expect_status 404
expect_body_contains 'This artist has no photo'
artist PUT "${BASE_URL}/api/admin/artists/${id}" "$photoless" "${PHOTOS}/photo.png"
expect_status 200
expect_body_contains '"hasPhoto":true'
[ "$(photos_on_disk)" = "$((photos + 1))" ] || fail "expected the artist's new photo on disk"
request --header "Cookie: ${cookie}" --request PUT --form-string "artist=${photoless}" \
    --form-string 'removePhoto=true' "${BASE_URL}/api/admin/artists/${id}"
expect_status 200
expect_body_contains '"hasPhoto":false'
[ "$(photos_on_disk)" = "$photos" ] || fail "expected the removed photo to be deleted"
request --header "Cookie: ${cookie}" --request DELETE "${BASE_URL}/api/admin/artists/${id}"
expect_status 200

echo "  an artist is added without a country, city, genres, bio, links, email or phone, and read back that way"
readonly PARTIAL='{"name":"DJ Partiel","country":"","city":"","genres":[],"bio":"","links":{},
"email":"","phone":""}'
artist POST "${BASE_URL}/api/admin/artists" "$PARTIAL"
expect_status 200
id="$(body_id)"
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists/${id}"
expect_status 200
expect_body_contains '"country":"","city":"","genres":[],"bio":"","links":{},"email":null,"phone":""'

echo "  another artist can be without an email too"
artist POST "${BASE_URL}/api/admin/artists" '{"name":"DJ Anonyme"}'
expect_status 200
expect_body_contains '"email":null'
anonymous="$(body_id)"

echo "  an artist's email is taken out, which frees it for another artist"
artist POST "${BASE_URL}/api/admin/artists" "${PROFILE/artiste@integration.test/libre@integration.test}"
expect_status 200
freed="$(body_id)"
artist PUT "${BASE_URL}/api/admin/artists/${freed}" "${PROFILE/\"artiste@integration.test\"/null}"
expect_status 200
expect_body_contains '"email":null'
artist POST "${BASE_URL}/api/admin/artists" "${PROFILE/artiste@integration.test/LIBRE@integration.test}"
expect_status 200
expect_body_contains '"email":"LIBRE@integration.test"'
taker="$(body_id)"
for removed in "$id" "$anonymous" "$freed" "$taker"; do
    request --header "Cookie: ${cookie}" --request DELETE "${BASE_URL}/api/admin/artists/${removed}"
    expect_status 200
done

echo "  an artist that doesn't exist can't be viewed, changed or deleted"
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists/${NOBODY}"
expect_status 404
# Postgres refuses to look up an id that isn't a UUID, which mustn't fail differently.
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists/not-a-uuid"
expect_status 404
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists/not-a-uuid/photo"
expect_status 404
artist PUT "${BASE_URL}/api/admin/artists/not-a-uuid" "$PROFILE"
expect_status 404
request --header "Cookie: ${cookie}" --request DELETE "${BASE_URL}/api/admin/artists/not-a-uuid"
expect_status 404
artist PUT "${BASE_URL}/api/admin/artists/${NOBODY}" "$PROFILE"
expect_status 404
request --header "Cookie: ${cookie}" --request DELETE "${BASE_URL}/api/admin/artists/${NOBODY}"
expect_status 404
