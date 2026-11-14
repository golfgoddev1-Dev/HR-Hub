<script setup>
// "เมนูที่ใช้บ่อย": the HR person picks 1 to 5 HR menus for their own home page.
// The saved order is the order they picked; the counter and the disabled states
// are the only guards the person sees, and the Worker checks the same rules.
import { computed, ref, watch } from 'vue'
import { putJson } from '../api.js'
import { invalidateProfile } from '../lib/shared-data.js'
import {
  MAX_SHORTCUTS,
  MIN_SHORTCUTS,
  normaliseHrShortcuts,
  selectableHrMenus,
} from '../lib/hr-menu-shortcuts.js'

const props = defineProps({
  saved: { type: Array, default: () => [] },
})

const choices = selectableHrMenus()
const selected = ref(normaliseHrShortcuts(props.saved))
const saving = ref(false)
const errorMessage = ref('')
const notice = ref('')

watch(
  () => props.saved,
  (value) => {
    selected.value = normaliseHrShortcuts(value)
  }
)

const atMax = computed(() => selected.value.length >= MAX_SHORTCUTS)
const atMin = computed(() => selected.value.length <= MIN_SHORTCUTS)
const canSave = computed(() => !saving.value)
const chosenRows = computed(() =>
  selected.value.map((route) => choices.find((choice) => choice.to === route)).filter(Boolean)
)
const chosenSet = computed(() => new Set(selected.value))

function isChosen(route) {
  return chosenSet.value.has(route)
}

function add(route) {
  if (isChosen(route) || atMax.value) return
  selected.value = [...selected.value, route]
  notice.value = ''
}

function remove(route) {
  if (atMin.value) return
  selected.value = selected.value.filter((entry) => entry !== route)
  notice.value = ''
}

async function save() {
  if (saving.value) return
  saving.value = true
  errorMessage.value = ''
  notice.value = ''
  try {
    const { status, data } = await putJson('/api/profile/hr-menus', {
      menus: selected.value,
    })
    if (status === 200 && data.ok === true) {
      selected.value = normaliseHrShortcuts(data.menus)
      // The home page reads the same profile loader, so the next visit shows it.
      invalidateProfile()
      notice.value = 'บันทึกแล้ว'
      return
    }
    errorMessage.value =
      typeof data.message === 'string' && data.message.length > 0
        ? data.message
        : 'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง'
  } catch {
    errorMessage.value = 'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="shortcuts" aria-labelledby="hr-menus-title">
    <div class="head">
      <h2 id="hr-menus-title" class="title">เมนูที่ใช้บ่อย</h2>
      <p class="counter" data-shortcut-counter>
        เลือกแล้ว {{ selected.length }} จาก {{ MAX_SHORTCUTS }} เมนู
      </p>
    </div>
    <p class="lead">เลือก {{ MIN_SHORTCUTS }} ถึง {{ MAX_SHORTCUTS }} เมนูที่จะขึ้นเป็นการ์ดบนหน้าหลักของคุณ</p>

    <ol v-if="chosenRows.length" class="chosen" aria-label="เมนูที่เลือกไว้ตามลำดับ">
      <li v-for="(row, index) in chosenRows" :key="row.to" class="chosen-row">
        <span class="chosen-index" aria-hidden="true">{{ index + 1 }}</span>
        <span class="chosen-label">{{ row.label }}</span>
        <button
          type="button"
          class="remove"
          :disabled="atMin"
          :aria-label="`เอา ${row.label} ออกจากเมนูที่ใช้บ่อย`"
          @click="remove(row.to)"
        >
          เอาออก
        </button>
      </li>
    </ol>

    <p v-if="atMin" class="note">ต้องมีอย่างน้อย {{ MIN_SHORTCUTS }} เมนู</p>
    <p v-else-if="atMax" class="note">ครบ {{ MAX_SHORTCUTS }} เมนูแล้ว เอาอันเดิมออกก่อนจึงจะเพิ่มได้</p>

    <ul class="choices" aria-label="เมนูของฝ่ายบุคคล">
      <li v-for="choice in choices" :key="choice.to">
        <button
          type="button"
          class="choice"
          :class="{ 'is-chosen': isChosen(choice.to) }"
          :aria-pressed="isChosen(choice.to)"
          :disabled="!isChosen(choice.to) && atMax"
          @click="isChosen(choice.to) ? remove(choice.to) : add(choice.to)"
        >
          <span class="choice-copy">
            <span class="choice-label">{{ choice.label }}</span>
            <span class="choice-desc">{{ choice.description }}</span>
          </span>
          <span class="choice-mark" aria-hidden="true">{{ isChosen(choice.to) ? 'เลือกแล้ว' : 'เลือก' }}</span>
        </button>
      </li>
    </ul>

    <div class="foot">
      <button type="button" class="save" :disabled="!canSave" @click="save">
        {{ saving ? 'กำลังบันทึก…' : 'บันทึกเมนูที่ใช้บ่อย' }}
      </button>
      <p v-if="notice" class="status" role="status">{{ notice }}</p>
    </div>

    <div v-if="errorMessage" class="error" role="alert">
      <p class="error-text">{{ errorMessage }}</p>
      <p class="error-fix">เลือก {{ MIN_SHORTCUTS }} ถึง {{ MAX_SHORTCUTS }} เมนูที่ไม่ซ้ำกัน แล้วกดบันทึกอีกครั้ง</p>
    </div>
  </section>
</template>

<style scoped>
/* Palette (this page is a plain white card, not glass):
   #12343b ink 11.0:1 on white, #5c7176 secondary 5.0:1, #4338ca action 7.0:1,
   #8b5cf6 focus ring only, #e0e8e6 border, #eef2ff chosen wash. */
.shortcuts {
  --tap: 44px;
  margin: 18px 0 0;
  padding: 18px 20px;
  background: #ffffff;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
}

.head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: baseline;
  justify-content: space-between;
}

.title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #12343b;
}

