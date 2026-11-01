#!/usr/bin/env bash
#
# Checks the migration that turns the artists whose `kind` was "collective", as collectives were before they had their
# own profiles, into collectives (server/drizzle/0004_collectives.sql), on a database that a server from before it left,
# since the other checks start from an empty database, where it has nothing to migrate. It can be deleted once
# production has migrated.
#
# The database gets the migrations up to 0003, as production has them, applied by the image's own migrator, then legacy
# collectives and an artist. A server of the image is started on it, which migrates it: each legacy collective becomes a
# collective with the same id and everything it had, whatever it left out, including its photo, which the server still
# serves, an artist for each of its artists' names, in order, with its genres, even when another artist has that name,
# and its applications, while everything else stays, and artists lose `kind` and `members`.

source "$(dirname "$0")/lib.sh"

readonly SERVER="${CONTAINER}-legacy"
trap 'docker rm --force "$SERVER" >/dev/null 2>&1 || true' EXIT

# The legacy collectives: Les Ondes, which applied through the form, with a photo, three artists, one of whom has the name
# of an artist who exists, and two applications, and Béton, which an admin added, leaving out what admins can, but its
# email, with a single artist and no applications. Then an artist, Ana, with everything, and an application.
readonly ONDES=10000000-0000-4000-8000-000000000001
readonly BETON=10000000-0000-4000-8000-000000000002
readonly ANA=10000000-0000-4000-8000-000000000003
readonly LEGACY_DATA="
insert into artists (id, created_at, created_by, email, kind, name, members, country, city, genres, bio, links, phone,
                     photo_key, photo_type, updated_by, updated_at)
values ('${ONDES}', '2026-01-02T03:04:05Z', null, 'ondes@legacy.test', 'collective', 'Les Ondes', '{Une,Deux,Ana}', 'CA',
        'Québec', '{techno,acid}', 'Une bio.', '{\"instagram\": \"lesondes\"}', '418 555-0100', 'artists/legacy.jpg',
        'image/jpeg', 'admin@legacy.test', '2026-02-03T04:05:06Z'),
       ('${BETON}', '2026-03-04T05:06:07Z', 'admin@legacy.test', 'beton@legacy.test', 'collective', 'Béton', '{Solo}', '',
        '', '{}', '', '{}', '', null, null, null, null),
       ('${ANA}', '2026-04-05T06:07:08Z', null, 'ana@legacy.test', 'artist', 'Ana', '{}', 'CA', 'Montréal', '{house}',
        'Une bio.', '{\"web\": \"https://ana.example\"}', '514 555-0100', 'artists/ana.png', 'image/png',
        'admin@legacy.test', '2026-05-06T07:08:09Z');
insert into applications (id, created_by, artist_id, received_at, dates, time_slots, prestations, other_prestation,
                          details, status, status_updated_by, status_updated_at)
values ('20000000-0000-4000-8000-000000000001', null, '${ONDES}', '2026-01-02T03:04:05Z', '{2026-06-01}', '[]', '{dj}',
        '', '', 'accepted', 'admin@legacy.test', '2026-01-10T00:00:00Z'),
       ('20000000-0000-4000-8000-000000000002', 'admin@legacy.test', '${ONDES}', '2026-02-02T00:00:00Z', '{2026-07-01}',
        '[]', '{}', 'Synthé', 'Une question.', 'new', null, null),
       ('20000000-0000-4000-8000-000000000003', null, '${ANA}', '2026-04-05T06:07:08Z', '{2026-08-01}', '[]', '{dj}', '',
        '', 'done', 'admin@legacy.test', '2026-08-02T00:00:00Z');
"

# expect_rows <query> <rows> -- expect the query, on the legacy database, to give these rows, one per line, with their
# columns separated by "|".
expect_rows() {
    local actual
    actual="$(sql "$1" legacy)"
    if [ "$actual" != "$2" ]; then
        echo "  expected the rows of: $1" >&2
        printf '%s\n' "$2" | sed 's/^/    /' >&2
        echo "  actual rows:" >&2
        printf '%s\n' "$actual" | sed 's/^/    /' >&2
        exit 1
    fi
}

