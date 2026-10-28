import createClient from 'openapi-fetch'
import type { ClientPathsWithMethod, MethodResponse, ParamsOption, RequestBodyOption } from 'openapi-fetch'
import type { components, paths } from './schema'

// The API, typed by schema.d.ts, which is generated from the server's openapi.json (`npm run generate:api` at the root).
// Calls name an endpoint's path and get the types of what it accepts and returns, e.g.
//
//     const result = await api.PUT('/api/admin/features/{id}', { params: { path: { id } }, body: { enabled } })
//
// Requests that are multipart/form-data, e.g. with a photo, are sent with `bodySerializer: formData`, e.g.
//
//     const result = await api.POST('/api/admin/artists', { body: { artist, photo }, bodySerializer: formData })
//
// Calls never throw: they return the response with `ok: true` if it succeeded, or else an `ApiError`, including for
// failures that never reach the server, which say so (see `Failure`). An admin request that fails with 401 also tells
// `onSessionEnded`'s listeners.

// A schema of the API, by name, e.g. `Schema<'Feature'>`.
export type Schema<Name extends keyof components['schemas']> = components['schemas'][Name]

export type ApiError = Schema<'ApiError'>

// Why a request failed: the server's error, or, with `fromServer` set to false, what went wrong when the server didn't
// answer with one, e.g. because the network failed, or because a proxy in front of it refused the request. Pages that
// artists see show a message of their own then, since this one isn't meant for them.
export type Failure = ApiError & { fromServer?: false }

export type Result<Data> = (Data & { ok: true }) | Failure

const client = createClient<paths>({
  // Absolute, since openapi-fetch builds a `Request`, which only accepts relative URLs in a browser, e.g. not in tests.
  baseUrl: globalThis.location.origin,
  // Both looked up for each request, so that tests can replace them (see mockFetch). `Request` is only called with `new`,
  // and the requests it makes are the environment's. A middleware that checks them against it would need a class.
  Request: function (input: RequestInfo | URL, init?: RequestInit) {
    return new globalThis.Request(input, init)
  } as unknown as typeof Request,
  fetch: (request) => globalThis.fetch(request),
})

type Client = typeof client
type Method = 'get' | 'put' | 'post' | 'delete'
export type PathsWith<M extends Method> = ClientPathsWithMethod<Client, M>
// A multipart/form-data body has to say that it's sent with `formData`, rather than as JSON.
type Serializer<Operation> = Operation extends { requestBody?: infer Body }
  ? [NonNullable<Body>] extends [never]
    ? unknown
    : NonNullable<Body> extends { content: { 'multipart/form-data': unknown } }
      ? { bodySerializer: typeof formData }
      : unknown
  : unknown
// What a request sends: its parameters, and its body.
export type Init<M extends Method, Path extends PathsWith<M>> = ParamsOption<paths[Path][M]> &
  RequestBodyOption<paths[Path][M]> &
  Serializer<paths[Path][M]>
// The init is optional when nothing in it is required, e.g. for a path without parameters.
export type InitParam<Init> = Record<string, never> extends Init ? [Init?] : [Init]
export type Data<M extends Method, Path extends PathsWith<M>> = MethodResponse<Client, M, Path>
// What a request sends as its body, e.g. `Body<'post', '/api/admin/artists'>`.
export type Body<M extends Method, Path extends PathsWith<M>> = NonNullable<RequestBodyOption<paths[Path][M]>['body']>

const sessionEndedListeners = new Set<() => void>()

// Calls `listener` whenever an admin request fails with 401, until the function it returns is called. Admin endpoints,
// those under /api/admin/, only ever fail with 401 when there's no session (see docs/design/server/README.md), so this
// tells that the session ended, e.g. when it expired. Listeners are called before the request's promise resolves, and
// mustn't throw, since the request would then throw too.
export function onSessionEnded(listener: () => void): () => void {
  sessionEndedListeners.add(listener)
  return () => sessionEndedListeners.delete(listener)
}

async function settle<Data>(
  request: Promise<{ data?: Data; error?: unknown; response: Response }>,
  admin: boolean,
): Promise<Result<Data>> {
  let settled: Awaited<typeof request>
  try {
    settled = await request
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), fromServer: false }
  }
  const { data, error, response } = settled
  if (response.ok) return { ...data, ok: true } as Data & { ok: true }
  // Outside the `try`, so that a listener that throws isn't taken for a request that failed.
  if (admin && response.status === 401) sessionEndedListeners.forEach((listener) => listener())
  const message = (error as Partial<ApiError> | undefined)?.error
  return typeof message === 'string' ? { ok: false, error: message } : { ok: false, error: 'Erreur inconnue', fromServer: false }
}

function method<M extends Method>(name: M) {
  return <Path extends PathsWith<M>>(path: Path, ...[init]: InitParam<Init<M, Path>>) =>
    settle(client.request(name, path, init as never), path.startsWith('/api/admin/')) as Promise<Result<Data<M, Path>>>
}

export const api = { GET: method('get'), PUT: method('put'), POST: method('post'), DELETE: method('delete') }

// Sends a body as multipart/form-data (see `api`): each of its fields as a part, files as they are, and anything else
// that isn't text, e.g. a profile, as JSON, in a field rather than a file. Fields that are undefined are left out. The
// browser sets the Content-Type, since it says where the parts start.
export function formData(body: Record<string, unknown>): FormData {
  const form = new FormData()
  for (const [name, value] of Object.entries(body)) {
    if (value === undefined) continue
    form.append(name, value instanceof Blob ? value : typeof value === 'string' ? value : JSON.stringify(value))
  }
  return form
}
