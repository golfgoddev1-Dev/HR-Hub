import { getSupabase } from './supabase.js'

export async function allowedLoginTypesFor(employeeId) {
  const supabase = getSupabase()
  const roles = [
    ['hr_admins', 'hr'],
    ['meeting_admins', 'meeting_controller'],
    ['system_admins', 'system_admin'],
  ]
  for (const [table, role] of roles) {
    const { data, error } = await supabase
      .from(table)
      .select('employee_id')
      .eq('employee_id', employeeId)
      .maybeSingle()
    if (error) throw error
    if (data) return [role]
  }
  return ['employee']
}

export function landingPathFor(loginRole, hasPendingApprovals) {
  if (loginRole === 'employee') {
    return hasPendingApprovals ? '/leave/approvals' : '/leave'
  }
  // HR lands on the HR home page (/hr), matching the Worker (worker/src/session.js).
  if (loginRole === 'hr') return '/hr'
  if (loginRole === 'controller' || loginRole === 'meeting_controller') return '/meeting/controller'
  if (loginRole === 'system' || loginRole === 'system_admin') return '/admin'
  return '/login'
}