.counter {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #5c7176;
  font-variant-numeric: tabular-nums;
}

.lead {
  margin: 6px 0 14px;
  font-size: 14px;
  line-height: 1.6;
  color: #5c7176;
}

.chosen {
  display: grid;
  gap: 8px;
  margin: 0 0 10px;
  padding: 0;
  list-style: none;
}

.chosen-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: var(--tap);
  padding: 6px 10px;
  border-radius: 10px;
  background: #eef2ff;
}

.chosen-index {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #ffffff;
  color: #4338ca;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.chosen-label {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  color: #12343b;
  overflow-wrap: anywhere;
}

.remove,
.save,
.choice {
  font-family: inherit;
  cursor: pointer;
}

.remove {
  min-width: 72px;
  min-height: var(--tap);
  padding: 0 12px;
  border: 1px solid #e0e8e6;
  border-radius: 10px;
  background: #ffffff;
  color: #a01b1b;
  font-size: 13px;
  font-weight: 600;
}

.remove:disabled,
.choice:disabled,
.save:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.note {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: #5c7176;
}

.choices {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.choice {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: var(--tap);
  padding: 10px 12px;
  border: 1px solid #e0e8e6;
  border-radius: 12px;
  background: #ffffff;
  text-align: left;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease;
}

.choice.is-chosen {
  background: #eef2ff;
  border-color: #4338ca;
}

.choice-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.choice-label {
  font-size: 15px;
  font-weight: 600;
  color: #12343b;
}

.choice-desc {
  font-size: 13px;
  line-height: 1.5;
  color: #5c7176;
  overflow-wrap: anywhere;
}

.choice-mark {
  font-size: 13px;
  font-weight: 700;
  color: #4338ca;
  white-space: nowrap;
}

.foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

.save {
  min-height: var(--tap);
  padding: 0 18px;
  border: 1px solid #4338ca;
  border-radius: 12px;
  background: #4f46e5;
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
}

.status {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #1c6b3f;
}

.error {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid #a01b1b;
  border-radius: 12px;
  background: #fdecec;
}

.error-text {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #a01b1b;
}

.error-fix {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.55;
  color: #7f1616;
}

.choice:focus-visible,
.remove:focus-visible,
.save:focus-visible {
  outline: 2px solid #8b5cf6;
  outline-offset: 2px;
}

@media (hover: hover) and (pointer: fine) {
  .choice:hover {
    border-color: #4338ca;
  }

  .save:hover {
    background: #4338ca;
  }
}

@media (max-width: 520px) {
  .shortcuts {
    padding: 14px;
  }

  .choice {
    grid-template-columns: minmax(0, 1fr);
  }

  .choice-mark {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .choice {
    transition: none;
  }
}
</style>
