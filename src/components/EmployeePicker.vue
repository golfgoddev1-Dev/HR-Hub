<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'

// Shared employee search for the HR leave forms. It reads the existing
// /api/hr/directory/employees search route, which already re-checks the hr role
// and hr_admins membership on every call.
const props = defineProps({
  modelValue: { type: Object, default: null },
  label: { type: String, default: 'พนักงาน' },
  placeholder: { type: String, default: 'พิมพ์ชื่อหรือรหัสพนักงาน' },
})

const emit = defineEmits(['update:modelValue'])

const query = ref('')
const results = ref([])
const loading = ref(false)
const message = ref('')

let timer = null

async function search() {
  const text = query.value.replace(/\s+/g, ' ').trim()
  message.value = ''

  if (text.length < 2) {
    results.value = []
    if (text.length > 0) message.value = 'พิมพ์อย่างน้อย 2 ตัวอักษร'
    return
  }

  loading.value = true
  try {
    const response = await fetch(`/api/hr/directory/employees?q=${encodeURIComponent(text)}`, {
      credentials: 'same-origin',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      results.value = []
      message.value = typeof data.message === 'string' ? data.message : 'ค้นหาไม่สำเร็จ'
      return
    }
    results.value = Array.isArray(data.results) ? data.results : []
  } catch {
    results.value = []
    message.value = 'ค้นหาไม่สำเร็จ'
  } finally {
    loading.value = false
  }
}

watch(query, () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(search, 300)
})

function select(item) {
  emit('update:modelValue', item)
  query.value = ''
  results.value = []
}

function clear() {
  emit('update:modelValue', null)
}

function display(item) {
  const name = item?.fullName || '—'
  const prefix = item?.namePrefix
  const withPrefix = prefix && !name.startsWith(prefix) ? `${prefix} ${name}` : name
  return item?.employeeCode ? `${withPrefix} (${item.employeeCode})` : withPrefix
}

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div class="picker">
    <label class="label">{{ label }}</label>

    <div v-if="props.modelValue" class="selected">
      <span class="selected-name">{{ display(props.modelValue) }}</span>
      <button type="button" class="clear" @click="clear">เปลี่ยน</button>
    </div>

    <template v-else>
      <input
        v-model="query"
        class="input"
        type="search"
        :placeholder="placeholder"
        autocomplete="off"
      />
      <p v-if="message" class="hint">{{ message }}</p>
      <p v-else-if="loading" class="hint">กำลังค้นหา…</p>
      <ul v-if="results.length" class="results">
        <li v-for="item in results" :key="item.id">
          <button type="button" class="result" @click="select(item)">
            <span class="result-name">{{ display(item) }}</span>
            <span class="result-meta">{{ item.departmentName || 'ไม่ระบุแผนก' }}</span>
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.picker {
  margin-bottom: 16px;
}

.label {
  display: block;
  margin-bottom: 7px;
  font-size: 13.5px;
  font-weight: 600;
  color: #12343b;
}

.input {
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid #cfdcda;
  border-radius: 10px;
  background: #f8fbfa;
  color: #12343b;
  font-family: inherit;
  font-size: 14.5px;
}

.hint {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: #5c7176;
}

.selected {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #cfdcda;
  border-radius: 10px;
  background: #f2f7f5;
}

.selected-name {
  font-size: 14px;
  font-weight: 600;
  color: #12343b;
}

.clear {
  border: none;
  background: none;
  padding: 0;
  color: #10504e;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.results {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  border: 1px solid #e0e8e6;
  border-radius: 10px;
  overflow: hidden;
  background: #ffffff;
}

.results li + li {
  border-top: 1px solid #eef3f2;
}

.result {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: none;
  text-align: left;
  font-family: inherit;
  cursor: pointer;
}

.result:hover,
.result:focus-visible {
  background: #f4f8f7;
  outline: none;
}

.result-name {
  font-size: 14px;
  font-weight: 600;
  color: #12343b;
}

.result-meta {
  font-size: 12.5px;
  color: #5c7176;
}
</style>
