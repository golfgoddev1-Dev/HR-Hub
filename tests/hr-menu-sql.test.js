// worker/sql/hr-menu-shortcuts.sql has to be the file that was actually run in
// production: safe to run again, and able to pass on the rows that already
// exist. Two things broke before:
//   - a check of 1 to 5 fails every existing row, because a new column defaults
//     to an empty array (the Worker still requires 1 to 5 on save, so a saved
//     choice is never empty, and 0 only ever means "system default");
//   - a plain "add constraint" errors the second time the file is run, so the
//     constraint has to be created only when pg_constraint does not have it.

import { describe, expect, it } from 'vitest'

import { readSource } from './helpers/read-source.js'

const SQL = readSource('worker/sql/hr-menu-shortcuts.sql')
const LINES = SQL.split('\n')

describe('the column', () => {
  it('is added without failing when it already exists', () => {
    expect(SQL).toContain('add column if not exists hr_menu_shortcuts text[] not null')
  })

  it('defaults to an empty array', () => {
    expect(SQL).toContain("default '{}'")
  })
})

describe('the check constraint', () => {
  it('allows 0 to 5, so the default rows pass', () => {
    expect(SQL).toContain('check (cardinality(hr_menu_shortcuts) between 0 and 5)')
  })

  it('never asks for 1 to 5, which would reject every existing row', () => {
    expect(SQL).not.toMatch(/between\s+1\s+and\s+5/i)
    for (const line of LINES) expect(line).not.toContain('between 1 and 5')
  })

  it('is created only when pg_constraint does not already have it', () => {
    expect(SQL).toContain('do $$')
    expect(SQL).toContain("select 1 from pg_constraint")
    expect(SQL).toContain("where conname = 'employees_hr_menu_shortcuts_len'")
    expect(SQL).toContain('if not exists (')
    expect(SQL).toContain('end if;')

    // One add constraint, and it sits inside the guard.
    expect(SQL.match(/add constraint/gi)).toHaveLength(1)
    const guard = SQL.indexOf('do $$')
    const add = SQL.indexOf('add constraint')
    const end = SQL.indexOf('end $$;')
    expect(guard).toBeGreaterThan(-1)
    expect(add).toBeGreaterThan(guard)
    expect(add).toBeLessThan(end)
  })

  it('names the constraint the same way in the guard and the add', () => {
    expect(SQL.match(/employees_hr_menu_shortcuts_len/g)).toHaveLength(2)
  })
})

describe('the file', () => {
  it('keeps the column comment', () => {
    expect(SQL).toContain('comment on column public.employees.hr_menu_shortcuts is')
    expect(SQL).toContain(
      "'HR home menu shortcuts, in the order the person chose; empty means the system default'"
    )
  })

  it('says the Worker, not SQL, owns the 1 to 5 rule on save', () => {
    expect(SQL).toContain('requires 1 to 5 routes')
    expect(SQL).toContain('An empty array (0 routes) means "nothing chosen"')
    expect(SQL).toContain('Safe to run again')
  })
})
