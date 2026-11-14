#!/usr/bin/env bash
#
# The admin routes for sessions and sets work against a real database, in the server's Docker image. The server's unit
# tests fake the database, and its property-based tests (server/src/sessions/rules.db.test.ts) only check that the rules
# of sessions hold after random requests, so this is what covers the sessions, sets and set_performers tables: performers
# kept in order, with their names, types and takeovers, and the names they give, which follow their collective's, the
# checks that take the database (artists and collectives that exist), starts kept as instants and sets placed relative to
# them, sessions listed those without a start first, then the most recent first, by artist, by takeover and by when they
# start, the rules of sessions (sessions don't overlap, a video or a track in at most one set, a cancelled session only
# has cancelled sets, and a takeover has a collective, which can't be deleted), with what's in the way in their 409s,
# including while other transactions change sessions, sets that don't fit in their session or overlap each other, which
# they say, a set's own track not being resolved again, what deleting an artist does to sets, and making a session a
# collective's takeover, or changing a set, while that collective, or one of its performers, is deleted, the applications
# sets and sessions come from, which applications list, their rules, and deleting them, even while a set is given one,
# and the content of a session's event on RA, from its sets' performers.
#
# These tests can't reach SoundCloud, so they only check what happens to a track's link before it's resolved.

source "$(dirname "$0")/lib.sh"

readonly IP=198.51.100.30
readonly NOBODY=00000000-0000-4000-8000-000000000000

readonly FILES="$(mktemp -d)"
# The smallest files that start like a JPEG and a PNG image, and one that's neither.
printf '\xff\xd8\xff\xe0JFIF' > "${FILES}/flyer.jpg"
printf '\x89PNG\r\n\x1a\nIHDR' > "${FILES}/flyer.png"
printf '%%PDF-1.7' > "${FILES}/flyer.pdf"
trap 'rm -rf "$FILES"' EXIT

login "$IP" "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
expect_status 200
cookie="$(session_cookie)"

readonly SESSIONS="${BASE_URL}/api/admin/sessions"
readonly SETS="${BASE_URL}/api/admin/sets"
readonly ARTISTS="${BASE_URL}/api/admin/artists"
readonly COLLECTIVES="${BASE_URL}/api/admin/collectives"

# performers <id>... -- a set's performers, as JSON, from their ids.
#
# Writing them out where the set is sent wouldn't do: macOS's bash expands the braces of "[{...},{...}]" in a command
# substitution within double quotes.
performers() {
    local id list=""
    for id in "$@"; do
        list="${list:+${list},}{\"id\":\"${id}\"}"
    done
    printf '[%s]' "$list"
}

# session_json <start> <duration> [<more JSON fields>] -- a session, as JSON, starting at <start>, as JSON (e.g. a quoted
# date and time, or null), of guest mixes, with a name of its own, without a takeover, an application, an RA event or a
# description unless they're given (the last of two fields with the same name is the one that counts).
session_json() {
    printf '{"start":%s,"durationMinutes":%s,"type":"guest-mixes","takeover":null,"application":null,"name":"HAUTE RIVE TAKEOVER","raEvent":null,"description":""%s}' \
        "$1" "$2" "${3:+,$3}"
}

# session_form <method> <url> <session JSON> [<curl args>...] -- add or change a session, as the admin, as
# multipart/form-data, with its fields as JSON in the "session" part, and the other parts given, e.g. its flyer.
session_form() {
    local method="$1" url="$2" fields="$3"
    shift 3
    request --header "Cookie: ${cookie}" --request "$method" --form-string "session=${fields}" "$@" "$url"
}

# collective_json <name> -- the profile of the collective Les Ondes, as JSON, with that name, and Ana as its artist.
collective_json() {
    printf '{"name":"%s","members":[{"id":"%s"}],"email":"ondes@sessions.test"}' "$1" "$ana"
}

# set_json <performers JSON> <offset> <duration> [<more JSON fields>] -- a set, as JSON, without links or an application
# unless they're given.
set_json() {
    printf '{"performers":%s,"offsetMinutes":%s,"durationMinutes":%s,"performanceTypes":["dj"],"otherPerformanceType":"","genres":[],"soundcloudTrack":null,"youtubeVideo":null,"application":null%s}' \
        "$1" "$2" "$3" "${4:+,$4}"
}

# session_ids -- the ids of the sessions in the body of the last request, in order, on one line.
session_ids() {
    printf '%s' "$BODY" | grep -o '{"id":"[^"]*","start"' | cut -d'"' -f4 | tr '\n' ' '
}

# set_ids -- the ids of the sets in the body of the last request, in order, on one line.
set_ids() {
    printf '%s' "$BODY" | grep -o '{"id":"[^"]*","performers"' | cut -d'"' -f4 | tr '\n' ' '
}

# expect_place <set id> <fits> [<set id>...] -- expect the body of the last request to have that set, saying whether it
# fits in its session (true or false), and that it overlaps the other sets given, in order, and no others.
expect_place() {
    local id="$1" fits="$2" overlapping="" other
    shift 2
    for other in "$@"; do
        overlapping="${overlapping:+${overlapping},}\"${other}\""
    done
    expect_body "\\{\"id\":\"${id}\",\"performers\":\\[[^]]*\\],[^{]*\"fitsInSession\":${fits},\"overlappingSets\":\\[${overlapping}\\]"
}

# last_set -- the id of the set that was added last.
last_set() {
    sql "select id from sets order by created_at desc limit 1"
}

# expect_conflict <error> <session id> [<set id>] -- expect the last request to have failed with 409, with that session,
# and that set, or none, in the way.
expect_conflict() {
    expect_status 409
    expect_body_contains "\"error\":\"$1\",\"session\":{\"id\":\"$2\",\"start\""
    if [ -n "${3:-}" ]; then
        expect_body_contains "\"set\":{\"id\":\"$3\",\"performers\""
    else
        expect_body '"set":null}$'
    fi
}

# hold_sessions_lock <statements> -- run the statements in a transaction that takes the lock the server takes before it
# changes sessions or sets (SESSIONS_LOCK in server/src/sessions/store.ts), and that's only committed once
# release_sessions_lock is called, since it then waits for a lock that a gate holds until then. Returns once the
# transaction waits for the gate.
hold_sessions_lock() {
    docker exec --env PGAPPNAME=gate "$PG" psql --quiet --username parking_radio --dbname parking_radio --command \
        "select pg_advisory_lock(4242); select pg_sleep(30);" >/dev/null 2>&1 &
    wait_for_sql "select exists (select from pg_stat_activity where application_name = 'gate' and wait_event = 'PgSleep')"
    docker exec --env PGAPPNAME=holder "$PG" psql --quiet --username parking_radio --dbname parking_radio --command \
        "begin; select pg_advisory_xact_lock($((0x5e55))); $1 select pg_advisory_lock(4242); commit;" >/dev/null 2>&1 &
    wait_for_sql "select exists (select from pg_stat_activity where application_name = 'holder' and wait_event = 'advisory')"
}

# wait_for_sessions_lock [<count>] -- wait for that many requests (one by default) to wait for the lock that
# hold_sessions_lock holds.
wait_for_sessions_lock() {
    wait_for_sql "select count(*) = ${1:-1} from pg_stat_activity where wait_event = 'advisory' and query ilike 'select pg_advisory_xact_lock%'"
}

# release_sessions_lock -- let the transaction of hold_sessions_lock be committed.
release_sessions_lock() {
    sql "select pg_cancel_backend(pid) from pg_stat_activity where application_name = 'gate'" >/dev/null
}

