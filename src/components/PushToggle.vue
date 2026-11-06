<script setup>
import { onMounted, ref } from 'vue'
import NotificationSwitch from './NotificationSwitch.vue'
import { getCached } from '../lib/data-cache.js'
import { DATA_KEYS, PAGE_TTL_MS, loaders } from '../lib/shared-data.js'
import {
  autoEnablePush,
  iosNeedsInstall as detectIosNeedsInstall,
  pushSupported as detectPushSupport,
  requestAndSubscribe,
  unsubscribePush,
} from '../lib/push.js'
import {
  NOTIFICATION_TOGGLE_MESSAGES,
  createNotificationToggle,
  readNotificationState,
  writeNotificationState,
} from '../lib/notification-toggle.js'

// The signed-out approver line is only shown to an approver; the account
// preference itself is one setting for everybody.
defineProps({
  approver: { type: Boolean, default: false },
})

const STATUS_TTL_MS = 60_000

// Push is opt-in: nothing is requested until the user presses the switch.
const supported = ref(false)
const iosNeedsInstall = ref(false)
// What the switch shows. It flips on tap and is corrected in the background.
const subscribed = ref(false)
const message = ref('')
const errorMessage = ref('')

// The signed-in employee id is only known after the cached profile read; until
// then nothing is stored, so another account's value can never be shown.
let employeeId = ''
// Started inside the tap handler, awaited by the background sync.
let permissionTask = null

const toggle = createNotificationToggle({
  sync: (desired) => syncNotificationState(desired),
  onState: (value) => {
    subscribed.value = value
  },
  onConfirm: (value) => {
    writeNotificationState(employeeId, value)
  },
  onNotice: (text) => {
    errorMessage.value = text
  },
})

function detect() {
  iosNeedsInstall.value = detectIosNeedsInstall()
  supported.value = detectPushSupport()
}

/**
 * The browser + server work for one intent. Runs in the background, never in
 * the tap handler, so the switch has already flipped when it starts.
 */
async function syncNotificationState(desired) {
  if (desired === false) {
    const result = await unsubscribePush()
    return result.ok ? { ok: true } : { ok: false, reason: 'server' }
  }

  const pending = permissionTask
  permissionTask = null
  const permission = await (pending ?? Promise.resolve(Notification.permission))
  if (permission !== 'granted') return { ok: false, reason: 'permission' }

  // Permission is already granted here, so this subscribes without prompting.
  const result = await requestAndSubscribe()
  if (result.ok) return { ok: true }
  return { ok: false, reason: result.reason === 'permission' ? 'permission' : 'server' }
}

/** Must run straight from the tap: no await may come before this call. */
function requestPermissionNow() {
  if (!supported.value) return Promise.resolve('unsupported')
  if (Notification.permission !== 'default') return Promise.resolve(Notification.permission)
  return Notification.requestPermission()
}

function togglePush() {
  const next = !subscribed.value
  // The switch flips here, before any network or browser work starts.
  toggle.request(next)
  if (!next) return
  // Still inside the click: the browser only prompts from a user gesture.
  permissionTask = requestPermissionNow()
}

async function accountId() {
  try {
    const data = await getCached(DATA_KEYS.profile, loaders.profile, { ttlMs: PAGE_TTL_MS })
    const profile = data?.profile ?? data
    return typeof profile?.id === 'string' ? profile.id : ''
  } catch {
    return ''
  }
}

/**
 * Confirms the painted value with the server in the background. The status read
 * is shared and brief, so a page visit costs at most one request a minute.
 */
async function verify() {
  let status
  try {
    status = await getCached(DATA_KEYS.notificationStatus, loaders.notificationStatus, {
      ttlMs: STATUS_TTL_MS,
    })
  } catch {
    return
  }
  if (typeof status?.enabled !== 'boolean') return
  if (status.enabled === subscribed.value) return
  if (toggle.adopt(status.enabled)) message.value = NOTIFICATION_TOGGLE_MESSAGES.updated
}

onMounted(async () => {
  detect()
  employeeId = await accountId()
  // Paint the last known value at once, then confirm it in the background.
  if (employeeId) toggle.seed(readNotificationState(employeeId))
  if (!supported.value) return
  void autoEnablePush()
  void verify()
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
