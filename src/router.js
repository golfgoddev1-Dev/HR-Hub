import { defineAsyncComponent } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { getSession } from './api.js'
import RoleShell from './components/RoleShell.vue'
import PageLoading from './components/PageLoading.vue'
// The allow-lists live in src/lib/route-access.js so pages can ask the same
// question the guard asks before offering a link.
import { canOpenPath, homePathByRole } from './lib/route-access.js'
import { loginTargetForPath } from './lib/notification-routes.js'
import { canPrintLeave } from './leave-print.js'

// Only the shell is in the first bundle. Every page is its own chunk, so the
// home of a role paints without downloading the calendar, the spreadsheet
// parser or the pages of the other roles. The placeholder renders inside
// RouterView, i.e. in the content area: the navigation is never unmounted and
// there is no blank screen while a chunk loads.
const page = (loader) =>
  defineAsyncComponent({ loader, loadingComponent: PageLoading, delay: 0 })

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: page(() => import('./pages/LoginPage.vue')) },
    { path: '/pending', component: page(() => import('./pages/PendingPage.vue')) },
    { path: '/', redirect: '/login' },
    { path: '/set-pin', component: page(() => import('./pages/SetPinPage.vue')) },

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
        {
          path: '/change-pin',
          component: page(() => import('./pages/ChangePinPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/leave',
          component: page(() => import('./pages/LeaveHomePage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/leave/new',
          component: page(() => import('./pages/LeaveRequestPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/leave/approvals',
          component: page(() => import('./pages/LeaveApprovalsPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/leave/calendar',
          component: page(() => import('./pages/LeaveCalendarPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/profile',
          component: page(() => import('./pages/ProfilePage.vue')),
          meta: { requiresAuth: true },
        },

        // HR system: the same HR dock stays mounted between these pages and the
        // leave pages above.
        {
          path: '/hr',
          component: page(() => import('./pages/HrHomePage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/hr/employees',
          component: page(() => import('./pages/HrEmployeesPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/hr/employees/manage',
          component: page(() => import('./pages/HrEmployeeDataPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/hr/employees/password',
          component: page(() => import('./pages/HrPasswordPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/hr/employees/import',
          component: page(() => import('./pages/HrEmployeeImportPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/hr/employees/:id',
          component: page(() => import('./pages/HrEmployeeDetailPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/hr/leave',
          component: page(() => import('./pages/HrLeaveRequestsPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/hr/leave/backdated',
          component: page(() => import('./pages/HrLeaveBackdatedPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/hr/leave/approvers',
          component: page(() => import('./pages/HrLeaveApproversPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/hr/leave/holidays',
          component: page(() => import('./pages/HrLeaveHolidaysPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/hr/leave/settings',
          component: page(() => import('./pages/HrLeaveSettingsPage.vue')),
          meta: { requiresAuth: true },
        },

        // Meeting controller: the controller sidebar is the shell for all of
        // these and for the leave pages above.
        {
          path: '/meeting/controller',
          component: page(() => import('./pages/ControllerOverviewPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/meeting/controller/qr',
          component: page(() => import('./pages/ControllerQrPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/meeting/controller/roster',
          component: page(() => import('./pages/ControllerRosterPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/meeting/controller/dashboard',
          component: page(() => import('./pages/ControllerDashboardPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/meeting/controller/registrants',
          component: page(() => import('./pages/RegistrantsPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/meeting/controller/employees',
          component: page(() => import('./pages/ControllerEmployeeDataPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/meeting/controller/backfill',
          component: page(() => import('./pages/MeetingBackfillHistoryPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/meeting/controller/backfill/import',
          component: page(() => import('./pages/MeetingBackfillImportPage.vue')),
          meta: { requiresAuth: true },
        },
        {
          path: '/meeting/register',
          component: page(() => import('./pages/RegisterPage.vue')),
        },

        // system_admin keeps AdminNav, drawn by the same RoleShell.
        {
          path: '/admin',
          component: page(() => import('./pages/AdminPage.vue')),
          meta: { requiresAuth: true },
        },
        // The permission screen names its one role, so any other role is sent to
        // its own home instead of reaching a page whose API would answer 403.
        {
          path: '/admin/permissions',
          component: page(() => import('./pages/AdminPermissionsPage.vue')),
          meta: { requiresAuth: true, role: 'system_admin' },
        },
      ],
    },

    // The printed leave form is a document, not an app page: no shell.
    {
      path: '/leave/hr/requests/:id/print',
      component: page(() => import('./pages/HrLeavePrintPage.vue')),
      meta: { requiresAuth: true },
    },

    {
      path: '/:pathMatch(.*)*',
      component: page(() => import('./pages/PendingPage.vue')),
      meta: { requiresAuth: true, catchAll: true },
    },
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
