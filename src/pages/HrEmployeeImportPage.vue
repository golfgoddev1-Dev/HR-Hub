<script setup>
import { computed, ref } from 'vue'
import HrNav from '../components/HrNav.vue'

const MAX_FILE_BYTES = 2 * 1024 * 1024
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]
const LOAD_ERROR = 'ไม่สามารถตรวจไฟล์ได้ กรุณาลองใหม่'
const SAVE_ERROR = 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง'

const stage = ref('idle') // idle | checking | preview | saving | done
const errorMessage = ref('')
const fileError = ref('')
const selectedFile = ref(null)
const preview = ref(null)
const result = ref(null)
const decisions = ref({})

const summary = computed(() => preview.value?.summary ?? null)
const choices = computed(() => preview.value?.choices ?? [])
const uploaded = computed(() => selectedFile.value?.name ?? '')

function reset() {
  stage.value = 'idle'
  preview.value = null
  result.value = null
  decisions.value = {}
  errorMessage.value = ''
  fileError.value = ''
  selectedFile.value = null
}

async function checkFile(file) {
  if (!file) return 'ไม่พบไฟล์'
  if (file.size > MAX_FILE_BYTES) return 'ไฟล์ใหญ่เกิน 2 MB'
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.xlsm')) return 'ไม่รับไฟล์ .xlsm'
  if (!lower.endsWith('.xlsx') && !lower.endsWith('.csv')) return 'รับเฉพาะไฟล์ .xlsx หรือ .csv'

  const bytes = new Uint8Array(await file.arrayBuffer())
  const isZip = ZIP_SIGNATURE.every((byte, index) => bytes[index] === byte)
  const isXlsx = lower.endsWith('.xlsx')

  if (isXlsx && !isZip) return 'ไฟล์ .xlsx ต้องเป็นไฟล์ Excel ที่ถูกต้อง'
  if (!isXlsx) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      if (text.includes('\u0000') || isZip) return 'ไฟล์ .csv ต้องเป็นข้อความ UTF-8'
    } catch {
      return 'ไฟล์ .csv ต้องเป็นข้อความ UTF-8'
    }
  }
  return ''
}

async function onFileChange(event) {
  const file = event.target.files?.[0]
  if (!file) return
  errorMessage.value = ''
  fileError.value = ''
  preview.value = null
  result.value = null
  decisions.value = {}

  const problem = await checkFile(file)
  if (problem) {
    fileError.value = problem
    selectedFile.value = null
    return
  }

  selectedFile.value = file
  stage.value = 'checking'
  try {
    const form = new FormData()
    form.append('file', file)
    const response = await fetch('/api/hr/employees/import/preview', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      stage.value = 'idle'
      errorMessage.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
      return
    }
    preview.value = data
    const initial = {}
    for (const choice of data.choices ?? []) initial[choice.row] = 'keep'
    decisions.value = initial
    stage.value = 'preview'
  } catch {
    stage.value = 'idle'
    errorMessage.value = LOAD_ERROR
  }
}

async function confirmImport() {
  if (stage.value === 'saving' || !selectedFile.value) return
  stage.value = 'saving'
  errorMessage.value = ''
  try {
    const form = new FormData()
    form.append('file', selectedFile.value)
    form.append(
      'choices',
      JSON.stringify(
        Object.entries(decisions.value).map(([row, decision]) => ({ row: Number(row), decision }))
      )
    )
    const response = await fetch('/api/hr/employees/import/confirm', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      stage.value = 'preview'
      errorMessage.value = typeof data.message === 'string' ? data.message : SAVE_ERROR
      return
    }
    result.value = data
    stage.value = 'done'
  } catch {
    stage.value = 'preview'
    errorMessage.value = SAVE_ERROR
  }
}

function restart() {
  reset()
}

const choiceLabel = (value) => (value === 'file' ? 'ใช้ค่าจากไฟล์' : 'คงค่าเดิม')
</script>

