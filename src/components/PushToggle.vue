<script setup>
import { computed, onMounted, ref } from 'vue'
import NotificationSwitch from './NotificationSwitch.vue'
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

// The signed-out approver line is only shown to an approver; the account
// preference itself is one setting for everybody.
defineProps({
  approver: { type: Boolean, default: false },
})

// Push is opt-in: nothing is requested until the user presses the switch.
const supported = ref(false)
const iosNeedsInstall = ref(false)
const browserSubscribed = ref(false)
const serverSubscribed = ref(false)
const busy = ref(false)
const message = ref('')
const errorMessage = ref('')

// On only when this browser has a subscription AND the server has the account
// preference on for the signed-in employee.
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

function togglePush() {
  if (busy.value) return
  return subscribed.value ? disable() : enable()
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
  <section class="push-card push-row">
    <div class="push-copy">
      <h2 class="push-title">การแจ้งเตือนใบลา</h2>

      <p class="push-text">
        เปิดเพื่อรับแจ้งเตือนเมื่อมีใบลารออนุมัติ หรือเมื่อใบลาของคุณได้รับการพิจารณา ไม่ส่งรายละเอียดการลาหรือเหตุผล
      </p>
      <p v-if="approver" class="push-text">
        หากคุณเป็นผู้อนุมัติ ระบบจะส่งเฉพาะจำนวนรายการรออนุมัติแม้ออกจากระบบแล้ว โดยไม่มีชื่อหรือรายละเอียด
      </p>
      <p v-if="iosNeedsInstall" class="push-warning">
        บน iPhone/iPad ต้องเพิ่มหน้านี้ไปที่หน้าจอโฮมก่อน: เปิดใน Safari → ปุ่มแชร์ →
        “เพิ่มไปที่หน้าจอโฮม” แล้วเปิดจากไอคอนนั้นอีกครั้ง
      </p>
      <p v-else-if="!supported" class="push-warning">
        เบราว์เซอร์นี้ยังไม่รองรับการแจ้งเตือนแบบ Web Push — ใช้ Chrome, Edge หรือ Safari
        เวอร์ชันใหม่บนมือถือหรือคอมพิวเตอร์
      </p>

      <p v-if="message" class="push-hint">{{ message }}</p>
      <p v-if="errorMessage" class="push-hint push-error" role="alert">{{ errorMessage }}</p>
    </div>

    <NotificationSwitch
      :checked="subscribed"
      :disabled="!supported || iosNeedsInstall"
      :busy="busy"
      label="การแจ้งเตือนใบลา"
      @toggle="togglePush"
    />
  </section>
</template>

<style scoped>
.push-row {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.push-card {
  margin-bottom: 16px;
  padding: 16px 20px;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  background: #ffffff;
}

.push-copy {
  flex: 1;
  min-width: 0;
}

.push-title {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 700;
  color: #12343b;
  overflow-wrap: anywhere;
}

.push-text {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: #5c7176;
  overflow-wrap: anywhere;
}

.push-text + .push-text {
  margin-top: 4px;
}

.push-warning {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.55;
  color: #a05b06;
}

.push-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #5c7176;
}

.push-error {
  color: #a01b1b;
}

@media (max-width: 360px) {
  .push-card {
    padding: 14px;
  }

  .push-row {
    gap: 10px;
  }
}
</style>
