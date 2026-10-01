#!/usr/bin/env bash
#
# The app doesn't run as root inside the container (see the USER instruction in the Dockerfile),
# and can't modify its own files.

source "$(dirname "$0")/lib.sh"

# The server's own user is checked, rather than the one `docker exec` defaults to: they're the same
# today, but only the former matters. It's PID 1, since the container is started without --init.
uid="$(docker exec "$CONTAINER" awk '/^Uid:/ { print $2 }' /proc/1/status)"
echo "  uid: ${uid}"
[ -n "$uid" ] || fail "couldn't read the server's uid from /proc/1/status"
[ "$uid" != 0 ] || fail "expected the app to run as an unprivileged user, not root"

if docker exec --user "$uid" "$CONTAINER" touch /app/server/dist/index.js 2>/dev/null; then
    fail "expected the app's files not to be writable by the user it runs as"
fi
