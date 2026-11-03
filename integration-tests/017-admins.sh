#!/usr/bin/env bash
#
# Admins are listed, revoked, and have their sessions end, end to end against a real database: the unit tests check
# sessions against a stand-in for it.

source "$(dirname "$0")/lib.sh"

readonly IP=198.51.100.17
readonly REVOKED_EMAIL="revoked@integration.test"
readonly RESET_EMAIL="reset@integration.test"
readonly PENDING_EMAIL="pending-revoked@integration.test"

# admin_in_body <email> -- the admin with this email, as the last request listed them. Admins are flat JSON objects.
admin_in_body() {
    printf '%s' "$BODY" | grep -o "{[^{}]*\"email\":\"$1\"[^{}]*}"
}

# admin_id <email> -- the id of the admin with this email, as the last request listed them.
admin_id() {
    admin_in_body "$1" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p'
}

# expect_admin <email> <field> <JSON value, as an extended regex> -- expect the admin with this email, as the last request
# listed them, to have this field.
expect_admin() {
    if ! admin_in_body "$1" | grep -Eq "\"$2\":$3[,}]"; then
        fail "expected ${1} to have ${2} matching ${3}: $(admin_in_body "$1")"
    fi
}

new_admin "$REVOKED_EMAIL" revoked-password
new_admin "$RESET_EMAIL" first-password
create_admin "$PENDING_EMAIL"
pending_token="$(invite_token)"

cookie="$(session_of "$ADMIN_EMAIL" "$ADMIN_PASSWORD")"
revoked_cookie="$(session_of "$REVOKED_EMAIL" revoked-password)"

echo "  the admins are listed, with their status, and which one is the admin who asks"
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/admins"
expect_status 200
expect_admin "$ADMIN_EMAIL" status '"active"'
expect_admin "$ADMIN_EMAIL" invitedBy null
expect_admin "$ADMIN_EMAIL" you true
expect_admin "$PENDING_EMAIL" status '"invited"'
expect_admin "$PENDING_EMAIL" inviteExpiresAt '"[^"]+"'
expect_admin "$PENDING_EMAIL" you false
admin_id="$(admin_id "$ADMIN_EMAIL")"
revoked_id="$(admin_id "$REVOKED_EMAIL")"
pending_id="$(admin_id "$PENDING_EMAIL")"

echo "  admins can't revoke themselves, nor admins who don't exist"
request --request DELETE --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/admins/${admin_id}"
expect_status 409
# Nor themselves with their id in uppercase, which the database would still match.
request --request DELETE --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/admins/$(printf '%s' "$admin_id" | tr '[:lower:]' '[:upper:]')"
expect_status 409
for id in 00000000-0000-0000-0000-000000000000 not-a-uuid; do
    request --request DELETE --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/admins/${id}"
    expect_status 404
done

echo "  a revoked admin's session ends, and they can't log in anymore"
request --header "Cookie: ${revoked_cookie}" "${BASE_URL}/api/admin/me"
expect_status 200
request --request DELETE --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/admins/${revoked_id}"
expect_status 200
request --header "Cookie: ${revoked_cookie}" "${BASE_URL}/api/admin/me"
expect_status 401
login "$IP" "$REVOKED_EMAIL" revoked-password
expect_status 401

echo "  revoking an admin who hasn't accepted their invite cancels it"
request --request DELETE --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/admins/${pending_id}"
expect_status 200
accept_invite "$pending_token" pending-password
expect_status 400

echo "  a new password ends the sessions that started before it"
reset_cookie="$(session_of "$RESET_EMAIL" first-password)"
create_admin "$RESET_EMAIL"
expect_output "is already an admin: this link resets their password"
accept_invite "$(invite_token)" second-password
expect_status 200
request --header "Cookie: ${reset_cookie}" "${BASE_URL}/api/admin/me"
expect_status 401
request --header "Cookie: $(session_of "$RESET_EMAIL" second-password)" "${BASE_URL}/api/admin/me"
expect_status 200

echo "  the admins who were revoked aren't listed anymore"
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/admins"
expect_status 200
for email in "$REVOKED_EMAIL" "$PENDING_EMAIL"; do
    if admin_in_body "$email" >/dev/null; then
        fail "expected ${email} not to be listed anymore"
    fi
done
