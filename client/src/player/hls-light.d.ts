// hls.js's light build has the same API as the full one, but its package doesn't declare types for it.
declare module 'hls.js/light' {
  export * from 'hls.js'
  export { default } from 'hls.js'
}
