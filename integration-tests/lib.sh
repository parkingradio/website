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
