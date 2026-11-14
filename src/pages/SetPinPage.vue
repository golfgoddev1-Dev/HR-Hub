<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { postJson } from '../api.js'

const router = useRouter()
const nationalId = ref('')
const code = ref('')
const pin = ref('')
const pinConfirm = ref('')
const pinVisible = ref(false)
const confirmVisible = ref(false)
const loading = ref(false)
const errorMessage = ref('')

const pinMatches = computed(() =>
  pin.value.length === 6 && pin.value === pinConfirm.value,
)

const canSubmit = computed(() =>
  nationalId.value.length === 13
  && code.value.length === 8
  && pin.value.length === 6
  && pinConfirm.value.length === 6
  && pinMatches.value
  && !loading.value,
)

// ตัดทุกอย่างที่ไม่ใช่ตัวเลข, จำกัดความยาว และอัปเดตค่าใน input ให้ตรงกับ state
function sanitize(event, length) {
  const cleaned = event.target.value.replace(/\D/g, '').slice(0, length)
  event.target.value = cleaned
  errorMessage.value = ''
  return cleaned
}

function onNationalId(event) { nationalId.value = sanitize(event, 13) }
function onCode(event) { code.value = sanitize(event, 8) }
function onPin(event) { pin.value = sanitize(event, 6) }
function onPinConfirm(event) { pinConfirm.value = sanitize(event, 6) }

