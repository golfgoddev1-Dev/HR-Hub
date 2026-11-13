// Source checks compare file text against strings written with "\n". A Windows
// checkout with a CRLF working copy hands back "\r\n", so every test that reads
// a project text file goes through this helper instead of readFileSync. The
// assertions stay as they are; only the checkout's line endings stop mattering.
import { readFileSync } from 'node:fs'

export function readSource(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
}
