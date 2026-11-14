#!/usr/bin/env bash
#
# Apps are connected through OAuth, end to end against a real database: an admin allows an app, which exchanges its code
# for tokens and refreshes them, and its connection ends when a code or a refresh token is used twice, even at the same
# time, when the admin disconnects it, is revoked or chooses a new password, or after going unused. The unit tests check
# the token endpoint against a stand-in for the store.
#
# The server's address, which is the issuer, is the dev server's (see OAuth in lib.sh).

source "$(dirname "$0")/lib.sh"

readonly IP=198.51.100.22
readonly CONNECTIONS="${BASE_URL}/api/admin/connections"
readonly FILES="$(mktemp -d)"
trap 'rm -rf "$FILES"' EXIT

# refresh <refresh token> [<scope>] -- get new tokens with a refresh token.
refresh() {
    local scope=()
    if [ -n "${2:-}" ]; then scope=(--data-urlencode "scope=$2"); fi
    request --data-urlencode grant_type=refresh_token --data-urlencode "refresh_token=$1" \
        --data-urlencode "client_id=${CLAUDE}" ${scope[@]+"${scope[@]}"} "$TOKEN_ENDPOINT"
}

# connect -- connect Claude as the admin of `cookie`, setting `access` and `refresh` to its tokens, and `connection` to
# its id.
connect() {
    exchange "$(authorize)"
    expect_status 200
    access="$(body_field access_token)"
    refresh="$(body_field refresh_token)"
    connection="$(connection_of "$access")"
}

# expect_connected <id> / expect_disconnected <id> -- expect the connection to be there, or not anymore.
expect_connected() {
    [ "$(sql "select count(*) from oauth_connections where id = '$1'")" = 1 ] || fail "expected connection $1 to be there"
}
expect_disconnected() {
    [ "$(sql "select count(*) from oauth_connections where id = '$1'")" = 0 ] || fail "expected connection $1 to have ended"
}

# expect_error <OAuth error> -- expect the last request to have failed with this error.
expect_error() {
    expect_status 400
    expect_body "\"error\":\"$1\""
}

readonly ADMIN_COOKIE="$(session_of "$ADMIN_EMAIL" "$ADMIN_PASSWORD")"
cookie="$ADMIN_COOKIE"

echo "  the metadata documents say where the endpoints are, at the site's address"
request "${BASE_URL}/.well-known/oauth-authorization-server"
expect_status 200
expect_body_contains "\"issuer\":\"${ISSUER}\""
expect_body_contains "\"token_endpoint\":\"${ISSUER}/api/oauth/token\""
request "${BASE_URL}/.well-known/oauth-protected-resource/mcp"
expect_status 200
expect_body_contains "\"resource\":\"${ISSUER}/mcp\""

echo "  the site serves the Parking Radio CLI's document, whose id, name and redirect URIs are those the server knows"
request "${BASE_URL}/oauth/parkingradio-cli.json"
expect_status 200
expect_header Content-Type 'application/json'
expect_body_lacks '<!doctype html>'
cli="$(body_field client_id)"
[ "$cli" = "https://parking.radio/oauth/parkingradio-cli.json" ] || fail "expected the production client_id, got: ${cli}"
[ "$(body_field client_name)" = "Parking Radio CLI" ] || fail "expected the client_name the pages show"
# Its redirect URIs, on localhost and 127.0.0.1, with the port the app would listen on.
cli_document="$BODY"
for host in localhost 127.0.0.1; do
    callback="$(printf '%s' "$cli_document" | grep -o "\"http://${host//./\\.}/[^\"]*\"" | tr -d '"' | sed "s|${host}|&:3118|")"
    json GET "${AUTHORIZATION}?response_type=code&client_id=${cli}&redirect_uri=${callback}&code_challenge=${CHALLENGE}&code_challenge_method=S256"
    expect_status 200
    expect_body_contains "\"client\":\"Parking Radio CLI\",\"redirectHost\":\"${host}\",\"local\":true"
