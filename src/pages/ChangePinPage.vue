<script setup>
import { computed, ref } from 'vue'
import { postJson } from '../api.js'
import LeaveNav from '../components/LeaveNav.vue'

// Reached only when the session still carries a HR-issued PIN. The server blocks
// every other API call until this succeeds; no old PIN is asked for because the
// employee may never have received one.
const pin = ref('')
const pinConfirm = ref('')
const pinVisible = ref(false)
const confirmVisible = ref(false)
const loading = ref(false)
const errorMessage = ref('')

const pinMatches = computed(() => pin.value.length === 6 && pin.value === pinConfirm.value)
const canSubmit = computed(
  () => pin.value.length === 6 && pinConfirm.value.length === 6 && pinMatches.value && !loading.value
)

function sanitize(event) {
  const cleaned = event.target.value.replace(/\D/g, '').slice(0, 6)
  event.target.value = cleaned
  errorMessage.value = ''
  return cleaned
}

function onPin(event) {
  pin.value = sanitize(event)
}

function onPinConfirm(event) {
  pinConfirm.value = sanitize(event)
}

async function submit() {
  if (!canSubmit.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const { status, data } = await postJson('/api/auth/change-pin', {
      pin: pin.value,
      pinConfirm: pinConfirm.value,
    })
    if (status === 200 && data.ok === true) {
      pin.value = ''
      pinConfirm.value = ''
      window.location.assign(typeof data.redirectTo === 'string' ? data.redirectTo : '/login')
      return
    }
    if (status === 401) {
      window.location.assign('/login')
      return
    }
    errorMessage.value =
      typeof data.message === 'string' ? data.message : 'เปลี่ยน PIN ไม่สำเร็จ กรุณาลองใหม่'
  } catch {
    errorMessage.value = 'เปลี่ยน PIN ไม่สำเร็จ กรุณาลองใหม่'
  } finally {
    pin.value = ''
    pinConfirm.value = ''
    loading.value = false
  }
}
</script>

<template>
  <div class="screen">
    <LeaveNav />

    <main class="content">
      <section class="card">
        <h1 class="title">เปลี่ยน PIN ก่อนใช้งาน</h1>
        <p class="sub">
          PIN ปัจจุบันออกโดยฝ่าย HR และใช้ได้เพียงครั้งเดียว กรุณากำหนด PIN 6 หลักของคุณเอง
          แล้วระบบจะพาไปยังหน้าหลัก
        </p>

        <label class="label" for="new-pin">PIN ใหม่ (6 หลัก)</label>
        <div class="field">
          <input
            id="new-pin"
            :type="pinVisible ? 'text' : 'password'"
            class="input"
            inputmode="numeric"
            autocomplete="new-password"
            maxlength="6"
            :value="pin"
            @input="onPin"
          />
          <button type="button" class="toggle" @click="pinVisible = !pinVisible">
            {{ pinVisible ? 'ซ่อน' : 'แสดง' }}
          </button>
        </div>

        <label class="label" for="confirm-pin">ยืนยัน PIN ใหม่</label>
        <div class="field">
          <input
            id="confirm-pin"
            :type="confirmVisible ? 'text' : 'password'"
            class="input"
            inputmode="numeric"
            autocomplete="new-password"
            maxlength="6"
            :value="pinConfirm"
            @input="onPinConfirm"
          />
          <button type="button" class="toggle" @click="confirmVisible = !confirmVisible">
            {{ confirmVisible ? 'ซ่อน' : 'แสดง' }}
          </button>
        </div>

        <p v-if="pin.length === 6 && !pinMatches" class="hint-error">PIN ทั้งสองช่องไม่ตรงกัน</p>
        <p v-else class="hint">ห้ามใช้เลขซ้ำกันทั้ง 6 หลัก หรือชุดตัวเลขเรียงกัน</p>

        <p v-if="errorMessage" class="alert">{{ errorMessage }}</p>

        <v-btn color="primary" class="submit" :disabled="!canSubmit" :loading="loading" @click="submit">
          บันทึก PIN ใหม่
        </v-btn>
      </section>
    </main>
  </div>
</template>

<style scoped>
.screen {
  min-height: 100vh;
  background: #f3f6f5;
}

.content {
  width: 100%;
  max-width: 440px;
  margin: 0 auto;
  padding: 24px 16px;
}

.card {
  background: #ffffff;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  padding: 24px;
}

.title {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 700;
  color: #12343b;
}

.sub {
  margin: 0 0 18px;
  font-size: 13px;
  color: #5c7176;
}

.label {
  display: block;
  margin: 14px 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: #12343b;
}

.field {
  display: flex;
  gap: 8px;
  align-items: center;
}

.input {
  flex: 1;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid #cfdcda;
  border-radius: 10px;
  background: #f8fbfa;
  color: #12343b;
  font-family: inherit;
  font-size: 18px;
  letter-spacing: 0.24em;
}

.toggle {
  border: none;
  background: none;
  padding: 0 4px;
  color: #10504e;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.hint {
  margin: 10px 0 0;
  font-size: 12.5px;
  color: #5c7176;
}

.hint-error {
  margin: 10px 0 0;
  font-size: 12.5px;
  color: #b3261e;
}

.alert {
  margin: 14px 0 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fdeceb;
  color: #b3261e;
  font-size: 13px;
}

.submit {
  margin-top: 18px;
}
</style>