# send_in_background <method> <url> <JSON> [<suffix>] -- send a request with a JSON body, as the admin, without waiting
# for its response, which wait_for_background then waits for. Its status and body are in ${FILES}/status and
# ${FILES}/body, or ${FILES}/status-<suffix> and ${FILES}/body-<suffix> with a suffix.
send_in_background() {
    local body=(--header 'Content-Type: application/json' --data "$3")
    # Sessions are added and changed as multipart/form-data, with their fields as JSON (see session_form).
    if [[ "$2" =~ /api/admin/sessions(/[^/]+)?$ ]]; then body=(--form-string "session=$3"); fi
    curl --silent --output "${FILES}/body${4:+-$4}" --write-out '%{http_code}' --header "Cookie: ${cookie}" --request "$1" \
        "${body[@]}" "$2" > "${FILES}/status${4:+-$4}" &
}

# delete_in_background <url> <name> -- delete what's at the URL, as the admin, without waiting for the response, whose
# status is then in ${FILES}/<name>.
delete_in_background() {
    curl --silent --output /dev/null --write-out '%{http_code}' --header "Cookie: ${cookie}" --request DELETE "$1" > "${FILES}/$2" &
}

# wait_for_background -- wait for every request sent in the background, then take the response of the one that
# send_in_background sent as the last request's, for the expect_* helpers.
wait_for_background() {
    wait
    STATUS="$(cat "${FILES}/status" 2>/dev/null || true)"
    BODY="$(cat "${FILES}/body" 2>/dev/null || true)"
}

echo "  sessions can't be listed without a session"
request "$SESSIONS"
expect_status 401

echo "  there are no sessions yet"
json GET "$SESSIONS"
expect_status 200
expect_body_contains '"total":0,"sessions":[]'

request --header "Cookie: ${cookie}" --form-string 'artist={"name":"Ana"}' "$ARTISTS"
ana="$(first_id)"
request --header "Cookie: ${cookie}" --form-string 'artist={"name":"Brume"}' "$ARTISTS"
brume="$(first_id)"
request --header "Cookie: ${cookie}" --form-string "collective=$(collective_json 'Les Ondes')" "$COLLECTIVES"
expect_status 200
ondes="$(first_id)"

echo "  an invalid session is explained, including one with the NUL character"
session_form POST "$SESSIONS" "$(session_json '"2026-11-14T21:00-05:00"' 0)"
expect_status 400
expect_body_contains '"error":"The duration must be a whole number of minutes, from 1 to 1440"'
# Postgres can't keep it.
session_form POST "$SESSIONS" "$(session_json '"2026-11-14T21:00-05:00"' 240 '"name":"HAUTE\u0000RIVE"')"
expect_status 400
expect_body_contains '"error":"Text can'"'"'t contain the NUL character"'
session_form POST "$SESSIONS" "$(session_json '"2026-11-14T21:00-05:00"' 240 '"raEvent":"https://ra.co/events/6683745\u0000"')"
expect_status 400

echo "  a session is added, as planned, without sets, and read back with its takeover, its start and end in Québec time and its RA event reduced"
session_form POST "$SESSIONS" "$(session_json '"2026-11-14T21:00-05:00"' 240 "\"type\":\"takeover\",\"takeover\":\"${ondes}\",\"raEvent\":\"https://ra.co/events/6683745\"")"
expect_status 200
first="$(first_id)"
json GET "${SESSIONS}/${first}"
expect_status 200
expect_body_contains "\"start\":\"2026-11-14T21:00:00-05:00\",\"end\":\"2026-11-15T01:00:00-05:00\",\"durationMinutes\":240,\"type\":\"takeover\",\"takeover\":{\"id\":\"${ondes}\",\"name\":\"Les Ondes\"}"
expect_body_contains '"name":"HAUTE RIVE TAKEOVER","title":"HAUTE RIVE TAKEOVER","raEvent":{"id":"6683745","url":"https://ra.co/events/6683745"},"description":"","effectiveDescription":"LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC","hasFlyer":false,"sets":[]'
expect_body_contains "\"createdBy\":\"${ADMIN_EMAIL}\",\"updatedBy\":null,\"updatedAt\":null,\"status\":\"planned\",\"statusUpdatedBy\":null"

echo "  a session is called by its own name, or else the one its type gives it, from its collective's name as it is then"
session_form POST "$SESSIONS" "$(session_json null 60 "\"type\":\"takeover\",\"takeover\":\"${ondes}\",\"name\":\"\"")"
expect_status 200
named="$(first_id)"
expect_body_contains "\"type\":\"takeover\",\"takeover\":{\"id\":\"${ondes}\",\"name\":\"Les Ondes\"},\"application\":null,\"name\":\"\",\"title\":\"LES ONDES TAKEOVER\""
request --header "Cookie: ${cookie}" --request PUT --form-string "collective=$(collective_json 'Les Ondes Côtières')" "${COLLECTIVES}/${ondes}"
expect_status 200
json GET "${SESSIONS}/${named}"
expect_body_contains '"name":"","title":"LES ONDES CÔTIÈRES TAKEOVER"'
expect_body_contains '"updatedBy":null,"updatedAt":null'
request --header "Cookie: ${cookie}" --request PUT --form-string "collective=$(collective_json 'Les Ondes')" "${COLLECTIVES}/${ondes}"
expect_status 200
for type in guest-mixes:GUEST\ MIXES live-performance:LIVE\ PERFORMANCE synth-meetup:SYNTH\ MEETUPS; do
    session_form PUT "${SESSIONS}/${named}" "$(session_json null 60 "\"type\":\"${type%%:*}\",\"name\":\"\"")"
    expect_status 200
    expect_body_contains "\"type\":\"${type%%:*}\",\"takeover\":null,\"application\":null,\"name\":\"\",\"title\":\"${type#*:}\""
done
session_form PUT "${SESSIONS}/${named}" "$(session_json null 60 '"type":"other","name":"ATELIER DE DJing POUR FEMMES"')"
expect_status 200
expect_body_contains '"type":"other","takeover":null,"application":null,"name":"ATELIER DE DJing POUR FEMMES","title":"ATELIER DE DJing POUR FEMMES"'
json DELETE "${SESSIONS}/${named}"
expect_status 200

echo "  a session has its own description, or else the one its type gives it, with its line breaks, and none for other"
session_form POST "$SESSIONS" "$(session_json null 60 '"type":"synth-meetup","description":" \r\nUne  soirée.\r\n\r\nSPÉCIALE "')"
expect_status 200
described="$(first_id)"
expect_body_contains '"description":"Une  soirée.\n\nSPÉCIALE","effectiveDescription":"Une  soirée.\n\nSPÉCIALE"'
[ "$(sql "select description from sessions where id = '${described}'" | head -1)" = 'Une  soirée.' ] || fail "expected the description to be kept"
session_form PUT "${SESSIONS}/${described}" "$(session_json null 60 '"type":"synth-meetup"')"
expect_body_contains '"description":"","effectiveDescription":"SYNTH MEETUPS\n\nRencontres hebdomadaires de création sonore et audiovisuelle'
session_form PUT "${SESSIONS}/${described}" "$(session_json null 60 '"type":"other"')"
expect_body_contains '"description":"","effectiveDescription":"","hasFlyer":false'
session_form PUT "${SESSIONS}/${described}" "$(session_json null 60 "\"description\":\"$(printf 'x%.0s' $(seq 1 5001))\"")"
expect_status 400
expect_body_contains '"error":"The description must be text, up to 5000 characters"'
session_form PUT "${SESSIONS}/${described}" "$(session_json null 60 '"description":"Une\u0000soirée"')"
expect_status 400
expect_body_contains '"error":"Text can'"'"'t contain the NUL character"'

