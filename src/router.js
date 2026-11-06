import { createRouter, createWebHistory } from 'vue-router'
import { getSession } from './api.js'
import RoleShell from './components/RoleShell.vue'
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
import AdminPermissionsPage from './pages/AdminPermissionsPage.vue'
import ProfilePage from './pages/ProfilePage.vue'
import { canPrintLeave } from './leave-print.js'
import LeaveHomePage from './pages/LeaveHomePage.vue'
import LeaveRequestPage from './pages/LeaveRequestPage.vue'
import LeaveApprovalsPage from './pages/LeaveApprovalsPage.vue'
import LeaveCalendarPage from './pages/LeaveCalendarPage.vue'
// The allow-lists live in src/lib/route-access.js so pages can ask the same
// question the guard asks before offering a link.
import { canOpenPath, homePathByRole } from './lib/route-access.js'
import { loginTargetForPath } from './lib/notification-routes.js'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginPage },
    { path: '/pending', component: PendingPage },
    { path: '/', redirect: '/login' },
    { path: '/set-pin', component: SetPinPage },

    // One shell route for every signed-in page. RoleShell picks the navigation
    // from the session role (employee dock, HR dock, admin nav, or the meeting
    // controller sidebar), so the menu is never replaced when the page changes.
    // Child paths stay absolute so every URL is the same string as before.
    {
      path: '/',
      component: RoleShell,
      children: [
        // งานของฉัน: these belong to the active employee record, so they are
        // children here and reachable in every shell.
        { path: '/change-pin', component: ChangePinPage, meta: { requiresAuth: true } },
        { path: '/leave', component: LeaveHomePage, meta: { requiresAuth: true } },
        { path: '/leave/new', component: LeaveRequestPage, meta: { requiresAuth: true } },
        { path: '/leave/approvals', component: LeaveApprovalsPage, meta: { requiresAuth: true } },
        { path: '/leave/calendar', component: LeaveCalendarPage, meta: { requiresAuth: true } },
        { path: '/profile', component: ProfilePage, meta: { requiresAuth: true } },

        // HR system: the same HR dock stays mounted between these pages and the
        // leave pages above.
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

        // Meeting controller: the controller sidebar is the shell for all of
        // these and for the leave pages above.
        { path: '/meeting/controller', component: ControllerOverviewPage, meta: { requiresAuth: true } },
        { path: '/meeting/controller/qr', component: ControllerQrPage, meta: { requiresAuth: true } },
        { path: '/meeting/controller/roster', component: ControllerRosterPage, meta: { requiresAuth: true } },
        { path: '/meeting/controller/dashboard', component: ControllerDashboardPage, meta: { requiresAuth: true } },
        { path: '/meeting/controller/registrants', component: RegistrantsPage, meta: { requiresAuth: true } },
        { path: '/meeting/controller/employees', component: ControllerEmployeeDataPage, meta: { requiresAuth: true } },
        { path: '/meeting/controller/backfill', component: MeetingBackfillHistoryPage, meta: { requiresAuth: true } },
        { path: '/meeting/controller/backfill/import', component: MeetingBackfillImportPage, meta: { requiresAuth: true } },
        { path: '/meeting/register', component: RegisterPage },

        // system_admin keeps AdminNav, drawn by the same RoleShell.
        { path: '/admin', component: AdminPage, meta: { requiresAuth: true } },
        // The permission screen names its one role, so any other role is sent to
        // its own home instead of reaching a page whose API would answer 403.
        {
          path: '/admin/permissions',
          component: AdminPermissionsPage,
          meta: { requiresAuth: true, role: 'system_admin' },
        },
      ],
    },

    // The printed leave form is a document, not an app page: no shell.
    { path: '/leave/hr/requests/:id/print', component: HrLeavePrintPage, meta: { requiresAuth: true } },

    { path: '/:pathMatch(.*)*', component: PendingPage, meta: { requiresAuth: true, catchAll: true } },
  ],
})

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true

  // The session comes from the shared cache, which login and logout both clear.
  // There is no second, module-level copy that could outlive a logout: after
  // clearAll() the next navigation asks the Worker again and gets a 401.
  const session = await getSession()
  if (!session) {
    // Preserve only a notification destination, so signing in from a push tap
    // returns to that page. Every other signed-out page keeps the old redirect.
    const target = loginTargetForPath(to.path)
    return target ? { path: '/login', query: { to: target } } : '/login'
  }

  // A HR-issued PIN must be replaced before any other page is reachable. The
  // server enforces the same rule for every API call; this only avoids showing a
  // screen that would fail.
  if (to.path === '/change-pin') return true
  if (session.mustChangePin === true) return '/change-pin'

  // The printed leave form is HR-only; another role is sent to its own home.
  if (to.path.startsWith('/leave/hr/requests/') && !canPrintLeave(session.role)) {
    return homePathByRole[session.role] ?? '/login'
  }

  const allowed = canOpenPath(session.role, to.path, session)

  const redirectTo =
    typeof session.redirectTo === 'string' && session.redirectTo.startsWith('/')
      ? session.redirectTo
      : ''
  // Redirecting to the address we are already on never resolves, so stop and let
  // the page show its message instead of looping.
  const canRedirect = redirectTo !== '' && redirectTo !== to.fullPath

  // A route may name the single role it belongs to. Checking it here means the
  // redirect does not depend on the session carrying a redirectTo value.
  if (typeof to.meta.role === 'string' && to.meta.role !== session.role) {
    return homePathByRole[session.role] ?? '/login'
  }

  if (to.meta.catchAll) return canRedirect ? redirectTo : true
  if (!allowed && canRedirect) return redirectTo
  return true
})
