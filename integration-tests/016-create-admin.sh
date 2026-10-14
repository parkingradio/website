#!/usr/bin/env bash
#
# The create-admin command, which creates a deployment's first admin (see tools/create-admin), end to end against a real
# database: it invites new admins, invites again those who haven't accepted their invite, and gives admins who already
# accepted theirs a link that resets their password.

source "$(dirname "$0")/lib.sh"

readonly IP=198.51.100.16
readonly EMAIL="create-admin@integration.test"
readonly PENDING_EMAIL="pending@integration.test"
upper_email="$(printf '%s' "$EMAIL" | tr '[:lower:]' '[:upper:]')"

echo "  a new admin gets an invite link, with which they choose their password"
create_admin "$EMAIL"
expect_output "Created admin ${EMAIL}."
accept_invite "$(invite_token)" first-password
expect_status 200
login "$IP" "$EMAIL" first-password
expect_status 200

echo "  an admin who accepted their invite gets a link that resets their password, whatever the case of the email"
create_admin "$upper_email"
expect_output "is already an admin: this link resets their password"
reset_token="$(invite_token)"

echo "  their password keeps working until the link is used"
login "$IP" "$EMAIL" first-password
expect_status 200
accept_invite "$reset_token" second-password
expect_status 200
login "$IP" "$EMAIL" first-password
expect_status 401
login "$IP" "$EMAIL" second-password
expect_status 200

echo "  an admin who hasn't accepted their invite gets a new one, and the earlier one stops working"
create_admin "$PENDING_EMAIL"
expect_output "Created admin ${PENDING_EMAIL}."
first_token="$(invite_token)"
create_admin "$PENDING_EMAIL"
expect_output "${PENDING_EMAIL} hadn't accepted their invite yet: earlier links no longer work."
accept_invite "$first_token" pending-password
expect_status 400
accept_invite "$(invite_token)" pending-password
expect_status 200

echo "  anything but a single email address is refused"
for args in "not-an-email" "" "${EMAIL} ${PENDING_EMAIL}"; do
    # shellcheck disable=SC2086 # split on purpose, into as many arguments as there are words
    create_admin $args
    if [ "$EXIT_STATUS" != 2 ]; then
        fail "expected create-admin ${args} to exit with 2, got ${EXIT_STATUS}: ${OUTPUT}"
    fi
done
