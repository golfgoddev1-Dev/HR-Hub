<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { postJson } from '../api.js'
import { clearAll } from '../lib/data-cache.js'
import { currentPushEndpoint } from '../lib/logout.js'
import { autoEnablePush } from '../lib/push.js'
import { safeLoginTarget } from '../lib/notification-routes.js'
import { landingPathFromRedirect } from '../lib/landing-path.js'
import LockoutDialog from '../components/LockoutDialog.vue'

const router = useRouter()
const route = useRoute()
const loginType = ref('')
const nationalId = ref('')
const pin = ref('')
const pinVisible = ref(false)
const loading = ref(false)
const errorMessage = ref('')
const lockoutOpen = ref(false)
// Cleared after a successful set-PIN. Page state only (never storage), and the
// query is stripped on mount so refreshing does not bring the banner back.
const showResetSuccess = ref(route.query.reset === '1')
const lockedUntil = ref('')
const loginTypes = [
  { value: 'employee', title: 'พนักงานทั่วไป', description: 'ยื่นลา ดูรายการลาของตัวเอง และรายการรออนุมัติ', icon: 'badge' },
  { value: 'hr', title: 'ผู้ดูแล HR', description: 'ดูใบลาทั้งหมด ส่งออกข้อมูล และจัดการพนักงาน', icon: 'groups' },
  { value: 'controller', title: 'หัวหน้าคุมประชุม', description: 'ดูภาพรวมการประชุม จัดการรายชื่อ และสร้าง QR', icon: 'qr_code' },
  { value: 'system', title: 'ผู้ดูแลระบบภาพรวม', description: 'จัดการสิทธิ์ผู้ใช้และตั้งค่าระบบ', icon: 'settings_suggest' },
]
const canSubmit = computed(() => Boolean(loginType.value) && nationalId.value.length === 13 && pin.value.length === 6 && !loading.value)
const citizenFull = computed(() => nationalId.value.length === 13)
const pinFull = computed(() => pin.value.length === 6)
const loginTarget = computed(() => safeLoginTarget(route.query.to))

onMounted(async () => {
  if (!showResetSuccess.value) return
  await router.replace({ path: '/login' })
})

function updateNationalId(event) {
  nationalId.value = event.target.value.replace(/\D/g, '').slice(0, 13)
  event.target.value = nationalId.value
  errorMessage.value = ''
}

function updatePin(event) {
  pin.value = event.target.value.replace(/\D/g, '').slice(0, 6)
  event.target.value = pin.value
  errorMessage.value = ''
}

function onLoginTypeChange() {
  errorMessage.value = ''
}

