#!/usr/bin/env bash
#
# The admin routes for applications work with a real database. The server's unit tests fake the database, so this is
# where we check:
# - the applications table, and that the database takes every status
# - that dates come back from the database as "YYYY-MM-DD"
# - that an application belongs to either an artist or a collective who exists, which the database checks too
# - that applications are listed by when they were received, the most recent first, and that an application was received
#   when it was created unless an admin said otherwise
# - applications listed by artist or by collective
# - that deleting an artist deletes their applications, but not those of their collectives, and that deleting a
#   collective deletes its applications
# - the applications_settings table, and that who applications are emailed to is saved, and replaced

source "$(dirname "$0")/lib.sh"

readonly IP=198.51.100.12
readonly NOBODY=00000000-0000-4000-8000-000000000000

readonly PHOTO="$(mktemp)"
trap 'rm -f "$PHOTO"' EXIT
printf '\xff\xd8\xff\xe0JFIF' > "$PHOTO"

login "$IP" "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
expect_status 200
cookie="$(session_cookie)"

# application <artist id> [<details>] [<more JSON fields>] -- an application for that artist, as JSON.
application() {
    printf '{"artistId":"%s","dates":["2027-01-15","2020-02-29"],"timeSlots":[{"start":"18:00","end":"22:00"}],"performanceTypes":["dj"],"otherPerformanceType":"","details":"%s"%s}' \
        "$1" "${2:-}" "${3:+,$3}"
}

# fields [<details>] [<more JSON fields>] -- an application's fields, as JSON, as changing it sends them, without its
# artist.
fields() {
    application "" "$@" | sed 's/^{"artistId":"",/{/'
}

# application_of <collective id> [<more JSON fields>] -- an application for that collective, as JSON.
application_of() {
    printf '{"collectiveId":"%s","dates":["2027-02-01"],"timeSlots":[],"performanceTypes":["full-band"],"otherPerformanceType":"","details":""%s}' \
        "$1" "${2:+,$2}"
}

# The artist who applies.
request --header "Cookie: ${cookie}" --form-string 'artist={"name":"Candidate","country":"CA",
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
expect_body_contains 'Choisissez au moins une date.'

echo "  an application is created, and read back as it was sent, with its dates as days, in order"
json POST "${BASE_URL}/api/admin/applications" "$(application "$artist" first)"
expect_status 200
first="$(body_id)"
json GET "${BASE_URL}/api/admin/applications/${first}"
expect_status 200
expect_body_contains "\"artistId\":\"${artist}\""
expect_body_contains '"dates":["2020-02-29","2027-01-15"]'
# jsonb doesn't keep the order of keys, so a time slot's keys can come back in either order.
expect_body '"timeSlots":\[\{("start":"18:00","end":"22:00"|"end":"22:00","start":"18:00")\}\],"performanceTypes":\["dj"\],"otherPerformanceType":"","details":"first"'
expect_body_contains "\"createdBy\":\"${ADMIN_EMAIL}\""
expect_body_contains '"status":"new"'
[ "$(body_field receivedAt)" = "$(body_field createdAt)" ] || { _show_body; fail "expected the application to be received when it was created"; }

echo "  an application is created with when it was received, which can't be in the future"
json POST "${BASE_URL}/api/admin/applications" "$(application "$artist" third '"receivedAt":"2026-03-28T10:03:00-04:00"')"
expect_status 200
third="$(body_id)"
json GET "${BASE_URL}/api/admin/applications/${third}"
expect_body_contains '"receivedAt":"2026-03-28T10:03:00-04:00"'
json POST "${BASE_URL}/api/admin/applications" "$(application "$artist" future '"receivedAt":"2099-01-01T00:00:00-05:00"')"
expect_status 400
expect_body_contains 'La date de réception ne peut pas être dans le futur.'

echo "  when an application was received is in Québec time, with Québec's offset then"
for receivedAt in 2026-03-28T14:03:00Z 2026-03-28T10:03-05:00 2026-03-08T02:30-05:00; do
    json POST "${BASE_URL}/api/admin/applications" "$(application "$artist" offset "\"receivedAt\":\"${receivedAt}\"")"
    expect_status 400
    expect_body_contains 'La date de réception doit être une date et une heure du Québec'
done

echo "  applications are listed by when they were received, the most recent first, and by artist"
json POST "${BASE_URL}/api/admin/applications" "$(application "$artist" second)"
expect_status 200
second="$(body_id)"
json GET "${BASE_URL}/api/admin/applications"
expect_status 200
# The third was created before the second, but received long before.
expect_body "\"id\":\"${second}\".*\"id\":\"${first}\".*\"id\":\"${third}\""
json GET "${BASE_URL}/api/admin/applications?artist=${artist}"
expect_body "\"id\":\"${second}\".*\"id\":\"${first}\".*\"id\":\"${third}\""
json GET "${BASE_URL}/api/admin/applications?artist=${NOBODY}"
expect_body_contains '"applications":[]'
json GET "${BASE_URL}/api/admin/applications?artist=not-a-uuid"
expect_body_contains '"applications":[]'

echo "  an application is changed, and its status too"
json PUT "${BASE_URL}/api/admin/applications/${first}" \
    '{"dates":["2026-12-10"],"timeSlots":[],"performanceTypes":["full-band","live-performance"],"otherPerformanceType":"Synthé modulaire","details":""}'
