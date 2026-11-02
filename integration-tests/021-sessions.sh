#!/usr/bin/env bash
#
# The admin routes for sessions and sets work against a real database. The server's unit tests fake the database, so
# this is what covers the sessions, sets and set_performers tables: performers kept in order, with their names, and
# takeovers, the checks that take the database (artists and collectives that exist), starts kept as instants and sets
# placed relative to them, sessions listed those without a start first, then the most recent first, by artist and by
# takeover, the rules of sessions (sessions don't overlap, a set fits in its session, a session's sets don't overlap
# each other, a video or a track in at most one set, and a cancelled session only has cancelled sets), with what's in the
# way in their 409s, including while other transactions change sessions, a set's own track not being resolved again,
# what deleting an artist or a collective does to sessions and sets, and changing a session or a set while its
# takeover's collective, or one of its performers, is deleted.
#
# These tests can't reach SoundCloud, so they only check what happens to a track's link before it's resolved.

source "$(dirname "$0")/lib.sh"

readonly IP=198.51.100.30
readonly NOBODY=00000000-0000-4000-8000-000000000000

readonly FILES="$(mktemp -d)"
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
# date and time, or null), without a takeover or an RA event unless they're given (the last of two fields with the same
# name is the one that counts).
session_json() {
    printf '{"start":%s,"durationMinutes":%s,"takeover":null,"name":"HAUTE RIVE TAKEOVER","raEvent":null%s}' "$1" "$2" "${3:+,$3}"
}

# set_json <performers JSON> <offset> <duration> [<more JSON fields>] -- a set, as JSON, without links unless they're
# given.
set_json() {
    printf '{"performers":%s,"offsetMinutes":%s,"durationMinutes":%s,"prestations":["dj"],"otherPrestation":"","genres":[],"soundcloudTrack":null,"youtubeVideo":null%s}' \
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
    curl --silent --output "${FILES}/body${4:+-$4}" --write-out '%{http_code}' --header "Cookie: ${cookie}" --request "$1" \
        --header 'Content-Type: application/json' --data "$3" "$2" > "${FILES}/status${4:+-$4}" &
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
expect_body_contains '"sessions":[]'

request --header "Cookie: ${cookie}" --form-string 'artist={"name":"Ana"}' "$ARTISTS"
ana="$(first_id)"
request --header "Cookie: ${cookie}" --form-string 'artist={"name":"Brume"}' "$ARTISTS"
brume="$(first_id)"
request --header "Cookie: ${cookie}" --form-string "collective={\"name\":\"Les Ondes\",\"members\":[{\"id\":\"${ana}\"}],\"email\":\"ondes@sessions.test\"}" "$COLLECTIVES"
expect_status 200
ondes="$(first_id)"

echo "  an invalid session is explained, including one with the NUL character"
json POST "$SESSIONS" "$(session_json '"2026-11-14T21:00-05:00"' 0)"
expect_status 400
expect_body_contains '"error":"The duration must be a whole number of minutes, from 1 to 1440"'
# Postgres can't keep it.
json POST "$SESSIONS" "$(session_json '"2026-11-14T21:00-05:00"' 240 '"name":"HAUTE\u0000RIVE"')"
expect_status 400
expect_body_contains '"error":"Text can'"'"'t contain the NUL character"'
json POST "$SESSIONS" "$(session_json '"2026-11-14T21:00-05:00"' 240 '"raEvent":"https://ra.co/events/6683745\u0000"')"
expect_status 400

echo "  a session is added, as planned, without sets, and read back with its takeover, its start and end in UTC and its RA event reduced"
json POST "$SESSIONS" "$(session_json '"2026-11-14T21:00-05:00"' 240 "\"takeover\":\"${ondes}\",\"raEvent\":\"https://ra.co/events/6683745\"")"
expect_status 200
first="$(first_id)"
json GET "${SESSIONS}/${first}"
expect_status 200
expect_body_contains "\"start\":\"2026-11-15T02:00:00.000Z\",\"end\":\"2026-11-15T06:00:00.000Z\",\"durationMinutes\":240,\"takeover\":{\"id\":\"${ondes}\",\"name\":\"Les Ondes\"}"
expect_body_contains '"name":"HAUTE RIVE TAKEOVER","raEvent":{"id":"6683745","url":"https://ra.co/events/6683745"},"sets":[]'
expect_body_contains "\"createdBy\":\"${ADMIN_EMAIL}\",\"updatedBy\":null,\"updatedAt\":null,\"status\":\"planned\",\"statusUpdatedBy\":null"