echo "  a session's flyer is checked, kept, served, replaced, removed, and deleted with it"
session_form PUT "${SESSIONS}/${described}" "$(session_json null 60)" --form "flyer=@${FILES}/flyer.pdf"
expect_status 400
expect_body_contains '"error":"The flyer must be a JPEG, PNG or WebP image"'
[ "$(photos_on_disk sessions)" = 0 ] || fail "expected no flyer on disk"
session_form PUT "${SESSIONS}/${described}" "$(session_json null 60)" --form "flyer=@${FILES}/flyer.jpg"
expect_status 200
expect_body_contains '"hasFlyer":true'
expect_body_contains "\"updatedBy\":\"${ADMIN_EMAIL}\""
[ "$(photos_on_disk sessions)" = 1 ] || fail "expected the session's flyer on disk"
request --header "Cookie: ${cookie}" "${SESSIONS}/${described}/flyer"
expect_status 200
expect_header Content-Type 'image/jpeg'
expect_header X-Content-Type-Options 'nosniff'
expect_header Cache-Control 'private, no-cache'
expect_header ETag '"[^"]+"'
# A browser that has the flyer gets a 304 without it, with the same ETag, compared as text rather than as a regex.
etag_of_response() { printf '%s\n' "$HEADERS" | sed -n 's/^[Ee][Tt][Aa][Gg]: *//p'; }
etag="$(etag_of_response)"
request --header "Cookie: ${cookie}" --header "If-None-Match: ${etag}" "${SESSIONS}/${described}/flyer"
expect_status 304
[ -z "$BODY" ] || fail "expected no flyer with the 304"
[ "$(etag_of_response)" = "$etag" ] || fail "expected the 304 to have the flyer's ETag"
curl --silent --header "Cookie: ${cookie}" --output "${FILES}/served" "${SESSIONS}/${described}/flyer"
cmp --silent "${FILES}/flyer.jpg" "${FILES}/served" || fail "expected the flyer as it was sent"
# A flyer sent with a session that isn't saved is deleted: one that would overlap the first session, or a takeover of a
# collective that doesn't exist.
session_form POST "$SESSIONS" "$(session_json '"2026-11-14T22:00-05:00"' 60)" --form "flyer=@${FILES}/flyer.png"
expect_status 409
session_form POST "$SESSIONS" "$(session_json null 60 "\"type\":\"takeover\",\"takeover\":\"${NOBODY}\"")" --form "flyer=@${FILES}/flyer.png"
expect_status 400
[ "$(photos_on_disk sessions)" = 1 ] || fail "expected the flyers of the sessions that weren't saved to be deleted"
# Without a flyer, the session keeps its own.
session_form PUT "${SESSIONS}/${described}" "$(session_json null 60)"
expect_body_contains '"hasFlyer":true'
session_form PUT "${SESSIONS}/${described}" "$(session_json null 60)" --form "flyer=@${FILES}/flyer.png" --form-string removeFlyer=true
expect_status 400
session_form PUT "${SESSIONS}/${described}" "$(session_json null 60)" --form "flyer=@${FILES}/flyer.png"
expect_status 200
[ "$(photos_on_disk sessions)" = 1 ] || fail "expected the replaced flyer to be deleted"
request --header "Cookie: ${cookie}" "${SESSIONS}/${described}/flyer"
expect_header Content-Type 'image/png'
session_form PUT "${SESSIONS}/${described}" "$(session_json null 60)" --form-string removeFlyer=true
expect_body_contains '"hasFlyer":false'
[ "$(photos_on_disk sessions)" = 0 ] || fail "expected the removed flyer to be deleted"
request --header "Cookie: ${cookie}" "${SESSIONS}/${described}/flyer"
expect_status 404
expect_body_contains '"error":"This session has no flyer"'
session_form PUT "${SESSIONS}/${described}" "$(session_json null 60)" --form "flyer=@${FILES}/flyer.png"
[ "$(photos_on_disk sessions)" = 1 ] || fail "expected the session's flyer on disk"
json DELETE "${SESSIONS}/${described}"
expect_status 200
[ "$(photos_on_disk sessions)" = 0 ] || fail "expected the deleted session's flyer to be deleted"

echo "  only takeovers have a collective, and they need one, a session of type other needs a name, and nothing is saved otherwise"
for fields in '"type":"takeovers"' '"type":"takeover"' "\"takeover\":\"${ondes}\"" "\"type\":\"other\",\"takeover\":\"${ondes}\"" '"type":"other","name":" "'; do
    session_form POST "$SESSIONS" "$(session_json '"2027-01-01T16:00-05:00"' 60 "$fields")"
    expect_status 400
done
session_form POST "$SESSIONS" "$(session_json '"2027-01-01T16:00-05:00"' 60 '"type":"takeover"')"
expect_body_contains '"error":"A takeover has a collective"'
session_form POST "$SESSIONS" "$(session_json '"2027-01-01T16:00-05:00"' 60 "\"takeover\":\"${ondes}\"")"
expect_body_contains '"error":"Only a takeover has a collective"'
session_form POST "$SESSIONS" "$(session_json '"2027-01-01T16:00-05:00"' 60 '"type":"other","name":""')"
expect_body_contains '"error":"A session of type other has a name"'

echo "  a takeover has to be a collective that exists, and nothing is saved otherwise"
for takeover in "$NOBODY" not-a-uuid "$ana"; do
    session_form POST "$SESSIONS" "$(session_json '"2027-01-01T16:00-05:00"' 60 "\"type\":\"takeover\",\"takeover\":\"${takeover}\"")"
    expect_status 400
    expect_body_contains '"error":"No such collective"'
done
json GET "$SESSIONS"
[ "$(session_ids)" = "${first} " ] || { _show_body; fail "expected only the first session"; }

echo "  sessions can't overlap, when they're added or changed, but one can start when another ends, and the 409 names the other"
session_form POST "$SESSIONS" "$(session_json '"2026-11-15T00:00-05:00"' 60)"
expect_conflict 'Another session overlaps this one' "$first"
session_form POST "$SESSIONS" "$(session_json '"2026-11-15T01:00-05:00"' 60)"
expect_status 200
next="$(first_id)"
session_form PUT "${SESSIONS}/${next}" "$(session_json '"2026-11-15T00:30-05:00"' 60)"
expect_conflict 'Another session overlaps this one' "$first"
json GET "${SESSIONS}/${next}"
expect_body_contains '"start":"2026-11-15T01:00:00-05:00","end":"2026-11-15T02:00:00-05:00"'
# Changing its duration alone, the session it would be, with its start, is checked.
json PATCH "${SESSIONS}/${first}" '{"durationMinutes":300}'
expect_conflict 'Another session overlaps this one' "$next"

echo "  a session's fields are taken as JSON in their own part, which can't have other fields, unlike the request"
session_form PUT "${SESSIONS}/${next}" "$(session_json '"2026-11-15T01:00-05:00"' 60 '"title":"X"')"
expect_status 400
expect_body_contains '"error":"Unknown field: `title`"'
session_form PUT "${SESSIONS}/${next}" "$(session_json '"2026-11-15T01:00-05:00"' 60)" --form-string 'submit=enregistrer'
expect_status 200

echo "  a session lasts the minutes that actually pass, for the database too, e.g. the night the clocks go back"
# From midnight, for 4 hours: the clocks then say 3:00, an hour behind.
session_form POST "$SESSIONS" "$(session_json '"2026-11-01T00:00-04:00"' 240)"
expect_status 200
night="$(first_id)"
expect_body_contains '"start":"2026-11-01T00:00:00-04:00","end":"2026-11-01T03:00:00-05:00"'
session_form POST "$SESSIONS" "$(session_json '"2026-11-01T02:59-05:00"' 60)"
expect_conflict 'Another session overlaps this one' "$night"
session_form POST "$SESSIONS" "$(session_json '"2026-11-01T03:00-05:00"' 60)"
expect_status 200
dawn="$(first_id)"
for session in "$night" "$dawn"; do
    json DELETE "${SESSIONS}/${session}"
    expect_status 200
