// For the tests: a multipart/form-data body, as `app.inject` takes it, with a part for each field, in order: a string as a
// field, and a Buffer as a file. Fields that are undefined are left out.
export function multipartBody(parts: Record<string, string | Buffer | undefined>): { payload: Buffer; headers: { 'content-type': string } } {
  const boundary = 'test-boundary'
  const chunks: Buffer[] = []
  for (const [name, value] of Object.entries(parts)) {
    if (value === undefined) continue
    const file = Buffer.isBuffer(value) ? `; filename="${name}"\r\nContent-Type: application/octet-stream` : ''
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"${file}\r\n\r\n`), Buffer.from(value), Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}