# The legacy database, with the migrations up to 0003, applied as a server from back then applied them, with its own
# migrator, from the image's migrations.
sql "create database legacy"
docker exec --interactive --workdir /app --env DATABASE_URL="postgres://parking_radio:parking_radio@${PG}:5432/legacy" \
    "$CONTAINER" node --input-type=module - <<'EOF'
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
const folder = '/tmp/migrations-legacy'
cpSync('server/drizzle', folder, { recursive: true })
const journal = JSON.parse(readFileSync(`${folder}/meta/_journal.json`, 'utf8'))
journal.entries = journal.entries.filter((entry) => entry.idx <= 3)
writeFileSync(`${folder}/meta/_journal.json`, JSON.stringify(journal))
const db = drizzle(process.env.DATABASE_URL)
await migrate(db, { migrationsFolder: folder })
await db.$client.end()
EOF
sql "$LEGACY_DATA" legacy

echo "  the legacy collectives become collectives, with their artists and their applications"
run_server "$SERVER" legacy
BASE_URL="http://$(docker port "$SERVER" 3000/tcp)"
if ! wait_until 60 curl --silent --fail "${BASE_URL}/healthz"; then
    docker logs "$SERVER" >&2
    fail "the server never started on the legacy database"
fi

expect_rows "select id, created_at, coalesce(created_by, '-'), name, country, city, description, links, email, phone,
                    coalesce(photo_key, '-'), coalesce(photo_type, '-'), coalesce(updated_by, '-'),
                    coalesce(updated_at::text, '-')
             from collectives order by name" "\
${BETON}|2026-03-04 05:06:07+00|admin@legacy.test|Béton||||{}|beton@legacy.test||-|-|-|-
${ONDES}|2026-01-02 03:04:05+00|-|Les Ondes|CA|Québec|Une bio.|{\"instagram\": \"lesondes\"}|ondes@legacy.test|418 555-0100|artists/legacy.jpg|image/jpeg|admin@legacy.test|2026-02-03 04:05:06+00"

# Each one's artists, in order. The new ones are known only by their name, with the legacy collective's genres, and were
# added when and by whom it was. Ana's name gets a new artist too, rather than being taken for Ana.
expect_rows "select collectives.name, position, artists.name, coalesce(artists.email, '-'), artists.country,
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
Les Ondes|2|Ana|-|||{techno,acid}||{}||-|2026-01-02 03:04:05+00|-|-|-"

# The other artists: Ana, as she was.
expect_rows "select id, email, name, country, city, genres, bio, links, phone, photo_key, photo_type, created_at,
                    coalesce(created_by, '-'), updated_by, updated_at
             from artists where id not in (select artist_id from collective_members)" "\
${ANA}|ana@legacy.test|Ana|CA|Montréal|{house}|Une bio.|{\"web\": \"https://ana.example\"}|514 555-0100|artists/ana.png|image/png|2026-04-05 06:07:08+00|-|admin@legacy.test|2026-05-06 07:08:09+00"

expect_rows "select id, coalesce(artist_id::text, '-'), coalesce(collective_id::text, '-'), coalesce(created_by, '-'),
                    received_at, other_prestation, details, status, coalesce(status_updated_by, '-')
             from applications order by id" "\
20000000-0000-4000-8000-000000000001|-|${ONDES}|-|2026-01-02 03:04:05+00|||accepted|admin@legacy.test
20000000-0000-4000-8000-000000000002|-|${ONDES}|admin@legacy.test|2026-02-02 00:00:00+00|Synthé|Une question.|new|-
20000000-0000-4000-8000-000000000003|${ANA}|-|-|2026-04-05 06:07:08+00|||done|admin@legacy.test"

expect_rows "select column_name from information_schema.columns
             where table_name = 'artists' and column_name in ('kind', 'members')" ""
expect_rows "select count(*) from drizzle.__drizzle_migrations" 5

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