done

echo "  an app is allowed, exchanges its code for tokens, and is listed with its connection"
connect
expect_header Cache-Control 'no-store'
json GET "$CONNECTIONS"
expect_status 200
expect_body_contains "{\"id\":\"${connection}\",\"client\":\"Claude\",\"scopes\":[\"admin\"]"

echo "  refreshing gives new tokens, and can keep fewer scopes"
refresh "$refresh" admin
expect_status 200
expect_body_contains '"scope":"admin"'
newer="$(body_field refresh_token)"
[ "$(connection_of "$(body_field access_token)")" = "$connection" ] || fail "expected the refresh to keep the connection"
refresh "$newer" other-scope
expect_error invalid_scope

echo "  a refresh token used again ends its connection, even an older one"
refresh "$newer"
expect_status 200
newest="$(body_field refresh_token)"
refresh "$refresh"
expect_error invalid_grant
expect_disconnected "$connection"
refresh "$newest"
expect_error invalid_grant

echo "  a code used again ends the connection it made"
code="$(authorize)"
exchange "$code"
expect_status 200
connection="$(connection_of "$(body_field access_token)")"
exchange "$code"
expect_error invalid_grant
expect_disconnected "$connection"

echo "  the app ends its connection, with its access token or its refresh token"
connect
request --data-urlencode "token=${access}" --data-urlencode "client_id=${CLAUDE}" "${BASE_URL}/api/oauth/revoke"
expect_status 200
expect_disconnected "$connection"
connect
request --data-urlencode "token=${refresh}" --data-urlencode "client_id=${CLAUDE}" "${BASE_URL}/api/oauth/revoke"
expect_status 200
expect_disconnected "$connection"

echo "  an admin disconnects their app, which another admin can't"
connect
new_admin "other@oauth.integration.test" other-password
other_cookie="$(session_of "other@oauth.integration.test" other-password)"
request --request DELETE --header "Cookie: ${other_cookie}" "${CONNECTIONS}/${connection}"
expect_status 404
expect_connected "$connection"
json DELETE "${CONNECTIONS}/${connection}"
expect_status 200
expect_disconnected "$connection"
refresh "$refresh"
expect_error invalid_grant

echo "  a new password ends the admin's connections, and the codes they were given"
readonly RESET_EMAIL="reset@oauth.integration.test"
new_admin "$RESET_EMAIL" first-password
cookie="$(session_of "$RESET_EMAIL" first-password)"
connect
code="$(authorize)"
create_admin "$RESET_EMAIL"
accept_invite "$(invite_token)" second-password
expect_status 200
expect_disconnected "$connection"
refresh "$refresh"
expect_error invalid_grant
exchange "$code"
expect_error invalid_grant

echo "  revoking an admin ends their connections"
cookie="$other_cookie"
connect
cookie="$ADMIN_COOKIE"
json DELETE "${BASE_URL}/api/admin/admins/$(sql "select id from users where email = 'other@oauth.integration.test'")"
expect_status 200
expect_disconnected "$connection"

echo "  a connection whose refresh token went unused ends, and is cleaned up with expired codes"
connect
sql "update oauth_refresh_tokens set expires_at = now() - interval '1 second' where connection_id = '${connection}';
     update oauth_connections set expires_at = now() - interval '1 second' where id = '${connection}'" >/dev/null
json GET "$CONNECTIONS"
expect_status 200
if printf '%s' "$BODY" | grep -Fq "$connection"; then fail "expected connection ${connection} not to be listed"; fi
refresh "$refresh"
expect_error invalid_grant
authorize >/dev/null
expect_disconnected "$connection"

# race_in_background <name> <curl args...> -- send a request without waiting for its response, whose status is then in
# ${FILES}/<name>.
race_in_background() {
    local name="$1"
    shift
    curl --silent --output /dev/null --write-out '%{http_code}' "$@" > "${FILES}/${name}" &
}

