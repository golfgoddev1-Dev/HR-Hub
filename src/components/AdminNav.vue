<script setup>
// Same shell as AppDock.vue. Only /admin exists today, so the
// other two items are disabled labels: no to/href may point at a missing page.
import { completeLogout, logoutRequestOptions } from '../lib/logout.js'
defineProps({
  sections: { type: Array, required: true },
})

async function logout() {
  let keepPushSubscription = false
  try {
    const response = await fetch('/api/auth/logout', await logoutRequestOptions())
    const data = await response.json().catch(() => ({}))
    keepPushSubscription = response.ok && data.keepPushSubscription === true
  } catch {
    // ignore: navigation still happens
  }
  // Drop every cached read and the browser's copies, then replace this page.
  await completeLogout({ keepPushSubscription })
}
</script>

<template>
  <header class="admin-nav">
    <div class="nav-inner">
      <div class="nav-brand">
        <span class="material-symbols-outlined brand-icon">admin_panel_settings</span>
        <span class="nav-title">ผู้ดูแลระบบ</span>
      </div>

      <nav class="nav-links">
        <div v-for="section in sections" :key="section.id" class="nav-section">
          <span class="nav-section-label">{{ section.label }}</span>

          <div class="nav-section-items">
            <template v-for="item in section.items" :key="item.to ?? item.label">
              <RouterLink
                v-if="!item.disabled"
                :to="item.to"
                class="nav-link"
                active-class="nav-link-active"
                :aria-label="item.ariaLabel"
              >
                <span class="material-symbols-outlined nav-icon">{{ item.icon }}</span>
                <span>{{ item.label }}</span>
                <span v-if="item.badge > 0" class="nav-badge">{{ item.badge }}</span>
              </RouterLink>

              <span
                v-else
                class="nav-link nav-link-disabled"
                aria-disabled="true"
                title="เร็วๆ นี้"
              >
                <span class="material-symbols-outlined nav-icon">{{ item.icon }}</span>
                <span>{{ item.label }}</span>
                <span class="nav-badge">เร็วๆ นี้</span>
              </span>
            </template>
          </div>
        </div>

        <button type="button" class="nav-link nav-logout" @click="logout">
          <span class="material-symbols-outlined nav-icon">logout</span>
          <span>ออกจากระบบ</span>
        </button>
      </nav>
    </div>
  </header>
</template>

<style scoped>
/* The admin bar speaks the same language as the HR dock: one frosted glass
   panel, brand and logout on the first row, then one labelled row per group of
   pills. The tint, blur and tier fallback come from the shared glass tokens. */
.admin-nav {
  border-radius: 24px;
  background: var(--glass-tint-strong, rgba(255, 255, 255, 0.97));
  -webkit-backdrop-filter: var(--glass-filter, blur(18px));
  backdrop-filter: var(--glass-filter, blur(18px));
  border: 1px solid rgba(255, 255, 255, 0.8);
  box-shadow:
    0 18px 40px -24px rgba(16, 80, 78, 0.45),
    0 2px 8px rgba(16, 80, 78, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  color: #12343b;
}

.nav-inner {
  padding: 8px 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
}

.nav-brand {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 4px 8px 4px 4px;
}

.brand-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 13px;
  background: linear-gradient(135deg, #10504e 0%, #176562 100%);
  color: #85f8c4;
  font-size: 22px;
  line-height: 1;
  box-shadow:
    0 8px 18px -8px rgba(16, 80, 78, 0.6),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.nav-title {
  font-size: 16px;
  font-weight: 700;
  color: #12343b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The links wrapper dissolves so the logout button can join the brand row
   while each section takes a full row of its own. */
.nav-links {
  display: contents;
}

.nav-section {
  display: flex;
  flex: 1 1 100%;
  order: 2;
  align-items: center;
  gap: 16px;
  min-width: 0;
  margin: 0 4px;
  padding: 6px 10px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(16, 80, 78, 0.055), rgba(16, 80, 78, 0.025));
}

.nav-section-label {
  flex: 0 0 104px;
  color: #3f5558;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.25;
}

.nav-section-items {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  min-width: 0;
}

.nav-icon {
  font-family: 'Material Symbols Outlined';
  font-size: 19px;
  line-height: 1;
}

.nav-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  /* The bar wraps, so a 44px item grows the bar instead of the label. */
  min-height: 44px;
  padding: 6px 14px 6px 8px;
  box-sizing: border-box;
  border-radius: 999px;
  color: #48615e;
  font-size: 14px;
  text-decoration: none;
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.nav-link .nav-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(16, 80, 78, 0.09);
  color: #10504e;
}

.nav-link-active {
  background: rgba(16, 80, 78, 0.1);
  color: #0f3d3e;
}

.nav-link-active .nav-icon {
  border-color: transparent;
  background: linear-gradient(135deg, #10504e 0%, #1bb193 100%);
  color: #ffffff;
}

.nav-link:focus-visible {
  outline: var(--motion-focus-width, 2px) solid var(--motion-focus, #8b5cf6);
  outline-offset: 2px;
}

@media (hover: hover) and (pointer: fine) {
  .nav-link:hover {
    background: rgba(255, 255, 255, 0.8);
    color: #0f3d3e;
    transform: translateY(-2px);
  }

  .nav-link-active:hover {
    background: rgba(16, 80, 78, 0.14);
  }

  .nav-link-disabled:hover {
    background: none;
    color: #48615e;
    transform: none;
  }

  .nav-logout:hover {
    background: rgba(255, 241, 242, 0.95);
  }
}

.nav-link-disabled {
  opacity: 0.75;
  cursor: not-allowed;
}

.nav-badge {
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(16, 80, 78, 0.12);
  color: #0f3d3e;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

/* Logout: the red pill in the brand row, top right. */
.nav-logout {
  order: 1;
  color: #be123c;
}

.nav-logout .nav-icon {
  background: #fff1f2;
  border-color: rgba(190, 18, 60, 0.14);
  color: #be123c;
}

.nav-logout:active {
  transform: scale(0.96);
}

@media (max-width: 720px) {
  .nav-title {
    display: none;
  }

  .nav-section {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .nav-section-label {
    flex-basis: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .nav-link {
    transition: none !important;
  }

  .nav-link:hover,
  .nav-logout:active {
    transform: none !important;
  }
}
</style>
