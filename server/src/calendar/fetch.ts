// Reading a feed's link, within the limits of a read (see "Reading the feeds" in docs/design/server/calendar.md).
//
// The link is a secret, so this module's errors are its own, and never quote the link, a redirect's `Location`, what the
// link's server answered, or the errors of `fetch`, whose causes can name the link's host.

export const READ_TIMEOUT_MS = 20_000
export const MAX_REDIRECTS = 5
export const MAX_BYTES = 10 * 1024 * 1024

// A read that failed: `status` is what adding the feed fails with, 400 when the link doesn't give a calendar, and 502
// when its server can't be reached, or fails, for now.
export class FeedReadError extends Error {
  constructor(
    readonly status: 400 | 502,
    message: string,
  ) {
    super(message)
  }
}

// The read was cut short by `signal`, e.g. because the server is shutting down.
export class ReadAborted extends Error {
  constructor() {
    super('The read was stopped')
  }
}

const unreachable = (reason: string) => new FeedReadError(502, `The link can't be read: its server ${reason}`)
// The link doesn't give a calendar, e.g. because its server refuses it, or what it gives isn't one.
export const refused = (reason: string) => new FeedReadError(400, `The link can't be read: ${reason}`)

// Why `fetch` failed, from its cause's code, as Node gives it.
function networkError(error: unknown): FeedReadError {
  const code = String((error instanceof Error && (error.cause as { code?: unknown } | undefined)?.code) || '')
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return unreachable("can't be found")
  if (code === 'ECONNREFUSED') return unreachable('refuses connections')
  if (/CERT|TLS|SSL/.test(code)) return unreachable("has a certificate that isn't valid")
  return unreachable("can't be reached")
}

// The body of `response`, as text, cut short past MAX_BYTES.
async function bodyOf(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_BYTES) {
      await reader.cancel()
      throw refused(`the calendar is over ${MAX_BYTES / 1024 / 1024} MB`)
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

// The text that `link`, an https link, gives, following its redirects. Throws a FeedReadError when it can't be read,
// or a ReadAborted when `signal` aborts first. `fetch` and `timeoutMs` are only for tests.
export async function readLink(
  link: string,
  { signal, fetch = globalThis.fetch, timeoutMs = READ_TIMEOUT_MS }: { signal?: AbortSignal; fetch?: typeof globalThis.fetch; timeoutMs?: number } = {},
): Promise<string> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const both = signal ? AbortSignal.any([signal, timeout]) : timeout
  const failure = (error: unknown) => {
    if (signal?.aborted) return new ReadAborted()
    if (timeout.aborted) return unreachable(`doesn't answer within ${READ_TIMEOUT_MS / 1000} seconds`)
    return error instanceof FeedReadError ? error : networkError(error)
  }
  try {
    let url = link
    for (let redirects = 0; ; redirects++) {
      const response = await fetch(url, { redirect: 'manual', signal: both, headers: { Accept: 'text/calendar, */*;q=0.5' } })
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel()
        const location = response.headers.get('location')
        if (location === null) throw refused(`its server redirects without a link (${response.status})`)
        if (redirects === MAX_REDIRECTS) throw refused(`it redirects more than ${MAX_REDIRECTS} times`)
        const next = URL.parse(location, url)
        if (next?.protocol !== 'https:') throw refused("it redirects to a link that isn't https")
        url = next.href
        continue
      }
      if (response.status >= 200 && response.status < 300) return await bodyOf(response)
      await response.body?.cancel()
      const { status } = response
      if (status === 408 || status === 429) throw unreachable(`refuses requests for now (${status})`)
      if (status >= 400 && status < 500) throw refused(`its server refuses it (${status})`)
      throw unreachable(`fails (${status})`)
    }
  } catch (error) {
    throw failure(error)
  }
}
