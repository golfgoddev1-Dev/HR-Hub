import { describe, expect, it } from 'vitest'
import { readSource } from './helpers/read-source.js'

const page = readSource(new URL('../src/pages/ControllerDashboardPage.vue', import.meta.url))

describe('ControllerDashboardPage', () => {
  it('treats an answer without the fields the template reads as a load error', () => {
    const guard = page.indexOf('!data.meeting || !data.history')
    const assign = page.indexOf('dash.value = data')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(assign)
  })
})
