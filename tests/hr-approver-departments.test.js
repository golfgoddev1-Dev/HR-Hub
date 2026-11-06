// The department dropdown on "ตั้งค่าผู้อนุมัติ". The bug was a doubled path
// (`/api/hr/directory/catalog/catalog`), which threw on every load and left the
// page showing "ไม่พบแผนก". These checks pin the source URL, the no-caching rule
// for a failed or empty read, and the error + retry the page now shows.
import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DATA_KEYS, loadHrDepartments } from '../src/lib/shared-data.js'
import { clearAll, peekCached } from '../src/lib/data-cache.js'

const PAGE = readFileSync(
  new URL('../src/pages/HrLeaveApproversPage.vue', import.meta.url),
  'utf8'
)
const SHARED = readFileSync(new URL('../src/lib/shared-data.js', import.meta.url), 'utf8')

const realFetch = globalThis.fetch

const ok = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const DEPARTMENT = { id: 'dept-1', name: 'ฝ่ายบุคคล' }

beforeEach(() => {
  clearAll()
})

afterEach(() => {
  globalThis.fetch = realFetch
  clearAll()
})

describe('the HR department source', () => {
  it('requests the catalog once, without doubling /catalog', async () => {
    const urls = []
    globalThis.fetch = vi.fn(async (url) => {
      urls.push(String(url))
      return ok({ ok: true, departments: [DEPARTMENT] })
    })

    const departments = await loadHrDepartments()

    expect(urls).toEqual(['/api/hr/directory/catalog'])
    expect(departments).toEqual([DEPARTMENT])
  })

  it('keeps a successful list and reuses it', async () => {
    const fetchMock = vi.fn(async () => ok({ ok: true, departments: [DEPARTMENT] }))
    globalThis.fetch = fetchMock

    await loadHrDepartments()
    const second = await loadHrDepartments()

    expect(second).toEqual([DEPARTMENT])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(peekCached(DATA_KEYS.hrDepartments)).not.toBeNull()
  })

  it('does not store a failed read, and a retry loads the list', async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('offline')
      return ok({ ok: true, departments: [DEPARTMENT] })
    })

    await expect(loadHrDepartments()).rejects.toThrow()
    expect(peekCached(DATA_KEYS.hrDepartments)).toBeNull()

    await expect(loadHrDepartments()).resolves.toEqual([DEPARTMENT])
    expect(calls).toBe(2)
  })

  it('returns an empty list but never keeps it', async () => {
    globalThis.fetch = vi.fn(async () => ok({ ok: true, departments: [] }))

    await expect(loadHrDepartments()).resolves.toEqual([])
    expect(peekCached(DATA_KEYS.hrDepartments)).toBeNull()
  })

  it('passes the response error through as a safe message', async () => {
    globalThis.fetch = vi.fn(async () => ok({ ok: false, message: 'ระบบขัดข้อง' }))

    await expect(loadHrDepartments()).rejects.toThrow('ระบบขัดข้อง')
    expect(peekCached(DATA_KEYS.hrDepartments)).toBeNull()
  })
})

describe('the approvers page wiring', () => {
  it('reads departments through the shared loader for both selects', () => {
    expect(SHARED).toContain("/api/hr/directory/catalog'")
    expect(PAGE).toContain('loadHrDepartments')
    expect(PAGE).toContain(':items="departments"')
    expect(PAGE).toContain('item-title="name"')
    expect(PAGE).toContain('item-value="id"')
    // The old doubled path must not come back.
    expect(PAGE).not.toContain("directoryCatalog('/api/hr/directory/catalog')")
  })

  it('shows an error with a retry instead of an empty picker', () => {
    expect(PAGE).toContain('departmentsError')
    expect(PAGE).toContain('@click="loadDepartments"')
    expect(PAGE).toContain('ลองใหม่')
  })

  it('shows ไม่พบแผนก only after a successful empty answer', () => {
    expect(PAGE).toContain("departmentsLoading ? 'กำลังโหลด…' : 'ไม่พบแผนก'")
  })
})
