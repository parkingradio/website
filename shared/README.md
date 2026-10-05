# shared

This directory contains the contract between the client and the server: the shapes of the API's requests and
responses, the rules that decide whether a request is valid, and "global" values used by the API. Things that
fall outside this strict scope should not be included in this package.

If the client and the server would stop agreeing on what a valid request is if they each had their own copy
of a type/function/value, it belongs here. Otherwise, it doesn't.

[docs/api.md](../docs/api.md) gives an overview of every endpoint: update it too when an endpoint changes.

## How it's used

The client and the server import it as `shared/<file>` (e.g. `shared/events` for `src/events.ts`), through the
`exports` of `package.json`.

It has no build: the client and the server both use its TypeScript sources, during development as in
production. Vite bundles them into the client, and Node runs them for the server by stripping their types.
This means that TypeScript features that are more than just type annotations must not be used here.
