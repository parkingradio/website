#!/usr/bin/env bash
#
# The admin routes for collectives work against a real database. The server's unit tests mock the database and the
# photos, so this is what covers the collectives and collective_members tables: contact emails being unique among
# collectives whatever their case, collectives listed by name, members kept in order, members created by name, the
# checks on members that take the database (artists who exist, and aren't collectives of their own, on both sides),
# artists returning their collectives, what deleting an artist or a collective does to the other, a collective's photo
# kept on disk, then deleted, and changing a collective while one of its members is deleted.

source "$(dirname "$0")/lib.sh"

readonly IP=198.51.100.19
readonly NOBODY=00000000-0000-4000-8000-000000000000

# The smallest files that start like a JPEG and a PNG image.
readonly FILES="$(mktemp -d)"
trap 'rm -rf "$FILES"' EXIT
printf '\xff\xd8\xff\xe0JFIF' > "${FILES}/photo.jpg"
printf '\x89PNG\r\n\x1a\nIHDR' > "${FILES}/photo.png"

login "$IP" "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
expect_status 200
cookie="$(session_cookie)"

# send <part> <method> <url> <JSON> [<photo file>] -- add or change an artist or a collective, as <part> says.
send() {
    local photo=()
    if [ -n "${5:-}" ]; then photo=(--form "photo=@$5"); fi
    request --header "Cookie: ${cookie}" --request "$2" --form-string "$1=$4" ${photo[@]+"${photo[@]}"} "$3"
}

# admin <method> <url> -- any other request, as the admin.
admin() {
    request --header "Cookie: ${cookie}" --request "$1" "$2"
}

# expect_no_artist <name> -- expect no artist to have this name, e.g. a member sent by name with a collective that was
# refused.
expect_no_artist() {
    admin GET "$ARTISTS"
    expect_status 200
    if printf '%s' "$BODY" | grep -Fq "\"name\":\"$1\""; then fail "expected no artist named $1"; fi
}

# sql <query> -- run a query in the database, and print its result, without headers or alignment.
sql() {
    docker exec "$PG" psql --quiet --no-align --tuples-only --username parking_radio --dbname parking_radio --command "$1"
}

# wait_for_sql <query> -- wait, for up to 10 seconds, for the query to return true.
wait_for_sql() {
    for _ in $(seq 1 100); do
        [ "$(sql "$1")" = t ] && return 0
        sleep 0.1
    done
    fail "timed out waiting for: $1"
}

# first_id -- the first "id" in the body of the last request, e.g. that of the collective rather than its members'.
first_id() {
    printf '%s' "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4
}

# profile_with <email> <member>... -- a collective's profile, as JSON, with this email and these members: each one the id
# of an artist, or name=<name> for a new artist.
#
# Writing the members out where the profile is sent wouldn't do anyway: macOS's bash expands the braces of
# "[{...},{...}]" in a command substitution within double quotes.
profile_with() {
    local email="$1" member members=""
    shift
    for member in "$@"; do
        if [[ "$member" == name=* ]]; then member="{\"name\":\"${member#name=}\"}"; else member="{\"id\":\"${member}\"}"; fi
        members="${members:+${members},}${member}"
    done
    printf '{"name":"Les Ondes","members":[%s],"country":"CA","city":"Québec","description":"Une description.",
"links":{"soundcloud":"https://soundcloud.com/lesondes"},"email":"%s","phone":"418 555-0123"}' "$members" "$email"
}

# profile <member>... -- the same, with the email of the collective that's changed throughout.
profile() {
    profile_with contact@collectives.test "$@"
}

readonly COLLECTIVES="${BASE_URL}/api/admin/collectives"
readonly ARTISTS="${BASE_URL}/api/admin/artists"

echo "  collectives can't be listed without a session"
request "$COLLECTIVES"
expect_status 401

echo "  there are no collectives yet"
admin GET "$COLLECTIVES"
expect_status 200
expect_body_contains '"collectives":[]'

send artist POST "$ARTISTS" '{"kind":"artist","name":"Ana","email":"ana@collectives.test"}'
expect_status 200
ana="$(first_id)"
send artist POST "$ARTISTS" '{"kind":"artist","name":"Brume"}'
expect_status 200
brume="$(first_id)"
send artist POST "$ARTISTS" '{"kind":"collective","name":"Ancien Collectif","members":["Do"],"email":"ancien@collectives.test"}'
expect_status 200
legacy="$(first_id)"

echo "  an invalid profile is explained, in French"
send collective POST "$COLLECTIVES" "$(profile)" "${FILES}/photo.jpg"
expect_status 400
expect_body_contains 'Indiquez au moins un artiste du collectif.'
[ "$(photos_on_disk collectives)" = 0 ] || fail "expected no photo to be stored"

