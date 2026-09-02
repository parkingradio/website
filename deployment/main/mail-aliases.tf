# This file sets up the mail aliases at var.domain.
#
#   name@<domain> => some-addresss@some-domain
#
# Adding an entry like `foo = bar@gmail.com` will result in a setup allowing
# `foo@domain` to be mirrored to `bar@gmail.com`. Removing an entry will result
# in the forwarding setup for that entry being removed (so be careful).
#
# Under the hood, each entry gets its own IAM sending credentials (restricted to
# send only as e.g. `foo@domain`), and a Cloudflare Email Routing rule to forward
# incoming mail destined to `foo@domain` to `bar@gmail.com`.
#
# See mail.tf for the actual code acting on this table.
#
# IMPORTANT NOTE:
#   Since these aliases become IAM usernames and email addresses, only use lowercase
#   letters, digits, dots and hyphens.
locals {
  mail_aliases = {
    contact = "contact@example.com"
    owner   = "owner@example.com"
  }
}
