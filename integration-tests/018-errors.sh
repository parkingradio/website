#!/usr/bin/env bash
#
# Every error is an `ApiError`, `{"ok":false,"error":...}` and nothing else, even when the server refuses a request
# before any endpoint handles it: a body that isn't valid JSON or is too large, a path that doesn't exist whatever the
# body, or a URL that can't be routed, whose path the error doesn't quote.

source "$(dirname "$0")/lib.sh"

# Logins are rate limited before their body is read, so these requests count as attempts.
readonly IP=198.51.100.18
readonly API_ERROR='^\{"ok":false,"error":"[^"]+"\}$'

# post_json <path> <curl data args...> -- send a JSON body, as a client at IP.
post_json() {
    local path="$1"
    shift
    request --header "CF-Connecting-IP: ${IP}" --header 'Content-Type: application/json' "$@" "${BASE_URL}${path}"
}

echo "  a body that isn't valid JSON, or doesn't match what the endpoint takes, has the NUL character, or is too large"
post_json /api/auth/login --data '{"email": "admin@integration.test", '
expect_status 400
expect_body "$API_ERROR"

post_json /api/auth/login --data '{"email": "admin@integration.test", "password": 12345678}'
expect_status 400
expect_body '^\{"ok":false,"error":"`password`: [^"]+"\}$'

# Which the database can't store, rather than a 500 for the query that fails.
post_json /api/auth/login --data '{"email": "admin\u0000@integration.test", "password": "x"}'
expect_status 400
expect_body '^\{"ok":false,"error":"`email`: Text can'"'"'t contain the NUL character"\}$'

# Over the 1 MiB that the server takes.
too_large() {
    printf '{"email": "'
    head -c $((2 * 1024 * 1024)) /dev/zero | tr '\0' a
    printf '", "password": "x"}'
}
post_json /api/auth/login --data-binary @- < <(too_large)
expect_status 413
expect_body "$API_ERROR"

echo "  a path that doesn't exist, whatever the body"
for path in /api/nope /archives; do
    post_json "$path" --data '{"not": json'
    expect_status 404
    expect_body '^\{"ok":false,"error":"Not found"\}$'
done

echo "  a URL that can't be routed"
request "${BASE_URL}/api/%zz"
expect_status 400
expect_body '^\{"ok":false,"error":"Invalid URL"\}$'

# The server takes path parameters of up to 100 characters.
request "${BASE_URL}/api/radio/tracks/$(head -c 101 /dev/zero | tr '\0' x)/stream"
expect_status 414
expect_body '^\{"ok":false,"error":"URL too long"\}$'
