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
  if (loginRole === 'hr') return '/leave/hr'
  if (loginRole === 'controller' || loginRole === 'meeting_controller') return '/meeting/controller'
  if (loginRole === 'system' || loginRole === 'system_admin') return '/admin'
  return '/login'
}
