import { Router } from 'express'
import { z } from 'zod'
import { getRequiredEnv } from '../config.js'
import { getSupabase } from '../supabase.js'
import { requireRole } from '../middleware/require-role.js'
import { buildRegisterUrl, newQrToken, validateWindow } from '../meeting-window.js'

const router = Router()
const SAVE_ERROR_MESSAGE = 'ไม่สามารถบันทึกได้ กรุณาลองใหม่'
const INVALID_BODY_MESSAGE = 'ข้อมูลไม่ถูกต้อง'
const SUP_ONLY_MESSAGE = 'แก้ไขได้เฉพาะการประชุมหัวหน้างาน'
const NOT_FOUND_MESSAGE = 'ไม่พบประเภทการประชุม'

const rotateSchema = z.object({
  code: z.enum(['sup', 'monthly']),
}).strict()
const windowSchema = z.object({
  openTime: z.string(),
  cutoffTime: z.string(),
  code: z.string().optional(),
}).strict()

function formatTime(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || value.length < 5) return null
  return value.slice(0, 5)
}

router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})
router.use(requireRole('meeting_controller'))

router.get('/types', async (_req, res) => {
  try {
    const supabase = getSupabase()
    const origin = getRequiredEnv('APP_ORIGIN')
    const { data: types, error } = await supabase
      .from('meeting_types')
      .select('code, name, qr_token, weekday, default_open_time, default_cutoff_time')
      .order('code', { ascending: true })
    if (error) throw error

    const rows = (types ?? []).map((type) => ({
      code: type.code,
      name: type.name,
      registerUrl: buildRegisterUrl(origin, type.qr_token),
      weekday: type.weekday === null || type.weekday === undefined ? null : type.weekday,
      openTime: formatTime(type.default_open_time),
      cutoffTime: formatTime(type.default_cutoff_time),
    }))
    return res.status(200).json({ ok: true, types: rows })
  } catch (err) {
    console.error('[meeting-types-error]', { name: err?.name, code: err?.code, message: err?.message, details: err?.details, hint: err?.hint })
    return res.status(500).json({ ok: false, message: SAVE_ERROR_MESSAGE })
  }
})

router.post('/qr/rotate', async (req, res) => {
  const parsed = rotateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ ok: false, message: INVALID_BODY_MESSAGE })

  try {
    const supabase = getSupabase()
    const origin = getRequiredEnv('APP_ORIGIN')
    const token = newQrToken()
    const { data: updated, error: updateError } = await supabase
      .from('meeting_types')
      .update({ qr_token: token })
      .eq('code', parsed.data.code)
      .select('id')
      .maybeSingle()
    if (updateError) throw updateError
    if (!updated) return res.status(400).json({ ok: false, message: NOT_FOUND_MESSAGE })

    const { error: auditError } = await supabase.from('audit_logs').insert({
      actor_id: req.session.employeeId,
      action: 'meeting_qr_rotated',
      entity: 'meeting_type',
      entity_id: updated.id,
      detail: null,
    })
    if (auditError) throw auditError

    return res.status(200).json({ ok: true, registerUrl: buildRegisterUrl(origin, token) })
  } catch (error) {
    console.error('[meeting-qr-rotate-error]', error && error.code)
    return res.status(500).json({ ok: false, message: SAVE_ERROR_MESSAGE })
  }
})

router.put('/window', async (req, res) => {
  const parsed = windowSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ ok: false, message: INVALID_BODY_MESSAGE })
  if (parsed.data.code !== undefined && parsed.data.code !== 'sup') {
    return res.status(400).json({ ok: false, message: SUP_ONLY_MESSAGE })
  }

  const { openTime, cutoffTime } = parsed.data
  const validation = validateWindow({ openTime, cutoffTime })
  if (!validation.ok) return res.status(400).json({ ok: false, message: validation.message })

  try {
    const supabase = getSupabase()
    const { data: current, error: readError } = await supabase
      .from('meeting_types')
      .select('id, default_open_time, default_cutoff_time')
      .eq('code', 'sup')
      .maybeSingle()
    if (readError) throw readError
    if (!current) return res.status(400).json({ ok: false, message: NOT_FOUND_MESSAGE })

    const { error: updateError } = await supabase
      .from('meeting_types')
      .update({ default_open_time: openTime, default_cutoff_time: cutoffTime })
      .eq('id', current.id)
    if (updateError) throw updateError

    const detail = JSON.stringify({
      old: {
        openTime: formatTime(current.default_open_time),
        cutoffTime: formatTime(current.default_cutoff_time),
      },
      new: { openTime, cutoffTime },
    })
    const { error: auditError } = await supabase.from('audit_logs').insert({
      actor_id: req.session.employeeId,
      action: 'meeting_window_updated',
      entity: 'meeting_type',
      entity_id: current.id,
      detail,
    })
    if (auditError) throw auditError

    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('[meeting-window-error]', error && error.code)
    return res.status(500).json({ ok: false, message: SAVE_ERROR_MESSAGE })
  }
})

export default router
