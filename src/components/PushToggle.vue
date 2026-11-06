<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  autoEnablePush,
  browserSubscription,
  fetchNotificationStatus,
  iosNeedsInstall as detectIosNeedsInstall,
  notificationSwitchIsOn,
  pushSupported as detectPushSupport,
  requestAndSubscribe,
  unsubscribePush,
} from '../lib/push.js'

// Push is opt-in: nothing is requested until the user presses the button.
const supported = ref(false)
const iosNeedsInstall = ref(false)
const browserSubscribed = ref(false)
const serverSubscribed = ref(false)
const busy = ref(false)
const message = ref('')
const errorMessage = ref('')

// On only when this browser has a subscription AND the server has a row for
// this endpoint, bound to the signed-in employee.
const subscribed = computed(() =>
  notificationSwitchIsOn({
    browserSubscribed: browserSubscribed.value,
    serverSubscribed: serverSubscribed.value,
  })
)

function detect() {
  iosNeedsInstall.value = detectIosNeedsInstall()
  supported.value = detectPushSupport()
}

async function refresh() {
  if (!supported.value) return
  try {
    const subscription = await browserSubscription()
    const status = await fetchNotificationStatus(subscription?.endpoint ?? null)
    browserSubscribed.value = Boolean(subscription)
    serverSubscribed.value = status.subscribed
  } catch {
    browserSubscribed.value = false
    serverSubscribed.value = false
  }
}

async function enable() {
  if (busy.value) return
  busy.value = true
  message.value = ''
  errorMessage.value = ''

  try {
    const result = await requestAndSubscribe()
    if (!result.ok) {
      message.value =
        result.reason === 'permission'
          ? 'ยังไม่ได้อนุญาตการแจ้งเตือน — เปิดได้ที่การตั้งค่าเบราว์เซอร์'
          : result.reason === 'config'
            ? 'ยังไม่ได้ตั้งค่าการแจ้งเตือน'
            : 'เปิดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่'
      return
    }

    await refresh()
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
    const result = await unsubscribePush()
    if (!result.ok) {
      errorMessage.value = 'ปิดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่'
      return
    }

    await refresh()
    message.value = 'ปิดการแจ้งเตือนแล้ว'
  } catch {
    errorMessage.value = 'ปิดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่'
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  detect()
  if (!supported.value) return
  // Re-subscribe only for an account that already opted in, and only when the
  // browser has already granted permission. This never prompts.
  await autoEnablePush()
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