async function submitLogin() {
  if (!canSubmit.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const endpoint = await currentPushEndpoint()
    const body = {
      loginType: loginType.value,
      nationalId: nationalId.value,
      pin: pin.value,
    }
    // Names this browser's endpoint so signing in here takes the row over and
    // clears any signed-out mark left by the previous employee.
    if (endpoint) body.endpoint = endpoint
    const { status, data } = await postJson('/api/auth/login', body)
    if (status === 200 && typeof data.redirectTo === 'string') {
      pin.value = ''
      // A new session is a new cache: drop the previous account's reads.
      clearAll()
      // A forced PIN change always wins. Otherwise a validated notification
      // target takes priority over the server's ordinary landing path.
      const destination =
        data.mustChangePin === true
          ? data.redirectTo
          : loginTarget.value ?? landingPathFromRedirect(data.redirectTo) ?? data.redirectTo
      await router.replace(destination)
      // This account may already have opted in and granted permission. The
      // helper never prompts; it only re-creates the missing browser endpoint.
      void autoEnablePush()
      return
    }
    pin.value = ''
    if (status === 423) {
      lockedUntil.value = typeof data.lockedUntil === 'string' ? data.lockedUntil : ''
      lockoutOpen.value = true
      return
    }
    if (status === 400 || status === 401) {
      errorMessage.value = typeof data.message === 'string' ? data.message : 'ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่'
      return
    }
    errorMessage.value = 'ไม่สามารถเชื่อมต่อได้ กรุณาลองใหม่'
  } catch {
    errorMessage.value = 'ไม่สามารถเชื่อมต่อได้ กรุณาลองใหม่'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page">
    <!-- Ambient Background Blobs for Glass Refraction -->
    <div class="page-ambient-bg" aria-hidden="true">
      <div class="ambient-orb ambient-orb-1"></div>
      <div class="ambient-orb ambient-orb-2"></div>
      <div class="ambient-orb ambient-orb-3"></div>
    </div>

    <!-- Top bar -->
    <header class="topbar">
      <div class="brand-inline">
        <div class="brand-mark-sm">
          <span class="material-symbols-outlined">shield</span>
        </div>
        <span class="brand-title-sm">Siam Secure HR</span>
      </div>
      <div class="env-chip">
        <span class="material-symbols-outlined env-icon">verified</span>
        <span>Authorized Workforce Environment</span>
      </div>
    </header>

    <main class="page-main">
      <div class="shell">
        <div class="split">
          <!-- Left: brand panel -->
          <section class="brand-panel" aria-label="HR Hub">
            <div class="blur blur-tr"></div>
            <div class="blur blur-bl"></div>

            <div class="brand-body">
              <div class="brand-top">
                <div class="brand-id">
                  <div class="brand-mark">HR</div>
                  <div class="brand-id-text">
                    <span class="brand-name">HR Hub</span>
                    <span class="brand-sub">Enterprise Access</span>
                  </div>
                </div>
                <div class="pdpa-chip">
                  <span class="pulse-dot"></span>
                  <span>PDPA Encrypted</span>
                </div>
              </div>

              <div class="brand-copy">
                <div class="brand-tag">
                  <span class="material-symbols-outlined tag-icon">verified_user</span>
                  <span>ศูนย์รวมระบบพนักงานกลาง</span>
                </div>
                <h2 class="brand-heading">ระบบงาน HR ในที่เดียว</h2>
                <p class="brand-description">
                  ยื่นและอนุมัติใบลา ลงทะเบียนประชุม และดูแลข้อมูลพนักงาน ด้วยการเข้าสู่ระบบด้วยเลขบัตรประชาชนและ PIN ของคุณเอง
                </p>
              </div>

              <ul class="benefits">
                <li class="benefit">
                  <span class="benefit-icon material-symbols-outlined">check_circle</span>
                  <span class="benefit-copy">
                    <span class="benefit-title">ยื่นใบลาและติดตามสถานะได้ทุกที่</span>
                    <span class="benefit-sub">รับการแจ้งเตือนและตรวจสอบผลการอนุมัติแบบเรียลไทม์</span>
                  </span>
                </li>
                <li class="benefit">
                  <span class="benefit-icon material-symbols-outlined">qr_code_scanner</span>
                  <span class="benefit-copy">
                    <span class="benefit-title">ลงทะเบียนเข้าประชุมด้วยการสแกน QR</span>
                    <span class="benefit-sub">เช็คชื่อเข้าร่วมประชุมอย่างรวดเร็ว ปลอดภัย และแม่นยำ</span>
                  </span>
                </li>
                <li class="benefit">
                  <span class="benefit-icon material-symbols-outlined">lock</span>
                  <span class="benefit-copy">
                    <span class="benefit-title">ข้อมูลส่วนตัวถูกเข้ารหัสและบันทึกการเข้าถึงทุกครั้ง</span>
                    <span class="benefit-sub">มาตรฐานรักษาความปลอดภัยสารสนเทศระดับองค์กร</span>
                  </span>
                </li>
              </ul>
            </div>

            <div class="brand-footnote">
              <span class="material-symbols-outlined footnote-icon">info</span>
              <span>สำหรับพนักงานขององค์กรเท่านั้น หากเข้าระบบไม่ได้ กรุณาติดต่อฝ่าย HR</span>
            </div>
          </section>

          <!-- Right: login panel (Glassmorphic) -->
          <section class="login-panel">
            <div class="login-inner">
              <div class="login-head">
                <div class="login-title-row">
                  <h1>เข้าสู่ระบบ</h1>
                  <span class="sso-chip">Single Sign-On V2</span>
                </div>
                <p class="login-sub">เลือกประเภทการเข้าใช้งานก่อน แล้วกรอกข้อมูลของคุณ</p>
              </div>

              <!-- success alert (reset=1) -->
              <div v-if="showResetSuccess" class="success-alert" role="status">
                <span class="material-symbols-outlined success-icon">check_circle</span>
                <div class="success-text">
                  <p class="success-title">ตั้ง PIN สำเร็จ กรุณาเข้าสู่ระบบด้วย PIN ใหม่</p>
                  <p class="success-body">คุณสามารถใช้ PIN ใหม่ร่วมกับเลขบัตรประชาชนเพื่อเข้าสู่ระบบงานได้ทันที</p>
                </div>
                <button type="button" class="success-close" aria-label="ปิดข้อความ" @click="showResetSuccess = false">
                  <span class="material-symbols-outlined">close</span>
                </button>
              </div>

              <form class="form" @submit.prevent="submitLogin">
                <!-- 1. Login type -->
                <fieldset class="section">
                  <div class="section-head">
                    <legend class="section-label">1. ประเภทการเข้าใช้งาน</legend>
                    <span class="section-hint">ระบุตามสังกัดของท่าน</span>
                  </div>
                  <div class="role-grid">
                    <label
                      v-for="option in loginTypes"
                      :key="option.value"
                      class="role-option"
                      :class="{ 'role-option--selected': loginType === option.value }"
                    >
                      <input
                        v-model="loginType"
                        class="sr-only"
                        type="radio"
                        name="loginType"
                        :value="option.value"
                        @change="onLoginTypeChange"
                      />
                      <div class="role-head">
                        <div class="role-title-wrap">
                          <div class="role-icon">
                            <span class="material-symbols-outlined">{{ option.icon }}</span>
                          </div>
                          <span class="role-title">{{ option.title }}</span>
                        </div>
                        <div class="role-radio" :class="{ 'role-radio--on': loginType === option.value }">
                          <div v-if="loginType === option.value" class="role-radio-dot"></div>
                        </div>
                      </div>
                      <p class="role-desc">{{ option.description }}</p>
                    </label>
                  </div>
                </fieldset>

                <!-- 2. Citizen ID -->
                <div class="section">
                  <div class="section-head">
                    <label class="section-label" for="citizenIdInput">2. เลขบัตรประชาชน 13 หลัก</label>
                    <span class="counter" :class="{ full: citizenFull }">{{ nationalId.length }}/13</span>
                  </div>
                  <div class="input-wrap">
                    <span class="material-symbols-outlined input-icon">id_card</span>
                    <input
                      id="citizenIdInput"
                      class="input"
                      type="text"
                      inputmode="numeric"
                      maxlength="13"
                      autocomplete="off"
                      placeholder="กรอกตัวเลข 13 หลัก"
                      :value="nationalId"
                      @input="updateNationalId"
                    />
                  </div>
                  <div class="field-hint">
                    <span class="material-symbols-outlined hint-icon">info</span>
                    <span>กรอกเฉพาะตัวเลข ไม่ต้องใส่ขีด</span>
                  </div>
                </div>

                <!-- 3. PIN -->
                <div class="section">
                  <div class="section-head">
                    <label class="section-label" for="pinInput">PIN 6 หลัก</label>
                    <span class="counter" :class="{ full: pinFull }">{{ pin.length }}/6</span>
                  </div>
                  <div class="input-wrap">
                    <span class="material-symbols-outlined input-icon">pin</span>
                    <input
                      id="pinInput"
                      class="input input-pin"
                      :type="pinVisible ? 'text' : 'password'"
                      inputmode="numeric"
                      maxlength="6"
                      autocomplete="off"
                      placeholder="กรอก PIN 6 หลัก"
                      :value="pin"
                      @input="updatePin"
                    />
                    <button type="button" class="toggle" :aria-label="pinVisible ? 'ซ่อน PIN' : 'แสดง PIN'" @click="pinVisible = !pinVisible">
                      <span class="material-symbols-outlined toggle-icon">{{ pinVisible ? 'visibility_off' : 'visibility' }}</span>
                      <span class="toggle-text">{{ pinVisible ? 'ซ่อน' : 'แสดง / ซ่อน' }}</span>
                    </button>
                  </div>
                </div>

                <!-- Error -->
                <div v-if="errorMessage" class="error-alert" role="alert">
                  <span class="material-symbols-outlined error-icon">error</span>
                  <div class="error-text">
                    <p class="error-title">ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่</p>
                    <p class="error-body">{{ errorMessage }}</p>
                  </div>
                  <button type="button" class="error-close" aria-label="ปิดข้อความ" @click="errorMessage = ''">
                    <span class="material-symbols-outlined">close</span>
                  </button>
                </div>

                <!-- Glow Shimmer Submit Button -->
                <button type="submit" class="submit" :class="{ ready: canSubmit }" :disabled="!canSubmit">
                  <span v-if="loading" class="material-symbols-outlined spin">sync</span>
                  <span v-else class="material-symbols-outlined">login</span>
                  <span>{{ loading ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ' }}</span>
                </button>
              </form>

              <footer class="login-footer">
                <span class="footer-text">ยังไม่มี PIN หรือลืม PIN?</span>
                <RouterLink to="/set-pin" class="footer-link">ตั้งหรือรีเซ็ต PIN ด้วยรหัสจาก HR</RouterLink>
              </footer>

              <div class="security-row">
                <span class="security-note">
                  <span class="material-symbols-outlined security-icon">security</span>
                  ระบบป้องกันการเดารหัสผ่าน 5 ครั้ง
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>

    <footer class="page-footer">
      <div class="footer-left">
        <span class="material-symbols-outlined footer-icon">lock</span>
        <span>Bangkok Datacenter Tier IV • Protected under Thai PDPA Regulations</span>
      </div>
      <div>Internal Corporate Personnel Only</div>
    </footer>

    <LockoutDialog v-model="lockoutOpen" :locked-until="lockedUntil" />
  </div>
</template>

<style scoped>

.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-smoothing: antialiased;
  font-feature-settings: 'liga';
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.page {
  position: relative;
  min-height: 100vh;
  /* dvh shrinks with the browser UI and the phone keyboard; 100vh is the
     fallback for browsers that do not know dvh yet. */
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  font-family: 'IBM Plex Sans', 'IBM Plex Sans Thai', sans-serif;
  color: #0b1c30;
  background: #f4f7fc;
  overflow-x: hidden;
}

/* Ambient Floating Lights for Glassmorphism */
.page-ambient-bg {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}

.ambient-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.65;
  animation: floatAmbient 18s ease-in-out infinite alternate;
}

.ambient-orb-1 {
  width: min(520px, 82vw);
  height: min(520px, 82vw);
  top: -120px;
  right: -80px;
  background: radial-gradient(circle, rgba(49, 107, 243, 0.22) 0%, rgba(49, 107, 243, 0) 70%);
}

.ambient-orb-2 {
  width: min(440px, 76vw);
  height: min(440px, 76vw);
  bottom: -60px;
  right: 15%;
  background: radial-gradient(circle, rgba(133, 248, 196, 0.24) 0%, rgba(133, 248, 196, 0) 70%);
  animation-duration: 22s;
  animation-delay: -5s;
}

.ambient-orb-3 {
  width: min(480px, 80vw);
  height: min(480px, 80vw);
  top: 30%;
  left: -120px;
  background: radial-gradient(circle, rgba(100, 160, 255, 0.16) 0%, rgba(100, 160, 255, 0) 70%);
  animation-duration: 25s;
  animation-delay: -10s;
}

@keyframes floatAmbient {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(40px, 30px) scale(1.08); }
  100% { transform: translate(-30px, 50px) scale(0.95); }
}

/* Top bar */
.topbar {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  padding-top: max(12px, env(safe-area-inset-top));
  padding-left: max(16px, env(safe-area-inset-left));
  padding-right: max(16px, env(safe-area-inset-right));
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 4px 20px rgba(15, 33, 55, 0.03);
}

@media (min-width: 1024px) {
  .topbar { padding: 12px 48px; }
}

.brand-inline {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-mark-sm {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: linear-gradient(135deg, #0f2137 0%, #162f4e 100%);
  color: #85f8c4;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(15, 33, 55, 0.15);
}

.brand-mark-sm .material-symbols-outlined {
  font-size: 18px;
}

.brand-title-sm {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.env-chip {
  display: none;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #44474d;
  background: rgba(255, 255, 255, 0.6);
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.8);
}

.env-icon {
  font-size: 16px;
  color: #005137;
}

@media (min-width: 640px) {
  .env-chip { display: inline-flex; }
}

/* Main */
.page-main {
  position: relative;
  z-index: 1;
  flex: 1;
  width: 100%;
  padding: 24px 16px;
  padding-left: max(16px, env(safe-area-inset-left));
  padding-right: max(16px, env(safe-area-inset-right));
  display: flex;
  flex-direction: column;
}

@media (min-width: 1024px) {
  .page-main { padding: 40px 48px; }
}

.shell {
  width: 100%;
  max-width: 1280px;
  /* Auto block margins centre the card in the free space without the top
     clipping that align-items:center causes when the card is taller. */
  margin: auto;
  min-width: 0;
}

/* Glassmorphic Main Container */
.split {
  display: grid;
  grid-template-columns: 1fr;
  border-radius: 16px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.85);
  box-shadow: 
    0 24px 48px -12px rgba(15, 33, 55, 0.12),
    0 4px 12px rgba(15, 33, 55, 0.04),
    inset 0 1px 1px rgba(255, 255, 255, 0.9);
}

@media (min-width: 1024px) {
  .split { grid-template-columns: 5fr 7fr; }
}

/* Brand panel */
.brand-panel {
  position: relative;
  overflow: hidden;
  background: linear-gradient(145deg, #0d1e33 0%, #0f2137 60%, #132842 100%);
  color: #ffffff;
  padding: 32px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 32px;
}

@media (min-width: 640px) {
  .brand-panel { padding: 40px; }
}

@media (min-width: 1024px) {
  .brand-panel { padding: 48px; }
}

.blur {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  filter: blur(48px);
}

.blur-tr {
  width: min(340px, 80vw);
  height: min(340px, 80vw);
  top: -80px;
  right: -80px;
  background: radial-gradient(circle, rgba(49, 107, 243, 0.2) 0%, rgba(49, 107, 243, 0) 70%);
}

.blur-bl {
  width: min(280px, 72vw);
  height: min(280px, 72vw);
  bottom: 20px;
  left: -64px;
  background: radial-gradient(circle, rgba(104, 219, 169, 0.12) 0%, rgba(104, 219, 169, 0) 70%);
}

.brand-body {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.brand-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.brand-id {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-mark {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: #ffffff;
  color: #0f2137;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.05em;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2), inset 0 -2px 4px rgba(0, 0, 0, 0.05);
}

.brand-id-text {
  display: flex;
  flex-direction: column;
}

.brand-name {
  font-size: 18px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.01em;
}

.brand-sub {
  margin-top: 4px;
  font-size: 11px;
  line-height: 14px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8c9eb9;
}

.pdpa-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(133, 248, 196, 0.25);
  font-size: 11px;
  font-weight: 500;
  color: #85f8c4;
}

.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #85f8c4;
  box-shadow: 0 0 10px rgba(133, 248, 196, 0.8);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
}

.brand-copy {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.brand-tag {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-radius: 6px;
  background: rgba(49, 107, 243, 0.2);
  border: 1px solid rgba(180, 197, 255, 0.2);
  color: #b4c5ff;
  font-size: 11px;
  font-weight: 500;
}

.tag-icon {
  font-size: 16px;
}

.brand-heading {
  margin: 0;
  font-size: 36px;
  line-height: 48px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: #ffffff;
}

.brand-description {
  margin: 0;
  font-size: 14px;
  line-height: 24px;
  color: #8c9eb9;
}

.benefits {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.benefit {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: transform var(--motion-hover) var(--motion-ease), opacity var(--motion-hover) var(--motion-ease), background-color var(--motion-hover) var(--motion-ease), border-color var(--motion-hover) var(--motion-ease), color var(--motion-hover) var(--motion-ease), box-shadow var(--motion-hover) var(--motion-ease);
}

.benefit-icon {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: #002618;
  color: #85f8c4;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
  margin-top: 2px;
}

.benefit-copy {
  display: flex;
  flex-direction: column;
}

.benefit-title {
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  color: #ffffff;
}

.benefit-sub {
  font-size: 12px;
  line-height: 18px;
  color: #8c9eb9;
}

.brand-footnote {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: #8c9eb9;
  font-size: 11px;
  line-height: 15px;
}

.footnote-icon {
  font-size: 18px;
  color: #85f8c4;
  flex-shrink: 0;
}

/* Glassmorphic Login Panel */
.login-panel {
  background: rgba(255, 255, 255, 0.76);
  backdrop-filter: blur(28px);
  -webkit-backdrop-filter: blur(28px);
  padding: 24px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

@media (min-width: 640px) {
  .login-panel { padding: 40px; }
}

@media (min-width: 1024px) {
  .login-panel { padding: 48px; }
}

.login-inner {
  width: 100%;
  max-width: 576px;
  min-width: 0;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.login-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.login-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.login-title-row h1 {
  margin: 0;
  font-size: 28px;
  line-height: 40px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.sso-chip {
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(220, 233, 255, 0.6);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.8);
  color: #0051d5;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.login-sub {
  margin: 0;
  font-size: 14px;
  line-height: 22px;
  color: #44474d;
}

/* Success alert */
.success-alert {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border-radius: 10px;
  background: rgba(239, 244, 255, 0.85);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(133, 248, 196, 0.5);
  box-shadow: 0 4px 16px rgba(19, 154, 109, 0.08);
}

.success-icon {
  font-size: 20px;
  color: #139a6d;
  margin-top: 2px;
  flex-shrink: 0;
}

.success-text {
  flex: 1;
  min-width: 0;
}

.success-close {
  margin-left: auto;
  flex-shrink: 0;
  min-width: 44px;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  background: none;
  border: 0;
  border-radius: 6px;
  padding: 2px;
  cursor: pointer;
  color: #44474d;
  display: flex;
}

.success-close .material-symbols-outlined {
  font-size: 18px;
}

.success-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}

.success-body {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: #44474d;
}

/* Form */
.form {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.section {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.section-label {
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
  color: #0b1c30;
  padding: 0;
}

.section-hint {
  font-size: 11px;
  font-weight: 500;
  color: #0051d5;
}

.counter {
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  color: #44474d;
  background: rgba(220, 233, 255, 0.7);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.8);
  transition: transform var(--motion-hover) var(--motion-ease), opacity var(--motion-hover) var(--motion-ease), background-color var(--motion-hover) var(--motion-ease), border-color var(--motion-hover) var(--motion-ease), color var(--motion-hover) var(--motion-ease), box-shadow var(--motion-hover) var(--motion-ease);
}

.counter.full {
  background: #85f8c4;
  color: #005137;
  font-weight: 600;
  transform: scale(1.04);
  box-shadow: 0 2px 8px rgba(133, 248, 196, 0.4);
}

/* Role grid with Glassmorphism */
.role-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

@media (min-width: 640px) {
  .role-grid { grid-template-columns: 1fr 1fr; }
}

.role-option {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  border-radius: 12px;
  cursor: pointer;
  background: rgba(244, 248, 255, 0.65);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 2px 8px rgba(15, 33, 55, 0.03);
  transition: transform var(--motion-hover) var(--motion-ease), opacity var(--motion-hover) var(--motion-ease), background-color var(--motion-hover) var(--motion-ease), border-color var(--motion-hover) var(--motion-ease), color var(--motion-hover) var(--motion-ease), box-shadow var(--motion-hover) var(--motion-ease);
}

.role-option--selected {
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(49, 107, 243, 0.6);
  box-shadow: 0 8px 24px rgba(49, 107, 243, 0.14), inset 0 0 0 1px rgba(49, 107, 243, 0.2);
}

.role-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.role-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.role-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(220, 233, 255, 0.7);
  color: #44474d;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  transition: transform var(--motion-hover) var(--motion-ease), opacity var(--motion-hover) var(--motion-ease), background-color var(--motion-hover) var(--motion-ease), border-color var(--motion-hover) var(--motion-ease), color var(--motion-hover) var(--motion-ease), box-shadow var(--motion-hover) var(--motion-ease);
}

.role-icon .material-symbols-outlined {
  font-size: 18px;
}

.role-option--selected .role-icon {
  background: #316bf3;
  color: #ffffff;
  box-shadow: 0 4px 10px rgba(49, 107, 243, 0.3);
}

.role-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}

.role-radio {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(211, 228, 254, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform var(--motion-hover) var(--motion-ease), opacity var(--motion-hover) var(--motion-ease), background-color var(--motion-hover) var(--motion-ease), border-color var(--motion-hover) var(--motion-ease), color var(--motion-hover) var(--motion-ease), box-shadow var(--motion-hover) var(--motion-ease);
}

.role-radio--on {
  background: #0051d5;
  box-shadow: 0 2px 6px rgba(0, 81, 213, 0.3);
}

.role-radio-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ffffff;
  animation: dotPop 0.2s var(--motion-ease);
}

@keyframes dotPop {
  0% { transform: scale(0); }
  100% { transform: scale(1); }
}

.role-desc {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: #44474d;
}

/* Glassmorphic Inputs */
.input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.input-icon {
  position: absolute;
  left: 14px;
  font-size: 20px;
  color: #556276;
  pointer-events: none;
  transition: color 0.2s ease;
}

.input {
  width: 100%;
  height: 48px;
  min-height: 44px;
  padding: 0 16px 0 44px;
  border: 1px solid rgba(255, 255, 255, 0.9);
  border-radius: 10px;
  background: rgba(244, 248, 255, 0.65);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  font-family: inherit;
  font-size: 16px;
  line-height: 26px;
  color: #0b1c30;
  outline: none;
  box-shadow: inset 0 1px 3px rgba(15, 33, 55, 0.04);
  transition: transform var(--motion-hover) var(--motion-ease), opacity var(--motion-hover) var(--motion-ease), background-color var(--motion-hover) var(--motion-ease), border-color var(--motion-hover) var(--motion-ease), color var(--motion-hover) var(--motion-ease), box-shadow var(--motion-hover) var(--motion-ease);
}

.input::placeholder {
  color: #74777d;
  letter-spacing: normal;
  text-align: left;
}

.input:focus {
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(49, 107, 243, 0.8);
  box-shadow: 0 0 0 3px rgba(49, 107, 243, 0.18), 0 4px 12px rgba(49, 107, 243, 0.08);
}

.input:focus ~ .input-icon,
.input-wrap:focus-within .input-icon {
  color: #0051d5;
}

.input:focus-visible,
.toggle:focus-visible,
.success-close:focus-visible,
.error-close:focus-visible,
.role-option:focus-within {
  outline: 3px solid #0051d5;
  outline-offset: 2px;
}

.input-pin {
  letter-spacing: 0.3em;
  padding-right: 96px;
}

.toggle {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  height: 44px;
  min-height: 44px;
  min-width: 44px;
  justify-content: center;
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: #44474d;
  font-family: inherit;
  cursor: pointer;
  transition: transform var(--motion-hover) var(--motion-ease), opacity var(--motion-hover) var(--motion-ease), background-color var(--motion-hover) var(--motion-ease), border-color var(--motion-hover) var(--motion-ease), color var(--motion-hover) var(--motion-ease), box-shadow var(--motion-hover) var(--motion-ease);
}

.toggle-icon {
  font-size: 18px;
}

.toggle-text {
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
}

.field-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #44474d;
  font-size: 12px;
  line-height: 18px;
}

.hint-icon {
  font-size: 14px;
}

/* Error */
.error-alert {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border-radius: 10px;
  background: rgba(255, 218, 214, 0.9);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(186, 26, 26, 0.25);
  color: #93000a;
  box-shadow: 0 4px 16px rgba(186, 26, 26, 0.08);
}

.error-icon {
  font-size: 20px;
  color: #ba1a1a;
  margin-top: 2px;
  flex-shrink: 0;
}

.error-text {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.error-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}

.error-body {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  opacity: 0.85;
}

.error-close {
  background: none;
  border: 0;
  min-width: 44px;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  padding: 2px;
  cursor: pointer;
  color: #93000a;
  display: flex;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.error-close .material-symbols-outlined {
  font-size: 18px;
}

/* Glow Shimmer Submit Button */
.submit {
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 10px;
  background: rgba(229, 238, 255, 0.75);
  color: #74777d;
  font-family: inherit;
  font-size: 16px;
  font-weight: 600;
  opacity: 0.7;
  cursor: not-allowed;
  transition: transform var(--motion-hover) var(--motion-ease), opacity var(--motion-hover) var(--motion-ease), background-color var(--motion-hover) var(--motion-ease), border-color var(--motion-hover) var(--motion-ease), color var(--motion-hover) var(--motion-ease), box-shadow var(--motion-hover) var(--motion-ease);
}

/* Glass Specular Top Highlight */
.submit::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.6) 50%, rgba(255, 255, 255, 0) 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
}

/* Continuous Prismatic Glow Shimmer Sweep */
.submit::after {
  content: '';
  position: absolute;
  top: -50%;
  left: -150%;
  width: 100%;
  height: 200%;
  background: linear-gradient(
    65deg,
    rgba(255, 255, 255, 0) 20%,
    rgba(255, 255, 255, 0.12) 40%,
    rgba(133, 248, 196, 0.22) 50%,
    rgba(255, 255, 255, 0.25) 55%,
    rgba(255, 255, 255, 0) 75%
  );
  transform: rotate(26deg);
  opacity: 0;
  pointer-events: none;
}

.submit.ready {
  background: linear-gradient(135deg, #0d1e33 0%, #0f2137 55%, #183354 100%);
  color: #ffffff;
  opacity: 1;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: 
    0 4px 16px rgba(15, 33, 55, 0.24),
    0 0 20px rgba(49, 107, 243, 0.15);
  animation: readyPulseGlow 3.5s ease-in-out infinite;
}

.submit.ready::before {
  opacity: 1;
}

.submit.ready::after {
  opacity: 1;
  animation: shimmerSweep 3.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

.submit.ready:active {
  transform: translateY(0) scale(0.99);
}

@keyframes shimmerSweep {
  /* Transform, not left: the sweep travels the same distance without a
     layout per frame. */
  0% { transform: translateX(0); }
  35%, 100% { transform: translateX(310%); }
}

/* A transform pulse, not a box-shadow pulse: the glow itself is static on the
   button, and only the scale moves, so the ready cue costs no repaint. */
@keyframes readyPulseGlow {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.015); }
}

.submit .material-symbols-outlined {
  font-size: 20px;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Footer */
.login-footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  text-align: center;
}

@media (min-width: 640px) {
  .login-footer { flex-direction: row; gap: 8px; }
}

.footer-text {
  font-size: 14px;
  color: #44474d;
}

.footer-link {
  font-size: 16px;
  font-weight: 600;
  color: #0051d5;
  text-decoration: underline;
  text-decoration-color: rgba(49, 107, 243, 0.4);
  text-underline-offset: 4px;
  transition: color 0.2s ease;
}

.security-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #44474d;
  font-size: 11px;
}

.security-note {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.security-icon {
  font-size: 14px;
  color: #005137;
}

/* Page footer */
.page-footer {
  position: relative;
  z-index: 2;
  padding: 12px 16px;
  background: rgba(239, 244, 255, 0.65);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-top: 1px solid rgba(255, 255, 255, 0.8);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: #44474d;
}

@media (min-width: 640px) {
  .page-footer {
    flex-direction: row;
    padding: 12px 48px;
  }
}

.footer-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.footer-icon {
  font-size: 14px;
}

/* Phones: the marketing panel would push the form below the fold, so the login
   card is the only panel and the page centres it. Everything stays in normal
   flow: with the keyboard open the page scrolls and the focused input stays
   visible. No fixed positioning is used for the form. */
@media (max-width: 767px) {
  .topbar {
    padding-top: max(8px, env(safe-area-inset-top));
    padding-bottom: 8px;
    padding-left: max(16px, env(safe-area-inset-left));
    padding-right: max(16px, env(safe-area-inset-right));
  }

  .page-main {
    padding: 12px max(16px, env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom))
      max(16px, env(safe-area-inset-left));
  }

  .brand-panel,
  .page-footer {
    display: none;
  }

  .split {
    border-radius: 16px;
  }

  .login-panel {
    padding: 16px;
    justify-content: center;
  }

  .login-inner {
    gap: 14px;
    max-width: 100%;
  }

  .login-title-row h1 {
    font-size: 24px;
    line-height: 32px;
  }

  .login-sub {
    font-size: 13px;
    line-height: 18px;
  }

  .form {
    gap: 14px;
  }

  .role-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .role-option {
    min-height: 44px;
    padding: 8px;
    gap: 2px;
    border-radius: 10px;
  }

  /* Secondary copy stays out of the way so four roles and both fields fit. */
  .role-desc,
  .section-hint {
    display: none;
  }

  .role-title {
    font-size: 12px;
    line-height: 16px;
    overflow-wrap: anywhere;
  }

  .role-icon {
    width: 24px;
    height: 24px;
  }

  .role-icon .material-symbols-outlined {
    font-size: 16px;
  }

  .section {
    gap: 6px;
  }

  .section-label {
    font-size: 14px;
    line-height: 20px;
  }

  .field-hint {
    font-size: 11px;
    line-height: 15px;
  }

  .input {
    height: 46px;
  }

  /* Icon-only toggle: still a 44px target, and the PIN field keeps its room. */
  .toggle {
    right: 4px;
    min-width: 44px;
    padding: 0 10px;
  }

  .toggle-text {
    display: none;
  }

  .input-pin {
    padding-right: 64px;
  }

  /* The global sheet adds a 24px margin and a 20px divider above this block;
     on a phone that space is needed by the form itself. */
  .login-footer {
    margin-top: 0;
    padding-top: 0;
    border-top: 0;
    gap: 2px;
    font-size: 12px;
    line-height: 16px;
  }

  .login-footer .footer-text,
  .login-footer .footer-link {
    font-size: 12px;
    line-height: 16px;
  }

  .security-row {
    font-size: 10px;
  }
}

/* Short screens (small phones and landscape): drop the optional lines first so
   the form is centred and readable, then let the page scroll if needed. */
@media (max-width: 767px) and (max-height: 720px) {
  .login-sub,
  .field-hint,
  .security-row {
    display: none;
  }

  .login-inner,
  .form {
    gap: 10px;
  }

  .login-title-row h1 {
    font-size: 22px;
    line-height: 28px;
  }

  .login-panel {
    padding: 12px 14px;
  }
}

/* Reduced Motion for Accessibility */
@media (prefers-reduced-motion: reduce) {
  .ambient-orb,
  .pulse-dot,
  .submit.ready,
  .submit.ready::after {
    animation: none !important;
  }
}
/* ===== Motion ===== */

@keyframes m-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes m-fade-in-down {
  from { opacity: 0; transform: translateY(-16px); }
  to { opacity: 1; transform: none; }
}
@keyframes m-fade-in-up {
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: none; }
}
@keyframes m-scale-in {
  from { opacity: 0; transform: scale(0.98) translateY(12px); }
  to { opacity: 1; transform: none; }
}
@keyframes m-slide-in {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: none; }
}
@keyframes m-shake {
  10%, 90% { transform: translate3d(-1px, 0, 0); }
  20%, 80% { transform: translate3d(2px, 0, 0); }
  30%, 50%, 70% { transform: translate3d(-3px, 0, 0); }
  40%, 60% { transform: translate3d(3px, 0, 0); }
}
@keyframes m-role-pop {
  0% { transform: translateY(-2px) scale(0.98); }
  60% { transform: translateY(-2px) scale(1.015); }
  100% { transform: translateY(-2px) scale(1); }
}
@keyframes m-counter-pop {
  0% { transform: scale(1); }
  50% { transform: scale(1.15); }
  100% { transform: scale(1.05); }
}

/* 1) เข้าฉาก — the shared entrance: one duration, one curve, one stagger step.
   Nothing here invents its own rhythm; the atoms below only choose an order. */
.topbar { animation: m-fade-in-down var(--motion-entrance) var(--motion-ease) backwards; }
/* The panel and its heading must be readable at first paint. The remaining
   motion below the fold is decorative and does not gate the login LCP. */
.split { animation: none; }

/* 2) ฝั่งแบรนด์ ทยอยขึ้นทีละส่วน */
.brand-top { animation: m-fade-in-up var(--motion-entrance) var(--motion-ease) backwards; }
.brand-copy { animation: m-fade-in-up var(--motion-entrance) var(--motion-ease) var(--motion-stagger) backwards; }
.benefit { animation: m-fade-in-up var(--motion-entrance) var(--motion-ease) backwards; }
.benefit:nth-child(1) { animation-delay: calc(var(--motion-stagger) * 2); }
.benefit:nth-child(2) { animation-delay: calc(var(--motion-stagger) * 3); }
.benefit:nth-child(3) { animation-delay: calc(var(--motion-stagger) * 4); }
.brand-footnote { animation: m-fade-in-up var(--motion-entrance) var(--motion-ease) calc(var(--motion-stagger) * 5) backwards; }

/* 3) ฝั่งฟอร์ม */
.login-head { animation: none; }
.form > .section { animation: m-fade-in-up var(--motion-entrance) var(--motion-ease) backwards; }
.form > .section:nth-child(1) { animation-delay: var(--motion-stagger); }
.form > .section:nth-child(2) { animation-delay: calc(var(--motion-stagger) * 2); }
.form > .section:nth-child(3) { animation-delay: calc(var(--motion-stagger) * 3); }
.success-alert { animation: m-slide-in var(--motion-route) var(--motion-ease) backwards; }
.error-alert { animation: m-shake var(--motion-route) var(--motion-ease) backwards; }

/* 4) ตัวเลือกและช่องกรอก */
.role-option--selected { animation: m-role-pop var(--motion-route) var(--motion-ease); }
.input-icon { transition: color var(--motion-hover) var(--motion-ease), transform var(--motion-hover) var(--motion-ease); }
.input-wrap:focus-within .input-icon { transform: scale(1.1); }
.counter { transition: transform var(--motion-hover) var(--motion-ease), background-color var(--motion-hover) var(--motion-ease), color var(--motion-hover) var(--motion-ease); }
.counter.full { animation: m-counter-pop var(--motion-route) var(--motion-ease) backwards; }

/* 5) ปิดแอนิเมชันเมื่อผู้ใช้ตั้งค่า reduced motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

@media (hover: hover) and (pointer: fine) {
  .benefit:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.14);
    transform: translateX(3px);
  }

  .success-close:hover {
    color: #0b1c30;
  }

  .role-option:hover {
    background: rgba(255, 255, 255, 0.88);
    transform: translateY(-2px);
    border-color: rgba(255, 255, 255, 1);
    box-shadow: 0 8px 20px rgba(15, 33, 55, 0.08);
  }

  .toggle:hover {
    color: #0b1c30;
    background: rgba(220, 233, 255, 0.6);
  }

  .error-close:hover {
    background: rgba(186, 26, 26, 0.1);
  }

  .submit.ready:hover {
    background: linear-gradient(135deg, #0a1829 0%, #0c1c30 55%, #132a47 100%);
    transform: translateY(-2px);
    box-shadow: 
      0 8px 24px rgba(15, 33, 55, 0.32),
      0 0 30px rgba(133, 248, 196, 0.22);
  }

  .footer-link:hover {
    color: #002b6e;
  }
}
</style>