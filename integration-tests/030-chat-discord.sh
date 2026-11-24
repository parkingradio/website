#!/usr/bin/env bash
#
# Checks the Discord credentials of the chat against a real database, with the stand-in for Discord that .env.example has
# the server use (CHAT_STAND_IN), which accepts any credentials in the right format:
# - the endpoints require a session
# - there are none until they're entered
# - credentials that aren't in the right format are refused, and not saved
# - credentials are checked without being saved, then saved, with the names the stand-in gives, and the token is never
#   sent back
# - the token is in the database, but never logged

source "$(dirname "$0")/lib.sh"

readonly URL="${BASE_URL}/api/admin/chat/discord"
readonly TOKEN='MTA5ODc2NTQzMjEwOTg3NjU0Mw.Gabc12.integration-secret-7f3a'
readonly CHANNEL_ID='1234567890123456789'
readonly CREDENTIALS="{\"botToken\":\"${TOKEN}\",\"channelId\":\"${CHANNEL_ID}\"}"
since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "  the endpoints require a session"
request "$URL"
expect_status 401
request --request PUT --header 'Content-Type: application/json' --data "$CREDENTIALS" "$URL"
expect_status 401
request --request POST --header 'Content-Type: application/json' --data "$CREDENTIALS" "${URL}/check"
expect_status 401

login 198.51.100.33 "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
expect_status 200
cookie="$(session_cookie)"

echo "  there are none until they're entered"
json GET "$URL"
expect_status 200
expect_body_contains '{"ok":true,"credentials":null}'

echo "  credentials that aren't in the right format are refused, and can't be checked either"
json PUT "$URL" "{\"botToken\":\"Bot ${TOKEN}\",\"channelId\":\"${CHANNEL_ID}\"}"
expect_status 400
expect_body_contains "Not a Discord bot's token"
expect_body_lacks "$TOKEN"
json POST "${URL}/check" "{\"botToken\":\"${TOKEN}\",\"channelId\":\"#chat\"}"
expect_status 400
expect_body_contains "Not a Discord channel's id"
json GET "$URL"
expect_body_contains '{"ok":true,"credentials":null}'

echo "  credentials are checked without being saved"
json POST "${URL}/check" "$CREDENTIALS"
expect_status 200
expect_body_contains '{"ok":true}'
json GET "$URL"
expect_body_contains '{"ok":true,"credentials":null}'

echo "  then saved, with the bot's and the channel's names, and the token is never sent back"
json PUT "$URL" "$CREDENTIALS"
expect_status 200
expect_body "\"channelId\":\"${CHANNEL_ID}\",\"botName\":\"stand-in\",\"channelName\":\"chat\",\"updatedBy\":\"${ADMIN_EMAIL}\""
expect_body_lacks "$TOKEN"
json GET "$URL"
expect_status 200
expect_body "\"channelId\":\"${CHANNEL_ID}\",\"botName\":\"stand-in\",\"channelName\":\"chat\",\"updatedBy\":\"${ADMIN_EMAIL}\""
expect_body_lacks "$TOKEN"
if [ "$(sql 'select bot_token from discord_credentials')" != "$TOKEN" ]; then fail "the token wasn't saved"; fi

echo "  the token is never logged"
if docker logs --since "$since" "$CONTAINER" 2>&1 | grep -qF "$TOKEN"; then fail "the server logged the bot's token"; fi