done

echo "  sessions without a start don't overlap anything, until they're given one"
session_form POST "$SESSIONS" "$(session_json null 240 "\"type\":\"takeover\",\"takeover\":\"${ondes}\"")"
expect_status 200
canned="$(first_id)"
expect_body_contains '"start":null,"end":null,"durationMinutes":240'
session_form POST "$SESSIONS" "$(session_json '""' 240)"
expect_status 200
other_canned="$(first_id)"
expect_body_contains '"start":null,"end":null'
session_form PUT "${SESSIONS}/${canned}" "$(session_json '"2026-11-14T20:00-05:00"' 240 "\"type\":\"takeover\",\"takeover\":\"${ondes}\"")"
expect_conflict 'Another session overlaps this one' "$first"
json GET "${SESSIONS}/${canned}"
expect_body_contains '"start":null'

echo "  a set is added to a session, as planned, with its performers in order, and placed in it"
json POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$brume" "$ana")" 0 60 \
    '"performanceTypes":["live-performance","dj","dj"],"otherPerformanceType":" Synthé \n modulaire ","genres":["ambient","techno","ambient"],"youtubeVideo":"https://youtu.be/dQw4w9WgXcQ?si=x"')"
expect_status 200
opening="$(last_set)"
expect_body_contains "\"id\":\"${first}\",\"start\":\"2026-11-14T21:00:00-05:00\""
expect_body_contains "{\"id\":\"${opening}\",\"performers\":[{\"id\":\"${brume}\",\"name\":\"Brume\"},{\"id\":\"${ana}\",\"name\":\"Ana\"}]"
expect_body_contains '"offsetMinutes":0,"durationMinutes":60,"start":"2026-11-14T21:00:00-05:00","end":"2026-11-14T22:00:00-05:00"'
expect_body_contains '"performanceTypes":["dj","live-performance"],"otherPerformanceType":"Synthé modulaire","genres":["ambient","techno"],"soundcloudTrack":null'
expect_body_contains '"youtubeVideo":{"id":"dQw4w9WgXcQ","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
expect_body_contains "\"createdBy\":\"${ADMIN_EMAIL}\",\"updatedBy\":null,\"updatedAt\":null,\"status\":\"planned\""

echo "  the content of a session's event on RA has its title, its times in Québec time, and its sets' performers"
json GET "${SESSIONS}/${first}/ra-event"
expect_status 200
expect_body_contains '"event":{"title":"HAUTE RIVE TAKEOVER","start":"2026-11-14T21:00:00-05:00","end":"2026-11-15T01:00:00-05:00","lineup":"Brume\nAna","venueId":"288529","promoterIds":["183980"]'

echo "  performers have to be artists who exist, a set's session has to exist, and nothing is saved otherwise"
for performer in "$NOBODY" not-a-uuid "$ondes"; do
    json POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$brume" "$performer")" 120 60)"
    expect_status 400
    expect_body_contains '"error":"No such artist"'
done
for session in "$NOBODY" not-a-uuid; do
    json POST "${SESSIONS}/${session}/sets" "$(set_json "$(performers "$ana")" 120 60)"
    expect_status 404
    expect_body_contains '"error":"No such session"'
done
json GET "${SESSIONS}/${first}"
[ "$(set_ids)" = "${opening} " ] || { _show_body; fail "expected only the opening set"; }

echo "  a set doesn't have to fit in its session, with or without an offset, which it says, and one without a duration fits"
json POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$ana")" 200 60)"
expect_status 200
expect_place "$(last_set)" false
json DELETE "${SETS}/$(last_set)"
expect_status 200
json POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$ana")" null 241)"
expect_status 200
expect_place "$(last_set)" false
json DELETE "${SETS}/$(last_set)"
expect_status 200
json POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$ana")" null 240)"
expect_status 200
whenever="$(last_set)"
expect_place "$whenever" true
json POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$ana")" null null)"
expect_status 200
unplaced="$(last_set)"
expect_body_contains "{\"id\":\"${unplaced}\",\"performers\":[{\"id\":\"${ana}\",\"name\":\"Ana\"}],\"offsetMinutes\":null,\"durationMinutes\":null,\"start\":null,\"end\":null"

echo "  a session's sets can overlap each other, when they're added or changed, which they say, but one can start when another ends"
json POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$ana")" 30 60)"
expect_status 200
across="$(last_set)"
expect_place "$opening" true "$across"
expect_place "$across" true "$opening"
json PUT "${SETS}/${across}" "$(set_json "$(performers "$ana")" 60 60)"
expect_status 200
expect_place "$opening" true
expect_place "$across" true
json PUT "${SETS}/${across}" "$(set_json "$(performers "$ana")" 59 60)"
expect_status 200
expect_place "$across" true "$opening"
json DELETE "${SETS}/${across}"
expect_status 200
json POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$ana")" 60 60)"
expect_status 200
second="$(last_set)"
json GET "${SESSIONS}/${first}"
# By offset, those without one last, in the order they were added.
[ "$(set_ids)" = "${opening} ${second} ${whenever} ${unplaced} " ] || { _show_body; fail "expected the sets by offset"; }
expect_body_contains "{\"id\":\"${second}\",\"performers\":[{\"id\":\"${ana}\",\"name\":\"Ana\"}],\"offsetMinutes\":60,\"durationMinutes\":60"

echo "  but the sets of two sessions can be at the same offsets"
json POST "${SESSIONS}/${next}/sets" "$(set_json "$(performers "$brume")" 0 60)"
expect_status 200
later="$(last_set)"

echo "  a cancelled set isn't among the sets the others overlap, but says which ones it would overlap"
json PUT "${SETS}/${opening}/status" '{"status":"cancelled"}'
expect_status 200
expect_body_contains "\"status\":\"cancelled\",\"statusUpdatedBy\":\"${ADMIN_EMAIL}\""
json POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$brume")" 0 30)"
expect_status 200
instead="$(last_set)"
expect_place "$instead" true
expect_place "$opening" true "$instead"
json PUT "${SETS}/${opening}/status" '{"status":"planned"}'
expect_status 200
expect_place "$instead" true "$opening"
json DELETE "${SETS}/${instead}"
expect_status 200
json PUT "${SETS}/${opening}/status" '{"status":"done"}'
expect_status 200

echo "  a session can be shortened so that its sets don't fit in it anymore, which they say, cancelled ones included"
json PUT "${SETS}/${second}/status" '{"status":"cancelled"}'
expect_status 200
session_form PUT "${SESSIONS}/${first}" "$(session_json '"2026-11-14T21:00-05:00"' 119 "\"type\":\"takeover\",\"takeover\":\"${ondes}\"")"
expect_status 200
expect_body_contains '"durationMinutes":119'
expect_place "$opening" true
expect_place "$second" false
expect_place "$whenever" false
json PUT "${SETS}/${second}/status" '{"status":"planned"}'
expect_status 200
json DELETE "${SETS}/${whenever}"
expect_status 200

