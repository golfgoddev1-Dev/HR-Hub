import { Router } from 'express'
import { z } from 'zod'
import { getSupabase } from '../supabase.js'
import { requireRole } from '../middleware/require-role.js'
import { validateWindow } from '../meeting-window.js'
import { bangkokToday } from '../register-window.js'

const router = Router()
const SAVE_ERROR_MESSAGE = 'ไม่สามารถบันทึกได้ กรุณาลองใหม่'
const TYPE_ERROR_MESSAGE = 'ประเภทการประชุมไม่ถูกต้อง'
const INVALID_BODY_MESSAGE = 'ข้อมูลไม่ถูกต้อง'
const PAST_DATE_MESSAGE = 'เลือกวันที่ตั้งแต่วันนี้เป็นต้นไป'
const LIST_LIMIT = 12

const sessionSchema = z.object({
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  openTime: z.string(),
  cutoffTime: z.string(),
}).strict()

function logError(error) {
  if (error?.code) {
    console.error('[meeting-monthly-error]', error.code)
    return
  }
  console.error('[meeting-monthly-error]', error?.name)
}

function toHm(value) {
  if (typeof value !== 'string' || value.length < 5) return null
  return value.slice(0, 5)
}

function isCalendarDate(value) {
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return false
  return parsed.toISOString().slice(0, 10) === value
}

async function findMonthlyTypeId(supabase) {
  const { data, error } = await supabase
    .from('meeting_types')
    .select('id')
    .eq('code', 'monthly')
    .maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})
router.use(requireRole('meeting_controller'))

router.get('/', async (_req, res) => {
  try {
    const supabase = getSupabase()
    const typeId = await findMonthlyTypeId(supabase)
    if (!typeId) return res.status(400).json({ ok: false, message: TYPE_ERROR_MESSAGE })

    const { data, error } = await supabase
      .from('meeting_sessions')
      .select('id, session_date, open_time, cutoff_time')
      .eq('meeting_type_id', typeId)
      .gte('session_date', bangkokToday())
      .order('session_date', { ascending: true })
      .limit(LIST_LIMIT)
    if (error) throw error

    const sessions = (data ?? []).map((row) => ({
      id: row.id,
      sessionDate: row.session_date,
      openTime: toHm(row.open_time),
      cutoffTime: toHm(row.cutoff_time),
    }))
    return res.status(200).json({ ok: true, sessions })
  } catch (error) {
    logError(error)
    return res.status(500).json({ ok: false, message: SAVE_ERROR_MESSAGE })
  }
})

router.put('/', async (req, res) => {
  const parsed = sessionSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ ok: false, message: INVALID_BODY_MESSAGE })
  if (!isCalendarDate(parsed.data.sessionDate)) {
    return res.status(400).json({ ok: false, message: INVALID_BODY_MESSAGE })
  }

  const validation = validateWindow({
    openTime: parsed.data.openTime,
    cutoffTime: parsed.data.cutoffTime,
  })
  if (!validation.ok) return res.status(400).json({ ok: false, message: validation.message })

  const today = bangkokToday()
  if (parsed.data.sessionDate < today) {
    return res.status(400).json({ ok: false, message: PAST_DATE_MESSAGE })
  }

  try {
    const supabase = getSupabase()
    const typeId = await findMonthlyTypeId(supabase)
    if (!typeId) return res.status(400).json({ ok: false, message: TYPE_ERROR_MESSAGE })

    const { data: saved, error } = await supabase
      .from('meeting_sessions')
      .upsert({
        meeting_type_id: typeId,
        session_date: parsed.data.sessionDate,
        cycle_key: `monthly-${parsed.data.sessionDate}`,
        open_time: parsed.data.openTime,
        cutoff_time: parsed.data.cutoffTime,
      }, { onConflict: 'meeting_type_id,session_date' })
      .select('id')
      .single()
    if (error) throw error

    const { error: auditError } = await supabase.from('audit_logs').insert({
      actor_id: req.session.employeeId,
      action: 'meeting_monthly_session_set',
      entity: 'meeting_session',
      entity_id: saved.id,
      detail: JSON.stringify({
        sessionDate: parsed.data.sessionDate,
        openTime: parsed.data.openTime,
        cutoffTime: parsed.data.cutoffTime,
      }),
    })
    if (auditError) throw auditError

    return res.status(200).json({ ok: true })
  } catch (error) {
    logError(error)
    return res.status(500).json({ ok: false, message: SAVE_ERROR_MESSAGE })
  }
})

export default router
