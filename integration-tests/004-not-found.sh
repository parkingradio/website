#!/usr/bin/env bash
#
# What isn't a page of the client is a clean 404 rather than index.html: unknown API paths get
# the API's JSON error, and so do unknown paths under /.well-known, e.g. those apps probe for
# OpenID Connect, and requests other than GET for a client route.

source "$(dirname "$0")/lib.sh"

for path in /api /api/nope /api/admin/nope /.well-known /.well-known/openid-configuration; do
    request "${BASE_URL}${path}"
    expect_status 404
    expect_body '^\{"ok":false,"error":"Not found"\}$'
done

request --request POST "${BASE_URL}/archives"
expect_status 404
expect_body '^\{"ok":false,"error":"Not found"\}$'