echo "  moving a session moves its sets, which doesn't count as changing them, and so does taking its start away"
session_form PUT "${SESSIONS}/${first}" "$(session_json '"2026-11-21T21:00-05:00"' 120 "\"type\":\"takeover\",\"takeover\":\"${ondes}\",\"raEvent\":\"6683745\"")"
expect_status 200
expect_body_contains "\"start\":\"2026-11-21T21:00:00-05:00\",\"end\":\"2026-11-21T23:00:00-05:00\",\"durationMinutes\":120"
expect_body_contains "{\"id\":\"${second}\",\"performers\":[{\"id\":\"${ana}\",\"name\":\"Ana\"}],\"offsetMinutes\":60,\"durationMinutes\":60,\"start\":\"2026-11-21T22:00:00-05:00\",\"end\":\"2026-11-21T23:00:00-05:00\""
expect_body_contains "\"updatedBy\":\"${ADMIN_EMAIL}\""
[ "$(sql "select count(*) from sets where session_id = '${first}' and updated_by is not null")" = 0 ] || fail "expected the sets not to be changed"
session_form PUT "${SESSIONS}/${first}" "$(session_json null 120 "\"type\":\"takeover\",\"takeover\":\"${ondes}\",\"raEvent\":\"6683745\"")"
expect_status 200
expect_body_contains "{\"id\":\"${second}\",\"performers\":[{\"id\":\"${ana}\",\"name\":\"Ana\"}],\"offsetMinutes\":60,\"durationMinutes\":60,\"start\":null,\"end\":null"
session_form PUT "${SESSIONS}/${first}" "$(session_json '"2026-11-14T21:00-05:00"' 240 "\"type\":\"takeover\",\"takeover\":\"${ondes}\",\"raEvent\":\"6683745\"")"
expect_status 200

echo "  cancelling a session cancels its sets, done ones included, but not the other way around"
json PUT "${SESSIONS}/${first}/status" '{"status":"cancelled"}'
expect_status 200
expect_body_contains "\"status\":\"cancelled\",\"statusUpdatedBy\":\"${ADMIN_EMAIL}\""
[ "$(sql "select count(*) from sets where session_id = '${first}' and (status <> 'cancelled' or status_updated_by <> '${ADMIN_EMAIL}' or updated_by is not null)")" = 0 ] \
    || fail "expected every set of the session to be cancelled, as the admin, without being changed"
echo "  and while it's cancelled, its sets can be changed, but not un-cancelled, and none can be added"
json POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$ana")" 180 60)"
expect_conflict 'This session is cancelled' "$first"
json PUT "${SETS}/${second}/status" '{"status":"planned"}'
expect_conflict 'This session is cancelled' "$first"
json PUT "${SETS}/${second}/status" '{"status":"cancelled"}'
expect_status 200
json PUT "${SETS}/${second}" "$(set_json "$(performers "$ana" "$brume")" 60 60)"
expect_status 200
echo "  un-cancelling a session leaves its sets cancelled, to be un-cancelled one by one"
json PUT "${SESSIONS}/${first}/status" '{"status":"planned"}'
expect_status 200
[ "$(sql "select count(*) from sets where session_id = '${first}' and status <> 'cancelled'")" = 0 ] || fail "expected the sets to stay cancelled"
for set in "$opening" "$second"; do
    json PUT "${SETS}/${set}/status" '{"status":"planned"}'
    expect_status 200
done

echo "  a session can't be un-cancelled when it would overlap another one"
json PUT "${SESSIONS}/${next}/status" '{"status":"cancelled"}'
expect_status 200
session_form POST "$SESSIONS" "$(session_json '"2026-11-15T01:30-05:00"' 60)"
expect_status 200
replacement="$(first_id)"
json PUT "${SESSIONS}/${next}/status" '{"status":"planned"}'
expect_conflict 'Another session overlaps this one' "$replacement"
json GET "${SESSIONS}/${next}"
expect_body_contains '"status":"cancelled"'

echo "  sessions without a start come first, the most recently added first, then the others, the most recent first"
json GET "$SESSIONS"
[ "$(session_ids)" = "${other_canned} ${canned} ${replacement} ${next} ${first} " ] || { _show_body; fail "expected the sessions in order"; }

echo "  sessions are listed by the artists who played their sets, with all of their sets, and by takeover"
json GET "${SESSIONS}?artist=${brume}"
[ "$(session_ids)" = "${next} ${first} " ] || { _show_body; fail "expected the sessions where Brume played"; }
json GET "${SESSIONS}?artist=${ana}"
[ "$(session_ids)" = "${first} " ] || { _show_body; fail "expected the session where Ana played"; }
[ "$(set_ids)" = "${opening} ${second} ${unplaced} " ] || { _show_body; fail "expected every set of the session"; }
json GET "${SESSIONS}?takeover=${ondes}"
[ "$(session_ids)" = "${canned} ${first} " ] || { _show_body; fail "expected Les Ondes' takeovers"; }
for query in "artist=${NOBODY}" artist=not-a-uuid "artist=${ondes}" "takeover=${brume}" "takeover=${NOBODY}" takeover=not-a-uuid; do
    json GET "${SESSIONS}?${query}"
    expect_status 200
    expect_body_contains '"sessions":[]'
done
for query in "artist=${ana}&artist=${brume}" "takeover=${ondes}&takeover=${ondes}" "artist=${ana}&takeover=${ondes}"; do
    json GET "${SESSIONS}?${query}"
    expect_status 400
done

echo "  sessions are listed by when they start, from \`from\`, included, to \`to\`, excluded, by artist and by takeover too"
# A week when the clocks go back, from Monday at midnight, before, to the next Monday at midnight, after.
week=(2026-10-26T00:00-04:00 2026-11-02T00:00-05:00)
dated=()
for start in "${week[0]}" 2026-10-31T21:00-04:00 "${week[1]}"; do
    session_form POST "$SESSIONS" "$(session_json "\"${start}\"" 60)"
    expect_status 200
    dated+=("$(first_id)")
done
json GET "${SESSIONS}?from=${week[0]}&to=${week[1]}"
expect_body_contains '"total":2,"sessions":['
[ "$(session_ids)" = "${dated[1]} ${dated[0]} " ] || { _show_body; fail "expected the sessions of the week"; }
json GET "${SESSIONS}?from=2026-10-26T01:00-04:00&to=2026-11-02T00:01-05:00"
[ "$(session_ids)" = "${dated[2]} ${dated[1]} " ] || { _show_body; fail "expected the sessions from an hour later"; }
json GET "${SESSIONS}?to=2026-11-14T21:00-05:00"
[ "$(session_ids)" = "${dated[2]} ${dated[1]} ${dated[0]} " ] || { _show_body; fail "expected the sessions before the first one"; }
json GET "${SESSIONS}?from=2026-11-14T21:00-05:00"
expect_body_contains '"total":3,"sessions":['
[ "$(session_ids)" = "${replacement} ${next} ${first} " ] || { _show_body; fail "expected the sessions from the first one on"; }
json GET "${SESSIONS}?takeover=${ondes}&from=2026-11-01T00:00-04:00"
[ "$(session_ids)" = "${first} " ] || { _show_body; fail "expected Les Ondes' takeovers with a start"; }
json GET "${SESSIONS}?artist=${brume}&to=2026-11-15T01:00-05:00"
[ "$(session_ids)" = "${first} " ] || { _show_body; fail "expected the sessions where Brume played, before the next one"; }
for query in "from=${week[1]}&to=${week[0]}" "from=${week[0]}&to=${week[0]}" from= from=2026-10-26 to=1999-12-31T18:59-05:00; do
    json GET "${SESSIONS}?${query}"
    expect_status 400
done

echo "  instants are sent in Québec time, with Québec's offset then"
# Midnight on Monday, October 26 is -04:00, and the same instant in UTC, or with -05:00, is another instant, refused all
# the same. So is 2:30 on March 14, 2027, which the clocks skip.
for query in from=2026-10-26T04:00Z from=2026-10-26T05:00%2B01:00 from=2026-10-26T00:00-05:00 to=2027-03-14T02:30-05:00; do
    json GET "${SESSIONS}?${query}"
    expect_status 400
    expect_body_contains 'must be a single date and time in Québec time, with the offset from UTC in effect then (-05:00, or -04:00 from the second Sunday of March at 2:00 to the first Sunday of November at 2:00)'
