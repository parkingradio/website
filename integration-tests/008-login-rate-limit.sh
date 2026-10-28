#!/usr/bin/env bash
#
# Password guessing is throttled per client address, as reported by Cloudflare in
# CF-Connecting-IP: after LOGIN_ATTEMPTS_PER_WINDOW (10) attempts in the window, further ones get
# a 429, while another address is unaffected.

source "$(dirname "$0")/lib.sh"

for _ in $(seq 1 10); do
    login 203.0.113.1 nobody@integration.test guess
    expect_status 401
done

login 203.0.113.1 nobody@integration.test guess
expect_status 429
expect_body '^\{"ok":false,"error":"Too many login attempts, try again in [^"]+"\}$'

login 203.0.113.2 nobody@integration.test guess
expect_status 401
