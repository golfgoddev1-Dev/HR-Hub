import { describe, expect, it } from 'vitest'
import { isValidSearchQuery, normalizeSearchQuery } from '../server/meeting-roster.js'

describe('normalizeSearchQuery', () => {
  it('trims the query', () => {
    expect(normalizeSearchQuery('  สมชาย  ')).toBe('สมชาย')
  })

  it('collapses inner spaces to one space', () => {
    expect(normalizeSearchQuery('สมชาย   ใจดี')).toBe('สมชาย ใจดี')
  })

  it('trims and collapses together', () => {
    expect(normalizeSearchQuery('   สมชาย \t  ใจดี  ')).toBe('สมชาย ใจดี')
  })

  it('returns an empty string for non-string input', () => {
    expect(normalizeSearchQuery(null)).toBe('')
    expect(normalizeSearchQuery(undefined)).toBe('')
  })
})

describe('isValidSearchQuery', () => {
  it('rejects empty and too-short queries', () => {
    expect(isValidSearchQuery('')).toBe(false)
    expect(isValidSearchQuery(' ')).toBe(false)
    expect(isValidSearchQuery('a')).toBe(false)
    expect(isValidSearchQuery(' a ')).toBe(false)
  })

  it('accepts queries with at least two characters', () => {
    expect(isValidSearchQuery('ab')).toBe(true)
    expect(isValidSearchQuery('  ab  ')).toBe(true)
  })
})
