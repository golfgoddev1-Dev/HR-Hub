<script setup>
// Shown on the role's home page after login when the account already has leave
// notifications on but this browser has no subscription yet. It never asks for
// permission while rendering: the request runs only inside the button's click.
import { onMounted, ref } from 'vue'
import {
  autoEnablePush,
  browserSubscription,
  fetchNotificationStatus,
  notificationBannerState,
  pushSupported as detectPushSupport,
  requestAndSubscribe,
} from '../lib/push.js'

const DISMISS_KEY = 'hr-notification-banner-dismissed'

const state = ref('none')
const busy = ref(false)
const errorMessage = ref('')

function dismissed() {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function rememberDismissal() {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1')
  } catch {
    // Private mode without storage: the banner simply may show again.
  }
}

async function detect() {
  if (!detectPushSupport()) return

  let status = null
  try {
    status = await fetchNotificationStatus()
  } catch {
    return
  }

  const subscription = await browserSubscription()
  const next = notificationBannerState({
    enabled: status.enabled,
    permission: Notification.permission,
    hasSubscription: Boolean(subscription),
  })

  // A granted browser resumes silently; the banner is only for a decision the
  // person still has to make.
  if (next === 'auto') {
    await autoEnablePush()
    return
  }
  if (next === 'none' || dismissed()) return
  state.value = next
}

async function enable() {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''

  try {
    const result = await requestAndSubscribe()
    if (!result.ok) {
      errorMessage.value =
        result.reason === 'permission'
          ? 'ยังไม่ได้อนุญาตการแจ้งเตือน — เปิดได้ที่การตั้งค่าเบราว์เซอร์'
          : 'เปิดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่'
      return
    }
    state.value = 'none'
  } catch {
    errorMessage.value = 'เปิดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่'
  } finally {
    busy.value = false
  }
}

function dismiss() {
  rememberDismissal()
  state.value = 'none'
}

onMounted(detect)
</script>

<template>
  <section v-if="state !== 'none'" class="notify-banner" role="status">
    <div class="notify-banner-copy">
      <template v-if="state === 'prompt'">
        <p class="notify-banner-title">บัญชีนี้เปิดการแจ้งเตือนใบลาไว้ เปิดบนเครื่องนี้ด้วยหรือไม่</p>
        <p v-if="errorMessage" class="notify-banner-error" role="alert">{{ errorMessage }}</p>
        <div class="notify-banner-actions">
          <button type="button" class="notify-banner-btn" :disabled="busy" @click="enable">
            {{ busy ? 'กำลังเปิด…' : 'เปิดการแจ้งเตือน' }}
          </button>
          <button type="button" class="notify-banner-dismiss" :disabled="busy" @click="dismiss">
            ไว้ภายหลัง
          </button>
        </div>
      </template>

      <template v-else>
        <p class="notify-banner-title">เบราว์เซอร์นี้ปิดการแจ้งเตือนไว้</p>
        <p class="notify-banner-text">
          บัญชีนี้เปิดการแจ้งเตือนใบลาไว้ แต่เบราว์เซอร์บล็อกไว้อยู่ เปิดได้ที่การตั้งค่าเบราว์เซอร์
          → การแจ้งเตือน แล้วอนุญาตสำหรับหน้านี้
        </p>
        <div class="notify-banner-actions">
          <button type="button" class="notify-banner-dismiss" @click="dismiss">ปิด</button>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.notify-banner {
  display: flex;
  min-width: 0;
  gap: 12px;
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid #cfe0dc;
  border-radius: 14px;
  background: #eef7f4;
}

.notify-banner-copy {
  flex: 1;
  min-width: 0;
}

.notify-banner-title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 700;
  line-height: 1.55;
  color: #12343b;
  overflow-wrap: anywhere;
}

.notify-banner-text {
  margin: 4px 0 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: #5c7176;
  overflow-wrap: anywhere;
}

.notify-banner-error {
  margin: 6px 0 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: #a01b1b;
  overflow-wrap: anywhere;
}

.notify-banner-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.notify-banner-btn,
.notify-banner-dismiss {
  min-height: 36px;
  padding: 0 14px;
  border-radius: 9px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
}

.notify-banner-btn {
  background: #10504e;
  color: #ffffff;
}

.notify-banner-btn:hover:not(:disabled) {
  background: #0d423f;
}

.notify-banner-dismiss {
  background: #ffffff;
  border-color: #cfdcda;
  color: #10504e;
}

.notify-banner-btn:disabled,
.notify-banner-dismiss:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@media (max-width: 360px) {
  .notify-banner {
    padding: 12px;
  }

  .notify-banner-actions {
    flex-direction: column;
  }

  .notify-banner-btn,
  .notify-banner-dismiss {
    width: 100%;
  }
}
</style>
