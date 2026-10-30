import { Router } from 'express'
import { z } from 'zod'
import { getSupabase } from '../supabase.js'
import { requireRole } from '../middleware/require-role.js'
import { isValidSearchQuery, normalizeSearchQuery } from '../meeting-roster.js'

const router = Router()
const SAVE_ERROR_MESSAGE = 'ไม่สามารถบันทึกได้ กรุณาลองใหม่'
const TYPE_ERROR_MESSAGE = 'ประเภทการประชุมไม่ถูกต้อง'
const EMPLOYEE_ERROR_MESSAGE = 'ไม่พบพนักงานที่ใช้งานอยู่'
const ROSTER_ERROR_MESSAGE = 'ไม่พบรายชื่อนี้'
const INVALID_BODY_MESSAGE = 'ข้อมูลไม่ถูกต้อง'
const DASH = '-'
const SEARCH_LIMIT = 10
const MEETING_CODES = ['sup', 'monthly']
const SHARED_CODE = 'sup'
const MEMBER_FIELDS = 'employee_id, employees!meeting_roster_employee_id_fkey!inner(employee_code, full_name, departments(name), positions(name))'
const EMPLOYEE_FIELDS = 'id, employee_code, full_name, departments(name), positions(name)'

const rosterSchema = z.object({
  employeeId: z.uuid(),
}).strict()

function logError(error) {
  if (error?.code) {
    console.error('[meeting-roster-error]', error.code)
    return
  }
  console.error('[meeting-roster-error]', { name: error?.name, message: error?.message })
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

function toMember(row) {
  const employee = row.employees ?? {}
  return {
    employeeId: row.employee_id,
    employeeCode: employee.employee_code ?? DASH,
    fullName: employee.full_name ?? DASH,
    departmentName: employee.departments?.name ?? DASH,
    positionName: employee.positions?.name ?? DASH,
  }
}

function toCandidate(row) {
  return {
    employeeId: row.id,
    employeeCode: row.employee_code ?? DASH,
    fullName: row.full_name ?? DASH,
    departmentName: row.departments?.name ?? DASH,
    positionName: row.positions?.name ?? DASH,
  }
}

function sortByName(list) {
  return [...list].sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), 'th'))
}

async function findTypeIds(supabase) {
  const { data, error } = await supabase
    .from('meeting_types')
    .select('id, code')
    .in('code', MEETING_CODES)
  if (error) throw error
  const supId = data?.find((row) => row.code === SHARED_CODE)?.id ?? null
  const monthlyId = data?.find((row) => row.code === 'monthly')?.id ?? null
  return { supId, monthlyId }
}

async function activeMemberIds(supabase, typeId) {
  const { data, error } = await supabase
    .from('meeting_roster')
    .select('employee_id')
    .eq('meeting_type_id', typeId)
    .eq('is_active', true)
  if (error) throw error
  return new Set((data ?? []).map((row) => row.employee_id))
}

router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})
router.use(requireRole('meeting_controller'))

router.get('/', async (_req, res) => {
  try {
    const supabase = getSupabase()
    const { supId } = await findTypeIds(supabase)
    if (!supId) return res.status(400).json({ ok: false, message: TYPE_ERROR_MESSAGE })

    const { data, error } = await supabase
      .from('meeting_roster')
      .select(MEMBER_FIELDS)
      .eq('meeting_type_id', supId)
      .eq('is_active', true)
    if (error) throw error

    const members = sortByName((data ?? []).map(toMember))
    return res.status(200).json({ ok: true, count: members.length, members })
  } catch (error) {
    logError(error)
    return res.status(500).json({ ok: false, message: SAVE_ERROR_MESSAGE })
  }
})

router.get('/search', async (req, res) => {
  const query = normalizeSearchQuery(req.query.q)
  if (!isValidSearchQuery(query)) return res.status(200).json({ ok: true, results: [] })

  try {
    const supabase = getSupabase()
    const { supId } = await findTypeIds(supabase)
    if (!supId) return res.status(400).json({ ok: false, message: TYPE_ERROR_MESSAGE })

    const rosterIds = await activeMemberIds(supabase, supId)

    const pattern = `%${escapeLike(query)}%`
    const [nameResult, codeResult] = await Promise.all([
      supabase
        .from('employees')
        .select(EMPLOYEE_FIELDS)
        .eq('is_active', true)
        .ilike('full_name', pattern)
        .limit(SEARCH_LIMIT),
      supabase
        .from('employees')
        .select(EMPLOYEE_FIELDS)
        .eq('is_active', true)
        .ilike('employee_code', pattern)
        .limit(SEARCH_LIMIT),
    ])
    if (nameResult.error) throw nameResult.error
    if (codeResult.error) throw codeResult.error

    const merged = new Map()
    for (const row of [...(nameResult.data ?? []), ...(codeResult.data ?? [])]) {
      if (rosterIds.has(row.id) || merged.has(row.id)) continue
      merged.set(row.id, toCandidate(row))
    }

    const results = sortByName([...merged.values()]).slice(0, SEARCH_LIMIT)
    return res.status(200).json({ ok: true, results })
  } catch (error) {
    logError(error)
    return res.status(500).json({ ok: false, message: SAVE_ERROR_MESSAGE })
  }
})

router.post('/add', async (req, res) => {
  const parsed = rosterSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ ok: false, message: INVALID_BODY_MESSAGE })

  try {
    const supabase = getSupabase()
    const { supId, monthlyId } = await findTypeIds(supabase)
    if (!supId || !monthlyId) return res.status(400).json({ ok: false, message: TYPE_ERROR_MESSAGE })

    const { data: employee, error: employeeError } = await supabase
      .from('employees')
      .select('id, is_active')
      .eq('id', parsed.data.employeeId)
      .maybeSingle()
    if (employeeError) throw employeeError
    if (!employee || employee.is_active !== true) {
      return res.status(400).json({ ok: false, message: EMPLOYEE_ERROR_MESSAGE })
    }

    const now = new Date().toISOString()
    const rows = [supId, monthlyId].map((typeId) => ({
      meeting_type_id: typeId,
      employee_id: parsed.data.employeeId,
      is_active: true,
      created_by: req.session.employeeId,
      created_at: now,
    }))
    const { error } = await supabase
      .from('meeting_roster')
      .upsert(rows, { onConflict: 'meeting_type_id,employee_id' })
    if (error) throw error

    return res.status(200).json({ ok: true })
  } catch (error) {
    logError(error)
    return res.status(500).json({ ok: false, message: SAVE_ERROR_MESSAGE })
  }
})

router.post('/remove', async (req, res) => {
  const parsed = rosterSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ ok: false, message: INVALID_BODY_MESSAGE })

  try {
    const supabase = getSupabase()
    const { supId, monthlyId } = await findTypeIds(supabase)
    if (!supId || !monthlyId) return res.status(400).json({ ok: false, message: TYPE_ERROR_MESSAGE })

    const { data: updated, error } = await supabase
      .from('meeting_roster')
      .update({ is_active: false })
      .eq('employee_id', parsed.data.employeeId)
      .in('meeting_type_id', [supId, monthlyId])
      .select('meeting_type_id')
    if (error) throw error
    if (!updated || updated.length === 0) {
      return res.status(404).json({ ok: false, message: ROSTER_ERROR_MESSAGE })
    }

    return res.status(200).json({ ok: true })
  } catch (error) {
    logError(error)
    return res.status(500).json({ ok: false, message: SAVE_ERROR_MESSAGE })
  }
})

export default router
