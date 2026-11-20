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

echo "  changing the artist only changes what it's given, which keeps the email and phone, without giving them back"
call update_artist "{\"id\":\"${artist}\",\"name\":\"MCP Integration 2\"}"
expect_body_contains '\"name\":\"MCP Integration 2\"'
expect_body_contains '\"links\":{\"web\":\"https://example.com\"}'
expect_body_lacks "$EMAIL"
expect_body_lacks '\"phone\"'
[ "$(sql "select email || ' ' || phone from artists where id = '${artist}'")" = "${EMAIL} 514 555 0123" ] || fail "expected the email and phone to stay"

echo "  the artists are listed as summaries, with their total"
call list_artists '{}'
expect_body_contains "\\\"total\\\":$(sql "select count(*) from artists"),"
expect_body_contains "{\\\"id\\\":\\\"${artist}\\\",\\\"name\\\":\\\"MCP Integration 2\\\""
expect_body_lacks '\"bio\"'
expect_body_lacks "$EMAIL"

echo "  a tool that fails says so, with the route's error"
call create_artist "{\"name\":\"Another\",\"email\":\"${EMAIL}\"}"
expect_body_contains '"isError":true'
expect_body_contains '\"status\":409'

echo "  the artist's email is only removed when it's given as null, which doesn't give it back either"
call update_artist "{\"id\":\"${artist}\",\"email\":null}"
expect_body_lacks '"isError"'
expect_body_lacks '\"email\"'
expect_body_lacks '\"phone\"'
[ "$(sql "select coalesce(email, 'none') || ' ' || phone from artists where id = '${artist}'")" = "none 514 555 0123" ] \
    || fail "expected the email to be removed, and the phone to stay"

echo "  the artist's photo, which tools can't send, is removed, which gives the artist without their phone"
sql "update artists set photo_key = 'artists/mcp.png', photo_type = 'image/png' where id = '${artist}'" >/dev/null
call delete_artist_photo "{\"id\":\"${artist}\"}"
expect_body_lacks '"isError"'
expect_body_contains '\"hasPhoto\":false'
expect_body_lacks '\"phone\"'
[ "$(sql "select coalesce(photo_key, 'none') from artists where id = '${artist}'")" = none ] || fail "expected the photo to be removed"

echo "  read_documentation gives the instructions, then the rules from the image's design documents"
call read_documentation '{"area":"sessions"}'
expect_body_contains "\"text\":\"This is Parking Radio's development environment, not the production site"
expect_body_contains '# Sessions'
expect_body_lacks '## `GET'
call read_documentation '{"area":"ra-events"}'
expect_body_contains '# RA events'
expect_body_lacks '## `GET'

echo "  a request counts as using the connection, at most every few minutes"
sql "update oauth_connections set last_used_at = now() - interval '10 minutes' where id = '${connection}'" >/dev/null
call get_artist "{\"id\":\"${artist}\"}"
[ "$(sql "select last_used_at > now() - interval '1 minute' from oauth_connections where id = '${connection}'")" = t ] \
    || fail "expected the connection to have been used just now"

echo "  times are given in Québec time, and a new session's or set's fields that can be null can be left out"
call create_session '{"start":"2026-11-14T21:00-05:00","durationMinutes":120,"type":"other","name":"MCP","description":""}'
expect_body_contains '\"start\":\"2026-11-14T21:00:00-05:00\",\"end\":\"2026-11-14T23:00:00-05:00\"'
session="$(sql "select id from sessions where name = 'MCP'")"
call create_set "{\"id\":\"${session}\",\"performers\":[{\"id\":\"${artist}\"}],\"performanceTypes\":[\"dj\"],\"otherPerformanceType\":\"\",\"genres\":[]}"
expect_body_contains '\"durationMinutes\":null,\"performanceTypes\"'
expect_body_lacks 'offsetMinutes'
expect_body_contains '\"soundcloudTrack\":null'

echo "  sessions are listed by when they start, with bounds in Québec time, and other offsets are refused, with their type and title"
call list_sessions '{"from":"2026-11-14T21:00-05:00","to":"2026-11-14T21:01-05:00"}'
expect_body_contains "\\\"total\\\":1,\\\"sessions\\\":[{\\\"id\\\":\\\"${session}\\\""
expect_body_contains '\"end\":\"2026-11-14T23:00:00-05:00\",\"durationMinutes\":120,\"type\":\"other\",\"title\":\"MCP\",\"takeover\":null,\"application\":null,\"status\":\"planned\",\"announced\":false,\"sets\"'
call list_sessions '{"from":"2026-11-14T21:01-05:00","to":"2026-11-14T23:00-05:00"}'
expect_body_contains '\"total\":0,'
call list_sessions '{"from":"2026-11-15T03:00+01:00"}'
expect_body_contains '"isError":true'
expect_body_contains 'must be a single date and time in Québec time, with the offset from UTC in effect then'

