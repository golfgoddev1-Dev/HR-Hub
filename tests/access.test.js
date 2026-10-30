import { describe, expect, it } from 'vitest'
import { landingPathFor } from '../server/access.js'

describe('landingPathFor', () => {
  it('routes employees with pending approvals to approvals', () => {
    expect(landingPathFor('employee', true)).toBe('/leave/approvals')
  })

  it('routes employees without pending approvals to leave', () => {
    expect(landingPathFor('employee', false)).toBe('/leave')
  })

  it('routes HR to the HR leave page', () => {
    expect(landingPathFor('hr', false)).toBe('/leave/hr')
  })

  it('routes meeting controllers to the meeting overview page', () => {
    expect(landingPathFor('controller', false)).toBe('/meeting/controller')
    expect(landingPathFor('meeting_controller', false)).toBe('/meeting/controller')
  })

  it('routes system administrators to the admin page', () => {
    expect(landingPathFor('system', false)).toBe('/admin')
  })
})