async function submitSetPin() {
  if (!canSubmit.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const { status, data } = await postJson('/api/auth/set-pin', {
      nationalId: nationalId.value,
      code: code.value,
      pin: pin.value,
      pinConfirm: pinConfirm.value,
    })
    if (status === 200 && data.ok === true) {
      // replace(): the finished set-PIN screen must not stay in browser history,
      // otherwise a back button press returns to it.
      await router.replace('/login?reset=1')
      return
    }
    errorMessage.value = typeof data.message === 'string'
      ? data.message
      : 'ไม่สามารถตั้ง PIN ได้ กรุณาลองใหม่'
  } catch {
    errorMessage.value = 'ไม่สามารถตั้ง PIN ได้ กรุณาลองใหม่'
  } finally {
    pin.value = ''
    pinConfirm.value = ''
    loading.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="page-ambient-bg" aria-hidden="true">
      <div class="ambient-orb ambient-orb-1"></div>
      <div class="ambient-orb ambient-orb-2"></div>
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
        <span class="material-symbols-outlined env-icon">lock</span>
        <span>TLS 1.3 256-Bit Encrypted Session</span>
      </div>
    </header>

    <main class="page-main">
      <div class="shell">
        <div class="split">
          <!-- Left: steps panel -->
          <section class="brand-panel" aria-label="ขั้นตอนการตั้ง PIN">
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
                  <span class="material-symbols-outlined tag-icon">route</span>
                  <span>ขั้นตอนการตั้ง PIN</span>
                </div>
                <h2 class="brand-heading">ตั้ง PIN ใหม่ใน 4 ขั้นตอน</h2>
                <p class="brand-description">
                  ใช้เลขบัตรประชาชนและรหัส 8 หลักที่ได้รับจากฝ่าย HR เพื่อกำหนด PIN 6 หลักของคุณเอง
                </p>
              </div>

              <ol class="steps">
                <li class="step">
                  <span class="step-no">1</span>
                  <span class="step-copy">
                    <span class="step-title">กรอกเลขบัตรประชาชน 13 หลัก</span>
                    <span class="step-sub">กรอกเฉพาะตัวเลข ไม่ต้องใส่ขีด</span>
                  </span>
                </li>
                <li class="step">
                  <span class="step-no">2</span>
                  <span class="step-copy">
                    <span class="step-title">กรอกรหัส 8 หลักจากฝ่าย HR</span>
                    <span class="step-sub">รหัสนี้ใช้ยืนยันตัวตนก่อนตั้ง PIN</span>
                  </span>
                </li>
                <li class="step">
                  <span class="step-no">3</span>
                  <span class="step-copy">
                    <span class="step-title">ตั้ง PIN ใหม่ 6 หลัก</span>
                    <span class="step-sub">ใช้ตัวเลขที่จำได้ และไม่บอกผู้อื่น</span>
                  </span>
                </li>
                <li class="step">
                  <span class="step-no">4</span>
                  <span class="step-copy">
                    <span class="step-title">ยืนยัน PIN อีกครั้งแล้วกดตั้ง PIN</span>
                    <span class="step-sub">เมื่อสำเร็จ ระบบจะพากลับไปหน้าเข้าสู่ระบบ</span>
                  </span>
                </li>
              </ol>
            </div>

            <div class="brand-footnote">
              <span class="material-symbols-outlined footnote-icon">info</span>
              <span>ยังไม่ได้รับรหัส 8 หลัก หรือรหัสหมดอายุ กรุณาติดต่อฝ่ายทรัพยากรบุคคลของหน่วยงานท่าน</span>
            </div>
          </section>

          <!-- Right: form panel -->
          <section class="form-panel">
            <div class="form-inner">
              <div class="ssl-pill">
                <span class="material-symbols-outlined ssl-pill-icon">security</span>
                <span>การส่งข้อมูลผ่านการเข้ารหัส 256-bit SSL</span>
              </div>

              <div class="card">
                <header class="card-header">
                  <div class="card-icon">
                    <span class="material-symbols-outlined">password</span>
                  </div>
                  <h1>ตั้งหรือรีเซ็ต PIN</h1>
                  <p>กรอกเลขบัตร รหัส 8 หลักจาก HR และ PIN ใหม่ 6 หลัก</p>
                </header>

                <!-- Error alert -->
                <div v-if="errorMessage" class="alert" role="alert">
                  <span class="material-symbols-outlined alert-icon">error</span>
                  <div class="alert-text">
                    <span class="alert-title">เกิดข้อผิดพลาดในการตรวจสอบ</span>
                    <span class="alert-body">{{ errorMessage }}</span>
                  </div>
                  <button type="button" class="alert-close" aria-label="ปิดข้อความ" @click="errorMessage = ''">
                    <span class="material-symbols-outlined">close</span>
                  </button>
                </div>

                <form class="form" @submit.prevent="submitSetPin">
                  <!-- เลขบัตรประชาชน -->
                  <div class="field">
                    <div class="field-head">
                      <label for="nationalId">เลขบัตรประชาชน 13 หลัก</label>
                      <span class="counter" :class="{ full: nationalId.length === 13 }">{{ nationalId.length }}/13</span>
                    </div>
                    <div class="input-wrap">
                      <span class="material-symbols-outlined input-icon">badge</span>
                      <input
                        id="nationalId"
                        class="input input-id"
                        type="text"
                        inputmode="numeric"
                        maxlength="13"
                        autocomplete="off"
                        placeholder="กรอกตัวเลข 13 หลัก"
                        :value="nationalId"
                        @input="onNationalId"
                      />
                    </div>
                  </div>

                  <!-- Notice: the 8-digit code is issued by HR -->
                  <div class="code-notice" role="note">
                    <span class="material-symbols-outlined code-notice-icon">info</span>
                    <span>ช่องรหัส 8 หลัก ให้ติดต่อฝ่ายบุคคล (HR) เพื่อขอรหัสไปรีเซ็ต PIN</span>
                  </div>

                  <!-- รหัสจาก HR -->
                  <div class="field">
                    <div class="field-head">
                      <label for="code">รหัสจาก HR 8 หลัก</label>
                      <span class="counter" :class="{ full: code.length === 8 }">{{ code.length }}/8</span>
                    </div>
                    <div class="input-wrap">
                      <span class="material-symbols-outlined input-icon">key</span>
                      <input
                        id="code"
                        class="input input-code"
                        type="text"
                        inputmode="numeric"
                        maxlength="8"
                        autocomplete="one-time-code"
                        placeholder="กรอกรหัส 8 หลัก"
                        :value="code"
                        @input="onCode"
                      />
                    </div>
                  </div>

                  <!-- PIN ใหม่ -->
                  <div class="field">
                    <div class="field-head">
                      <label for="pin">PIN ใหม่ 6 หลัก</label>
                      <span class="counter" :class="{ full: pin.length === 6 }">{{ pin.length }}/6</span>
                    </div>
                    <div class="input-wrap">
                      <span class="material-symbols-outlined input-icon">lock</span>
                      <input
                        id="pin"
                        class="input input-pin"
                        :type="pinVisible ? 'text' : 'password'"
                        inputmode="numeric"
                        maxlength="6"
                        autocomplete="new-password"
                        placeholder="กรอก PIN 6 หลัก"
                        :value="pin"
                        @input="onPin"
                      />
                      <button type="button" class="toggle" :aria-label="pinVisible ? 'ซ่อน PIN ใหม่' : 'แสดง PIN ใหม่'" @click="pinVisible = !pinVisible">
                        <span class="material-symbols-outlined toggle-icon">{{ pinVisible ? 'visibility_off' : 'visibility' }}</span>
                        <span class="toggle-text">{{ pinVisible ? 'ซ่อน' : 'แสดง' }}</span>
                      </button>
                    </div>
                  </div>

                  <!-- ยืนยัน PIN -->
                  <div class="field">
                    <div class="field-head">
                      <label for="pinConfirm">ยืนยัน PIN ใหม่</label>
                      <span v-if="pinConfirm" class="match" :class="pinMatches ? 'ok' : 'bad'">
                        <span class="material-symbols-outlined match-icon">{{ pinMatches ? 'check_circle' : 'cancel' }}</span>
                        <span>{{ pinMatches ? 'PIN ตรงกัน' : 'PIN ไม่ตรงกัน' }}</span>
                      </span>
                    </div>
                    <div class="input-wrap">
                      <span class="material-symbols-outlined input-icon">verified_user</span>
                      <input
                        id="pinConfirm"
                        class="input input-pin"
                        :type="confirmVisible ? 'text' : 'password'"
                        inputmode="numeric"
                        maxlength="6"
                        autocomplete="new-password"
                        placeholder="กรอก PIN ใหม่อีกครั้ง"
                        :value="pinConfirm"
                        @input="onPinConfirm"
                      />
                      <button type="button" class="toggle" :aria-label="confirmVisible ? 'ซ่อน PIN ที่ยืนยัน' : 'แสดง PIN ที่ยืนยัน'" @click="confirmVisible = !confirmVisible">
                        <span class="material-symbols-outlined toggle-icon">{{ confirmVisible ? 'visibility_off' : 'visibility' }}</span>
                        <span class="toggle-text">{{ confirmVisible ? 'ซ่อน' : 'แสดง' }}</span>
                      </button>
                    </div>
                  </div>

                  <button type="submit" class="submit" :class="{ ready: canSubmit }" :disabled="!canSubmit">
                    <span v-if="loading" class="material-symbols-outlined spin">progress_activity</span>
                    <span>{{ loading ? 'กำลังบันทึกข้อมูล...' : 'ตั้ง PIN' }}</span>
                  </button>
                </form>

                <div class="card-footer">
                  <RouterLink to="/login" class="back-link">
                    <span class="material-symbols-outlined back-icon">arrow_back</span>
                    <span>กลับไปหน้าเข้าสู่ระบบ</span>
                  </RouterLink>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>

    <!-- Footer -->
    <footer class="page-footer">
      <div class="helpdesk">
        <span class="material-symbols-outlined helpdesk-icon">support_agent</span>
        <span>ศูนย์บริการช่วยเหลือบุคลากร (HR Helpdesk) โทร. 02-XXX-XXXX ต่อ 8888 | เวลาทำการ จันทร์-ศุกร์ 08:30 - 17:30 น.</span>
      </div>
      <div class="copyright">© 2025 สงวนลิขสิทธิ์ ฝ่ายทรัพยากรบุคคลและระบบสารสนเทศองค์กร</div>
    </footer>
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

.page {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: 'IBM Plex Sans', 'IBM Plex Sans Thai', sans-serif;
  color: #0b1c30;
  background: #f4f7fc;
  overflow-x: hidden;
}

/* Ambient background (เหมือนหน้า login) */
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
  width: 520px;
  height: 520px;
  top: -120px;
  right: -80px;
  background: radial-gradient(circle, rgba(49, 107, 243, 0.22) 0%, rgba(49, 107, 243, 0) 70%);
}

.ambient-orb-2 {
  width: 440px;
  height: 440px;
  bottom: -60px;
  left: -80px;
  background: radial-gradient(circle, rgba(133, 248, 196, 0.24) 0%, rgba(133, 248, 196, 0) 70%);
  animation-duration: 22s;
  animation-delay: -5s;
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
  display: flex;
  align-items: center;
}

@media (min-width: 1024px) {
  .page-main { padding: 40px 48px; }
}

.shell {
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  min-width: 0;
}

/* Split container (ธีมเดียวกับหน้า login) */
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

/* Left: brand/steps panel */
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
  min-width: 0;
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
  width: 340px;
  height: 340px;
  top: -80px;
  right: -80px;
  background: radial-gradient(circle, rgba(49, 107, 243, 0.2) 0%, rgba(49, 107, 243, 0) 70%);
}

