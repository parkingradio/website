#!/usr/bin/env bash
#
# The MCP server, end to end against a real database and the image's own design documents: Claude, connected through
# OAuth, lists the tools and calls them, as the admin who connected it, without seeing artists' emails and phone numbers,
# and can't anymore once the admin disconnects it. The unit tests check the tools against routes of their own.

source "$(dirname "$0")/lib.sh"

readonly IP=198.51.100.23
readonly MCP="${BASE_URL}/mcp"
readonly EMAIL="mcp-artist@integration.test"

# mcp <JSON-RPC message> -- send a message to the MCP server, with the access token in `access`.
mcp() {
    request --header "Authorization: Bearer ${access}" --header 'Accept: application/json, text/event-stream' \
        --header 'Content-Type: application/json' --header 'MCP-Protocol-Version: 2025-11-25' --data "$1" "$MCP"
}

# call <tool> <arguments as JSON> -- call a tool.
call() {
    mcp "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}"
    expect_status 200
}

login "$IP" "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
expect_status 200
cookie="$(session_cookie)"

echo "  without an access token, the MCP server says where to get one"
access=""
mcp '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
expect_status 401
expect_header WWW-Authenticate "Bearer resource_metadata=\"${ISSUER}/.well-known/oauth-protected-resource/mcp\", scope=\"admin\""

exchange "$(authorize)"
expect_status 200
access="$(body_field access_token)"
connection="$(connection_of "$access")"

echo "  Claude initializes, and lists the tools"
mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"integration","version":"1"}}}'
expect_status 200
expect_header Content-Type 'application/json'
expect_body_contains '"protocolVersion":"2025-11-25"'
# The server isn't told its environment, so it's development.
expect_body_contains '"serverInfo":{"name":"Parking Radio (development)"'
expect_body_contains "\"instructions\":\"This is Parking Radio's development environment, not the production site"
expect_body_contains 'Parking Radio is an independent non-profit radio.'
mcp '{"jsonrpc":"2.0","method":"notifications/initialized"}'
expect_status 202
mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
expect_status 200
expect_body_contains '"name":"create_artist","title":"Ajouter un artiste","description":"Once per conversation, before using it, read the rules with `read_documentation`, area `artists`. '
expect_body_contains '"name":"read_documentation"'

echo "  a tool adds an artist as the admin, and gives it back without its email and phone"
call create_artist "{\"name\":\"MCP Integration\",\"email\":\"${EMAIL}\",\"phone\":\"514 555 0123\",\"links\":{\"web\":\"https://example.com\"}}"
expect_body_contains '\"name\":\"MCP Integration\"'
expect_body_lacks "$EMAIL"
expect_body_lacks '\"phone\"'
artist="$(sql "select id from artists where lower(email) = '${EMAIL}'")"
[ -n "$artist" ] || fail "expected the artist to be added"
[ "$(sql "select created_by from artists where id = '${artist}'")" = "$ADMIN_EMAIL" ] || fail "expected the admin to have added the artist"

echo "  replacing the artist's profile keeps the email and phone it leaves out"
call update_artist "{\"id\":\"${artist}\",\"name\":\"MCP Integration 2\"}"
expect_body_contains '\"name\":\"MCP Integration 2\"'
[ "$(sql "select email || ' ' || phone from artists where id = '${artist}'")" = "${EMAIL} 514 555 0123" ] || fail "expected the email and phone to stay"

echo "  the artists are listed as summaries"
call list_artists '{}'
expect_body_contains "{\\\"id\\\":\\\"${artist}\\\",\\\"name\\\":\\\"MCP Integration 2\\\""
expect_body_lacks '\"bio\"'
expect_body_lacks "$EMAIL"

echo "  a tool that fails says so, with the route's error"
call create_artist "{\"name\":\"Another\",\"email\":\"${EMAIL}\"}"
expect_body_contains '"isError":true'
expect_body_contains '\"status\":409'

echo "  read_documentation gives the instructions, then the rules from the image's design documents"
call read_documentation '{"area":"sessions"}'
expect_body_contains "\"text\":\"This is Parking Radio's development environment, not the production site"
expect_body_contains '# Sessions'
expect_body_lacks '## `GET'

echo "  a request counts as using the connection, at most every few minutes"
sql "update oauth_connections set last_used_at = now() - interval '10 minutes' where id = '${connection}'" >/dev/null
call get_artist "{\"id\":\"${artist}\"}"
[ "$(sql "select last_used_at > now() - interval '1 minute' from oauth_connections where id = '${connection}'")" = t ] \
    || fail "expected the connection to have been used just now"

echo "  times are given in Québec time, and a new set's fields that can be null can be left out"
call create_session '{"start":"2026-11-14T21:00-05:00","durationMinutes":120,"takeover":null,"name":"MCP","raEvent":null}'
expect_body_contains '\"start\":\"2026-11-14T21:00:00-05:00\",\"end\":\"2026-11-14T23:00:00-05:00\"'
session="$(sql "select id from sessions where name = 'MCP'")"
call create_set "{\"id\":\"${session}\",\"performers\":[{\"id\":\"${artist}\"}],\"prestations\":[\"dj\"],\"otherPrestation\":\"\",\"genres\":[]}"
expect_body_contains '\"offsetMinutes\":null'
expect_body_contains '\"durationMinutes\":null'
expect_body_contains '\"soundcloudTrack\":null'
call delete_session "{\"id\":\"${session}\"}"

call delete_artist "{\"id\":\"${artist}\"}"
expect_body_contains '{\"ok\":true}'

echo "  only POST is answered at /mcp, and other paths under it don't exist"
request --header "Authorization: Bearer ${access}" "$MCP"
expect_status 405
expect_header Allow 'POST'
request "${MCP}/other"
expect_status 404
expect_body '^\{"ok":false,"error":"Not found"\}$'

echo "  once the admin disconnects Claude, its access token doesn't work anymore"
json DELETE "${BASE_URL}/api/admin/connections/${connection}"
expect_status 200
mcp '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
expect_status 401
expect_header WWW-Authenticate '.*error="invalid_token"'
