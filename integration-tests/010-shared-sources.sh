#!/usr/bin/env bash
#
# The server runs shared's sources by having Node strip their types (see shared/README.md), which only works if
# they're in the image and Node accepts them.

source "$(dirname "$0")/lib.sh"

# From server/, like the server's own imports.
docker exec --workdir /app/server "$CONTAINER" node --input-type=module -e "await import('shared/error')" \
    || fail "couldn't import shared/error"

# Code, rather than only types, which the server runs to check requests.
docker exec --workdir /app/server "$CONTAINER" node --input-type=module -e "
    const { playlistLink } = await import('shared/radio')
    if (playlistLink('https://soundcloud.com/a/sets/b?si=1') !== 'https://soundcloud.com/a/sets/b') process.exit(1)
" || fail "couldn't run shared/radio"