echo "  a takeover has to be a collective that exists, and nothing is saved otherwise"
for takeover in "$NOBODY" not-a-uuid "$ana"; do
    json POST "$SESSIONS" "$(session_json '"2027-01-01T21:00Z"' 60 "\"takeover\":\"${takeover}\"")"
    expect_status 400
    expect_body_contains '"error":"No such collective"'
done
json GET "$SESSIONS"
[ "$(session_ids)" = "${first} " ] || { _show_body; fail "expected only the first session"; }

echo "  sessions can't overlap, when they're added or changed, but one can start when another ends, and the 409 names the other"
json POST "$SESSIONS" "$(session_json '"2026-11-15T05:00Z"' 60)"
expect_conflict 'Another session overlaps this one' "$first"
json POST "$SESSIONS" "$(session_json '"2026-11-15T06:00Z"' 60)"
expect_status 200
next="$(first_id)"
json PUT "${SESSIONS}/${next}" "$(session_json '"2026-11-15T05:30Z"' 60)"
expect_conflict 'Another session overlaps this one' "$first"
json GET "${SESSIONS}/${next}"
expect_body_contains '"start":"2026-11-15T06:00:00.000Z","end":"2026-11-15T07:00:00.000Z"'

echo "  a session lasts the minutes that actually pass, for the database too, e.g. the night the clocks go back"
# From midnight, for 4 hours: the clocks then say 3:00, an hour behind.
json POST "$SESSIONS" "$(session_json '"2026-11-01T00:00-04:00"' 240)"
expect_status 200
night="$(first_id)"
expect_body_contains '"start":"2026-11-01T04:00:00.000Z","end":"2026-11-01T08:00:00.000Z"'
json POST "$SESSIONS" "$(session_json '"2026-11-01T02:59-05:00"' 60)"
expect_conflict 'Another session overlaps this one' "$night"
json POST "$SESSIONS" "$(session_json '"2026-11-01T03:00-05:00"' 60)"
expect_status 200
dawn="$(first_id)"
for session in "$night" "$dawn"; do
    json DELETE "${SESSIONS}/${session}"
    expect_status 200
done

echo "  sessions without a start don't overlap anything, until they're given one"
json POST "$SESSIONS" "$(session_json null 240 "\"takeover\":\"${ondes}\"")"
expect_status 200
canned="$(first_id)"
expect_body_contains '"start":null,"end":null,"durationMinutes":240'
json POST "$SESSIONS" "$(session_json '""' 240)"
expect_status 200
other_canned="$(first_id)"
expect_body_contains '"start":null,"end":null'
json PUT "${SESSIONS}/${canned}" "$(session_json '"2026-11-14T20:00-05:00"' 240 "\"takeover\":\"${ondes}\"")"
expect_conflict 'Another session overlaps this one' "$first"
json GET "${SESSIONS}/${canned}"
expect_body_contains '"start":null'

echo "  a set is added to a session, as planned, with its performers in order, and placed in it"
json POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$brume" "$ana")" 0 60 \
    '"prestations":["live-performance","dj","dj"],"otherPrestation":" Synthé \n modulaire ","genres":["ambient","techno","ambient"],"youtubeVideo":"https://youtu.be/dQw4w9WgXcQ?si=x"')"
expect_status 200
opening="$(last_set)"
expect_body_contains "\"id\":\"${first}\",\"start\":\"2026-11-15T02:00:00.000Z\""
expect_body_contains "{\"id\":\"${opening}\",\"performers\":[{\"id\":\"${brume}\",\"name\":\"Brume\"},{\"id\":\"${ana}\",\"name\":\"Ana\"}]"
expect_body_contains '"offsetMinutes":0,"durationMinutes":60,"start":"2026-11-15T02:00:00.000Z","end":"2026-11-15T03:00:00.000Z"'
expect_body_contains '"prestations":["dj","live-performance"],"otherPrestation":"Synthé modulaire","genres":["ambient","techno"],"soundcloudTrack":null'
expect_body_contains '"youtubeVideo":{"id":"dQw4w9WgXcQ","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
expect_body_contains "\"createdBy\":\"${ADMIN_EMAIL}\",\"updatedBy\":null,\"updatedAt\":null,\"status\":\"planned\""

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

echo "  a set fits in its session, with or without an offset, and a set without a duration always does"
json POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$ana")" 200 60)"
expect_conflict 'This set ends after its session' "$first"
json POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$ana")" null 241)"
expect_conflict 'This set ends after its session' "$first"
json POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$ana")" null 240)"
expect_status 200
whenever="$(last_set)"
json POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$ana")" null null)"
expect_status 200
unplaced="$(last_set)"
expect_body_contains "{\"id\":\"${unplaced}\",\"performers\":[{\"id\":\"${ana}\",\"name\":\"Ana\"}],\"offsetMinutes\":null,\"durationMinutes\":null,\"start\":null,\"end\":null"