done
for start in '"2026-11-14T21:00Z"' '"2026-11-14T21:00-04:00"' '"2027-03-14T02:30-04:00"'; do
    session_form POST "$SESSIONS" "$(session_json "$start" 60)"
    expect_status 400
    expect_body_contains '"error":"The start must be a date and time in Québec time, with the offset from UTC in effect then'
done
for session in "${dated[@]}"; do
    json DELETE "${SESSIONS}/${session}"
    expect_status 200
done

echo "  a video belongs to at most one set, and the 409 names it and its session"
json POST "${SESSIONS}/${replacement}/sets" "$(set_json "$(performers "$ana")" null null '"youtubeVideo":"dQw4w9WgXcQ"')"
expect_conflict "This YouTube video is another set's" "$first" "$opening"

echo "  a SoundCloud link has to be on soundcloud.com, and can't be resolved until the SoundCloud app's credentials are entered"
json PUT "${SETS}/${later}" "$(set_json "$(performers "$brume")" 0 60 '"soundcloudTrack":"https://on.soundcloud.com/AbCdE"')"
expect_status 400
expect_body_contains 'must be a link to it on soundcloud.com'
json PUT "${SETS}/${later}" "$(set_json "$(performers "$brume")" 0 60 '"soundcloudTrack":"https://soundcloud.com/parkingdotradio/3tons"')"
expect_status 409
expect_body_contains '"error":"The credentials of the SoundCloud app have not been entered yet","session":null,"set":null'

echo "  but a set's own track isn't resolved again, so the set can be changed without SoundCloud"
sql "update sets set soundcloud_track_id = '42', soundcloud_track_url = 'https://soundcloud.com/parkingdotradio/3tons' where id = '${later}'" >/dev/null
json PUT "${SETS}/${later}" "$(set_json "$(performers "$brume" "$ana")" 0 60 '"soundcloudTrack":"https://soundcloud.com/parkingdotradio/3tons?si=abc"')"
expect_status 200
expect_body_contains '"soundcloudTrack":{"id":"42","url":"https://soundcloud.com/parkingdotradio/3tons"}'
expect_body_contains "{\"id\":\"${later}\",\"performers\":[{\"id\":\"${brume}\",\"name\":\"Brume\"},{\"id\":\"${ana}\",\"name\":\"Ana\"}]"
expect_body_contains "\"updatedBy\":\"${ADMIN_EMAIL}\""

echo "  a track belongs to at most one set, which the database checks"
status=0
sql "update sets set soundcloud_track_id = '42', soundcloud_track_url = 'https://soundcloud.com/parkingdotradio/3tons' where id = '${second}'" \
    >"${FILES}/refused" 2>&1 || status=$?
[ "$status" != 0 ] || fail "expected the database to refuse a track in two sets"
grep -q sets_soundcloud_track_id_idx "${FILES}/refused" || fail "expected sets_soundcloud_track_id_idx to refuse it, but got: $(cat "${FILES}/refused")"

echo "  and the 409 names the other set and its session"
# These tests can't resolve tracks, so the set's own track becomes another set's while the set is saved: the set is read,
# with its track, then waits for the sessions' lock, while another transaction gives that track to the later set.
sql "update sets set soundcloud_track_id = '43', soundcloud_track_url = 'https://soundcloud.com/parkingdotradio/b2b' where id = '${second}'" >/dev/null
hold_sessions_lock "update sets set soundcloud_track_id = '44' where id = '${second}'; update sets set soundcloud_track_id = '43' where id = '${later}';"
send_in_background PUT "${SETS}/${second}" "$(set_json "$(performers "$ana")" 60 60 '"soundcloudTrack":"https://soundcloud.com/parkingdotradio/b2b"')"
wait_for_sessions_lock
release_sessions_lock
wait_for_background
expect_conflict "This SoundCloud track is another set's" "$next" "$later"
sql "update sets set soundcloud_track_id = null, soundcloud_track_url = null where id = '${second}'" >/dev/null

echo "  two overlapping sessions sent at the same time wait for each other, and the second is refused, naming the first"
# Both wait for the sessions' lock, which another transaction holds, and then take it one at a time. Without it, both
# could insert into the exclusion constraint's index, then wait for each other, which Postgres would end as a deadlock:
# a 500 rather than a 409.
hold_sessions_lock ""
for start in 2027-02-01T16:00-05:00 2027-02-01T16:30-05:00; do
    send_in_background POST "$SESSIONS" "$(session_json "\"${start}\"" 60)" "$start"
done
wait_for_sessions_lock 2
release_sessions_lock
wait
statuses="$(for file in "${FILES}"/status-*; do cat "$file"; echo; done | sort | tr '\n' ' ')"
[ "$statuses" = "200 409 " ] || fail "expected one session to be added and the other refused, got: ${statuses}"
for start in 2027-02-01T16:00-05:00 2027-02-01T16:30-05:00; do
    STATUS="$(cat "${FILES}/status-${start}")"
    BODY="$(cat "${FILES}/body-${start}")"
    if [ "$STATUS" = 200 ]; then added="$(first_id)"; else refused="$BODY"; fi
done
STATUS=409
BODY="$refused"
expect_conflict 'Another session overlaps this one' "$added"
json DELETE "${SESSIONS}/${added}"
expect_status 200

echo "  a set added to a session, or un-cancelled, while another transaction cancels the session, waits for it, and is refused"
# Only because of the sessions' lock: neither request locks the session's row, which they only read, so without it, they
# would read the session before it's cancelled, and succeed.
hold_sessions_lock "update sessions set status = 'cancelled' where id = '${next}' or id = '${replacement}'; update sets set status = 'cancelled' where session_id = '${replacement}';"
send_in_background POST "${SESSIONS}/${replacement}/sets" "$(set_json "$(performers "$ana")" 0 30)"
wait_for_sessions_lock
release_sessions_lock
wait_for_background
expect_conflict 'This session is cancelled' "$replacement"
json POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$ana")" null null)"
expect_status 200
spare="$(last_set)"
json PUT "${SETS}/${spare}/status" '{"status":"cancelled"}'
expect_status 200
hold_sessions_lock "update sessions set status = 'cancelled' where id = '${first}'; update sets set status = 'cancelled' where session_id = '${first}';"
send_in_background PUT "${SETS}/${spare}/status" '{"status":"planned"}'
wait_for_sessions_lock
release_sessions_lock
wait_for_background
expect_conflict 'This session is cancelled' "$first"
json PUT "${SESSIONS}/${first}/status" '{"status":"done"}'
expect_status 200
for set in "$opening" "$second"; do
    json PUT "${SETS}/${set}/status" '{"status":"done"}'
    expect_status 200
done

echo "  a set added while another transaction shortens its session waits for it, and says if it doesn't fit anymore"
# Only because of the sessions' lock too.
hold_sessions_lock "update sessions set duration_minutes = 150 where id = '${first}';"
send_in_background POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$ana")" 120 60)"
wait_for_sessions_lock
release_sessions_lock
wait_for_background
expect_status 200
expect_body_contains '"durationMinutes":150'
expect_place "$(last_set)" false
json DELETE "${SETS}/$(last_set)"
expect_status 200

echo "  deleting a session and deleting an artist who played two of its sets wait for each other"
# Each one deletes the artist's rows in set_performers, in an order of its own, so they would deadlock if they didn't
# both take the sessions' lock first.
session_form POST "$SESSIONS" "$(session_json '"2027-03-01T16:00-05:00"' 120)"
doomed="$(first_id)"
request --header "Cookie: ${cookie}" --form-string 'artist={"name":"Passager"}' "$ARTISTS"
passenger="$(first_id)"
for offset in 0 60; do
    json POST "${SESSIONS}/${doomed}/sets" "$(set_json "$(performers "$passenger")" "$offset" 60)"
    expect_status 200
