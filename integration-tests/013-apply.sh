#!/usr/bin/env bash
#
# Checks applying (`POST /api/applications`) against a real database and Cloudflare's real Turnstile endpoint. It uses
# Cloudflare's test keys from .env.example, whose secret key accepts every token. The unit tests fake both the database
# and Turnstile, so this is where we check that:
# - a new artist who applies is created along with their application, both with a null createdBy, with or without a
#   photo, and the application is received when it's created
# - an artist who already exists (same email, ignoring case) can't apply again, and the photo they sent is deleted
# - if two people apply with the same new email at the same time, only one artist is created
# - an application without a token is refused
# - an artist can't leave out their city, which only admins can, like their country, genres, links or phone
# - applications are rate limited per CF-Connecting-IP

source "$(dirname "$0")/lib.sh"

readonly TOKEN='XXXX.DUMMY.TOKEN.XXXX'

readonly PHOTO="$(mktemp)"
trap 'rm -f "$PHOTO"' EXIT
printf '\xff\xd8\xff\xe0JFIF' > "$PHOTO"

# profile <name> <email> -- an artist's profile, as JSON.
profile() {
    printf '{"kind":"artist","name":"%s","members":[],"country":"CA","city":"Montréal","genres":["house"],"bio":"Une bio.","links":{"instagram":"@applicant"},"email":"%s","phone":"514 555-0123"}' \
        "$1" "$2"
}

readonly APPLICATION='{"dates":["2027-03-12"],"timeSlots":[{"start":"18:00","end":"22:00"}],"prestations":["dj"],"otherPrestation":"","details":""}'

# apply <client address> <profile> [<token>] [<photo>] -- apply, as a client at that address, with PHOTO unless another
# file, or '' for no photo, is given.
apply() {
    local photo=()
    if [ -n "${4-$PHOTO}" ]; then photo=(--form "photo=@${4-$PHOTO}"); fi
    request --header "CF-Connecting-IP: $1" --form-string "artist=$2" --form-string "application=${APPLICATION}" \
        --form-string "turnstileToken=${3-$TOKEN}" ${photo[@]+"${photo[@]}"} "${BASE_URL}/api/applications"
}

echo "  an artist applies, and is added, as having added themselves"
apply 198.51.100.13 "$(profile Applicant applicant@integration.test)"
expect_status 200
expect_body_contains '{"ok":true}'

login 198.51.100.14 "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
expect_status 200
cookie="$(session_cookie)"

request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists"
expect_status 200
artist="$(printf '%s' "$BODY" | sed -nE 's/.*"id":"([^"]*)","createdAt":"[^"]*","createdBy":null,"kind":"artist","name":"Applicant".*/\1/p')"
[ -n "$artist" ] || { _show_body; fail "the artist who applied wasn't added, as having added themselves"; }

request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists/${artist}/photo"
expect_status 200
expect_header Content-Type 'image/jpeg'

request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/applications?artist=${artist}"
expect_status 200
expect_body_contains '"dates":["2027-03-12"]'
expect_body_contains '"createdBy":null'
[ -n "$(body_field receivedAt)" ] && [ "$(body_field receivedAt)" = "$(body_field createdAt)" ] || { _show_body; fail "expected the application to be received when it was created"; }

echo "  an artist applies without a photo, and is added without one"
photos="$(photos_on_disk)"
apply 198.51.100.22 "$(profile Photoless photoless@integration.test)" "$TOKEN" ''
expect_status 200
[ "$(photos_on_disk)" = "$photos" ] || fail "expected no photo to be stored"
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists"
# The artist's links are an object, which comes before hasPhoto.
expect_body '"name":"Photoless"[^{]*\{[^}]*\}[^}]*"hasPhoto":false'

echo "  an artist who already exists, whatever the case of their email, can't apply again"
photos="$(photos_on_disk)"
apply 198.51.100.15 "$(profile 'Someone Else' Applicant@Integration.Test)"
expect_status 409
expect_body_contains 'Un artiste est déjà inscrit avec cette adresse e-mail.'
[ "$(photos_on_disk)" = "$photos" ] || fail "expected the photo sent with the refused application to be deleted"
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists"
if printf '%s' "$BODY" | grep -Fq 'Someone Else'; then _show_body; fail "applying again added another artist"; fi
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/applications?artist=${artist}"
[ "$(printf '%s' "$BODY" | grep -o "\"artistId\":\"${artist}\"" | wc -l)" -eq 1 ] || { _show_body; fail "expected the artist to still have 1 application"; }

echo "  of two artists applying with the same email at once, only one is added"
# The two requests may or may not reach the database at exactly the same time. Either way, one of them must be refused.
photos="$(photos_on_disk)"
statuses="$(for address in 198.51.100.18 198.51.100.19; do
    curl --silent --output /dev/null --write-out '%{http_code}\n' --header "CF-Connecting-IP: ${address}" \
        --form-string "artist=$(profile Simultaneous simultaneous@integration.test)" --form-string "application=${APPLICATION}" \
        --form-string "turnstileToken=${TOKEN}" --form "photo=@${PHOTO}" "${BASE_URL}/api/applications" &
done | sort | tr '\n' ' ')"
[ "$statuses" = '200 409 ' ] || fail "expected one application to be accepted and the other refused, got: ${statuses}"
[ "$(photos_on_disk)" = "$((photos + 1))" ] || fail "expected only the photo of the artist who was added to be kept"
request --header "Cookie: ${cookie}" "${BASE_URL}/api/admin/artists"
[ "$(printf '%s' "$BODY" | grep -o '"name":"Simultaneous"' | wc -l)" -eq 1 ] || { _show_body; fail "expected a single artist to be added"; }

echo "  an application without a token is refused, in French"
apply 198.51.100.16 "$(profile Tokenless tokenless@integration.test)" ''
expect_status 400
expect_body_contains 'La vérification anti-robot a échoué.'

echo "  an artist can't leave out their city, which only admins can"
apply 198.51.100.16 "$(profile Cityless cityless@integration.test | sed 's/"city":"Montréal"/"city":""/')"
expect_status 400
expect_body_contains 'Indiquez votre ville.'

echo "  applications are rate limited per CF-Connecting-IP"
# Invalid requests count towards the limit too, so these don't need a valid token.
for _ in 1 2 3 4 5; do
    request --header 'CF-Connecting-IP: 198.51.100.17' --request POST "${BASE_URL}/api/applications"
    expect_status 400
done
request --header 'CF-Connecting-IP: 198.51.100.17' --request POST "${BASE_URL}/api/applications"
expect_status 429
expect_body_contains 'Trop de candidatures'
