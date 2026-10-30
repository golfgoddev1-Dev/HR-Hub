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
      await router.push('/login?reset=1')
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
    <!-- Top bar -->
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">
          <span class="material-symbols-outlined brand-mark-icon">verified_user</span>
        </div>
        <div class="brand-text">
          <span class="brand-title">ระบบบริการงานบุคคลและสวัสดิการพนักงาน</span>
          <span class="brand-sub">HR Portal Secure Access</span>
        </div>
      </div>
      <div class="secure-chip">
        <span class="material-symbols-outlined secure-chip-icon">lock</span>
        <span>TLS 1.3 256-Bit Encrypted Session</span>
      </div>
    </header>

    <!-- Main -->
    <main class="page-main">
      <div class="form-wrap">
        <div class="ssl-pill">
          <span class="material-symbols-outlined ssl-pill-icon">security</span>
          <span>การส่งข้อมูลผ่านการเข้ารหัส 256-bit SSL</span>
        </div>

        <section class="card">
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
        </section>

        <p class="policy-note">
          หากไม่ได้รับรหัส 8 หลัก หรือรหัสหมดอายุ กรุณาติดต่อฝ่ายทรัพยากรบุคคลของหน่วยงานท่าน
        </p>
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
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Sans+Thai:wght@400;500;600&display=swap');
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

.page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: 'IBM Plex Sans', 'IBM Plex Sans Thai', sans-serif;
  color: #0b1c30;
  background:
    radial-gradient(ellipse at top, rgba(180, 197, 255, 0.3), transparent 60%),
    linear-gradient(180deg, #f8f9ff 0%, #eff4ff 100%);
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
  box-shadow: 0 1px 8px rgba(0, 0, 0, 0.04);
}

@media (min-width: 768px) {
  .topbar { padding: 12px 48px; }
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.brand-mark {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #000919;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.brand-mark-icon {
  color: #ffffff;
  font-size: 20px;
}

.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.brand-title {
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
}

.brand-sub {
  font-size: 11px;
  line-height: 14px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #44474d;
}

.secure-chip {
  display: none;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: 999px;
  background: #eff4ff;
  font-size: 11px;
  color: #44474d;
}

.secure-chip-icon {
  font-size: 16px;
  color: #005137;
}

@media (min-width: 640px) {
  .secure-chip { display: inline-flex; }
}

/* Main */
.page-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
}

@media (min-width: 768px) {
  .page-main { padding: 48px; }
}

.form-wrap {
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  align-items: center;
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
  margin-bottom: 16px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.ssl-pill-icon {
  font-size: 16px;
  color: #316bf3;
  font-variation-settings: 'FILL' 1;
}

/* Card */
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
  font-size: 28px;
  line-height: 40px;
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
  letter-spacing: normal;   /* ไม่ให้ placeholder ได้ letter-spacing จากช่องกรอก */
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
  letter-spacing: 0.15em;   /* คงไว้เฉพาะค่าที่พิมพ์ */
  text-transform: uppercase;
}

.input-pin {
  text-align: left;         /* ให้ตรงกับต้นฉบับ */
  letter-spacing: 0.3em;    /* ใช้กับตัวเลขที่พิมพ์เท่านั้น */
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
  background: #000919;
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

.policy-note {
  margin: 16px 0 0;
  max-width: 320px;
  text-align: center;
  font-size: 12px;
  line-height: 18px;
  color: #44474d;
}

/* Page footer */
.page-footer {
  padding: 16px;
  background: rgba(255, 255, 255, 0.6);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}

@media (min-width: 768px) {
  .page-footer {
    flex-direction: row;
    justify-content: space-between;
    padding: 16px 48px;
    text-align: left;
  }
}

.helpdesk {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  line-height: 18px;
  color: #44474d;
}

.helpdesk-icon {
  font-size: 16px;
}

.copyright {
  font-size: 11px;
  color: #44474d;
}
</style>