import { createRouter, createWebHistory } from 'vue-router'
import { getSession } from './api.js'
import LoginPage from './pages/LoginPage.vue'
import PendingPage from './pages/PendingPage.vue'
import SetPinPage from './pages/SetPinPage.vue'
import ChangePinPage from './pages/ChangePinPage.vue'
import ControllerQrPage from './pages/ControllerQrPage.vue'
import ControllerRosterPage from './pages/ControllerRosterPage.vue'
import RegisterPage from './pages/RegisterPage.vue'
import ControllerOverviewPage from './pages/ControllerOverviewPage.vue'
import ControllerDashboardPage from './pages/ControllerDashboardPage.vue'
import MeetingBackfillHistoryPage from './pages/MeetingBackfillHistoryPage.vue'
import MeetingBackfillImportPage from './pages/MeetingBackfillImportPage.vue'
import RegistrantsPage from './pages/RegistrantsPage.vue'
import HrHomePage from './pages/HrHomePage.vue'
import HrEmployeeImportPage from './pages/HrEmployeeImportPage.vue'
import HrEmployeeDetailPage from './pages/HrEmployeeDetailPage.vue'
import HrEmployeesPage from './pages/HrEmployeesPage.vue'
import HrEmployeeDataPage from './pages/HrEmployeeDataPage.vue'
import HrPasswordPage from './pages/HrPasswordPage.vue'
import ControllerEmployeeDataPage from './pages/ControllerEmployeeDataPage.vue'
import HrLeaveRequestsPage from './pages/HrLeaveRequestsPage.vue'
import HrLeaveBackdatedPage from './pages/HrLeaveBackdatedPage.vue'
import HrLeaveApproversPage from './pages/HrLeaveApproversPage.vue'
import HrLeaveHolidaysPage from './pages/HrLeaveHolidaysPage.vue'
import HrLeaveSettingsPage from './pages/HrLeaveSettingsPage.vue'
import HrLeavePrintPage from './pages/HrLeavePrintPage.vue'
import AdminPage from './pages/AdminPage.vue'
import { canPrintLeave } from './leave-print.js'
import LeaveHomePage from './pages/LeaveHomePage.vue'
import LeaveRequestPage from './pages/LeaveRequestPage.vue'
import LeaveApprovalsPage from './pages/LeaveApprovalsPage.vue'
// The allow-lists live in src/lib/route-access.js so pages can ask the same
// question the guard asks before offering a link.
import { canOpenPath, homePathByRole } from './lib/route-access.js'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginPage },
    { path: '/pending', component: PendingPage },
    { path: '/', redirect: '/login' },
    { path: '/set-pin', component: SetPinPage },
    { path: '/change-pin', component: ChangePinPage, meta: { requiresAuth: true } },
    { path: '/leave', component: LeaveHomePage, meta: { requiresAuth: true } },
    { path: '/leave/new', component: LeaveRequestPage, meta: { requiresAuth: true } },
    { path: '/leave/approvals', component: LeaveApprovalsPage, meta: { requiresAuth: true } },
    { path: '/meeting/controller', component: ControllerOverviewPage, meta: { requiresAuth: true } },
    { path: '/meeting/controller/qr', component: ControllerQrPage, meta: { requiresAuth: true } },
    { path: '/meeting/controller/roster', component: ControllerRosterPage, meta: { requiresAuth: true } },
    { path: '/meeting/controller/dashboard', component: ControllerDashboardPage, meta: { requiresAuth: true } },
    { path: '/meeting/controller/registrants', component: RegistrantsPage, meta: { requiresAuth: true } },
    { path: '/meeting/controller/employees', component: ControllerEmployeeDataPage, meta: { requiresAuth: true } },
    { path: '/meeting/controller/backfill', component: MeetingBackfillHistoryPage, meta: { requiresAuth: true } },
    { path: '/meeting/controller/backfill/import', component: MeetingBackfillImportPage, meta: { requiresAuth: true } },
    { path: '/meeting/register', component: RegisterPage },
    { path: '/hr', component: HrHomePage, meta: { requiresAuth: true } },
    { path: '/hr/employees', component: HrEmployeesPage, meta: { requiresAuth: true } },
    { path: '/hr/employees/manage', component: HrEmployeeDataPage, meta: { requiresAuth: true } },
    { path: '/hr/employees/password', component: HrPasswordPage, meta: { requiresAuth: true } },
    { path: '/hr/employees/import', component: HrEmployeeImportPage, meta: { requiresAuth: true } },
    { path: '/hr/employees/:id', component: HrEmployeeDetailPage, meta: { requiresAuth: true } },
    { path: '/hr/leave', component: HrLeaveRequestsPage, meta: { requiresAuth: true } },
    { path: '/hr/leave/backdated', component: HrLeaveBackdatedPage, meta: { requiresAuth: true } },
    { path: '/hr/leave/approvers', component: HrLeaveApproversPage, meta: { requiresAuth: true } },
    { path: '/hr/leave/holidays', component: HrLeaveHolidaysPage, meta: { requiresAuth: true } },
    { path: '/hr/leave/settings', component: HrLeaveSettingsPage, meta: { requiresAuth: true } },
    { path: '/leave/hr/requests/:id/print', component: HrLeavePrintPage, meta: { requiresAuth: true } },
    { path: '/admin', component: AdminPage, meta: { requiresAuth: true } },
    { path: '/:pathMatch(.*)*', component: PendingPage, meta: { requiresAuth: true, catchAll: true } },
  ],
})

// One session lookup is shared for a short window so a redirect cycle can never
// call /api/auth/me in a tight loop.
const SESSION_CACHE_MS = 3000
let cachedSession = null
let cachedAt = 0
let pendingSession = null

async function loadSession() {
  if (cachedSession && Date.now() - cachedAt < SESSION_CACHE_MS) return cachedSession
  if (!pendingSession) {
    pendingSession = getSession()
      .then((session) => {
        if (session) {
          cachedSession = session
          cachedAt = Date.now()
        }
        return session
      })
      .finally(() => {
        pendingSession = null
      })
  }
  return pendingSession
}

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true

  const session = await loadSession()
  if (!session) return '/login'

  // A HR-issued PIN must be replaced before any other page is reachable. The
  // server enforces the same rule for every API call; this only avoids showing a
  // screen that would fail.
  if (to.path === '/change-pin') return true
  if (session.mustChangePin === true) return '/change-pin'

  // The printed leave form is HR-only; another role is sent to its own home.
  if (to.path.startsWith('/leave/hr/requests/') && !canPrintLeave(session.role)) {
    return homePathByRole[session.role] ?? '/login'
  }

  const allowed = canOpenPath(session.role, to.path)

  const redirectTo =
    typeof session.redirectTo === 'string' && session.redirectTo.startsWith('/')
      ? session.redirectTo
      : ''
  // Redirecting to the address we are already on never resolves, so stop and let
  // the page show its message instead of looping.
  const canRedirect = redirectTo !== '' && redirectTo !== to.fullPath

  if (to.meta.catchAll) return canRedirect ? redirectTo : true
  if (!allowed && canRedirect) return redirectTo
  return true
})
