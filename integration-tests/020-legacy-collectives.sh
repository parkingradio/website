#!/usr/bin/env bash
#
# Checks the migration that turns the artists whose `kind` was "collective", as collectives were before they had their
# own profiles, into collectives (server/drizzle/0007_legacy_collectives.sql), on a database that a server from before it
# left, since the other checks start from an empty database, where it has nothing to migrate. It can be deleted once
# production has migrated.
#
# The database gets the migrations up to 0006, applied by the image's own migrator, then legacy collectives, one of which
# has the email of a collective, and another one is a member of a collective. A server of the image is started on it,
# which migrates it:
# - while a legacy collective has the email of a collective, or is a member of one, the server doesn't start, and says
#   which one it is, without its email, and the database is as it was
# - once that's fixed and the server started again, each legacy collective becomes a collective with the same id and
#   everything it had, whatever it left out, including its photo, which the server still serves, an artist for each of
#   its artists' names, in order, with its genres, even when another artist has that name, and its applications, while
#   everything else stays, and artists lose `kind` and `members`
#
# Production has none of the migrations since 0003, which it then gets all at once: another database, with the
# migrations up to 0003 and a legacy collective, checks that it migrates the same way.

source "$(dirname "$0")/lib.sh"

readonly SERVER="${CONTAINER}-legacy"
readonly SERVER_0003="${CONTAINER}-legacy-0003"
trap 'docker rm --force "$SERVER" "$SERVER_0003" >/dev/null 2>&1 || true' EXIT

# The legacy collectives: Les Ondes, which applied through the form, with a photo, three artists, one of whom has the name
# of an artist who exists, and two applications, and Béton, which an admin added, leaving out what admins can, but its
# email, with a single artist and no applications. Then an artist, Ana, with an application, a collective, of Ana, and
# another one, which has the email of Les Ondes, whatever its case.
readonly ONDES=10000000-0000-4000-8000-000000000001
readonly BETON=10000000-0000-4000-8000-000000000002
readonly ANA=10000000-0000-4000-8000-000000000003
readonly NOUVELLES=10000000-0000-4000-8000-000000000004
readonly ENCORE=10000000-0000-4000-8000-000000000005
readonly LEGACY_DATA="
insert into artists (id, created_at, created_by, email, kind, name, members, country, city, genres, bio, links, phone,
                     photo_key, photo_type, updated_by, updated_at)
values ('${ONDES}', '2026-01-02T03:04:05Z', null, 'ondes@legacy.test', 'collective', 'Les Ondes', '{Une,Deux,Ana}', 'CA',
        'Québec', '{techno,acid}', 'Une bio.', '{\"instagram\": \"lesondes\"}', '418 555-0100', 'artists/legacy.jpg',
        'image/jpeg', 'admin@legacy.test', '2026-02-03T04:05:06Z'),
       ('${BETON}', '2026-03-04T05:06:07Z', 'admin@legacy.test', 'beton@legacy.test', 'collective', 'Béton', '{Solo}', '',
        '', '{}', '', '{}', '', null, null, null, null),
       ('${ANA}', '2026-04-05T06:07:08Z', null, 'ana@legacy.test', 'artist', 'Ana', '{}', 'CA', 'Montréal', '{house}',
        'Une bio.', '{\"web\": \"https://ana.example\"}', '514 555-0100', null, null, null, null);
insert into applications (id, created_by, artist_id, received_at, dates, time_slots, prestations, other_prestation,
                          details, status, status_updated_by, status_updated_at)
values ('20000000-0000-4000-8000-000000000001', null, '${ONDES}', '2026-01-02T03:04:05Z', '{2026-06-01}', '[]', '{dj}',
        '', '', 'accepted', 'admin@legacy.test', '2026-01-10T00:00:00Z'),
       ('20000000-0000-4000-8000-000000000002', 'admin@legacy.test', '${ONDES}', '2026-02-02T00:00:00Z', '{2026-07-01}',
        '[]', '{}', 'Synthé', 'Une question.', 'new', null, null),
       ('20000000-0000-4000-8000-000000000003', null, '${ANA}', '2026-04-05T06:07:08Z', '{2026-08-01}', '[]', '{dj}', '',
        '', 'new', null, null);
