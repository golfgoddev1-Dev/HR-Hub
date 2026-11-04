// Certificate retention: the selection must be driven by an injected clock, not
// by "today", so the test stays true next year.
import { describe, expect, it } from 'vitest'

import {
  CERT_BUCKET,
  cutoffIso,
  certificateStoragePath,
  selectExpiredCertificates,
} from '../worker/src/leave-retention.js'

const NOW = new Date('2026-11-03T00:00:00.000Z')

function daysBefore(days) {
  return new Date(NOW.getTime() - days * 86400000).toISOString()
}

function row(id, days, overrides = {}) {
  return {
    id,
    medical_certificate_url: `https://example.test/${id}.pdf`,
    created_at: daysBefore(days),
    ...overrides,
  }
}

describe('cutoffIso', () => {
  it('subtracts the retention window from the injected now', () => {
    expect(cutoffIso(NOW, 90)).toBe('2026-08-05T00:00:00.000Z')
    expect(cutoffIso(NOW, 30)).toBe('2026-10-04T00:00:00.000Z')
    expect(cutoffIso(NOW, 365)).toBe('2025-11-03T00:00:00.000Z')
  })
})

describe('selectExpiredCertificates', () => {
  it('selects only rows older than the retention window', () => {
    const rows = [row('old', 91), row('edge', 90), row('fresh', 89), row('today', 0)]
    const expired = selectExpiredCertificates(rows, { now: NOW, retentionDays: 90 })

    expect(expired.map((item) => item.id)).toEqual(['old', 'edge'])
  })

  it('follows the setting: 30 days expires more than 365 days', () => {
    const rows = [row('forty', 40), row('four-hundred', 400)]

    expect(
      selectExpiredCertificates(rows, { now: NOW, retentionDays: 30 }).map((item) => item.id)
    ).toEqual(['forty', 'four-hundred'])

    expect(
      selectExpiredCertificates(rows, { now: NOW, retentionDays: 365 }).map((item) => item.id)
    ).toEqual(['four-hundred'])
  })

  it('skips rows without a certificate or with an unreadable date', () => {
    const rows = [
      row('empty', 100, { medical_certificate_url: null }),
      row('blank', 100, { medical_certificate_url: '   ' }),
      row('bad-date', 100, { created_at: 'not-a-date' }),
      row('kept', 100),
    ]

    expect(
      selectExpiredCertificates(rows, { now: NOW, retentionDays: 90 }).map((item) => item.id)
    ).toEqual(['kept'])
  })

  it('tolerates an empty or malformed list', () => {
    expect(selectExpiredCertificates([], { now: NOW, retentionDays: 90 })).toEqual([])
    expect(selectExpiredCertificates(null, { now: NOW, retentionDays: 90 })).toEqual([])
  })
})

describe('certificateStoragePath', () => {
  const BASE = 'https://fake-project.supabase.co'

  it('reads the path out of a public URL', () => {
    expect(
      certificateStoragePath(`${BASE}/storage/v1/object/public/${CERT_BUCKET}/leave/emp/cert.pdf`)
    ).toBe('leave/emp/cert.pdf')
  })

  it('reads the path out of a signed URL, ignoring the token', () => {
    expect(
      certificateStoragePath(
        `${BASE}/storage/v1/object/sign/${CERT_BUCKET}/leave/emp/cert.pdf?token=abc.def`
      )
    ).toBe('leave/emp/cert.pdf')
  })

  it('accepts an authenticated URL and a path that repeats the bucket', () => {
    expect(
      certificateStoragePath(`${BASE}/storage/v1/object/authenticated/${CERT_BUCKET}/a/b.png`)
    ).toBe('a/b.png')
    expect(certificateStoragePath(`${CERT_BUCKET}/a/b.png`)).toBe('a/b.png')
  })

  it('refuses paths that are not inside the leave-certificates bucket', () => {
    // The cleanup clears these links; it must never delete someone else's file.
    expect(certificateStoragePath('a/b.png')).toBe(null)
    expect(certificateStoragePath('/a/b.png')).toBe(null)
    expect(certificateStoragePath('leave-attachments/a/b.png')).toBe(null)
    expect(certificateStoragePath('https://cdn.example.test/cert.pdf')).toBe(null)
  })

  it('drops an external link to null but still clears the column', () => {
    const expired = selectExpiredCertificates(
      [row('external', 100, { medical_certificate_url: 'https://cdn.example.test/cert.pdf' })],
      { now: NOW, retentionDays: 90 }
    )
    expect(expired).toHaveLength(1)
    expect(expired[0].path).toBe(null)
  })

  it('decodes percent-encoded paths', () => {
    expect(certificateStoragePath(`${CERT_BUCKET}/leave/%E0%B8%81/cert.pdf`)).toBe(
      'leave/ก/cert.pdf'
    )
  })

  it('returns null for values it cannot use', () => {
    expect(certificateStoragePath(null)).toBe(null)
    expect(certificateStoragePath('')).toBe(null)
    expect(certificateStoragePath('   ')).toBe(null)
    expect(certificateStoragePath(`${BASE}/other/path.pdf`)).toBe(null)
    expect(certificateStoragePath(CERT_BUCKET)).toBe(null)
    expect(certificateStoragePath('not-a-url-at-all')).toBe(null)
  })

  it('attaches the parsed path to each expired row', () => {
    const expired = selectExpiredCertificates(
      [row('kept', 100, { medical_certificate_url: `${BASE}/storage/v1/object/public/${CERT_BUCKET}/x/y.pdf` })],
      { now: NOW, retentionDays: 90 }
    )
    expect(expired[0].path).toBe('x/y.pdf')
  })
})
