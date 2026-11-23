import { describe, expect, it, vi } from 'vitest'
import { FeedReadError, MAX_BYTES, ReadAborted, readLink } from './fetch.js'

// Reading a feed's link, within the limits of a read (see "Reading the feeds" in docs/design/server/calendar.md), against
// a fake `fetch`.

const LINK = 'https://calendar.google.com/calendar/ical/team%40group.calendar.google.com/private-0123456789abcdef/basic.ics'
const CALENDAR = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'

type Answer = Response | ((url: string, init: RequestInit) => Promise<Response>)

// A fetch that answers each request with the next of `answers`, and records what it was asked for.
function fakeFetch(...answers: Answer[]) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const answer = answers.shift()
    if (!answer) throw new Error('No more answers')
    return typeof answer === 'function' ? answer(String(url), init!) : answer
  })
}

const redirect = (location: string, status = 302) => new Response(null, { status, headers: { Location: location } })

// An answer that never comes, until the request is aborted.
const never = (_url: string, init: RequestInit) =>
  new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))

// A network error, as Node's fetch gives it, whose cause names the link's host.
function networkError(code: string) {
  return async () => {
    throw new TypeError('fetch failed', { cause: Object.assign(new Error(`getaddrinfo ${code} calendar.google.com`), { code }) })
  }
}

async function failure(promise: Promise<unknown>): Promise<FeedReadError> {
  const error = await promise.then(
    () => null,
    (error: unknown) => error,
  )
  if (!(error instanceof FeedReadError)) throw new Error(`Expected a FeedReadError, got ${String(error)}`)
  return error
}

describe('readLink', () => {
  it('gives the text the link gives, as UTF-8', async () => {
    const fetch = fakeFetch(new Response('BEGIN:VCALENDAR\r\nX-WR-CALNAME:Équipe\r\nEND:VCALENDAR\r\n'))
    expect(await readLink(LINK, { fetch })).toBe('BEGIN:VCALENDAR\r\nX-WR-CALNAME:Équipe\r\nEND:VCALENDAR\r\n')
    expect(fetch).toHaveBeenCalledExactlyOnceWith(LINK, expect.objectContaining({ redirect: 'manual' }))
  })

  it('follows up to 5 redirects, each to an https link, relative ones included', async () => {
    const fetch = fakeFetch(
      redirect('https://a.example/1'),
      redirect('/2', 301),
      redirect('https://b.example/3', 307),
      redirect('4', 308),
      redirect('https://c.example/5', 303),
      new Response(CALENDAR),
    )
    expect(await readLink(LINK, { fetch })).toBe(CALENDAR)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([LINK, 'https://a.example/1', 'https://a.example/2', 'https://b.example/3', 'https://b.example/4', 'https://c.example/5'])
  })

  it('refuses a link that redirects more than 5 times, to a link that is not https, or without a link', async () => {
    const six = fakeFetch(...Array.from({ length: 6 }, (_, index) => redirect(`https://a.example/${index}`)))
    expect(await failure(readLink(LINK, { fetch: six }))).toMatchObject({ status: 400, message: "The link can't be read: it redirects more than 5 times" })
    for (const location of ['http://a.example/', 'webcal://a.example/', 'https://[not a host']) {
      const fetch = fakeFetch(redirect(location))
      expect(await failure(readLink(LINK, { fetch }))).toMatchObject({ status: 400, message: "The link can't be read: it redirects to a link that isn't https" })
    }
    for (const status of [302, 304]) {
      expect(await failure(readLink(LINK, { fetch: fakeFetch(new Response(null, { status })) }))).toMatchObject({
        status: 400,
        message: `The link can't be read: its server redirects without a link (${status})`,
      })
    }
  })

  it('refuses a link that its server refuses, and fails with 502 when its server fails, or refuses requests for now', async () => {
    const statuses = { 401: 400, 403: 400, 404: 400, 410: 400, 408: 502, 429: 502, 500: 502, 503: 502 }
    for (const [status, expected] of Object.entries(statuses)) {
      const error = await failure(readLink(LINK, { fetch: fakeFetch(new Response(null, { status: Number(status) })) }))
      expect(error.status, status).toBe(expected)
      expect(error.message, status).toContain(`(${status})`)
    }
  })

  it("says why the link's server can't be reached", async () => {
    const reasons = {
      ENOTFOUND: "The link can't be read: its server can't be found",
      ECONNREFUSED: "The link can't be read: its server refuses connections",
      DEPTH_ZERO_SELF_SIGNED_CERT: "The link can't be read: its server has a certificate that isn't valid",
      ECONNRESET: "The link can't be read: its server can't be reached",
    }
    for (const [code, message] of Object.entries(reasons)) {
      expect(await failure(readLink(LINK, { fetch: fakeFetch(networkError(code)) }))).toMatchObject({ status: 502, message })
    }
  })

  it('refuses a calendar over 10 MB', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent++
        controller.enqueue(chunk)
      },
    })
    const error = await failure(readLink(LINK, { fetch: fakeFetch(new Response(body)) }))
    expect(error).toMatchObject({ status: 400, message: "The link can't be read: the calendar is over 10 MB" })
    // It stopped reading once it was over.
    expect(sent).toBeLessThanOrEqual(MAX_BYTES / chunk.length + 2)
    expect(await readLink(LINK, { fetch: fakeFetch(new Response(new Uint8Array(MAX_BYTES))) })).toHaveLength(MAX_BYTES)
  })

  it('fails with 502 when the answer, or the rest of it, takes too long', async () => {
    const message = "The link can't be read: its server doesn't answer within 20 seconds"
    expect(await failure(readLink(LINK, { fetch: fakeFetch(never), timeoutMs: 20 }))).toMatchObject({ status: 502, message })
    const slowBody = (_url: string, init: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('BEGIN:VCALENDAR\r\n'))
          init.signal!.addEventListener('abort', () => controller.error(init.signal!.reason))
        },
      })
      return Promise.resolve(new Response(body))
    }
    expect(await failure(readLink(LINK, { fetch: fakeFetch(slowBody), timeoutMs: 20 }))).toMatchObject({ status: 502, message })
  })

  it('stops when it is told to', async () => {
    const stopping = new AbortController()
    const read = readLink(LINK, { fetch: fakeFetch(never), signal: stopping.signal })
    stopping.abort()
    await expect(read).rejects.toBeInstanceOf(ReadAborted)
  })

  it('never says what the link is, or what its server answered', async () => {
    const secrets = ['private-0123456789abcdef', 'calendar.google.com', 'team%40group']
    const answers: Answer[] = [
      new Response(`Not found: ${LINK}`, { status: 404 }),
      new Response(`Error at ${LINK}`, { status: 500 }),
      redirect(`http://calendar.google.com/private-0123456789abcdef`),
      networkError('ENOTFOUND'),
      networkError('EWHATEVER'),
    ]
    for (const answer of answers) {
      const { message } = await failure(readLink(LINK, { fetch: fakeFetch(answer) }))
      for (const secret of secrets) expect(message).not.toContain(secret)
    }
  })
})