<template>
  <div class="page">
    <HrNav />

    <main class="content">
      <div class="page-head">
        <div>
          <h1 class="page-title">นำเข้าข้อมูลพนักงาน</h1>
          <p class="page-sub">
            อัปโหลดไฟล์ .xlsx หรือ .csv เพื่อเพิ่มรายชื่อพนักงานเข้าสู่ระบบ
            ใช้หน้านี้ได้ทั้งการนำเข้าครั้งแรกและครั้งถัดไป
          </p>
        </div>
        <a class="template-link" href="/api/hr/employees/import/template">
          <v-icon icon="download" size="18" />
          ดาวน์โหลดเทมเพลต .xlsx
        </a>
      </div>

      <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-4">
        {{ errorMessage }}
      </v-alert>
      <v-alert v-if="fileError" type="warning" variant="tonal" class="mb-4">
        {{ fileError }}
      </v-alert>

      <section class="card">
        <h2 class="card-title">1. เลือกไฟล์</h2>
        <p class="hint">
          หัวคอลัมน์ต้องเรียงตามลำดับ: รหัสพนักงาน, คำนำหน้าชื่อ, ชื่อ, สกุล, แผนก, เลขที่บัตรประชาชน
          · ขนาดไม่เกิน 2 MB · ไม่เกิน 500 แถวข้อมูล · ไม่รับไฟล์ .xlsm หรือไฟล์ที่มี macro
        </p>

        <div class="file-row">
          <label class="file-pick">
            <input
              type="file"
              accept=".xlsx,.csv"
              :disabled="stage === 'checking' || stage === 'saving'"
              @change="onFileChange"
            />
            <span>เลือกไฟล์</span>
          </label>
          <span v-if="uploaded" class="file-name">{{ uploaded }}</span>
        </div>

        <p v-if="stage === 'checking'" class="hint">กำลังตรวจไฟล์…</p>
      </section>

      <section v-if="preview && summary" class="card">
        <h2 class="card-title">2. ตัวอย่างผลตรวจ</h2>

        <div class="stats">
          <div class="stat"><span class="stat-value">{{ summary.added }}</span><span class="stat-label">เพิ่มใหม่</span></div>
          <div class="stat"><span class="stat-value">{{ summary.updated }}</span><span class="stat-label">อัปเดต</span></div>
          <div class="stat"><span class="stat-value">{{ summary.needsChoice }}</span><span class="stat-label">ต้องให้เลือก</span></div>
          <div class="stat"><span class="stat-value">{{ summary.skipped }}</span><span class="stat-label">ข้าม</span></div>
          <div class="stat"><span class="stat-value">{{ summary.rejected }}</span><span class="stat-label">ปฏิเสธ</span></div>
        </div>

        <v-alert
          v-if="summary.needsChoice > 0"
          type="warning"
          variant="tonal"
          class="mb-4"
        >
          มี {{ summary.needsChoice }} แถวที่รหัสพนักงานมีอยู่แล้วแต่เลขบัตรไม่ตรงกัน
          กรุณาเลือกทีละแถวว่าใช้ค่าจากไฟล์หรือคงค่าเดิม (ค่าเริ่มต้นคือคงค่าเดิม)
        </v-alert>

        <div v-if="choices.length" class="block">
          <h3 class="block-title">แถวที่ต้องเลือก</h3>
          <div v-for="choice in choices" :key="choice.row" class="choice-row">
            <div class="choice-info">
              <div class="choice-main">แถว {{ choice.row }} · {{ choice.employeeCode }} · {{ choice.name }}</div>
              <div class="choice-sub">
                แผนก {{ choice.departmentName }} · เลขบัตรในไฟล์ {{ choice.fileIdMasked || '—' }}
                · เลขบัตรเดิม {{ choice.storedIdMasked || 'ไม่พร้อมแสดง' }}
              </div>
            </div>
            <div class="choice-actions">
              <label class="radio">
                <input v-model="decisions[choice.row]" type="radio" :value="'keep'" />
                <span>คงค่าเดิม</span>
              </label>
              <label class="radio">
                <input v-model="decisions[choice.row]" type="radio" :value="'file'" />
                <span>ใช้ค่าจากไฟล์</span>
              </label>
            </div>
          </div>
        </div>

        <div v-if="preview.adjustments?.length" class="block">
          <h3 class="block-title">ค่าที่ถูกปรับให้ตรงกับรายการในระบบ</h3>
          <ul class="plain-list">
            <li v-for="(item, index) in preview.adjustments" :key="index">
              แถว {{ item.row }} · {{ item.employeeCode }} · {{ item.field }}: จาก “{{ item.from }}” เป็น “{{ item.to }}”
            </li>
          </ul>
        </div>

        <div v-if="preview.skipped?.length" class="block">
          <h3 class="block-title">แถวที่ถูกข้าม ({{ preview.skipped.length }})</h3>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr><th>แถว</th><th>รหัสพนักงาน</th><th>ชื่อ-สกุล</th><th>เหตุผล</th></tr>
              </thead>
              <tbody>
                <tr v-for="item in preview.skipped" :key="`${item.row}-${item.employeeCode}`">
                  <td>{{ item.row }}</td>
                  <td>{{ item.employeeCode || '—' }}</td>
                  <td>{{ item.name || '—' }}</td>
                  <td>{{ item.reason }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-if="preview.added?.length" class="block">
          <h3 class="block-title">จะเพิ่ม {{ preview.added.length }} คน</h3>
          <ul class="plain-list">
            <li v-for="item in preview.added" :key="`add-${item.row}`">
              แถว {{ item.row }} · {{ item.employeeCode }} · {{ item.name }} · {{ item.departmentName }}
            </li>
          </ul>
        </div>

        <div v-if="preview.updated?.length" class="block">
          <h3 class="block-title">จะอัปเดต {{ preview.updated.length }} คน</h3>
          <ul class="plain-list">
            <li v-for="item in preview.updated" :key="`upd-${item.row}`">
              แถว {{ item.row }} · {{ item.employeeCode }} · {{ item.name }} · {{ item.departmentName }}
            </li>
          </ul>
        </div>

        <p class="hint">
          การตั้งค่าที่ใช้ตรวจไฟล์: ขนาดสูงสุด {{ Math.round(preview.settings.maxFileBytes / 1024 / 1024) }} MB ·
          สูงสุด {{ preview.settings.maxRows }} แถว ·
          ความยาวสูงสุด รหัส {{ preview.settings.maxLengths.employeeCode }},
          คำนำหน้า {{ preview.settings.maxLengths.prefix }},
          ชื่อ/สกุล {{ preview.settings.maxLengths.firstName }} / {{ preview.settings.maxLengths.lastName }},
          แผนก {{ preview.settings.maxLengths.department }} ตัวอักษร
        </p>

        <div class="actions">
          <v-btn
            color="primary"
            :disabled="stage === 'saving'"
            :loading="stage === 'saving'"
            @click="confirmImport"
          >
            ยืนยันการบันทึก
          </v-btn>
          <v-btn variant="text" :disabled="stage === 'saving'" @click="restart">
            เลือกไฟล์ใหม่
          </v-btn>
        </div>
      </section>

      <section v-if="result && result.summary" class="card">
        <h2 class="card-title">3. บันทึกเรียบร้อย</h2>
        <ul class="plain-list">
          <li>เพิ่มใหม่ {{ result.summary.added }} คน</li>
          <li>อัปเดต {{ result.summary.updated }} คน</li>
          <li>คงค่าเดิม {{ result.summary.keptExisting }} แถว</li>
          <li>ข้าม {{ result.summary.skipped }} แถว</li>
        </ul>

        <div v-if="result.skipped?.length" class="block">
          <h3 class="block-title">แถวที่ไม่ได้บันทึก</h3>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr><th>แถว</th><th>รหัสพนักงาน</th><th>ชื่อ-สกุล</th><th>เหตุผล</th></tr>
              </thead>
              <tbody>
                <tr v-for="item in result.skipped" :key="`res-${item.row}-${item.employeeCode}`">
                  <td>{{ item.row }}</td>
                  <td>{{ item.employeeCode || '—' }}</td>
                  <td>{{ item.name || '—' }}</td>
                  <td>{{ item.reason }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="actions">
          <v-btn variant="outlined" @click="restart">นำเข้าไฟล์อื่น</v-btn>
          <RouterLink to="/hr/employees/import">
            <v-btn variant="text">กลับไปหน้าเริ่มต้น</v-btn>
          </RouterLink>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f3f6f5;
}

.content {
  max-width: 1120px;
  margin: 0 auto;
  padding: 28px 20px 64px;
}

.page-head {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 20px;
}

.page-title {
  font-size: 26px;
  font-weight: 700;
  color: #12343b;
  margin: 0 0 6px;
}

.page-sub {
  margin: 0;
  max-width: 640px;
  color: #4c6167;
  font-size: 14px;
  line-height: 1.6;
}

.template-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border-radius: 10px;
  background: #ffffff;
  border: 1px solid #cfdcda;
  color: #10504e;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.card {
  background: #ffffff;
  border-radius: 14px;
  border: 1px solid #e0e8e6;
  padding: 20px;
  margin-bottom: 18px;
}