.blur-bl {
  width: 280px;
  height: 280px;
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
  font-size: 34px;
  line-height: 44px;
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

/* ขั้นตอน */
.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.step {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.step-no {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #002618;
  border: 1px solid rgba(133, 248, 196, 0.35);
  color: #85f8c4;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.step-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.step-title {
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  color: #ffffff;
}

.step-sub {
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

/* Right: form panel */
.form-panel {
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  padding: 24px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
}

@media (min-width: 640px) {
  .form-panel { padding: 40px; }
}

@media (min-width: 1024px) {
  .form-panel { padding: 48px; }
}

.form-inner {
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.ssl-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 16px;
  border-radius: 999px;
  background: #dce9ff;
  font-size: 11px;
  font-weight: 500;
  color: #44474d;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.ssl-pill-icon {
  font-size: 16px;
  color: #316bf3;
  font-variation-settings: 'FILL' 1;
}

/* Card (ฟอร์ม) */
.card {
  width: 100%;
  background: #ffffff;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 4px 24px rgba(15, 33, 55, 0.06), 0 1px 4px rgba(15, 33, 55, 0.04);
}

@media (min-width: 640px) {
  .card { padding: 32px; }
}

.card-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin-bottom: 24px;
}

.card-icon {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  background: #e5eeff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
  color: #000919;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.06);
}

.card-icon .material-symbols-outlined {
  font-size: 30px;
}

.card-header h1 {
  font-size: 26px;
  line-height: 36px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0 0 4px;
}

.card-header p {
  font-size: 14px;
  line-height: 22px;
  color: #44474d;
  max-width: 320px;
  margin: 0;
}

/* Alert */
.alert {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 16px;
  border-radius: 8px;
  background: #ffdad6;
  color: #93000a;
  margin-bottom: 24px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.alert-icon {
  font-size: 20px;
  color: #ba1a1a;
  font-variation-settings: 'FILL' 1;
  margin-top: 2px;
}

.alert-text {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.alert-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}

.alert-body {
  font-size: 12px;
  line-height: 18px;
  opacity: 0.9;
}

.alert-close {
  background: none;
  border: 0;
  padding: 2px;
  cursor: pointer;
  color: rgba(147, 0, 10, 0.7);
  display: flex;
}

.alert-close:hover {
  color: #93000a;
}

.alert-close .material-symbols-outlined {
  font-size: 18px;
}

/* Form */
.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.code-notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 8px;
  background: #eff4ff;
  border: 1px solid rgba(49, 107, 243, 0.25);
  color: #0b1c30;
  font-size: 14px;
  line-height: 21px;
  font-weight: 500;
}

.code-notice-icon {
  font-size: 20px;
  color: #316bf3;
  flex-shrink: 0;
}

.field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 20px;
}

.field-head label {
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  color: #0b1c30;
}

.counter {
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  color: #44474d;
  background: #e5eeff;
  padding: 2px 8px;
  border-radius: 4px;
  transition: background-color 0.2s, color 0.2s;
}

.counter.full {
  background: #85f8c4;
  color: #005137;
}

.match {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
}

.match.ok {
  color: #139a6d;
}

.match.bad {
  color: #ba1a1a;
}

.match-icon {
  font-size: 14px;
  font-variation-settings: 'FILL' 1;
}

.input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.input-icon {
  position: absolute;
  left: 12px;
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

.input-id {
  letter-spacing: normal;
}

.input-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}

.input-pin {
  text-align: left;
  letter-spacing: 0.3em;
  padding-right: 72px;
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
  cursor: pointer;
  transition: color 0.2s, background-color 0.2s;
}

.toggle:hover {
  color: #0b1c30;
  background: #e5eeff;
}

.toggle-icon {
  font-size: 18px;
}

.toggle-text {
  font-size: 11px;
  line-height: 16px;
}

/* Submit */
.submit {
  width: 100%;
  height: 48px;
  margin-top: 8px;
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
  transition: transform var(--motion-hover) var(--motion-ease), opacity var(--motion-hover) var(--motion-ease), background-color var(--motion-hover) var(--motion-ease), border-color var(--motion-hover) var(--motion-ease), color var(--motion-hover) var(--motion-ease), box-shadow var(--motion-hover) var(--motion-ease);
}

.submit.ready {
  background: linear-gradient(135deg, #0d1e33 0%, #0f2137 55%, #183354 100%);
  color: #ffffff;
  opacity: 1;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(15, 33, 55, 0.25);
}

.submit.ready:hover {
  background: linear-gradient(135deg, #0a1829 0%, #0c1c30 55%, #132a47 100%);
}

.submit.ready:active {
  transform: scale(0.99);
}

.spin {
  font-size: 20px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Card footer */
.card-footer {
  margin-top: 24px;
  text-align: center;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 500;
  color: #0051d5;
  text-decoration: none;
  transition: color 0.2s, background-color 0.2s;
}

.back-link:hover {
  color: #316bf3;
  background: #eff4ff;
}

.back-icon {
  font-size: 18px;
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
  text-align: center;
}

@media (min-width: 640px) {
  .page-footer {
    flex-direction: row;
    padding: 12px 48px;
    text-align: left;
  }
}

.helpdesk {
  display: flex;
  align-items: center;
  gap: 8px;
}

.helpdesk-icon {
  font-size: 16px;
}

.copyright {
  font-size: 11px;
  color: #44474d;
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
@keyframes m-shake {
  10%, 90% { transform: translate3d(-1px, 0, 0); }
  20%, 80% { transform: translate3d(2px, 0, 0); }
  30%, 50%, 70% { transform: translate3d(-3px, 0, 0); }
  40%, 60% { transform: translate3d(3px, 0, 0); }
}
@keyframes m-pop {
  0% { transform: scale(0.6); opacity: 0; }
  60% { transform: scale(1.12); opacity: 1; }
  100% { transform: scale(1); }
}
@keyframes m-counter-pop {
  0% { transform: scale(1); }
  50% { transform: scale(1.15); }
  100% { transform: scale(1.04); }
}
@keyframes m-shine {
  0%, 70% { transform: translateX(-120%) rotate(26deg); opacity: 0; }
  75% { opacity: 1; }
  100% { transform: translateX(420%) rotate(26deg); opacity: 0; }
}

/* The shared entrance, the shared curve and one stagger step: the set-pin page
   has its own composition, not its own timing. */
.topbar { animation: m-fade-in-down var(--motion-entrance) var(--motion-ease) backwards; }
.split { animation: m-scale-in var(--motion-entrance) var(--motion-ease) backwards; }
.brand-top { animation: m-fade-in-up var(--motion-entrance) var(--motion-ease) backwards; }
.brand-copy { animation: m-fade-in-up var(--motion-entrance) var(--motion-ease) var(--motion-stagger) backwards; }
.step { animation: m-fade-in-up var(--motion-entrance) var(--motion-ease) backwards; }
.step:nth-child(1) { animation-delay: calc(var(--motion-stagger) * 2); }
.step:nth-child(2) { animation-delay: calc(var(--motion-stagger) * 3); }
.step:nth-child(3) { animation-delay: calc(var(--motion-stagger) * 4); }
.step:nth-child(4) { animation-delay: calc(var(--motion-stagger) * 5); }
.brand-footnote { animation: m-fade-in-up var(--motion-entrance) var(--motion-ease) calc(var(--motion-stagger) * 6) backwards; }

.ssl-pill { animation: m-fade-in var(--motion-entrance) var(--motion-ease) var(--motion-stagger) backwards; }
.card { animation: m-fade-in-up var(--motion-entrance) var(--motion-ease) var(--motion-stagger) backwards; }
.card-icon { animation: m-pop var(--motion-entrance) var(--motion-ease) calc(var(--motion-stagger) * 2) backwards; }
.field { animation: m-fade-in-up var(--motion-entrance) var(--motion-ease) backwards; }
.form > .field:nth-child(1) { animation-delay: calc(var(--motion-stagger) * 2); }
.form > .field:nth-child(2) { animation-delay: calc(var(--motion-stagger) * 3); }
.form > .field:nth-child(3) { animation-delay: calc(var(--motion-stagger) * 4); }
.form > .field:nth-child(4) { animation-delay: calc(var(--motion-stagger) * 5); }
.submit { animation: m-fade-in-up var(--motion-entrance) var(--motion-ease) calc(var(--motion-stagger) * 6) backwards; }
.alert { animation: m-shake var(--motion-route) var(--motion-ease) backwards; }
.match-icon { animation: m-pop var(--motion-route) var(--motion-ease) backwards; }
.counter.full { animation: m-counter-pop var(--motion-route) var(--motion-ease) backwards; }
.input-icon { transition: color var(--motion-hover) var(--motion-ease), transform var(--motion-hover) var(--motion-ease); }
.input-wrap:focus-within .input-icon { transform: scale(1.1); color: #316bf3; }
.submit.ready { position: relative; overflow: hidden; }
.submit.ready::after {
  content: '';
  position: absolute;
  top: -50%;
  left: 0;
  width: 40%;
  height: 200%;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.25) 50%, rgba(255, 255, 255, 0) 100%);
  transform: rotate(26deg);
  pointer-events: none;
  animation: m-shine 3.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
</style>