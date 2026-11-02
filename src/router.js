import { createRouter, createWebHistory } from 'vue-router'
import { getSession } from './api.js'
import LoginPage from './pages/LoginPage.vue'
import PendingPage from './pages/PendingPage.vue'
import SetPinPage from './pages/SetPinPage.vue'
import ControllerQrPage from './pages/ControllerQrPage.vue'
import ControllerRosterPage from './pages/ControllerRosterPage.vue'
import RegisterPage from './pages/RegisterPage.vue'
import ControllerOverviewPage from './pages/ControllerOverviewPage.vue'
import ControllerDashboardPage from './pages/ControllerDashboardPage.vue'
import RegistrantsPage from './pages/RegistrantsPage.vue'
import HrEmployeeImportPage from './pages/HrEmployeeImportPage.vue'
import HrEmployeeDetailPage from './pages/HrEmployeeDetailPage.vue'
import HrEmployeesPage from './pages/HrEmployeesPage.vue'
import HrEmployeeDataPage from './pages/HrEmployeeDataPage.vue'
import ControllerEmployeeDataPage from './pages/ControllerEmployeeDataPage.vue'

const allowedPathsByRole = {
  employee: ['/leave', '/leave/approvals'],
  // HR lands on the employee import page: the HR leave page does not exist yet.
  hr: ['/hr/employees', '/hr/employees/import'],
  meeting_controller: [
    '/meeting/controller',
    '/meeting/controller/qr',
    '/meeting/controller/roster',
    '/meeting/controller/dashboard',
    '/meeting/controller/registrants',
    '/meeting/controller/employees',
  ],
  system_admin: ['/admin'],
}

// Detail pages carry an id in the path, so exact-path matching is not enough.
const allowedPrefixesByRole = {
  hr: ['/hr/employees/'],
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginPage },
    { path: '/pending', component: PendingPage },
    { path: '/', redirect: '/login' },
    { path: '/set-pin', component: SetPinPage },
    { path: '/meeting/controller', component: ControllerOverviewPage, meta: { requiresAuth: true } },
    { path: '/meeting/controller/qr', component: ControllerQrPage, meta: { requiresAuth: true } },
    { path: '/meeting/controller/roster', component: ControllerRosterPage, meta: { requiresAuth: true } },
    { path: '/meeting/controller/dashboard', component: ControllerDashboardPage, meta: { requiresAuth: true } },
    { path: '/meeting/controller/registrants', component: RegistrantsPage, meta: { requiresAuth: true } },
    { path: '/meeting/controller/employees', component: ControllerEmployeeDataPage, meta: { requiresAuth: true } },
    { path: '/meeting/register', component: RegisterPage },
    { path: '/hr/employees', component: HrEmployeesPage, meta: { requiresAuth: true } },
    { path: '/hr/employees/manage', component: HrEmployeeDataPage, meta: { requiresAuth: true } },
    { path: '/hr/employees/import', component: HrEmployeeImportPage, meta: { requiresAuth: true } },
    { path: '/hr/employees/:id', component: HrEmployeeDetailPage, meta: { requiresAuth: true } },
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

  const allowedPaths = allowedPathsByRole[session.role] ?? []
  const allowedPrefixes = allowedPrefixesByRole[session.role] ?? []
  const allowed =
    allowedPaths.includes(to.path) || allowedPrefixes.some((prefix) => to.path.startsWith(prefix))

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
