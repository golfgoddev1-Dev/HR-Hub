import { randomInt } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { getRequiredEnv } from '../server/config.js'
import { hmacSha256Hex } from '../server/crypto.js'
import { getSupabase } from '../server/supabase.js'

async function main() {
  const employeeCode = process.argv[2]
  if (!employeeCode) {
    console.log('usage: npm run issue:reset-code -- <employee_code>')
    process.exitCode = 1
    return
  }

  try {
    const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
    dotenv.config({ path: path.resolve(scriptDirectory, '../.env.local'), quiet: true })

    const supabase = getSupabase()
    const { data: employee, error: employeeError } = await supabase
      .from('employees')
      .select('id, is_active')
      .eq('employee_code', employeeCode)
      .maybeSingle()
    if (employeeError) throw employeeError
    if (!employee) {
      console.log('ไม่พบพนักงาน')
      process.exitCode = 1
      return
    }
    if (employee.is_active !== true) {
      console.log('พนักงานนี้ไม่ได้ใช้งานอยู่')
      process.exitCode = 1
      return
    }

    const { data: creator, error: creatorError } = await supabase
      .from('employees')
      .select('id')
      .eq('employee_code', 'ADM001')
      .maybeSingle()
    if (creatorError) throw creatorError
    if (!creator) {
      console.log('ไม่พบผู้สร้างรหัส (ADM001)')
      process.exitCode = 1
      return
    }

    const now = new Date()
    const { error: invalidateError } = await supabase
      .from('pin_reset_codes')
      .update({ used_at: now.toISOString() })
      .eq('employee_id', employee.id)
      .is('used_at', null)
    if (invalidateError) throw invalidateError

    const code = String(randomInt(0, 100000000)).padStart(8, '0')
    const codeHash = hmacSha256Hex(
      getRequiredEnv('PIN_RESET_SECRET'),
      `${employee.id}:${code}`,
    )
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000)
    const expiresAtIso = expiresAt.toISOString()

    const { error: insertError } = await supabase.from('pin_reset_codes').insert({
      employee_id: employee.id,
      code_hash: codeHash,
      created_by: creator.id,
      created_at: now.toISOString(),
      expires_at: expiresAtIso,
      used_at: null,
      attempts: 0,
    })
    if (insertError) throw insertError

    const { error: auditError } = await supabase.from('audit_logs').insert({
      actor_id: creator.id,
      action: 'pin_reset_code_issued',
      entity: 'employee',
      entity_id: employee.id,
      detail: null,
    })
    if (auditError) throw auditError

    const expiresAtBangkok = new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(expiresAt)
    console.log(`ออกรหัสแล้ว สำหรับ ${employeeCode}`)
    console.log(`รหัส: ${code}`)
    console.log(`หมดอายุ: ${expiresAtBangkok}`)
    console.log('รหัสนี้แสดงครั้งเดียว กรุณาส่งให้พนักงานด้วยช่องทางที่ปลอดภัย')
  } catch (error) {
    console.log('เกิดข้อผิดพลาดกับฐานข้อมูล', error && error.code)
    process.exitCode = 1
  }
}

await main()
