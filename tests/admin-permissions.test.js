// Frontend rules for the system-admin permission page. No browser needed: the
// search URL and escaping, the flag diff, the confirm rule and the route/nav
// wiring are all plain data.

import { describe, expect, it } from 'vitest'

import {
  MIN_SEARCH_LENGTH,
  PERMISSION_FIELDS,
  PERMISSION_KEYS,
  PERMISSION_SEARCH_URL,
  buildPermissionSearchUrl,
  buildSearchFilter,
  changedFlags,
  emptyPermissionFlags,
  encodeSearchValue,
  escapeSearchPattern,
  hasPermissionChanges,
  isSearchable,
  normalizeQuery,
  permissionToggleBody,
  readPermissionFlags,
  requiresSystemAdminConfirm,
  searchResultRows,
} from '../src/lib/admin-permissions.js'
import { adminNavItems } from '../src/lib/nav-config.js'
import { canOpenPath } from '../src/lib/route-access.js'

import { readSource } from './helpers/read-source.js'

const NAV = readSource(new URL('../src/components/AdminNav.vue', import.meta.url))
const ROUTER = readSource(new URL('../src/router.js', import.meta.url))
const PAGE = readSource(
  new URL('../src/pages/AdminPermissionsPage.vue', import.meta.url)
)

const ALL_OFF = emptyPermissionFlags()

describe('route access', () => {
  it('lets system_admin open the permission page', () => {
    expect(canOpenPath('system_admin', '/admin/permissions')).toBe(true)
    expect(canOpenPath('system_admin', '/admin')).toBe(true)
  })

  it('denies every other role', () => {
    for (const role of ['hr', 'meeting_controller', 'employee']) {
      expect(canOpenPath(role, '/admin/permissions'), role).toBe(false)
    }
    expect(canOpenPath(null, '/admin/permissions')).toBe(false)
  })

  it('declares the route under the admin layout with its one role', () => {
    expect(ROUTER).toContain("path: '/admin/permissions'")
    expect(ROUTER).toContain('AdminPermissionsPage')
    expect(ROUTER).toContain("meta: { requiresAuth: true, role: 'system_admin' }")
  })
})

describe('admin menu', () => {
  it('has a real link named สิทธิ์ผู้ใช้', () => {
    const permissions = adminNavItems().find((item) => item.to === '/admin/permissions')
    expect(permissions.label).toBe('สิทธิ์ผู้ใช้')
    // The nav renders it from the shared config, one link per item.
    expect(NAV).toContain('v-for="item in section.items"')
    expect(NAV).toContain(':to="item.to"')
  })

  it('draws the new icon with a material symbol span, not v-icon', () => {
    const permissions = adminNavItems().find((item) => item.to === '/admin/permissions')
    expect(permissions.icon).toBe('manage_accounts')
    expect(NAV).toContain('<span class="material-symbols-outlined nav-icon">{{ item.icon }}</span>')
    expect(NAV).not.toContain('<v-icon')
  })
})

describe('permission page', () => {
  it('offers the four Thai flags in order', () => {
    expect(PERMISSION_KEYS).toEqual(['hrAdmin', 'meetingAdmin', 'systemAdmin', 'leaveApprover'])
    expect(PERMISSION_FIELDS.map((field) => field.label)).toEqual([
      'ผู้ดูแล HR',
      'ผู้ดูแลการประชุม',
      'ผู้ดูแลระบบ',
      'ผู้อนุมัติการลา',
    ])
  })

  it('debounces the search and announces its result with role=status', () => {
    expect(PAGE).toContain('SEARCH_DEBOUNCE_MS')
    expect(PAGE).toContain('role="status"')
    expect(PAGE).toContain('buildPermissionSearchUrl')
    expect(PAGE).not.toContain('v-icon')
    expect(PAGE).toContain('class="material-symbols-outlined')
  })

  it('keeps the save button tied to a real change', () => {
    expect(PAGE).toContain('hasPermissionChanges')
    expect(PAGE).toContain(':disabled="!canSave"')
  })
})