done
hold_sessions_lock ""
delete_in_background "${SESSIONS}/${doomed}" session
delete_in_background "${ARTISTS}/${passenger}" artist
wait_for_sessions_lock 2
release_sessions_lock
wait
[ "$(cat "${FILES}/session")" = 200 ] || fail "expected the session to be deleted, got $(cat "${FILES}/session")"
[ "$(cat "${FILES}/artist")" = 200 ] || fail "expected the artist to be deleted, got $(cat "${FILES}/artist")"

echo "  making a session a collective's takeover while the collective is deleted doesn't deadlock, and fails"
request --header "Cookie: ${cookie}" --form-string "collective={\"name\":\"Passage\",\"members\":[{\"id\":\"${ana}\"}],\"email\":\"passage@sessions.test\"}" "$COLLECTIVES"
expect_status 200
passage="$(first_id)"
# Another transaction holds the collective's row while the collective, which has no takeovers yet, is deleted, which
# takes the sessions' lock first, to check that it has none until it's deleted, like making the session its takeover,
# which then waits for it. Had deleting the collective not taken that lock, the session could become its takeover in the
# meantime, and the two could deadlock, or the delete fail on the session's foreign key.
hold_row collectives "$passage"
delete_in_background "${COLLECTIVES}/${passage}" delete
wait_for_sql "select exists (select from pg_stat_activity where wait_event_type = 'Lock' and query ilike 'delete from \"collectives\"%')"
send_in_background PUT "${SESSIONS}/${next}" "$(session_json '"2026-11-15T01:00-05:00"' 60 "\"type\":\"takeover\",\"takeover\":\"${passage}\"")"
wait_for_sessions_lock
release_row
wait_for_background
[ "$(cat "${FILES}/delete")" = 200 ] || fail "expected the collective to be deleted, got $(cat "${FILES}/delete")"
expect_status 400
expect_body_contains '"error":"No such collective"'
json GET "${SESSIONS}/${next}"
expect_body_contains '"type":"guest-mixes","takeover":null'

echo "  changing a set while one of its performers is deleted doesn't deadlock"
request --header "Cookie: ${cookie}" --form-string 'artist={"name":"Éphémère"}' "$ARTISTS"
passing="$(first_id)"
json PUT "${SETS}/${later}" "$(set_json "$(performers "$passing" "$brume")" 0 60)"
expect_status 200
# Another transaction holds the artist's row while the artist is deleted, then while the set is changed to keep them.
# Deleting the artist takes the sessions' lock, then waits for their row, so changing the set waits for that lock.
# Changing the set takes its rows in set_performers, then its performers' through the foreign key, the opposite order of
# deleting the artist, so it's only because both take the sessions' lock that they don't deadlock.
hold_row artists "$passing"
delete_in_background "${ARTISTS}/${passing}" delete
wait_for_sql "select exists (select from pg_stat_activity where wait_event_type = 'Lock' and query ilike 'delete from \"artists\"%')"
send_in_background PUT "${SETS}/${later}" "$(set_json "$(performers "$brume" "$passing")" 0 60)"
wait_for_sessions_lock
release_row
wait_for_background
[ "$(cat "${FILES}/delete")" = 200 ] || fail "expected the artist to be deleted, got $(cat "${FILES}/delete")"
expect_status 400
expect_body_contains '"error":"No such artist"'
json GET "${SESSIONS}/${next}"
expect_body_contains "{\"id\":\"${later}\",\"performers\":[{\"id\":\"${brume}\",\"name\":\"Brume\"}]"

echo "  a set can come from one of its performers' applications, and a takeover from its collective's, which list them"
readonly APPLICATIONS="${BASE_URL}/api/admin/applications"
readonly SETS_APPLICATION="A set's application is one of its performers'"
readonly SESSIONS_APPLICATION="A session's application is that of the collective whose takeover it is"
# application_for <"artistId" or "collectiveId"> <id> -- add an application for that artist or collective, and print its id.
application_for() {
    json POST "$APPLICATIONS" "{\"$1\":\"$2\",\"dates\":[\"2027-04-01\"],\"timeSlots\":[],\"performanceTypes\":[],\"otherPerformanceType\":\"\",\"details\":\"\"}"
    expect_status 200
    first_id
}
request --header "Cookie: ${cookie}" --form-string 'artist={"name":"Candidate"}' "$ARTISTS"
candidate="$(first_id)"
request --header "Cookie: ${cookie}" --form-string 'artist={"name":"Rival"}' "$ARTISTS"
rival="$(first_id)"
request --header "Cookie: ${cookie}" --form-string "collective={\"name\":\"Candidats\",\"members\":[{\"id\":\"${candidate}\"}]}" "$COLLECTIVES"
candidates="$(first_id)"
artists_application="$(application_for artistId "$candidate")"
rivals_application="$(application_for artistId "$rival")"
collectives_application="$(application_for collectiveId "$candidates")"
session_form POST "$SESSIONS" "$(session_json '"2027-04-01T16:00-04:00"' 120 "\"type\":\"takeover\",\"takeover\":\"${candidates}\",\"application\":\"${collectives_application}\",\"name\":\"\"")"
expect_status 200
applied="$(first_id)"
expect_body_contains "\"application\":{\"id\":\"${collectives_application}\",\"receivedAt\":\""
json POST "${SESSIONS}/${applied}/sets" "$(set_json "$(performers "$brume" "$candidate")" 0 60 "\"application\":\"${artists_application}\"")"
expect_status 200
applied_set="$(last_set)"
json POST "${SESSIONS}/${applied}/sets" "$(set_json "$(performers "$candidate")" 60 60 "\"application\":\"${artists_application}\"")"
expect_status 200
rebooked="$(last_set)"
json GET "${APPLICATIONS}/${artists_application}"
expect_body_contains "\"sets\":[{\"id\":\"${applied_set}\",\"start\":\"2027-04-01T16:00:00-04:00\",\"end\":\"2027-04-01T17:00:00-04:00\",\"offsetMinutes\":0,\"durationMinutes\":60,\"status\":\"planned\",\"session\":{\"id\":\"${applied}\",\"title\":\"CANDIDATS TAKEOVER\",\"start\":\"2027-04-01T16:00:00-04:00\"}},{\"id\":\"${rebooked}\""
expect_body_contains '"sessions":[]'
json GET "${APPLICATIONS}/${collectives_application}"
expect_body_contains "\"sets\":[],\"sessions\":[{\"id\":\"${applied}\",\"title\":\"CANDIDATS TAKEOVER\",\"start\":\"2027-04-01T16:00:00-04:00\",\"end\":\"2027-04-01T18:00:00-04:00\",\"durationMinutes\":120,\"status\":\"planned\"}]"

echo "  a change that would break those rules fails, and leaves the set or the session as it was"
for change in "{\"application\":\"${collectives_application}\"}" "{\"application\":\"${rivals_application}\"}" "{\"performers\":[{\"id\":\"${rival}\"}]}"; do
    json PATCH "${SETS}/${applied_set}" "$change"
    expect_status 400
    expect_body_contains "\"error\":\"${SETS_APPLICATION}\""
