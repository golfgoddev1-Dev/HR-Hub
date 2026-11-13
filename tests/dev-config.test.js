// Guards for the local dev wiring after Express was retired: the Worker is the
// only API, so `npm run dev` must start it together with Vite and Vite must
// proxy /api to it. These replace the server-only unit tests that were removed
// with server/.
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { readSource } from './helpers/read-source.js'

const projectRoot = path.resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readSource(path.join(projectRoot, 'package.json')))

describe('local dev wiring', () => {
  it('runs the Worker and Vite together and no longer ships Express scripts', () => {
    expect(pkg.scripts.dev).toContain('dev:worker')
    expect(pkg.scripts.dev).toContain('dev:web')
    expect(pkg.scripts['dev:worker']).toContain('worker')
    expect(pkg.scripts['dev:api']).toBeUndefined()
    expect(pkg.scripts.start).toBeUndefined()
  })

  it('proxies /api to the local Worker by default', async () => {
    delete process.env.VITE_API_TARGET
    const config = (await import('../vite.config.js')).default
    expect(config.server.proxy['/api']).toBe('http://127.0.0.1:8787')
  })
})
