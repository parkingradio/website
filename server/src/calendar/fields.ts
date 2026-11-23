import { z } from 'zod'

// The fields of calendar feeds (see "Feeds" in docs/design/server/calendar.md). They're in a module of their own, which
// only needs zod, so that the database's schema doesn't load what reading the feeds needs.

// A feed's kind: what its events are.
export const FEED_KINDS = ['occupation', 'quiet-time'] as const
export const FeedKind = z.enum(FEED_KINDS).meta({ id: 'FeedKind', description: 'What its events are: occupations, or quiet time' })
export type FeedKind = z.infer<typeof FeedKind>

const NAME_MAX_LENGTH = 100
export const FeedName = z
  .string()
  .trim()
  .min(1, 'The name must not be blank')
  .max(NAME_MAX_LENGTH, `The name must be at most ${NAME_MAX_LENGTH} characters`)
  .meta({ description: `Trimmed, then between 1 and ${NAME_MAX_LENGTH} characters` })

// A feed's link, as the server keeps it (see "Feeds" in docs/design/server/calendar.md): an https link, which a webcal
// link stands for, without what comes after `#`, and with the characters links can't have encoded, so that two links
// for the same calendar are the same. Its length is checked as it's kept, since that's what the database's unique index
// holds, which has a limit.
export const LINK_MAX_LENGTH = 2000

const NOT_A_LINK = 'The link must be an https or webcal link'

// The link as the server keeps it, or an error, which never quotes it, since it's a secret.
export function normalizedLink(sent: string): { link: string } | { error: string } {
  let url: URL
  try {
    url = new URL(sent)
    // A webcal link stands for the same link in https. `URL` can't change a link's scheme from webcal, which it doesn't
    // know, to https, which it does, so it's read again.
    if (url.protocol === 'webcal:') url = new URL(`https:${sent.slice('webcal:'.length)}`)
  } catch {
    return { error: NOT_A_LINK }
  }
  if (url.protocol !== 'https:') return { error: NOT_A_LINK }
  if (url.username || url.password) return { error: "The link can't have a user name or a password" }
  url.hash = ''
  if (url.href.length > LINK_MAX_LENGTH) return { error: `The link must be at most ${LINK_MAX_LENGTH} characters` }
  return { link: url.href }
}

export const Link = z
  .string()
  .trim()
  .transform((sent, context) => {
    const normalized = normalizedLink(sent)
    if ('link' in normalized) return normalized.link
    context.addIssue({ code: 'custom', message: normalized.error })
    return z.NEVER
  })
  .meta({
    description:
      `Trimmed: an https or webcal link, without a user name or a password, of at most ${LINK_MAX_LENGTH} characters ` +
      "once its characters that links can't have are encoded. It's a secret, which is never sent back",
  })
