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

const allowedPathsByRole = {
  employee: ['/leave', '/leave/approvals'],
  hr: ['/leave/hr', '/hr/employees', '/hr/employees/import'],
  meeting_controller: [
    '/meeting/controller',
    '/meeting/controller/qr',
    '/meeting/controller/roster',
    '/meeting/controller/dashboard',
    '/meeting/controller/registrants',
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
    { path: '/meeting/register', component: RegisterPage },
    { path: '/hr/employees', component: HrEmployeesPage, meta: { requiresAuth: true } },
    { path: '/hr/employees/import', component: HrEmployeeImportPage, meta: { requiresAuth: true } },
    { path: '/hr/employees/:id', component: HrEmployeeDetailPage, meta: { requiresAuth: true } },
    { path: '/:pathMatch(.*)*', component: PendingPage, meta: { requiresAuth: true, catchAll: true } },
  ],
})

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true

  const session = await getSession()
  if (!session) return '/login'

  const allowedPaths = allowedPathsByRole[session.role] ?? []
  const allowedPrefixes = allowedPrefixesByRole[session.role] ?? []
  const allowed =
    allowedPaths.includes(to.path) || allowedPrefixes.some((prefix) => to.path.startsWith(prefix))
  if (session.redirectTo !== to.fullPath && !allowed) {
    return session.redirectTo
  }

  if (to.meta.catchAll) return session.redirectTo
  return true
})