done
json PATCH "${SETS}/${applied_set}" "{\"application\":\"${NOBODY}\"}"
expect_status 400
expect_body_contains '"error":"No such application"'
json PATCH "${SESSIONS}/${applied}" "{\"application\":\"${artists_application}\"}"
expect_status 400
expect_body_contains "\"error\":\"${SESSIONS_APPLICATION}\""
json PATCH "${SESSIONS}/${applied}" "{\"takeover\":\"${ondes}\"}"
expect_status 400
expect_body_contains "\"error\":\"${SESSIONS_APPLICATION}\""
json PATCH "${SESSIONS}/${applied}" '{"type":"guest-mixes","takeover":null}'
expect_status 400
expect_body_contains '"error":"Only a takeover has an application"'
[ "$(sql "select count(*) from sets where session_id = '${applied}' and (updated_by is not null or application_id is distinct from '${artists_application}')")" = 0 ] \
    || fail "expected the sets to be as they were"
[ "$(sql "select takeover_id = '${candidates}' and application_id = '${collectives_application}' and updated_by is null from sessions where id = '${applied}'")" = t ] \
    || fail "expected the session to be as it was"
# Unless the application is changed in the same request.
json PATCH "${SETS}/${applied_set}" "{\"performers\":[{\"id\":\"${rival}\"}],\"application\":\"${rivals_application}\"}"
expect_status 200

echo "  deleting an application takes it from its sets and sessions, which stay, unchanged otherwise"
json DELETE "${APPLICATIONS}/${collectives_application}"
expect_status 200
json GET "${SESSIONS}/${applied}"
expect_body_contains "\"takeover\":{\"id\":\"${candidates}\",\"name\":\"Candidats\"},\"application\":null"
[ "$(sql "select updated_by is null from sessions where id = '${applied}'")" = t ] || fail "expected the session not to count as changed"

echo "  giving a set an application while the application is deleted fails, rather than fail unexpectedly"
# Another transaction holds the application's row while it's deleted, which takes the sessions' lock first, like
# changing the set, which then waits for it, and finds no application.
hold_row applications "$artists_application"
delete_in_background "${APPLICATIONS}/${artists_application}" delete
wait_for_sql "select exists (select from pg_stat_activity where wait_event_type = 'Lock' and query ilike 'delete from \"applications\"%')"
send_in_background PATCH "${SETS}/${applied_set}" "{\"performers\":[{\"id\":\"${candidate}\"}],\"application\":\"${artists_application}\"}"
wait_for_sessions_lock
release_row
wait_for_background
[ "$(cat "${FILES}/delete")" = 200 ] || fail "expected the application to be deleted, got $(cat "${FILES}/delete")"
expect_status 400
expect_body_contains '"error":"No such application"'
json GET "${SESSIONS}/${applied}"
expect_body_contains "{\"id\":\"${rebooked}\",\"performers\":[{\"id\":\"${candidate}\",\"name\":\"Candidate\"}],"
[ "$(sql "select count(*) from sets where session_id = '${applied}' and application_id is not null")" = 1 ] \
    || fail "expected only the set with the other application to keep it"

echo "  deleting an artist takes their applications from their sets"
json DELETE "${ARTISTS}/${rival}"
expect_status 200
[ "$(sql "select count(*) from sets where session_id = '${applied}' and application_id is not null")" = 0 ] \
    || fail "expected the artist's application to be taken from their set"
json DELETE "${SESSIONS}/${applied}"
expect_status 200
json DELETE "${COLLECTIVES}/${candidates}"
expect_status 200
json DELETE "${ARTISTS}/${candidate}"
expect_status 200

echo "  deleting an artist takes them out of their sets, which stay, even without performers"
json DELETE "${ARTISTS}/${brume}"
expect_status 200
json GET "${SESSIONS}/${next}"
expect_body_contains "{\"id\":\"${later}\",\"performers\":[]"
json GET "${SESSIONS}/${first}"
expect_body_contains "{\"id\":\"${second}\",\"performers\":[{\"id\":\"${ana}\",\"name\":\"Ana\"}]"

echo "  a collective can't be deleted while it has takeovers, which the 409 names, until they're of another type"
readonly HAS_TAKEOVERS='This collective has takeovers: give them another collective, or another type, first'
json DELETE "${COLLECTIVES}/${ondes}"
expect_conflict "$HAS_TAKEOVERS" "$canned"
# Changing its type alone, the takeover it would be without a collective's type is refused.
json PATCH "${SESSIONS}/${canned}" '{"type":"guest-mixes"}'
expect_status 400
expect_body_contains '"error":"Only a takeover has a collective"'
json PATCH "${SESSIONS}/${canned}" '{"type":"guest-mixes","takeover":null}'
expect_status 200
expect_body_contains '"type":"guest-mixes","takeover":null'
json DELETE "${COLLECTIVES}/${ondes}"
expect_conflict "$HAS_TAKEOVERS" "$first"
json GET "${COLLECTIVES}/${ondes}"
expect_status 200
session_form PUT "${SESSIONS}/${first}" "$(session_json '"2026-11-14T21:00-05:00"' 240 '"type":"other"')"
expect_status 200
json DELETE "${COLLECTIVES}/${ondes}"
expect_status 200

echo "  a set without performers takes one again to be replaced, but its other fields and its status can still be changed"
json PUT "${SETS}/${later}" "$(set_json '[]' 0 60)"
expect_status 400
expect_body_contains '"error":"A set has at least one performer"'
json PATCH "${SETS}/${later}" '{"offsetMinutes":null,"durationMinutes":null,"genres":["ambient"]}'
expect_status 200
expect_body_contains "{\"id\":\"${later}\",\"performers\":[],\"offsetMinutes\":null,\"durationMinutes\":null"
# Its place is checked as the set would be, without a duration.
json PATCH "${SETS}/${later}" '{"offsetMinutes":30}'
expect_status 400
expect_body_contains '"error":"A set with an offset also has a duration"'
json PUT "${SESSIONS}/${next}/status" '{"status":"planned"}'
expect_status 200
json PUT "${SETS}/${later}/status" '{"status":"done"}'
expect_status 200
expect_body_contains "{\"id\":\"${later}\",\"performers\":[]"

echo "  a session or a set that doesn't exist can't be viewed, changed or deleted"
for id in "$NOBODY" not-a-uuid; do
    json GET "${SESSIONS}/${id}"
    expect_status 404
    json GET "${SESSIONS}/${id}/ra-event"
    expect_status 404
    session_form PUT "${SESSIONS}/${id}" "$(session_json null 60)"
    expect_status 404
    json PUT "${SESSIONS}/${id}/status" '{"status":"done"}'
    expect_status 404
    json DELETE "${SESSIONS}/${id}"
    expect_status 404
    json PUT "${SETS}/${id}" "$(set_json "$(performers "$ana")" null null)"
    expect_status 404
    expect_body_contains '"error":"No such set"'
    json PUT "${SETS}/${id}/status" '{"status":"done"}'
    expect_status 404
    json DELETE "${SETS}/${id}"
    expect_status 404
done

echo "  deleting a set keeps its performers, and deleting a session deletes its sets, but not their performers"
json DELETE "${SETS}/${spare}"
expect_status 200
json GET "${SESSIONS}/${first}"
[ "$(set_ids)" = "${opening} ${second} ${unplaced} " ] || { _show_body; fail "expected the spare set to be gone"; }
json DELETE "${SESSIONS}/${first}"
expect_status 200
[ "$(sql "select count(*) from sets where session_id = '${first}'")" = 0 ] || fail "expected the session's sets to be deleted"
[ "$(sql "select count(*) from set_performers where set_id in ('${opening}', '${second}', '${unplaced}')")" = 0 ] \
    || fail "expected the rows of the session's sets in set_performers to be deleted"
json GET "${ARTISTS}/${ana}"
expect_status 200
for session in "$next" "$canned" "$other_canned" "$replacement"; do
    json DELETE "${SESSIONS}/${session}"
    expect_status 200
done
json GET "$SESSIONS"
expect_body_contains '"sessions":[]'
