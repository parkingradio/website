# shared

This directory contains the contract between the client and the server that isn't generated from the server yet: the
shapes of the API's requests and responses, and "global" values used by the API. Things that
fall outside this strict scope should not be included in this package.

If the client and the server would stop agreeing on what a valid request is if they each had their own copy
of a type/function/value, it belongs here. Otherwise, it doesn't.

The server's design documents ([docs/design/server](../docs/design/server/README.md)) specify every endpoint, and the
types here implement them: update the documents first when an endpoint changes.

It's going away: the API's areas move one by one to schemas on the server's routes, from which the client's types are
generated (see [docs/design/README.md](../docs/design/README.md)), and each area's types are deleted from here once it
has. Every area has: only `ApiError` is left (`src/error.ts`), which the next step removes along with this package.

## How it's used

The client and the server import it as `shared/<file>` (e.g. `shared/error` for `src/error.ts`), through the
`exports` of `package.json`. So does the seed (see `e2e/seed.ts`), which talks to the server through its API.

It has no build: the client and the server both use its TypeScript sources, during development as in
production. Vite bundles them into the client, and Node runs them for the server by stripping their types (the server
only imports types from it now, which its build erases).
This means that TypeScript features that are more than just type annotations must not be used here.
