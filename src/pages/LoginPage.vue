<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { postJson } from '../api.js'
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
    const { status, data } = await postJson('/api/auth/login', {
      loginType: loginType.value,
      nationalId: nationalId.value,
      pin: pin.value,
    })
    if (status === 200 && typeof data.redirectTo === 'string') {
      pin.value = ''
      await router.replace(data.redirectTo)
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

          <!-- Right: login panel -->
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
              <div v-if="route.query.reset === '1'" class="success-alert" role="status">
                <span class="material-symbols-outlined success-icon">check_circle</span>
                <div class="success-text">
                  <p class="success-title">ตั้ง PIN สำเร็จ กรุณาเข้าสู่ระบบ</p>
                  <p class="success-body">คุณสามารถใช้ PIN ใหม่ร่วมกับเลขบัตรประชาชนเพื่อเข้าสู่ระบบงานได้ทันที</p>
                </div>
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
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Thai:wght@400;500;600&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');

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
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: 'IBM Plex Sans', 'IBM Plex Sans Thai', sans-serif;
  color: #0b1c30;
  background: #f8f9ff;
}

/* Top bar */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(12px);
  box-shadow: 0 1px 8px rgba(15, 33, 55, 0.03);
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
  border-radius: 4px;
  background: #0f2137;
  color: #85f8c4;
  display: flex;
  align-items: center;
  justify-content: center;
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
  gap: 4px;
  font-size: 12px;
  color: #44474d;
}

.env-icon {
  font-size: 16px;
  color: #002618;
}

@media (min-width: 640px) {
  .env-chip { display: inline-flex; }
}

/* Main */
.page-main {
  flex: 1;
  width: 100%;
  padding: 24px 16px;
}

@media (min-width: 1024px) {
  .page-main { padding: 40px 48px; }
}

.shell {
  max-width: 1280px;
  margin: 0 auto;
}

.split {
  display: grid;
  grid-template-columns: 1fr;
  border-radius: 12px;
  overflow: hidden;
  background: #ffffff;
  box-shadow: 0 20px 40px rgba(15, 33, 55, 0.1);
}

@media (min-width: 1024px) {
  .split { grid-template-columns: 5fr 7fr; }
}

/* Brand panel */
.brand-panel {
  position: relative;
  overflow: hidden;
  background: #0f2137;
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
  width: 320px;
  height: 320px;
  top: -80px;
  right: -80px;
  background: rgba(49, 107, 243, 0.1);
}

.blur-bl {
  width: 256px;
  height: 256px;
  bottom: 40px;
  left: -64px;
  background: rgba(104, 219, 169, 0.05);
  filter: blur(32px);
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
  border-radius: 8px;
  background: #ffffff;
  color: #0f2137;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 0.05em;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
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
  color: #7889a4;
}

.pdpa-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  font-size: 11px;
  font-weight: 500;
  color: #85f8c4;
}

.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #85f8c4;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
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
  padding: 4px 10px;
  border-radius: 4px;
  background: rgba(49, 107, 243, 0.2);
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
  color: #7889a4;
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
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(4px);
  transition: background-color 0.2s;
}

.benefit:hover {
  background: rgba(255, 255, 255, 0.1);
}

.benefit-icon {
  width: 24px;
  height: 24px;
  border-radius: 4px;
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
  color: #7889a4;
}

.brand-footnote {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: #7889a4;
  font-size: 11px;
  line-height: 14px;
}

.footnote-icon {
  font-size: 18px;
  color: #85f8c4;
  flex-shrink: 0;
}

/* Login panel */
.login-panel {
  background: #ffffff;
  padding: 24px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
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
  padding: 2px 10px;
  border-radius: 999px;
  background: #dce9ff;
  color: #44474d;
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
  border-radius: 8px;
  background: #eff4ff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.success-icon {
  font-size: 20px;
  color: #139a6d;
  margin-top: 2px;
  flex-shrink: 0;
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
  background: #dce9ff;
  padding: 2px 8px;
  border-radius: 4px;
  transition: background-color 0.2s, color 0.2s;
}

.counter.full {
  background: #85f8c4;
  color: #005137;
}

/* Role grid */
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
  background: #eff4ff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  transition: box-shadow 0.2s, background-color 0.2s;
}

.role-option:hover {
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.08);
}

.role-option--selected {
  background: #ffffff;
  box-shadow: 0 4px 12px rgba(15, 33, 55, 0.1);
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
  background: #dce9ff;
  color: #44474d;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.role-icon .material-symbols-outlined {
  font-size: 18px;
}

.role-option--selected .role-icon {
  background: #316bf3;
  color: #ffffff;
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
  background: #d3e4fe;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.role-radio--on {
  background: #0051d5;
}

.role-radio-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ffffff;
}

.role-desc {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: #44474d;
}

/* Inputs */
.input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.input-icon {
  position: absolute;
  left: 14px;
  font-size: 20px;
  color: #44474d;
  pointer-events: none;
}

.input {
  width: 100%;
  height: 48px;
  padding: 0 16px 0 44px;
  border: 0;
  border-radius: 8px;
  background: #eff4ff;
  font-family: inherit;
  font-size: 16px;
  line-height: 26px;
  color: #0b1c30;
  outline: none;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.04);
  transition: background-color 0.2s, box-shadow 0.2s;
}

.input::placeholder {
  color: #74777d;
  letter-spacing: normal;
  text-align: left;
}

.input:focus {
  background: #ffffff;
  box-shadow: 0 0 0 2px #316bf3;
}

.input-pin {
  letter-spacing: 0.3em;
  padding-right: 96px;
}

.toggle {
  position: absolute;
  right: 8px;
  height: 32px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: #44474d;
  font-family: inherit;
  cursor: pointer;
  transition: color 0.2s, background-color 0.2s;
}

.toggle:hover {
  color: #0b1c30;
  background: #dce9ff;
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
  border-radius: 8px;
  background: #ffdad6;
  color: #93000a;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
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
  opacity: 0.8;
}

.error-close {
  background: none;
  border: 0;
  padding: 2px;
  cursor: pointer;
  color: #93000a;
  display: flex;
}

.error-close .material-symbols-outlined {
  font-size: 18px;
}

/* Submit */
.submit {
  width: 100%;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 8px;
  background: #e5eeff;
  color: #44474d;
  font-family: inherit;
  font-size: 16px;
  font-weight: 600;
  opacity: 0.6;
  cursor: not-allowed;
  transition: all 0.2s;
}

.submit.ready {
  background: #0f2137;
  color: #ffffff;
  opacity: 1;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(15, 33, 55, 0.2);
}

.submit.ready:hover {
  background: #0b1c30;
}

.submit.ready:active {
  transform: scale(0.99);
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
}

.footer-link:hover {
  color: #002b6e;
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
  padding: 12px 16px;
  background: rgba(239, 244, 255, 0.5);
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
</style>