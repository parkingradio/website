import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import openapiTS, { COMMENT_HEADER, astToString } from 'openapi-typescript'
import ts from 'typescript'

// Writes src/api/schema.d.ts: the API's types, generated from the server's openapi.json by openapi-typescript, as its
// CLI would, except that files (`format: binary`), e.g. an artist's photo, are `Blob`s rather than strings, as
// openapi-typescript suggests, so that forms can send them. With `--check`, it only checks that schema.d.ts is up to
// date instead.
//
//   npm run generate:api    # at the root, which first generates openapi.json from the server

const INPUT = path.join(import.meta.dirname, '../server/openapi.json')
const OUTPUT = path.join(import.meta.dirname, 'src/api/schema.d.ts')

const BLOB = ts.factory.createTypeReferenceNode('Blob')

const ast = await openapiTS(JSON.parse(readFileSync(INPUT, 'utf8')), {
  transform: (schema) => (schema.format === 'binary' ? BLOB : undefined),
})
const generated = `${COMMENT_HEADER}${astToString(ast)}`

if (process.argv.includes('--check')) {
  if (readFileSync(OUTPUT, 'utf8') !== generated) {
    console.error("client/src/api/schema.d.ts doesn't match server/openapi.json. Run 'npm run generate:api' and commit the result.")
    process.exit(1)
  }
} else {
  writeFileSync(OUTPUT, generated)
}