echo "  a collective is added with its photo and members, in order, and read back as it was sent"
send collective POST "$COLLECTIVES" "$(profile "$brume" "$ana")" "${FILES}/photo.jpg"
expect_status 200
ondes="$(first_id)"
admin GET "${COLLECTIVES}/${ondes}"
expect_status 200
expect_body_contains "\"members\":[{\"id\":\"${brume}\",\"name\":\"Brume\"},{\"id\":\"${ana}\",\"name\":\"Ana\"}]"
expect_body_contains '"links":{"soundcloud":"lesondes"}'
expect_body_contains "\"createdBy\":\"${ADMIN_EMAIL}\""
expect_body_contains '"hasPhoto":true'
admin GET "${COLLECTIVES}/${ondes}/photo"
expect_status 200
expect_header Content-Type 'image/jpeg'
[ "$(photos_on_disk collectives)" = 1 ] || fail "expected the collective's photo on disk, apart from artists' photos"

echo "  another collective can't have the same contact email, whatever its case, and nothing sent with it is kept"
send collective POST "$COLLECTIVES" "$(profile_with CONTACT@collectives.test "$ana" name=Fantôme)" "${FILES}/photo.png"
expect_status 409
expect_body_contains 'Another collective has this email address'
[ "$(photos_on_disk collectives)" = 1 ] || fail "expected the refused photo to be deleted"
expect_no_artist Fantôme

echo "  but a collective can have an artist's email, and artists return the collectives they're in, by name"
send collective POST "$COLLECTIVES" "$(profile_with ana@collectives.test "$ana" | sed 's/Les Ondes/aube/')"
expect_status 200
aube="$(first_id)"
admin GET "${ARTISTS}/${ana}"
expect_body_contains "\"collectives\":[{\"id\":\"${aube}\",\"name\":\"aube\"},{\"id\":\"${ondes}\",\"name\":\"Les Ondes\"}]"
admin GET "${ARTISTS}"
expect_body_contains "\"collectives\":[{\"id\":\"${aube}\",\"name\":\"aube\"},{\"id\":\"${ondes}\",\"name\":\"Les Ondes\"}]"

echo "  collectives are listed by name, whatever its case, with their members"
admin GET "$COLLECTIVES"
expect_status 200
expect_body '"name":"aube".*"name":"Les Ondes"'
expect_body_contains "\"name\":\"aube\",\"members\":[{\"id\":\"${ana}\",\"name\":\"Ana\"}]"
expect_body_contains "\"name\":\"Les Ondes\",\"members\":[{\"id\":\"${brume}\",\"name\":\"Brume\"},{\"id\":\"${ana}\",\"name\":\"Ana\"}]"

echo "  a member has to be an artist who exists, rather than a collective, and nothing sent with them is kept"
for member in "$NOBODY" not-a-uuid; do
    send collective PUT "${COLLECTIVES}/${ondes}" "$(profile name=Fantôme "$ana" "$member")" "${FILES}/photo.png"
    expect_status 400
    expect_body_contains '"error":"No such artist"'
done
send collective POST "$COLLECTIVES" "$(profile_with other@collectives.test name=Fantôme "$legacy")" "${FILES}/photo.png"
expect_status 400
expect_body_contains "A collective can't be a member of a collective"
[ "$(photos_on_disk collectives)" = 1 ] || fail "expected the refused photos to be deleted"
expect_no_artist Fantôme
admin GET "${COLLECTIVES}/${ondes}"
expect_body_contains "\"members\":[{\"id\":\"${brume}\",\"name\":\"Brume\"},{\"id\":\"${ana}\",\"name\":\"Ana\"}]"

echo "  and a member can't become a collective"
send artist PUT "${ARTISTS}/${brume}" '{"kind":"collective","name":"Brume","members":["Do"],"email":"brume@collectives.test"}'
expect_status 400
expect_body_contains "An artist who is a member of a collective can't become a collective"

