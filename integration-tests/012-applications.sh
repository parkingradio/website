#!/usr/bin/env bash
#
# The admin routes for applications work with a real database. The server's unit tests fake the database, so this is
# where we check:
# - the applications migration
# - that dates come back from the database as "YYYY-MM-DD"
# - that an application can only belong to an artist who exists
# - that applications are listed newest first
# - that deleting an artist deletes their applications
# - the applications_settings migration, and that who applications are emailed to is saved, and replaced

source "$(dirname "$0")/lib.sh"

readonly IP=198.51.100.12
readonly NOBODY=00000000-0000-4000-8000-000000000000

readonly PHOTO="$(mktemp)"
trap 'rm -f "$PHOTO"' EXIT
printf '\xff\xd8\xff\xe0JFIF' > "$PHOTO"

login "$IP" "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
expect_status 200
cookie="$(session_cookie)"

# json <method> <url> [<body>] -- send a request with a JSON body.
json() {
    local body=()
    if [ -n "${3:-}" ]; then body=(--header 'Content-Type: application/json' --data "$3"); fi
    request --header "Cookie: ${cookie}" --request "$1" ${body[@]+"${body[@]}"} "$2"
}

# application <artist id> [<details>] -- an application for that artist, as JSON.
application() {
    printf '{"artistId":"%s","dates":["2027-01-15","2020-02-29"],"timeSlots":[{"start":"18:00","end":"22:00"}],"prestations":["dj"],"otherPrestation":"","details":"%s"}' \
        "$1" "${2:-}"
}

# The artist who applies.
request --header "Cookie: ${cookie}" --form-string 'artist={"kind":"artist","name":"Candidate","members":[],"country":"CA",
"city":"Montréal","genres":["house"],"bio":"Une bio.","links":{"instagram":"@candidate"},
"email":"candidate@integration.test","phone":"514 555-0123"}' --form "photo=@${PHOTO}" "${BASE_URL}/api/admin/artists"
expect_status 200
artist="$(body_id)"

echo "  applications can't be listed without a session"
request "${BASE_URL}/api/admin/applications"
expect_status 401

echo "  an application can only be created for an artist that exists"
json POST "${BASE_URL}/api/admin/applications" "$(application "$NOBODY")"
expect_status 400
expect_body_contains 'No such artist'
json POST "${BASE_URL}/api/admin/applications" "$(application not-a-uuid)"
expect_status 400
expect_body_contains 'No such artist'

echo "  an invalid application is explained, in French"
json POST "${BASE_URL}/api/admin/applications" "{\"artistId\":\"${artist}\",\"dates\":[]}"
expect_status 400
expect_body_contains 'Choisis au moins une date.'

echo "  an application is created, and read back as it was sent, with its dates as days, in order"
json POST "${BASE_URL}/api/admin/applications" "$(application "$artist" first)"
expect_status 200
first="$(body_id)"
json GET "${BASE_URL}/api/admin/applications/${first}"
expect_status 200
expect_body_contains "\"artistId\":\"${artist}\""
expect_body_contains '"dates":["2020-02-29","2027-01-15"]'
# jsonb doesn't keep the order of keys, so a time slot's keys can come back in either order.
expect_body '"timeSlots":\[\{("start":"18:00","end":"22:00"|"end":"22:00","start":"18:00")\}\],"prestations":\["dj"\],"otherPrestation":"","details":"first"'
expect_body_contains "\"createdBy\":\"${ADMIN_EMAIL}\""
expect_body_contains '"status":"new"'

echo "  applications are listed newest first, and by artist"
json POST "${BASE_URL}/api/admin/applications" "$(application "$artist" second)"
expect_status 200
second="$(body_id)"
json GET "${BASE_URL}/api/admin/applications"
expect_status 200
expect_body "\"id\":\"${second}\".*\"id\":\"${first}\""
json GET "${BASE_URL}/api/admin/applications?artist=${artist}"
expect_body "\"id\":\"${second}\".*\"id\":\"${first}\""
json GET "${BASE_URL}/api/admin/applications?artist=${NOBODY}"
expect_body_contains '"applications":[]'
json GET "${BASE_URL}/api/admin/applications?artist=not-a-uuid"
expect_body_contains '"applications":[]'

echo "  an application is changed, and its status too"
json PUT "${BASE_URL}/api/admin/applications/${first}" \
    '{"dates":["2026-12-10"],"timeSlots":[],"prestations":["full-band","live-performance"],"otherPrestation":"Synthé modulaire","details":""}'
expect_status 200
expect_body_contains '"dates":["2026-12-10"],"timeSlots":[],"prestations":["live-performance","full-band"],"otherPrestation":"Synthé modulaire"'
expect_body_contains "\"updatedBy\":\"${ADMIN_EMAIL}\""
json PUT "${BASE_URL}/api/admin/applications/${first}/status" '{"status":"accepted"}'
expect_status 200
expect_body_contains '"status":"accepted"'
expect_body_contains "\"statusUpdatedBy\":\"${ADMIN_EMAIL}\""
json PUT "${BASE_URL}/api/admin/applications/${first}/status" '{"status":"maybe"}'
expect_status 400

echo "  an application is deleted"
json DELETE "${BASE_URL}/api/admin/applications/${first}"
expect_status 200
json GET "${BASE_URL}/api/admin/applications/${first}"
expect_status 404

echo "  an application that doesn't exist can't be viewed, changed or deleted"
for id in "$NOBODY" not-a-uuid; do
    json GET "${BASE_URL}/api/admin/applications/${id}"
    expect_status 404
    json PUT "${BASE_URL}/api/admin/applications/${id}" "$(application "$artist")"
    expect_status 404
    json PUT "${BASE_URL}/api/admin/applications/${id}/status" '{"status":"accepted"}'
    expect_status 404
    json DELETE "${BASE_URL}/api/admin/applications/${id}"
    expect_status 404
done

echo "  deleting an artist deletes their applications"
json DELETE "${BASE_URL}/api/admin/artists/${artist}"
expect_status 200
json GET "${BASE_URL}/api/admin/applications/${second}"
expect_status 404

echo "  nobody gets applications by email until they're chosen, and they're saved, then replaced"
readonly RECIPIENTS="${BASE_URL}/api/admin/applications/recipients"
request "$RECIPIENTS"
expect_status 401
json GET "$RECIPIENTS"
expect_status 200
expect_body_contains '"recipients":[],"updatedBy":null,"updatedAt":null'
json PUT "$RECIPIENTS" '{"recipients":["equipe@integration.test"," Equipe@Integration.test ",""]}'
expect_status 200
expect_body_contains "\"recipients\":[\"equipe@integration.test\"],\"updatedBy\":\"${ADMIN_EMAIL}\""
json PUT "$RECIPIENTS" '{"recipients":["booking@integration.test","equipe@integration.test"]}'
expect_status 200
json GET "$RECIPIENTS"
expect_status 200
expect_body_contains "\"recipients\":[\"booking@integration.test\",\"equipe@integration.test\"],\"updatedBy\":\"${ADMIN_EMAIL}\""
json PUT "$RECIPIENTS" '{"recipients":["pas une adresse"]}'
expect_status 400
expect_body_contains 'Not an email address: pas une adresse'