echo "  a session's sets can't overlap each other, when they're added or changed, but one can start when another ends"
json POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$ana")" 30 60)"
expect_conflict 'Another set of this session overlaps this one' "$first" "$opening"
json POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$ana")" 60 60)"
expect_status 200
second="$(last_set)"
json PUT "${SETS}/${second}" "$(set_json "$(performers "$ana")" 59 60)"
expect_conflict 'Another set of this session overlaps this one' "$first" "$opening"
json GET "${SESSIONS}/${first}"
# By offset, those without one last, in the order they were added.
[ "$(set_ids)" = "${opening} ${second} ${whenever} ${unplaced} " ] || { _show_body; fail "expected the sets by offset"; }
expect_body_contains "{\"id\":\"${second}\",\"performers\":[{\"id\":\"${ana}\",\"name\":\"Ana\"}],\"offsetMinutes\":60,\"durationMinutes\":60"

echo "  but the sets of two sessions can be at the same offsets"
json POST "${SESSIONS}/${next}/sets" "$(set_json "$(performers "$brume")" 0 60)"
expect_status 200
later="$(last_set)"

echo "  which the database checks too"
status=0
sql "insert into sets (created_by, session_id, offset_minutes, duration_minutes, prestations, other_prestation, genres)
     values ('psql', '${first}', 30, 60, '{}', '', '{}')" >"${FILES}/refused" 2>&1 || status=$?
[ "$status" != 0 ] || fail "expected the database to refuse sets that overlap in a session"
grep -q sets_no_overlap "${FILES}/refused" || fail "expected sets_no_overlap to refuse it, but got: $(cat "${FILES}/refused")"

echo "  cancelled sets don't count, until they're not cancelled anymore"
json PUT "${SETS}/${opening}/status" '{"status":"cancelled"}'
expect_status 200
expect_body_contains "\"status\":\"cancelled\",\"statusUpdatedBy\":\"${ADMIN_EMAIL}\""
json POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$brume")" 0 30)"
expect_status 200
instead="$(last_set)"
json PUT "${SETS}/${opening}/status" '{"status":"planned"}'
expect_conflict 'Another set of this session overlaps this one' "$first" "$instead"
json DELETE "${SETS}/${instead}"
expect_status 200
json PUT "${SETS}/${opening}/status" '{"status":"done"}'
expect_status 200

echo "  a session can't be shortened so that one of its sets ends after it, even a cancelled one, and nothing changes"
json PUT "${SETS}/${second}/status" '{"status":"cancelled"}'
expect_status 200
json DELETE "${SETS}/${whenever}"
expect_status 200
json PUT "${SESSIONS}/${first}" "$(session_json '"2026-11-14T21:00-05:00"' 119 "\"takeover\":\"${ondes}\"")"
expect_conflict 'One of the sets of this session would end after it' "$first" "$second"
json PUT "${SETS}/${second}/status" '{"status":"planned"}'
expect_status 200
json GET "${SESSIONS}/${first}"
expect_body_contains '"durationMinutes":240'
expect_body_contains '"updatedBy":null'

echo "  moving a session moves its sets, which doesn't count as changing them, and so does taking its start away"
json PUT "${SESSIONS}/${first}" "$(session_json '"2026-11-21T21:00-05:00"' 120 "\"takeover\":\"${ondes}\",\"raEvent\":\"6683745\"")"
expect_status 200
expect_body_contains "\"start\":\"2026-11-22T02:00:00.000Z\",\"end\":\"2026-11-22T04:00:00.000Z\",\"durationMinutes\":120"
expect_body_contains "{\"id\":\"${second}\",\"performers\":[{\"id\":\"${ana}\",\"name\":\"Ana\"}],\"offsetMinutes\":60,\"durationMinutes\":60,\"start\":\"2026-11-22T03:00:00.000Z\",\"end\":\"2026-11-22T04:00:00.000Z\""
expect_body_contains "\"updatedBy\":\"${ADMIN_EMAIL}\""
[ "$(sql "select count(*) from sets where session_id = '${first}' and updated_by is not null")" = 0 ] || fail "expected the sets not to be changed"
json PUT "${SESSIONS}/${first}" "$(session_json null 120 "\"takeover\":\"${ondes}\",\"raEvent\":\"6683745\"")"
expect_status 200
expect_body_contains "{\"id\":\"${second}\",\"performers\":[{\"id\":\"${ana}\",\"name\":\"Ana\"}],\"offsetMinutes\":60,\"durationMinutes\":60,\"start\":null,\"end\":null"
json PUT "${SESSIONS}/${first}" "$(session_json '"2026-11-14T21:00-05:00"' 240 "\"takeover\":\"${ondes}\",\"raEvent\":\"6683745\"")"
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
json POST "$SESSIONS" "$(session_json '"2026-11-15T06:30Z"' 60)"
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
for start in 2027-02-01T21:00Z 2027-02-01T21:30Z; do
    send_in_background POST "$SESSIONS" "$(session_json "\"${start}\"" 60)" "$start"