echo "  a member is added by name, which creates them as an artist, and the members are reordered"
# The name that comes with Brume's id is ignored.
send collective PUT "${COLLECTIVES}/${ondes}" "$(profile name=Cyan "$brume" | sed "s/\"id\":\"${brume}\"/&,\"name\":\"ignoré\"/")"
expect_status 200
expect_body_contains "\"updatedBy\":\"${ADMIN_EMAIL}\""
cyan="$(printf '%s' "$BODY" | grep -o '"id":"[^"]*","name":"Cyan"' | cut -d'"' -f4)"
expect_body_contains "\"members\":[{\"id\":\"${cyan}\",\"name\":\"Cyan\"},{\"id\":\"${brume}\",\"name\":\"Brume\"}]"
admin GET "${ARTISTS}/${cyan}"
expect_status 200
expect_body_contains '"kind":"artist","name":"Cyan","members":[],"country":"","city":"","genres":[],"bio":"","links":{},"email":null,"phone":""'
expect_body_contains "\"createdBy\":\"${ADMIN_EMAIL}\""
expect_body_contains "\"collectives\":[{\"id\":\"${ondes}\",\"name\":\"Les Ondes\"}]"

echo "  the photo is replaced, then removed, and deleted each time"
send collective PUT "${COLLECTIVES}/${ondes}" "$(profile "$brume")" "${FILES}/photo.png"
expect_status 200
admin GET "${COLLECTIVES}/${ondes}/photo"
expect_header Content-Type 'image/png'
[ "$(photos_on_disk collectives)" = 1 ] || fail "expected the replaced photo to be deleted"
request --header "Cookie: ${cookie}" --request PUT --form-string "collective=$(profile "$brume")" \
    --form-string 'removePhoto=true' "${COLLECTIVES}/${ondes}"
expect_status 200
expect_body_contains '"hasPhoto":false'
[ "$(photos_on_disk collectives)" = 0 ] || fail "expected the removed photo to be deleted"
admin GET "${COLLECTIVES}/${ondes}/photo"
expect_status 404
expect_body_contains 'This collective has no photo'

echo "  deleting an artist takes them out of their collectives, which can be left without members"
admin DELETE "${ARTISTS}/${ana}"
expect_status 200
admin GET "${COLLECTIVES}/${aube}"
expect_status 200
expect_body_contains '"members":[]'

echo "  changing a collective while one of its members is deleted doesn't deadlock"
send artist POST "$ARTISTS" '{"kind":"artist","name":"Éphémère"}'
passing="$(first_id)"
send collective PUT "${COLLECTIVES}/${ondes}" "$(profile "$passing" "$brume")"
expect_status 200
# Another transaction holds the artist's row while the artist is deleted, then while the collective is changed to keep
# them, so that both wait for it, the deletion first, which then takes the row first. Had changing the collective taken
# its memberships before its members' rows, the two would deadlock: Postgres would end one of them with an error, and
# its request would fail with 500. Each request is only sent once the one before it waits for the row, and the
# transaction holding it is cancelled once both do.
docker exec --env PGAPPNAME=lock-holder "$PG" psql --quiet --username parking_radio --dbname parking_radio --command \
    "begin; select from artists where id = '${passing}' for no key update; select pg_sleep(30); commit;" >/dev/null 2>&1 &
wait_for_sql "select exists (select from pg_stat_activity where application_name = 'lock-holder' and wait_event = 'PgSleep')"
curl --silent --output /dev/null --write-out '%{http_code}' --header "Cookie: ${cookie}" --request DELETE \
    "${ARTISTS}/${passing}" > "${FILES}/delete" &
wait_for_sql "select exists (select from pg_stat_activity where wait_event_type = 'Lock' and query ilike 'delete from \"artists\"%')"
curl --silent --output /dev/null --write-out '%{http_code}' --header "Cookie: ${cookie}" --request PUT \
    --form-string "collective=$(profile "$brume" "$passing")" "${COLLECTIVES}/${ondes}" > "${FILES}/put" &
wait_for_sql "select exists (select from pg_stat_activity where wait_event_type = 'Lock' and query ilike 'select %for share')"
sql "select pg_cancel_backend(pid) from pg_stat_activity where application_name = 'lock-holder'" >/dev/null
wait
[ "$(cat "${FILES}/delete")" = 200 ] || fail "expected the artist to be deleted, got $(cat "${FILES}/delete")"
[ "$(cat "${FILES}/put")" = 400 ] || fail "expected the collective's member not to exist anymore, got $(cat "${FILES}/put")"
admin GET "${COLLECTIVES}/${ondes}"
expect_body_contains "\"members\":[{\"id\":\"${brume}\",\"name\":\"Brume\"}]"

echo "  deleting a collective keeps its members, and deletes its photo"
send collective PUT "${COLLECTIVES}/${ondes}" "$(profile "$brume")" "${FILES}/photo.jpg"
expect_status 200
admin DELETE "${COLLECTIVES}/${ondes}"
expect_status 200
admin GET "${COLLECTIVES}/${ondes}"
expect_status 404
[ "$(photos_on_disk collectives)" = 0 ] || fail "expected the deleted collective's photo to be deleted"
admin GET "${ARTISTS}/${brume}"
expect_status 200
expect_body_contains '"collectives":[]'

echo "  a collective that doesn't exist can't be viewed, changed or deleted"
for id in "$NOBODY" not-a-uuid; do
    admin GET "${COLLECTIVES}/${id}"
    expect_status 404
    admin GET "${COLLECTIVES}/${id}/photo"
    expect_status 404
    send collective PUT "${COLLECTIVES}/${id}" "$(profile "$brume")"
    expect_status 404
    admin DELETE "${COLLECTIVES}/${id}"
    expect_status 404
done

admin DELETE "${COLLECTIVES}/${aube}"
expect_status 200
for removed in "$brume" "$cyan" "$legacy"; do
    admin DELETE "${ARTISTS}/${removed}"
    expect_status 200
done
