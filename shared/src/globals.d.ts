// APIs that browsers and Node both have, but that aren't part of the ES2023 library this package is limited to
// (see tsconfig.json). Only the parts used here are declared.

// https://url.spec.whatwg.org/#url-class
declare class URL {
  constructor(url: string, base?: string)
  readonly href: string
  readonly hostname: string
  readonly pathname: string
  readonly username: string
  readonly password: string
}