insert into collectives (id, created_at, created_by, name, country, city, description, links, email, phone)
values ('${NOUVELLES}', '2026-05-06T07:08:09Z', 'admin@legacy.test', 'Nouvelles Ondes', '', '', '', '{}',
        'nouvelles@legacy.test', ''),
       ('${ENCORE}', '2026-06-07T08:09:10Z', 'admin@legacy.test', 'Les Ondes, encore', '', '', '', '{}',
        'ONDES@legacy.test', '');
insert into collective_members (collective_id, artist_id, position) values ('${NOUVELLES}', '${ANA}', 0);
"

# legacy_database <name> <migration> -- a database with the migrations up to that one, e.g. 0006_applications_collectives,
# applied as a server from back then applied them, with its own migrator, from the image's migrations.
legacy_database() {
    sql "create database $1"
    docker exec --interactive --workdir /app --env DATABASE_URL="postgres://parking_radio:parking_radio@${PG}:5432/$1" \
        --env MIGRATIONS="/tmp/migrations-$1" --env LAST="$2" "$CONTAINER" node --input-type=module - <<'EOF'
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
const folder = process.env.MIGRATIONS
cpSync('server/drizzle', folder, { recursive: true })
const journal = JSON.parse(readFileSync(`${folder}/meta/_journal.json`, 'utf8'))
journal.entries = journal.entries.slice(0, journal.entries.findIndex((entry) => entry.tag === process.env.LAST) + 1)
writeFileSync(`${folder}/meta/_journal.json`, JSON.stringify(journal))
const db = drizzle(process.env.DATABASE_URL)
await migrate(db, { migrationsFolder: folder })
await db.$client.end()
EOF
}

# expect_rows <database> <query> <rows> -- expect the query to give these rows, one per line, with their columns
# separated by "|".
expect_rows() {
    local actual
    actual="$(sql "$2" "$1")"
    if [ "$actual" != "$3" ]; then
        echo "  expected the rows of: $2" >&2
        printf '%s\n' "$3" | sed 's/^/    /' >&2
        echo "  actual rows:" >&2
        printf '%s\n' "$actual" | sed 's/^/    /' >&2
        exit 1
    fi
}

# expect_failed_migration <error> -- expect the server to stop when it migrates the legacy database, with this error in
# its log, without the emails of the legacy collectives, and the database to be as it was.
expect_failed_migration() {
    wait_until 60 sh -c "[ \"\$(docker inspect --format '{{.State.Running}}' '${SERVER}')\" = false ]" ||
        fail "expected the server to stop"
    [ "$(docker inspect --format '{{.State.ExitCode}}' "$SERVER")" = 1 ] || fail "expected the server to exit with 1"
    local log
    log="$(docker logs "$SERVER" 2>&1)"
    printf '%s' "$log" | grep -Fq "$1" || { printf '%s\n' "$log" | tail -5 >&2; fail "expected the error to say: $1"; }
    if printf '%s' "$log" | grep -iEq '(ondes|beton)@legacy.test'; then fail "expected the error to leave out the emails"; fi
    expect_rows legacy "select count(*) from artists where kind = 'collective'" 2
    expect_rows legacy "select count(*) from artists" 3
    expect_rows legacy "select count(*) from collectives" 2
    expect_rows legacy "select count(*) from applications where artist_id = '${ONDES}'" 2
    expect_rows legacy "select count(*) from drizzle.__drizzle_migrations" 7
}

legacy_database legacy 0006_applications_collectives
sql "$LEGACY_DATA" legacy
sql "insert into collective_members (collective_id, artist_id, position) values ('${NOUVELLES}', '${BETON}', 1)" legacy

