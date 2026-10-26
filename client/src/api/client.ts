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
// Like the helpers of ../api.ts, calls never throw: they return the response with `ok: true` if it succeeded, or else an
// `ApiError`, including for failures that never reach the server.

// A schema of the API, by name, e.g. `Schema<'Feature'>`.
export type Schema<Name extends keyof components['schemas']> = components['schemas'][Name]

export type ApiError = Schema<'ApiError'>

export type Result<Data> = (Data & { ok: true }) | ApiError

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

async function settle<Data>(request: Promise<{ data?: Data; error?: unknown; response: Response }>): Promise<Result<Data>> {
  try {
    const { data, error, response } = await request
    if (response.ok) return { ...data, ok: true } as Data & { ok: true }
    return { ok: false, error: (error as Partial<ApiError> | undefined)?.error ?? 'Erreur inconnue' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function method<M extends Method>(name: M) {
  return <Path extends PathsWith<M>>(path: Path, ...[init]: InitParam<Init<M, Path>>) =>
    settle(client.request(name, path, init as never)) as Promise<Result<Data<M, Path>>>
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