describe('query building', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeQuery('  สมชาย   ใจดี  ')).toBe('สมชาย ใจดี')
    expect(normalizeQuery(null)).toBe('')
  })

  it('needs at least two characters', () => {
    expect(MIN_SEARCH_LENGTH).toBe(2)
    expect(isSearchable(' a ')).toBe(false)
    expect(isSearchable('ab')).toBe(true)
    expect(isSearchable('ทด')).toBe(true)
  })

  it('builds the search request from the trimmed query', () => {
    expect(buildPermissionSearchUrl('  สมชาย  ')).toBe(
      `${PERMISSION_SEARCH_URL}?q=${encodeURIComponent('สมชาย')}`
    )
    expect(PERMISSION_SEARCH_URL).toBe('/api/admin/permissions/search')
  })
})

describe('escaping', () => {
  it('turns the ilike wildcards into literals', () => {
    expect(escapeSearchPattern('50%_x*')).toBe('50\\%\\_x\\*')
    expect(escapeSearchPattern('a\\b')).toBe('a\\\\b')
  })

  it('encodes the dot, comma and parentheses of a filter value', () => {
    expect(encodeSearchValue('a.b,c(d)')).toBe('a%2Eb%2Cc%28d%29')
  })

  it('builds an or=() filter whose values cannot open or close the group', () => {
    const filter = buildSearchFilter('a,b(c).d')

    expect(filter.startsWith('or=(full_name.ilike.')).toBe(true)
    expect(filter).toContain(',employee_code.ilike.')
    expect(filter).toContain('%2C')
    expect(filter).toContain('%28')
    expect(filter).toContain('%29')
    expect(filter).toContain('%2E')
    expect(filter).not.toContain('a,b')
    expect(filter).not.toContain('b(c)')
  })

  it('escapes a typed percent before encoding it', () => {
    expect(buildSearchFilter('50%')).toContain('%5C%25')
  })
})

describe('flag diff', () => {
  it('is empty when nothing changed', () => {
    expect(changedFlags(ALL_OFF, { ...ALL_OFF })).toEqual([])
    expect(hasPermissionChanges(null, null)).toBe(false)
  })

  it('names each changed flag in display order with its direction', () => {
    const changes = changedFlags(
      { ...ALL_OFF, hrAdmin: true, leaveApprover: true },
      { ...ALL_OFF }
    )
    expect(changes).toEqual([
      { key: 'hrAdmin', label: 'ผู้ดูแล HR', granted: false },
      { key: 'leaveApprover', label: 'ผู้อนุมัติการลา', granted: false },
    ])
  })

  it('treats a missing value as false, never as a change', () => {
    expect(changedFlags({}, { ...ALL_OFF })).toEqual([])
    expect(changedFlags(ALL_OFF, {})).toEqual([])
  })

  it('keeps only the four flags in the PUT body', () => {
    expect(permissionToggleBody({ ...ALL_OFF, hrAdmin: true, extra: true })).toEqual({
      hrAdmin: true,
      meetingAdmin: false,
      systemAdmin: false,
      leaveApprover: false,
    })
    expect(Object.keys(permissionToggleBody(null)).sort()).toEqual([
      'hrAdmin',
      'leaveApprover',
      'meetingAdmin',
      'systemAdmin',
    ])
  })
})

describe('confirm rule', () => {
  it('requires a confirm step only when the system admin flag is switched off', () => {
    expect(requiresSystemAdminConfirm({ ...ALL_OFF, systemAdmin: true }, { ...ALL_OFF })).toBe(
      true
    )
    expect(
      requiresSystemAdminConfirm({ ...ALL_OFF }, { ...ALL_OFF, systemAdmin: true })
    ).toBe(false)
    expect(requiresSystemAdminConfirm({ ...ALL_OFF }, { ...ALL_OFF, hrAdmin: true })).toBe(
      false
    )
    expect(requiresSystemAdminConfirm(null, { ...ALL_OFF })).toBe(false)
  })
})

describe('API replies', () => {
  it('reads only the four boolean flags from a person row', () => {
    expect(readPermissionFlags({ hrAdmin: true, systemAdmin: 'yes', pin: '123456' })).toEqual({
      hrAdmin: true,
      meetingAdmin: false,
      systemAdmin: false,
      leaveApprover: false,
    })
    expect(readPermissionFlags(null)).toEqual(ALL_OFF)
  })

  it('drops result rows without an id', () => {
    const rows = searchResultRows([
      { id: 'a', fullName: 'ก' },
      null,
      { fullName: 'ไม่มี id' },
      'x',
    ])
    expect(rows).toEqual([{ id: 'a', fullName: 'ก' }])
    expect(searchResultRows(null)).toEqual([])
  })
})
