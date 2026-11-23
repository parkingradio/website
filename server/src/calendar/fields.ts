import { z } from 'zod'

// The fields of calendar feeds (see "Feeds" in docs/design/server/calendar.md). They're in a module of their own, which
// only needs zod, so that the database's schema doesn't load what reading the feeds needs.

const NAME_MAX_LENGTH = 100
export const FeedName = z
  .string()
  .trim()
  .min(1, 'The name must not be blank')
  .max(NAME_MAX_LENGTH, `The name must be at most ${NAME_MAX_LENGTH} characters`)
  .meta({ description: `Trimmed, then between 1 and ${NAME_MAX_LENGTH} characters` })

// A feed's link, as the server keeps it: an https link, which a webcal link stands for (see "Feeds" in
// docs/design/server/calendar.md), without what comes after `#`, and with the characters links can't have encoded, so that two links
// for the same calendar are the same. Its length is checked as it's kept, since that's what the database's unique index
// holds, which has a limit.
export const LINK_MAX_LENGTH = 2000

const NOT_A_LINK = 'The link must be an https or webcal link'

// The link as the server keeps it, or an error, which never quotes it, since it's a secret.
export function normalizedLink(sent: string): { link: string } | { error: string } {
  // The NUL character is refused, rather than dropped or encoded, as parsing a link would (see "Text" in
  // docs/design/server/README.md).
  if (sent.includes('\0')) return { error: NOT_A_LINK }
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
      "as the server keeps it: in https, without what comes after #, and with its characters that links can't have encoded",
  })

export const PrivateTitles = z.boolean().meta({
  description: "Whether its titles are private: the server then never keeps, gives or logs its events' titles",
})
