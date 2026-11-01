#!/usr/bin/env bash
#
# Sourced by every check. Provides simple utilities to test and produce useful error messages
# on failure.

# -E makes the ERR trap below fire inside functions too. Without it, a command failing in a helper
# (e.g. curl failing to connect in `request`) would end the check without saying why.
set -Eeuo pipefail

trap 'echo "  FAILED ${0##*/}:${LINENO} -> ${BASH_COMMAND}" >&2' ERR

# Set by `request`, read by the expect_* helpers.
STATUS=""
BODY=""
HEADERS=""

_show_body() {
    echo "  actual status: ${STATUS}" >&2
    echo "  actual body:" >&2
    printf '%s\n' "$BODY" | head -10 | cut -c1-200 | sed 's/^/    /' >&2
}

# fail <message> -- fail the check, saying why.
fail() {
    echo "  $1" >&2
    exit 1
}

# request <curl args...> -- perform a request, capturing status, headers and body.
#
# Deliberately does not use --fail: a check asserts the status itself, and --fail would turn an
# unexpected one into a bare non-zero exit with nothing to read.
request() {
    local body_file header_file
    body_file="$(mktemp)"
    header_file="$(mktemp)"
    STATUS="$(curl --silent --output "$body_file" --dump-header "$header_file" \
        --write-out '%{http_code}' "$@")"
    BODY="$(cat "$body_file")"
    HEADERS="$(tr -d '\r' < "$header_file")"
    rm -f "$body_file" "$header_file"
}

# login <client address> <email> <password> -- attempt a login, as a client at that address.
#
# Logins are rate limited per CF-Connecting-IP, so checks that log in use addresses of their own.
login() {
    request --header "CF-Connecting-IP: $1" --header 'Content-Type: application/json' \
        --data "{\"email\":\"$2\",\"password\":\"$3\"}" "${BASE_URL}/api/auth/login"
}

# session_cookie -- the session cookie set by the last request, e.g. a login, as a Cookie header's value.
#
# The cookie is marked Secure, which curl won't send back over http://, so checks replay it by hand.
session_cookie() {
    printf '%s' "$HEADERS" | sed -n 's/^[Ss]et-[Cc]ookie: *\(session=[^;]*\).*/\1/p'
}

# create_admin <args...> -- run the create-admin command in the server's container, as tools/create-admin does in
# production, capturing what it prints (OUTPUT) and its exit status (EXIT_STATUS).
OUTPUT=""
EXIT_STATUS=""
#
# The output goes through a file rather than $(...), where the ERR trap above would report the command failing even when
# that's what the check expects.
create_admin() {
    local output_file
    output_file="$(mktemp)"
    EXIT_STATUS=0
    docker exec "$CONTAINER" node server/dist/create-admin.js "$@" >"$output_file" 2>&1 || EXIT_STATUS=$?
    OUTPUT="$(cat "$output_file")"
    rm -f "$output_file"
}

# invite_token -- the token in the invite link the last create_admin printed.
invite_token() {
    printf '%s' "$OUTPUT" | sed -n 's/.*accept-invite?token=\([0-9a-f]*\).*/\1/p'
}

# accept_invite <token> <password> -- accept an invite, choosing a password.
accept_invite() {
    request --header 'Content-Type: application/json' \
        --data "{\"token\":\"$1\",\"password\":\"$2\"}" "${BASE_URL}/api/auth/accept-invite"
}

# expect_output <string> -- expect what the last create_admin printed to contain the string, and it to have succeeded.
expect_output() {
    if [ "$EXIT_STATUS" != 0 ] || ! printf '%s' "$OUTPUT" | grep -Fq -- "$1"; then
        echo "  expected create-admin to succeed, saying: $1" >&2
        echo "  actual exit status: ${EXIT_STATUS}" >&2
        printf '%s\n' "$OUTPUT" | sed 's/^/    /' >&2
        exit 1
    fi
}

# photos_on_disk [<folder>] -- how many photos the server keeps in a folder, artists' unless it says collectives', in the
# directory that stands in for the private bucket.
photos_on_disk() {
    local folder="/tmp/private-bucket/${1:-artists}"
    docker exec "$CONTAINER" sh -c "if [ -d '${folder}' ]; then find '${folder}' -type f; fi" | wc -l | tr -d ' '
}

# body_field <name> -- the string field with this name in the body of the last request (the last one, if there are
# several).
body_field() {
    printf '%s' "$BODY" | sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p"
}

# body_id -- the "id" in the body of the last request, e.g. of what it created.
body_id() {
    body_field id
}

# first_id -- the first "id" in the body of the last request, e.g. that of a collective rather than its members'.
first_id() {
    printf '%s' "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4
}

# sql <query> -- run a query in the database, and print its result, without headers or alignment.
sql() {
    docker exec "$PG" psql --quiet --no-align --tuples-only --username parking_radio --dbname parking_radio --command "$1"
}

# expect_status <code>
expect_status() {
    if [ "$STATUS" != "$1" ]; then
        echo "  expected status $1" >&2
        _show_body
        exit 1
    fi
}

# expect_body <extended regex>
expect_body() {
    if ! printf '%s' "$BODY" | grep -Eq -- "$1"; then
        echo "  expected body to match: $1" >&2
        _show_body
        exit 1
    fi
}

# expect_body_contains <string>
expect_body_contains() {
    if ! printf '%s' "$BODY" | grep -Fq -- "$1"; then
        echo "  expected body to contain: $1" >&2
        _show_body
        exit 1
    fi
}

# expect_header <name> <extended regex>
#
# The name is matched case-insensitively, since HTTP does not fix a casing for it. The regex is
# grouped so that an alternation in it (e.g. 'a|b') applies to the value of that header only.
expect_header() {
    if ! printf '%s' "$HEADERS" | grep -iEq "^$1: *($2)"; then
        echo "  expected a $1 header matching: $2" >&2
        printf '%s\n' "$HEADERS" | sed 's/^/    /' >&2
        exit 1
    fi
}
