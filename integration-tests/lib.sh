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

# session_of <email> <password> -- log in, as a client at the check's address (IP), and print the session cookie.
session_of() {
    login "$IP" "$1" "$2"
    expect_status 200
    session_cookie
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

# accept_invite <token> <password> [curl args...] -- accept an invite, choosing a password.
accept_invite() {
    local token="$1" password="$2"
    shift 2
    request --header 'Content-Type: application/json' "$@" \
        --data "{\"token\":\"${token}\",\"password\":\"${password}\"}" "${BASE_URL}/api/auth/accept-invite"
}

# new_admin <email> <password> -- create an admin who accepted their invite, as the create-admin command does.
new_admin() {
    create_admin "$1"
    expect_output "Created admin $1."
    accept_invite "$(invite_token)" "$2"
    expect_status 200
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

# photos_on_disk [<folder>] -- how many photos the server keeps in a folder, artists' unless it says collectives' or
# sessions' (their flyers), in the directory that stands in for the private bucket.
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

# json <method> <url> [<body>] -- send a request with a JSON body, with the session cookie in `cookie`, e.g. an admin's.
json() {
    local body=()
    if [ -n "${3:-}" ]; then body=(--header 'Content-Type: application/json' --data "$3"); fi
    request --header "Cookie: ${cookie}" --request "$1" ${body[@]+"${body[@]}"} "$2"
}

# wait_for_sql <query> -- wait, for up to 10 seconds, for the query to return true.
wait_for_sql() {
    for _ in $(seq 1 100); do
        [ "$(sql "$1")" = t ] && return 0
        sleep 0.1
    done
    fail "timed out waiting for: $1"
}

# hold_row <table> <id> -- hold the row of the table with this id from another transaction, as an update would, until
# release_row, e.g. to have requests wait for it.
hold_row() {
    docker exec --env PGAPPNAME=lock-holder "$PG" psql --quiet --username parking_radio --dbname parking_radio --command \
        "begin; select from $1 where id = '$2' for no key update; select pg_sleep(30); commit;" >/dev/null 2>&1 &
    wait_for_sql "select exists (select from pg_stat_activity where application_name = 'lock-holder' and wait_event = 'PgSleep')"
}

# release_row -- let go of the row that hold_row holds.
release_row() {
    sql "select pg_cancel_backend(pid) from pg_stat_activity where application_name = 'lock-holder'" >/dev/null
}

# OAuth (see docs/design/server/oauth.md), as Claude connects to the server. The server's address, which is the issuer,
# is the dev server's, since MAIL_DOMAIN isn't set.
readonly ISSUER="http://localhost:5173"
readonly CLAUDE="https://claude.ai/oauth/mcp-oauth-client-metadata"
readonly CALLBACK="https://claude.ai/api/mcp/auth_callback"
readonly TOKEN_ENDPOINT="${BASE_URL}/api/oauth/token"
readonly AUTHORIZATION="${BASE_URL}/api/admin/oauth/authorization"

# A PKCE verifier, and its S256 challenge, for every authorization of this check.
readonly VERIFIER="$(openssl rand -hex 32)"
readonly CHALLENGE="$(printf '%s' "$VERIFIER" | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '=\n')"

# authorize -- allow Claude as the admin of `cookie`, and print the code it gets.
authorize() {
    json POST "$AUTHORIZATION" "{\"response_type\":\"code\",\"client_id\":\"${CLAUDE}\",\"redirect_uri\":\"${CALLBACK}\",\
\"code_challenge\":\"${CHALLENGE}\",\"code_challenge_method\":\"S256\",\"state\":\"s\",\"allow\":true}"
    expect_status 200
    body_field redirect | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p'
}

# exchange <code> -- exchange a code for tokens.
exchange() {
    request --data-urlencode grant_type=authorization_code --data-urlencode "code=$1" --data-urlencode "client_id=${CLAUDE}" \
        --data-urlencode "redirect_uri=${CALLBACK}" --data-urlencode "code_verifier=${VERIFIER}" \
        --data-urlencode "resource=${ISSUER}/mcp" "$TOKEN_ENDPOINT"
}

# token_hash <code or token> -- the hash the server keeps of it, in SQL.
token_hash() {
    printf "encode(sha256(convert_to('%s', 'UTF8')), 'hex')" "$1"
}

# connection_of <access token> -- the id of the connection with this access token, if there's one.
connection_of() {
    sql "select id from oauth_connections where access_token_hash = $(token_hash "$1")"
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

# expect_body_lacks <string>
expect_body_lacks() {
    if printf '%s' "$BODY" | grep -Fq -- "$1"; then
        echo "  expected body not to contain: $1" >&2
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

# expect_no_header <name> -- matched case-insensitively, like expect_header's.
expect_no_header() {
    if printf '%s' "$HEADERS" | grep -iq "^$1:"; then
        echo "  expected no $1 header" >&2
        printf '%s\n' "$HEADERS" | sed 's/^/    /' >&2
        exit 1
    fi
}