expect_status 200
expect_body_contains '"dates":["2026-12-10"],"timeSlots":[],"performanceTypes":["live-performance","full-band"],"otherPerformanceType":"Synthé modulaire"'
expect_body_contains "\"updatedBy\":\"${ADMIN_EMAIL}\""
json PUT "${BASE_URL}/api/admin/applications/${third}" "$(fields changed '"receivedAt":"2026-03-27T00:00-04:00"')"
expect_status 200
expect_body_contains '"receivedAt":"2026-03-27T00:00:00-04:00"'
json PUT "${BASE_URL}/api/admin/applications/${third}" "$(fields 'changed again')"
expect_status 200
expect_body_contains '"receivedAt":"2026-03-27T00:00:00-04:00"'
json PATCH "${BASE_URL}/api/admin/applications/${third}" '{"details":"changed once more"}'
expect_status 200
expect_body_contains '"dates":["2020-02-29","2027-01-15"]'
expect_body_contains '"details":"changed once more"'
expect_body_contains '"receivedAt":"2026-03-27T00:00:00-04:00"'
json PUT "${BASE_URL}/api/admin/applications/${third}" "$(application "$artist")"
expect_status 400
expect_body_contains '"error":"Unknown field: `artistId`"'
for status in accepted scheduled done rejected new; do
    json PUT "${BASE_URL}/api/admin/applications/${first}/status" "{\"status\":\"${status}\"}"
    expect_status 200
    expect_body_contains "\"status\":\"${status}\""
done
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
    json PUT "${BASE_URL}/api/admin/applications/${id}" "$(fields)"
    expect_status 404
    json PATCH "${BASE_URL}/api/admin/applications/${id}" '{"details":""}'
    expect_status 404
    json PUT "${BASE_URL}/api/admin/applications/${id}/status" '{"status":"accepted"}'
    expect_status 404
    json DELETE "${BASE_URL}/api/admin/applications/${id}"
    expect_status 404
done

echo "  an application is created for a collective, which has to exist, rather than for an artist"
request --header "Cookie: ${cookie}" --form-string "collective={\"name\":\"Les Candidats\",\"members\":[{\"id\":\"${artist}\"}],
\"email\":\"collectif@integration.test\"}" "${BASE_URL}/api/admin/collectives"
expect_status 200
collective="$(first_id)"
json POST "${BASE_URL}/api/admin/applications" "$(application_of "$collective")"
expect_status 200
theirs="$(body_id)"
expect_body_contains "\"artistId\":null,\"collectiveId\":\"${collective}\""
for id in "$NOBODY" not-a-uuid "$artist"; do
    json POST "${BASE_URL}/api/admin/applications" "$(application_of "$id")"
    expect_status 400
    expect_body_contains 'No such collective'
done
json POST "${BASE_URL}/api/admin/applications" "$(application_of "$collective" "\"artistId\":\"${artist}\"")"
expect_status 400
expect_body_contains 'An application belongs to either an artist or a collective'

echo "  the database refuses an application with neither an artist nor a collective, or both"
neither="insert into applications (dates, time_slots, performance_types, other_performance_type, details)
    values ('{2027-01-15}', '[]', '{}', '', '')"
both="update applications set artist_id = '${artist}' where id = '${theirs}'"
# Through a file rather than $(...), where the ERR trap would report the query failing, which is what's expected.
readonly REFUSED="$(mktemp)"
trap 'rm -f "$PHOTO" "$REFUSED"' EXIT
for query in "$neither" "$both"; do
    status=0
    sql "$query" >"$REFUSED" 2>&1 || status=$?
    [ "$status" != 0 ] || fail "expected the database to refuse: ${query}"
    grep -q applications_owner "$REFUSED" || fail "expected applications_owner to refuse: ${query}, but got: $(cat "$REFUSED")"
done

echo "  applications are listed by collective, and its applications aren't its artists'"
json GET "${BASE_URL}/api/admin/applications?collective=${collective}"
expect_status 200
[ "$(printf '%s' "$BODY" | grep -o '"id":"[^"]*"' | cut -d'"' -f4 | tr '\n' ' ')" = "${theirs} " ] || { _show_body; fail "expected only the collective's application"; }
json GET "${BASE_URL}/api/admin/applications?artist=${artist}"
if printf '%s' "$BODY" | grep -Fq "$theirs"; then fail "expected the collective's application not to be the artist's"; fi
json GET "${BASE_URL}/api/admin/applications?collective=${NOBODY}"
expect_body_contains '"applications":[]'
json GET "${BASE_URL}/api/admin/applications?artist=${artist}&collective=${collective}"
expect_status 400

echo "  deleting an artist deletes their applications, but not those of their collectives"
json DELETE "${BASE_URL}/api/admin/artists/${artist}"
expect_status 200
json GET "${BASE_URL}/api/admin/applications/${second}"
expect_status 404
json GET "${BASE_URL}/api/admin/applications/${theirs}"
expect_status 200

echo "  deleting a collective deletes its applications"
json DELETE "${BASE_URL}/api/admin/collectives/${collective}"
expect_status 200
json GET "${BASE_URL}/api/admin/applications/${theirs}"
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
expect_body_contains "Recipient 1 isn't an email address"