echo "  a legacy collective with a collective's email stops the migration, which changes nothing"
run_server "$SERVER" legacy
expect_failed_migration "have the email of a collective, so they can't become collectives: Les Ondes (${ONDES})"

echo "  and so does a legacy collective that's a member of a collective"
sql "update collectives set email = 'encore@legacy.test' where id = '${ENCORE}'" legacy
docker start "$SERVER" >/dev/null
expect_failed_migration "are members of collectives, so they can't become collectives: Béton (${BETON})"

echo "  once that's fixed, the legacy collectives become collectives, with their artists and their applications"
sql "delete from collective_members where artist_id = '${BETON}'" legacy
docker start "$SERVER" >/dev/null
BASE_URL="http://$(docker port "$SERVER" 3000/tcp)"
if ! wait_until 60 curl --silent --fail "${BASE_URL}/healthz"; then
    docker logs "$SERVER" >&2
    fail "the server never started on the legacy database"
fi

expect_rows legacy "select id, created_at, coalesce(created_by, '-'), name, country, city, description, links, email,
                           phone, coalesce(photo_key, '-'), coalesce(photo_type, '-'), coalesce(updated_by, '-'),
                           coalesce(updated_at::text, '-')
                    from collectives order by name" "\
${BETON}|2026-03-04 05:06:07+00|admin@legacy.test|Béton||||{}|beton@legacy.test||-|-|-|-
${ONDES}|2026-01-02 03:04:05+00|-|Les Ondes|CA|Québec|Une bio.|{\"instagram\": \"lesondes\"}|ondes@legacy.test|418 555-0100|artists/legacy.jpg|image/jpeg|admin@legacy.test|2026-02-03 04:05:06+00
${ENCORE}|2026-06-07 08:09:10+00|admin@legacy.test|Les Ondes, encore||||{}|encore@legacy.test||-|-|-|-
${NOUVELLES}|2026-05-06 07:08:09+00|admin@legacy.test|Nouvelles Ondes||||{}|nouvelles@legacy.test||-|-|-|-"

# Each one's artists, in order. The new ones are known only by their name, with the legacy collective's genres, and were
# added when and by whom it was. Ana's name gets a new artist too, rather than being taken for Ana.
expect_rows legacy "select collectives.name, position, artists.name, coalesce(artists.email, '-'), artists.country,
                           artists.city, artists.genres, artists.bio, artists.links, artists.phone,
                           coalesce(artists.photo_key, '-'), artists.created_at, coalesce(artists.created_by, '-'),
                           coalesce(artists.updated_by, '-'), coalesce(artists.updated_at::text, '-')
                    from collective_members
                    join collectives on collectives.id = collective_id
                    join artists on artists.id = artist_id
                    order by collectives.name, position" "\
Béton|0|Solo|-|||{}||{}||-|2026-03-04 05:06:07+00|admin@legacy.test|-|-
Les Ondes|0|Une|-|||{techno,acid}||{}||-|2026-01-02 03:04:05+00|-|-|-
Les Ondes|1|Deux|-|||{techno,acid}||{}||-|2026-01-02 03:04:05+00|-|-|-
Les Ondes|2|Ana|-|||{techno,acid}||{}||-|2026-01-02 03:04:05+00|-|-|-
Nouvelles Ondes|0|Ana|ana@legacy.test|CA|Montréal|{house}|Une bio.|{\"web\": \"https://ana.example\"}|514 555-0100|-|2026-04-05 06:07:08+00|-|-|-"

expect_rows legacy "select id, coalesce(artist_id::text, '-'), coalesce(collective_id::text, '-'), status,
                           coalesce(status_updated_by, '-')
                    from applications order by id" "\
20000000-0000-4000-8000-000000000001|-|${ONDES}|accepted|admin@legacy.test
20000000-0000-4000-8000-000000000002|-|${ONDES}|new|-
20000000-0000-4000-8000-000000000003|${ANA}|-|new|-"

expect_rows legacy "select count(*) from artists where id in ('${ONDES}', '${BETON}')" 0
# Ana, and the new artists.
expect_rows legacy "select count(*) from artists" 5
expect_rows legacy "select column_name from information_schema.columns
                    where table_name = 'artists' and column_name in ('kind', 'members')" ""

echo "  and the server serves them, with the photo they had"
docker exec "$SERVER" sh -c "mkdir -p /tmp/private-bucket/artists && printf '\377\330\377\340JFIF' > /tmp/private-bucket/artists/legacy.jpg"
CONTAINER="$SERVER" create_admin "$ADMIN_EMAIL"
expect_output "Created admin"
accept_invite "$(invite_token)" "$ADMIN_PASSWORD"
expect_status 200
login 198.51.100.40 "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
expect_status 200
cookie="$(session_cookie)"

request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/collectives/${ONDES}"
expect_status 200
expect_body '"members":\[\{"id":"[^"]*","name":"Une"\},\{"id":"[^"]*","name":"Deux"\},\{"id":"[^"]*","name":"Ana"\}\]'
expect_body_contains '"hasPhoto":true'
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/collectives/${ONDES}/photo"
expect_status 200
expect_header Content-Type 'image/jpeg'
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/applications?collective=${ONDES}"
expect_status 200
[ "$(printf '%s' "$BODY" | grep -o "\"collectiveId\":\"${ONDES}\"" | wc -l)" -eq 2 ] || { _show_body; fail "expected 2 applications"; }
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists"
expect_status 200
if printf '%s' "$BODY" | grep -Eq '"(kind|members)":'; then _show_body; fail "expected artists without kind or members"; fi

echo "  and they do from the migrations up to 0003, all at once, as production gets them"
readonly VIEILLES=10000000-0000-4000-8000-000000000006
legacy_database legacy_0003 0003_applications_received_at
sql "insert into artists (id, created_at, created_by, email, kind, name, members, country, city, genres, bio, links, phone,
                         photo_key, photo_type)
     values ('${VIEILLES}', '2025-01-02T03:04:05Z', null, 'vieilles@legacy.test', 'collective', 'Vieilles Ondes',
             '{Alpha,Beta}', 'CA', 'Québec', '{jazz}', 'Une bio.', '{}', '418 555-0101', 'artists/vieilles.png', 'image/png');
     insert into applications (id, artist_id, received_at, dates, time_slots, prestations, other_prestation, details, status)
     values ('20000000-0000-4000-8000-000000000004', '${VIEILLES}', '2025-01-02T03:04:05Z', '{2025-06-01}', '[]', '{dj}',
             '', '', 'done')" legacy_0003
run_server "$SERVER_0003" legacy_0003
if ! wait_until 60 curl --silent --fail "http://$(docker port "$SERVER_0003" 3000/tcp)/healthz"; then
    docker logs "$SERVER_0003" >&2
    fail "the server never started on the database with the migrations up to 0003"
fi
expect_rows legacy_0003 "select id, created_at, coalesce(created_by, '-'), name, description, email, photo_key from collectives" \
    "${VIEILLES}|2025-01-02 03:04:05+00|-|Vieilles Ondes|Une bio.|vieilles@legacy.test|artists/vieilles.png"
expect_rows legacy_0003 "select position, name, coalesce(email, '-'), genres, artists.created_at
                         from collective_members join artists on artists.id = artist_id order by position" "\
0|Alpha|-|{jazz}|2025-01-02 03:04:05+00
1|Beta|-|{jazz}|2025-01-02 03:04:05+00"
expect_rows legacy_0003 "select coalesce(artist_id::text, '-'), collective_id, status from applications" "-|${VIEILLES}|done"
expect_rows legacy_0003 "select count(*) from drizzle.__drizzle_migrations" 8