echo "  a set can come from its performer's application, which lists it, and the lists' summaries say so"
call create_application "{\"artistId\":\"${artist}\",\"dates\":[\"2026-11-14\"],\"timeSlots\":[],\"performanceTypes\":[\"dj\"],\"otherPerformanceType\":\"\",\"details\":\"\"}"
application="$(sql "select id from applications where artist_id = '${artist}'")"
set="$(sql "select id from sets where session_id = '${session}'")"
call update_set "{\"id\":\"${set}\",\"application\":\"${application}\"}"
expect_body_contains "\\\"application\\\":{\\\"id\\\":\\\"${application}\\\""
call list_sessions '{"from":"2026-11-14T21:00-05:00","to":"2026-11-14T21:01-05:00"}'
# With its duration rather than its times, and after its performers, its application.
expect_body_contains "\\\"sets\\\":[{\\\"id\\\":\\\"${set}\\\",\\\"durationMinutes\\\":null,\\\"status\\\":\\\"planned\\\",\\\"performers\\\""
expect_body_contains "}],\\\"application\\\":{\\\"id\\\":\\\"${application}\\\""
call list_applications "{\"artist\":\"${artist}\"}"
expect_body_contains "\\\"sets\\\":[{\\\"id\\\":\\\"${set}\\\""
expect_body_contains '\"sessions\":[]'

echo "  a set is moved among its session's sets"
call create_set "{\"id\":\"${session}\",\"performers\":[{\"id\":\"${artist}\"}],\"durationMinutes\":60,\"performanceTypes\":[],\"otherPerformanceType\":\"\",\"genres\":[]}"
other="$(sql "select id from sets where session_id = '${session}' and id <> '${set}'")"
call update_set_position "{\"id\":\"${other}\",\"position\":0}"
expect_body_contains "\\\"sets\\\":[{\\\"id\\\":\\\"${other}\\\""
[ "$(sql "select position from sets where id = '${set}'")" = 1 ] || fail "expected the first set to be moved second"
echo "  a set is moved to another session, as the admin, which gives both sessions"
call create_session '{"durationMinutes":120,"type":"other","name":"AILLEURS","description":""}'
elsewhere="$(sql "select id from sessions where name = 'AILLEURS'")"
call update_set_session "{\"id\":\"${set}\",\"session\":\"${elsewhere}\"}"
expect_body_contains "\\\"session\\\":{\\\"id\\\":\\\"${elsewhere}\\\""
expect_body_contains "\\\"previousSession\\\":{\\\"id\\\":\\\"${session}\\\""
[ "$(sql "select session_id || ' ' || updated_by from sets where id = '${set}'")" = "${elsewhere} ${ADMIN_EMAIL}" ] \
    || fail "expected the set to be moved, as the admin who connected the app"
call update_set_session "{\"id\":\"${set}\",\"session\":\"${session}\"}"
[ "$(sql "select session_id || ' ' || position from sets where id = '${set}'")" = "${session} 1" ] || fail "expected the set to be moved back, last"
call delete_session "{\"id\":\"${elsewhere}\"}"
echo "  a set's status is changed as the admin, which makes its session done once none of its sets is planned, and deleting one gives its session"
call update_set_status "{\"id\":\"${other}\",\"status\":\"done\"}"
call delete_set "{\"id\":\"${set}\"}"
expect_body_contains "\\\"sets\\\":[{\\\"id\\\":\\\"${other}\\\""
[ "$(sql "select status || ' ' || status_updated_by from sessions where id = '${session}'")" = "done ${ADMIN_EMAIL}" ] \
    || fail "expected the session to be done, as the admin who connected the app"
call delete_set "{\"id\":\"${other}\"}"

echo "  a session's description alone is changed, keeping the rest and its flyer, which tools can't send, but remove"
sql "update sessions set flyer_key = 'sessions/mcp.png', flyer_type = 'image/png' where id = '${session}'" >/dev/null
call update_session "{\"id\":\"${session}\",\"description\":\"Par MCP.\"}"
expect_body_contains '\"start\":\"2026-11-14T21:00:00-05:00\"'
expect_body_contains '\"description\":\"Par MCP.\",\"effectiveDescription\":\"Par MCP.\",\"hasFlyer\":true'
call delete_session_flyer "{\"id\":\"${session}\"}"
expect_body_contains '\"description\":\"Par MCP.\",\"effectiveDescription\":\"Par MCP.\",\"hasFlyer\":false'
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