done
wait_for_sessions_lock 2
release_sessions_lock
wait
statuses="$(for file in "${FILES}"/status-*; do cat "$file"; echo; done | sort | tr '\n' ' ')"
[ "$statuses" = "200 409 " ] || fail "expected one session to be added and the other refused, got: ${statuses}"
for start in 2027-02-01T21:00Z 2027-02-01T21:30Z; do
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

echo "  a set added while another transaction shortens its session waits for it, and is refused if it doesn't fit anymore"
# Only because of the sessions' lock too.
hold_sessions_lock "update sessions set duration_minutes = 150 where id = '${first}';"
send_in_background POST "${SESSIONS}/${first}/sets" "$(set_json "$(performers "$ana")" 120 60)"
wait_for_sessions_lock
release_sessions_lock
wait_for_background
expect_conflict 'This set ends after its session' "$first"
expect_body_contains '"durationMinutes":150'

echo "  deleting a session and deleting an artist who played two of its sets wait for each other"
# Each one deletes the artist's rows in set_performers, in an order of its own, so they would deadlock if they didn't
# both take the sessions' lock first.
json POST "$SESSIONS" "$(session_json '"2027-03-01T21:00Z"' 120)"
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

echo "  changing a session while its takeover's collective is deleted doesn't deadlock"
request --header "Cookie: ${cookie}" --form-string "collective={\"name\":\"Passage\",\"members\":[{\"id\":\"${ana}\"}],\"email\":\"passage@sessions.test\"}" "$COLLECTIVES"
expect_status 200
passage="$(first_id)"
json PUT "${SESSIONS}/${next}" "$(session_json '"2026-11-15T06:00Z"' 60 "\"takeover\":\"${passage}\"")"
expect_status 200
# Another transaction holds the collective's row while the collective is deleted, which clears the session's takeover,
# and so takes the sessions' lock first, like changing the session, which then waits for it. Had deleting the collective
# not taken that lock, the two could deadlock, or break the rules of sessions unnoticed.
hold_row collectives "$passage"
delete_in_background "${COLLECTIVES}/${passage}" delete
wait_for_sql "select exists (select from pg_stat_activity where wait_event_type = 'Lock' and query ilike 'delete from \"collectives\"%')"
send_in_background PUT "${SESSIONS}/${next}" "$(session_json '"2026-11-15T06:00Z"' 60 "\"takeover\":\"${passage}\"")"
wait_for_sessions_lock
release_row
wait_for_background
[ "$(cat "${FILES}/delete")" = 200 ] || fail "expected the collective to be deleted, got $(cat "${FILES}/delete")"
expect_status 400
expect_body_contains '"error":"No such collective"'
json GET "${SESSIONS}/${next}"
expect_body_contains '"takeover":null'

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

echo "  deleting an artist takes them out of their sets, which stay, even without performers"
json DELETE "${ARTISTS}/${brume}"
expect_status 200
json GET "${SESSIONS}/${next}"
expect_body_contains "{\"id\":\"${later}\",\"performers\":[]"
json GET "${SESSIONS}/${first}"
expect_body_contains "{\"id\":\"${second}\",\"performers\":[{\"id\":\"${ana}\",\"name\":\"Ana\"}]"

echo "  deleting a collective leaves the sessions of its takeovers without one, which doesn't count as changing them"
json DELETE "${COLLECTIVES}/${ondes}"
expect_status 200
json GET "${SESSIONS}/${canned}"
expect_body_contains '"takeover":null'
expect_body_contains '"updatedBy":null,"updatedAt":null'

echo "  a set without performers takes one again to be changed, but its status can still be changed"
json PUT "${SETS}/${later}" "$(set_json '[]' 0 60)"
expect_status 400
expect_body_contains '"error":"A set has at least one performer"'
json PUT "${SESSIONS}/${next}/status" '{"status":"planned"}'
expect_status 200
json PUT "${SETS}/${later}/status" '{"status":"done"}'
expect_status 200
expect_body_contains "{\"id\":\"${later}\",\"performers\":[]"

echo "  a session or a set that doesn't exist can't be viewed, changed or deleted"
for id in "$NOBODY" not-a-uuid; do
    json GET "${SESSIONS}/${id}"
    expect_status 404
    json PUT "${SESSIONS}/${id}" "$(session_json null 60)"
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