.card-title {
  font-size: 17px;
  font-weight: 700;
  color: #12343b;
  margin: 0 0 12px;
}

.hint {
  color: #5c7176;
  font-size: 13px;
  line-height: 1.7;
  margin: 8px 0;
}

.file-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
}

.file-pick {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 16px;
  border-radius: 10px;
  background: #0f3d3e;
  color: #ffffff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.file-pick input {
  display: none;
}

.file-name {
  font-size: 14px;
  color: #12343b;
  word-break: break-all;
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}

.stat {
  background: #f4f8f7;
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: #0f3d3e;
}

.stat-label {
  font-size: 12px;
  color: #5c7176;
}

.block {
  margin: 18px 0;
}

.block-title {
  font-size: 14px;
  font-weight: 700;
  color: #12343b;
  margin: 0 0 8px;
}

.plain-list {
  margin: 0;
  padding-left: 20px;
  font-size: 14px;
  line-height: 1.8;
  color: #29434a;
}

.table-wrap {
  overflow-x: auto;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.table th,
.table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid #e6edeb;
  vertical-align: top;
}

.table th {
  background: #f4f8f7;
  font-weight: 700;
  color: #12343b;
}

.choice-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: space-between;
  align-items: center;
  border: 1px solid #e6edeb;
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 8px;
}

.choice-main {
  font-size: 14px;
  font-weight: 600;
  color: #12343b;
}

.choice-sub {
  font-size: 12px;
  color: #5c7176;
  margin-top: 4px;
  line-height: 1.6;
}

.choice-actions {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}

.radio {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #29434a;
  cursor: pointer;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}
</style>
