// Where the browser goes when a page sends it to another site, e.g. back to an app that asked to connect, which the tests
// replace, since the browser they run in can't go anywhere.
export const browser = {
  go: (url: string) => window.location.assign(url),
}