# wait_for_both -- wait until two requests wait for the row that hold_row holds, release it, then wait for their answers.
wait_for_both() {
    wait_for_sql "select count(*) = 2 from pg_stat_activity where wait_event_type = 'Lock' and query ilike 'update %'"
    release_row
    wait
}

echo "  a refresh token used twice at the same time ends its connection"
connect
hold_row oauth_refresh_tokens "$(sql "select id from oauth_refresh_tokens where connection_id = '${connection}'")"
for name in first second; do
    race_in_background "$name" --data-urlencode grant_type=refresh_token --data-urlencode "refresh_token=${refresh}" \
        --data-urlencode "client_id=${CLAUDE}" "$TOKEN_ENDPOINT"
done
wait_for_both
expect_disconnected "$connection"
[ "$(cat "${FILES}/first" "${FILES}/second" | grep -c 200 || true)" -le 1 ] || fail "expected at most one refresh to succeed"

echo "  a code used twice at the same time doesn't leave a connection"
code="$(authorize)"
before="$(sql "select count(*) from oauth_connections")"
hold_row oauth_codes "$(sql "select id from oauth_codes where code_hash = $(token_hash "$code")")"
for name in first second; do
    race_in_background "$name" --data-urlencode grant_type=authorization_code --data-urlencode "code=${code}" \
        --data-urlencode "client_id=${CLAUDE}" --data-urlencode "redirect_uri=${CALLBACK}" \
        --data-urlencode "code_verifier=${VERIFIER}" "$TOKEN_ENDPOINT"
done
wait_for_both
[ "$(sql "select count(*) from oauth_connections")" = "$before" ] || fail "expected the code not to leave a connection"

echo "  a code used again while its connection is being made ends that connection once it's made"
# The exchange that used the code is played by psql, which makes the connection and links it to the code under the code's
# lock, as the server does, then waits for a lock that another session holds before it commits. The code is used again in
# the meantime, which waits for the code's lock, and only finds the connection once the exchange commits.
code="$(authorize)"
sql "update oauth_codes set used_at = now() where code_hash = $(token_hash "$code")" >/dev/null
docker exec --env PGAPPNAME=lock-holder "$PG" psql --quiet --username parking_radio --dbname parking_radio --command \
    "select pg_advisory_lock(22); select pg_sleep(30);" >/dev/null 2>&1 &
wait_for_sql "select exists (select from pg_stat_activity where application_name = 'lock-holder' and wait_event = 'PgSleep')"
docker exec --env PGAPPNAME=exchange "$PG" psql --quiet --username parking_radio --dbname parking_radio --command \
    "begin;
     select from oauth_codes where code_hash = $(token_hash "$code") for update;
     with connection as (
         insert into oauth_connections (user_id, client_id, scopes, expires_at, access_token_hash, access_token_expires_at)
         select user_id, client_id, scopes, now() + interval '1 day', 'being-made', now() + interval '1 hour'
         from oauth_codes where code_hash = $(token_hash "$code") returning id)
     update oauth_codes set connection_id = (select id from connection) where code_hash = $(token_hash "$code");
     select pg_advisory_lock(22);
     commit;" >/dev/null 2>&1 &
wait_for_sql "select exists (select from pg_stat_activity where application_name = 'exchange' and wait_event_type = 'Lock')"
race_in_background replay --data-urlencode grant_type=authorization_code --data-urlencode "code=${code}" \
    --data-urlencode "client_id=${CLAUDE}" --data-urlencode "redirect_uri=${CALLBACK}" \
    --data-urlencode "code_verifier=${VERIFIER}" "$TOKEN_ENDPOINT"
wait_for_sql "select exists (select from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%delete from \"oauth_codes\"%')"
release_row
wait
[ "$(cat "${FILES}/replay")" = 400 ] || fail "expected the code used again to be refused, got $(cat "${FILES}/replay")"
[ "$(sql "select count(*) from oauth_connections where access_token_hash = 'being-made'")" = 0 ] \
    || fail "expected the connection the code made to have ended"
