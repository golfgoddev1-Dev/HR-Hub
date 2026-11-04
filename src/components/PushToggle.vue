<script setup>
import { onMounted, ref } from 'vue'

// Push is opt-in: nothing is requested until the user presses the button.
const supported = ref(false)
const iosNeedsInstall = ref(false)
const subscribed = ref(false)
const busy = ref(false)
const message = ref('')
const errorMessage = ref('')

function urlBase64ToUint8Array(base64Url) {
  const padded = base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
  return bytes
}

function detect() {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const standalone =
    navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  iosNeedsInstall.value = isIos && !standalone
  supported.value =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

async function registration() {
  const existing = await navigator.serviceWorker.getRegistration('/')
  if (existing) return existing
  return navigator.serviceWorker.register('/sw.js')
}

async function refresh() {
  if (!supported.value) return
  try {
    const reg = await navigator.serviceWorker.getRegistration('/')
    const subscription = reg ? await reg.pushManager.getSubscription() : null
    subscribed.value = Boolean(subscription)
  } catch {
    subscribed.value = false
  }
}

async function enable() {
  if (busy.value) return
  busy.value = true
  message.value = ''
  errorMessage.value = ''

  try {
    // Only here, after a real click, do we ask the browser for permission.
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      message.value = 'ยังไม่ได้อนุญาตการแจ้งเตือน — เปิดได้ที่การตั้งค่าเบราว์เซอร์'
      return
    }

    const keyResponse = await fetch('/api/notifications/vapid-public-key', {
      credentials: 'same-origin',
    })
    const keyData = await keyResponse.json().catch(() => ({}))
    if (!keyResponse.ok || keyData.ok !== true) {
      errorMessage.value = typeof keyData.message === 'string' ? keyData.message : 'ยังไม่ได้ตั้งค่าการแจ้งเตือน'
      return
    }

    const reg = await registration()
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
    })

    const json = subscription.toJSON()
    const response = await fetch('/api/notifications/subscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        userAgent: navigator.userAgent,
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      await subscription.unsubscribe().catch(() => {})
      errorMessage.value = typeof data.message === 'string' ? data.message : 'ลงทะเบียนแจ้งเตือนไม่สำเร็จ'
      return
    }

    subscribed.value = true
    message.value = 'เปิดการแจ้งเตือนแล้ว'
  } catch {
    errorMessage.value = 'เปิดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่'
  } finally {
    busy.value = false
  }
}

async function disable() {
  if (busy.value) return
  busy.value = true
  message.value = ''
  errorMessage.value = ''

  try {
    const reg = await navigator.serviceWorker.getRegistration('/')
    const subscription = reg ? await reg.pushManager.getSubscription() : null
    const endpoint = subscription ? subscription.endpoint : null
    if (subscription) await subscription.unsubscribe()

    if (endpoint) {
      await fetch('/api/notifications/unsubscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      })
    }

    subscribed.value = false
    message.value = 'ปิดการแจ้งเตือนแล้ว'
  } catch {
    errorMessage.value = 'ปิดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่'
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  detect()
  await refresh()
})
</script>

<template>
  <section class="push-card">
    <div class="push-copy">
      <h2 class="push-title">แจ้งเตือนใบลา</h2>

      <p v-if="iosNeedsInstall" class="push-text">
        บน iPhone/iPad ต้องเพิ่มหน้านี้ไปที่หน้าจอโฮมก่อน: เปิดใน Safari → ปุ่มแชร์ →
        “เพิ่มไปที่หน้าจอโฮม” แล้วเปิดจากไอคอนนั้นอีกครั้ง
      </p>
      <p v-else-if="!supported" class="push-text">
        เบราว์เซอร์นี้ยังไม่รองรับการแจ้งเตือนแบบ Web Push — ใช้ Chrome, Edge หรือ Safari
        เวอร์ชันใหม่บนมือถือหรือคอมพิวเตอร์
      </p>
      <p v-else class="push-text">
        เปิดเพื่อรับแจ้งเตือนเมื่อมีใบลารออนุมัติ หรือเมื่อใบลาของคุณได้รับการพิจารณา
        (ไม่ส่งรายละเอียดการลาหรือเหตุผล)
      </p>
    </div>

    <div v-if="supported && !iosNeedsInstall" class="push-actions">
      <button v-if="!subscribed" type="button" class="push-btn" :disabled="busy" @click="enable">
        {{ busy ? 'กำลังเปิด…' : 'เปิดการแจ้งเตือน' }}
      </button>
      <button v-else type="button" class="push-btn push-btn-off" :disabled="busy" @click="disable">
        {{ busy ? 'กำลังปิด…' : 'ยกเลิกการแจ้งเตือน' }}
      </button>

      <p v-if="message" class="push-hint">{{ message }}</p>
      <p v-if="errorMessage" class="push-hint push-error" role="alert">{{ errorMessage }}</p>
    </div>
  </section>
</template>

<style scoped>
.push-card {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding: 16px 20px;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  background: #ffffff;
}

.push-copy {
  min-width: 240px;
  flex: 1 1 320px;
}

.push-title {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 700;
  color: #12343b;
}

.push-text {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: #5c7176;
}

.push-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}

.push-btn {
  min-height: 42px;
  padding: 0 18px;
  border: 0;
  border-radius: 10px;
  background: #10504e;
  color: #ffffff;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
}

.push-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.push-btn-off {
  background: #ffffff;
  color: #12343b;
  border: 1px solid #cfdcda;
}

.push-hint {
  margin: 0;
  font-size: 12px;
  color: #5c7176;
}

.push-error {
  color: #a01b1b;
}
</style>
