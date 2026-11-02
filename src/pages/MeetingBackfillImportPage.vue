<script setup>
import { computed, ref } from 'vue'
import * as XLSX from 'xlsx'
import ControllerNav from '../components/ControllerNav.vue'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const BATCH_ROWS = 500
const LOAD_ERROR = 'ไม่สามารถตรวจไฟล์ได้ กรุณาลองใหม่'
const SAVE_ERROR = 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง'
const HEADERS = [
  'ประเภทการประชุม',
  'วันที่ประชุม',
  'เวลา',
  'สถานที่',
  'ชื่อพนักงาน',
  'สถานะ',
  'กะที่ลา',
  'แผนก',
  'ระดับ',
  'รหัสการประชุม',
  'ตรวจสอบ',
  'เหตุผล',
]

// Mirrors the Worker's matching rule: exact full name first, then the name with
// its leading prefix removed. More than one match is never guessed.
const PREFIXES = ['นางสาว', 'เด็กหญิง', 'เด็กชาย', 'ด.ช.', 'ด.ญ.', 'นาย', 'นาง', 'Mr.', 'Mrs.', 'Ms.']

const stage = ref('idle') // idle | checking | preview | saving | done
const errorMessage = ref('')
const fileError = ref('')
const selectedFile = ref(null)
const preview = ref(null)
const result = ref(null)
const decisions = ref({})
const batchCount = ref(0)
const employees = ref([])
const employeeError = ref('')
const prepared = ref(null)

const summary = computed(() => preview.value?.summary ?? null)
const rounds = computed(() => preview.value?.rounds ?? [])
const conflicts = computed(() => rounds.value.filter((round) => round.mode === 'conflict' || round.mode === 'joined'))

function reset() {
  stage.value = 'idle'
  preview.value = null
  result.value = null
  decisions.value = {}
  errorMessage.value = ''
  fileError.value = ''
  selectedFile.value = null
  batchCount.value = 0
}

function cellText(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    const day = String(value.getUTCDate()).padStart(2, '0')
    const month = String(value.getUTCMonth() + 1).padStart(2, '0')
    return `${day}/${month}/${value.getUTCFullYear()}`
  }
  return String(value).replace(/\s+/g, ' ').trim()
}

/** Reads the first worksheet into rows plus their real Excel row numbers. */
function readWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
  const sheetName = workbook.SheetNames[0]
  const sheet = sheetName ? workbook.Sheets[sheetName] : null
  if (!sheet || !sheet['!ref']) return { error: 'ไม่พบข้อมูลในไฟล์' }

  const range = XLSX.utils.decode_range(sheet['!ref'])
  const lastColumn = Math.max(range.e.c, HEADERS.length - 1)
  const readRow = (rowIndex) => {
    const cells = []
    for (let column = 0; column <= lastColumn; column += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: column })]
      const text = cell ? cellText(cell.v) : ''
      cells.push(column === 2 ? toHhmm(text) : text)
    }
    return cells
  }

  const header = readRow(range.s.r)
  for (let index = 0; index < 7; index += 1) {
    if (header[index] !== HEADERS[index]) {
      return { error: 'หัวคอลัมน์ไม่ตรงกับเทมเพลต (ต้องมี A–G ครบตามลำดับ)' }
    }
  }

  const rows = []
  for (let rowIndex = range.s.r + 1; rowIndex <= range.e.r; rowIndex += 1) {
    const cells = readRow(rowIndex)
    if (!cells.some((value) => value !== '')) continue
    rows.push({ rowNumber: rowIndex + 1, cells })
  }
  if (rows.length === 0) return { error: 'ไม่พบแถวข้อมูลในไฟล์' }
  return { rows }
}

// Mirrors the Worker time reader: HH:mm, HH:mm:ss and the Excel day fraction
// (0.375) all become HH:mm. Anything else is left as typed so the Worker can
// refuse the row with its own reason.
function toHhmm(value) {
  const text = String(value ?? '').trim()
  if (text === '') return ''
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (clock) {
    const hour = Number(clock[1])
    const minute = Number(clock[2])
    const second = clock[3] === undefined ? 0 : Number(clock[3])
    if (hour <= 23 && minute <= 59 && second <= 59) {
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    }
    return text
  }
  const fraction = /^(?:0)?\.(\d{1,15})$/.exec(text)
  if (fraction) {
    const minutes = Math.round(Number(`0.${fraction[1]}`) * 1440) % 1440
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  }
  return text
}

function batchOf(rows, index) {
  const slice = rows.slice(index * BATCH_ROWS, index * BATCH_ROWS + BATCH_ROWS)
  return {
    rows: slice.map((row) => row.cells),
    rowNumbers: slice.map((row) => row.rowNumber),
    employeeIds: slice.map((row) => row.employeeId),
    startRow: slice[0].rowNumber,
  }
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  return { ok: response.ok && data.ok === true, data }
}

async function checkFile(file) {
  if (!file) return 'ไม่พบไฟล์'
  if (file.size > MAX_FILE_BYTES) return 'ไฟล์ใหญ่เกิน 5 MB'
  if (!file.name.toLowerCase().endsWith('.xlsx')) return 'รับเฉพาะไฟล์ .xlsx'
  return ''
}

const normalizeName = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

function stripPrefix(name) {
  for (const prefix of PREFIXES) {
    if (name.startsWith(`${prefix} `)) return name.slice(prefix.length + 1).trim()
  }
  return name
}

async function loadEmployees() {
  if (employees.value.length > 0) return true
  employeeError.value = ''
  try {
    const response = await fetch('/api/meeting/backfill/employees', { credentials: 'same-origin' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      employeeError.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
      return false
    }
    employees.value = data.employees ?? []
    if (employees.value.length === 0) {
      employeeError.value = 'ไม่พบรายชื่อพนักงานที่ใช้งานอยู่ในระบบ'
      return false
    }
    return true
  } catch {
    employeeError.value = LOAD_ERROR
    return false
  }
}

/** Returns { ok: true, id } or { ok: false, reason } for one name cell. */
function matchEmployee(rawName) {
  const name = normalizeName(rawName)
  if (name === '') return { ok: false, reason: 'ต้องระบุชื่อพนักงาน' }

  const exact = employees.value.filter((row) => normalizeName(row.full_name) === name)
  if (exact.length === 1) return { ok: true, id: exact[0].id }
  if (exact.length > 1) return { ok: false, reason: `ชื่อพนักงานตรงกับมากกว่า 1 คน (พบ: ${name})` }

  const wanted = stripPrefix(name)
  const loose = employees.value.filter((row) => stripPrefix(normalizeName(row.full_name)) === wanted)
  if (loose.length === 1) return { ok: true, id: loose[0].id }
  if (loose.length > 1) return { ok: false, reason: `ชื่อพนักงานตรงกับมากกว่า 1 คน (พบ: ${name})` }
  return { ok: false, reason: `ไม่พบชื่อพนักงานในระบบ (พบ: ${name})` }
}

function seedDecisions(data) {
  const next = { ...decisions.value }
  for (const round of data.rounds ?? []) {
    if (next[round.key]) continue
    next[round.key] = round.mode === 'joined' ? 'join' : 'skip'
  }
  decisions.value = next
}

function emptySummary() {
  return {
    dataRows: 0,
    rounds: 0,
    newRounds: 0,
    existingRounds: 0,
    joinedRounds: 0,
    conflictRounds: 0,
    needsDecision: 0,
    pendingRows: 0,
    writeRounds: 0,
    writeRows: 0,
    skipped: 0,
  }
}

function mergeRounds(store, incoming) {
  for (const round of incoming) {
    const current = store.get(round.key)
    if (!current) {
      store.set(round.key, JSON.parse(JSON.stringify(round)))
      continue
    }
    current.rows += round.rows
    current.fileRows += round.fileRows
    for (const key of ['attended', 'leave', 'not_attended', 'urgent_busy']) {
      current.statusCounts[key] += round.statusCounts[key]
    }
    current.shiftCounts['กะ A'] += round.shiftCounts['กะ A']
    current.shiftCounts['กะ B'] += round.shiftCounts['กะ B']
    if (round.mode === 'conflict' || current.mode !== 'conflict') current.mode = round.mode === 'conflict' ? 'conflict' : current.mode
  }
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
    const workbook = readWorkbook(await file.arrayBuffer())
    if (workbook.error) {
      stage.value = 'idle'
      fileError.value = workbook.error
      return
    }
    if (workbook.rows.length > 5000) {
      stage.value = 'idle'
      fileError.value = 'ไฟล์มีข้อมูลเกิน 5,000 แถว กรุณาแบ่งไฟล์'
      return
    }

    if (!(await loadEmployees())) {
      stage.value = 'idle'
      errorMessage.value = employeeError.value
      return
    }

    const matched = []
    const unmatched = []
    for (const row of workbook.rows) {
      const result = matchEmployee(row.cells[4])
      if (!result.ok) {
        unmatched.push({ row: row.rowNumber, typeName: row.cells[0] ?? '', dateIso: '', name: row.cells[4] ?? '', reason: result.reason })
        continue
      }
      matched.push({ ...row, employeeId: result.id })
    }

    if (matched.length === 0) {
      stage.value = 'idle'
      errorMessage.value = 'ไม่มีแถวที่จับคู่ชื่อพนักงานในระบบได้'
      return
    }

    prepared.value = { matched, unmatched }
    const total = Math.ceil(matched.length / BATCH_ROWS)
    batchCount.value = total
    const merged = new Map()
    const skipped = [...unmatched]
    const totals = emptySummary()
    totals.skipped = unmatched.length

    for (let index = 0; index < total; index += 1) {
      const batch = batchOf(matched, index)
      const { ok, data } = await postJson('/api/meeting/backfill/preview-batch', {
        fileName: file.name,
        startRow: batch.startRow,
        rowNumbers: batch.rowNumbers,
        rows: batch.rows,
        employeeIds: batch.employeeIds,
      })
      if (!ok) {
        stage.value = 'idle'
        errorMessage.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
        return
      }
      for (const key of Object.keys(totals)) totals[key] += Number(data.summary?.[key] ?? 0)
      mergeRounds(merged, data.rounds ?? [])
      for (const item of data.skipped ?? []) {
        if (skipped.length < 500) skipped.push(item)
      }
      seedDecisions(data)
    }

    totals.rounds = merged.size
    totals.dataRows = workbook.rows.length
    totals.skipped += Math.max(0, skipped.length - unmatched.length)
    preview.value = {
      fileName: file.name,
      summary: totals,
      rounds: [...merged.values()].sort((a, b) => (a.dateIso === b.dateIso ? a.time.localeCompare(b.time) : a.dateIso.localeCompare(b.dateIso))),
      skipped,
    }
    stage.value = 'preview'
  } catch {
    stage.value = 'idle'
    errorMessage.value = LOAD_ERROR
  }
}

async function confirmImport() {
  if (stage.value === 'saving' || !selectedFile.value || !preview.value || !prepared.value) return
  stage.value = 'saving'
  errorMessage.value = ''

  try {
    const { matched, unmatched } = prepared.value
    const total = Math.ceil(matched.length / BATCH_ROWS)
    const decisionList = Object.entries(decisions.value).map(([key, decision]) => ({
      key,
      decision: decision === 'join' ? 'join' : 'skip',
    }))
    const aggregate = {
      sessionsCreated: 0,
      sessionsReused: 0,
      attendanceWritten: 0,
      conflictsSkipped: 0,
      skipped: unmatched.length,
      skippedRows: [...unmatched],
    }

    for (let index = 0; index < total; index += 1) {
      const batch = batchOf(matched, index)
      const last = index === total - 1
      const { ok, data } = await postJson('/api/meeting/backfill/confirm-batch', {
        fileName: selectedFile.value.name,
        startRow: batch.startRow,
        rowNumbers: batch.rowNumbers,
        rows: batch.rows,
        employeeIds: batch.employeeIds,
        decisions: decisionList,
        final: last,
        totals: last
          ? {
              rounds: preview.value.summary.writeRounds,
              sessionsCreated: preview.value.summary.newRounds,
              sessionsReused: preview.value.summary.existingRounds + preview.value.summary.joinedRounds,
              attendance: preview.value.summary.writeRows,
              skipped: preview.value.summary.skipped,
              conflictsSkipped: preview.value.summary.conflictRounds,
            }
          : undefined,
      })
      if (!ok) {
        stage.value = 'preview'
        errorMessage.value = typeof data.message === 'string' ? data.message : SAVE_ERROR
        return
      }
      aggregate.sessionsCreated += data.summary?.sessionsCreated ?? 0
      aggregate.sessionsReused += data.summary?.sessionsReused ?? 0
      aggregate.attendanceWritten += data.summary?.attendanceWritten ?? 0
      aggregate.conflictsSkipped += data.summary?.conflictsSkipped ?? 0
      aggregate.skipped += data.summary?.skipped ?? 0
      for (const item of data.summary?.skippedRows ?? []) {
        if (aggregate.skippedRows.length < 500) aggregate.skippedRows.push(item)
      }
    }

    result.value = { summary: aggregate }
    stage.value = 'done'
  } catch {
    stage.value = 'preview'
    errorMessage.value = SAVE_ERROR
  }
}

const modeLabel = (mode) =>
  ({ new: 'รอบใหม่', existing: 'มีรอบอยู่แล้ว', joined: 'รวมเข้ารอบเดิม', conflict: 'รอบซ้ำ ต้องเลือก' })[mode] ?? mode
</script>

<template>
  <div class="page">
    <ControllerNav />

    <main class="content">
      <div class="page-head">
        <div>
          <h1 class="page-title">นำเข้าข้อมูลย้อนหลัง</h1>
          <p class="page-sub">
            อัปโหลดไฟล์ .xlsx ตามเทมเพลตเพื่อบันทึกการเข้าร่วมประชุมย้อนหลัง
            เบราว์เซอร์อ่านไฟล์และส่งให้เซิร์ฟเวอร์ตรวจทีละ 500 แถว
          </p>
        </div>
        <a class="template-link" href="/api/meeting/backfill/template">
          <v-icon icon="download" size="18" />
          ดาวน์โหลดเทมเพลต .xlsx
        </a>
      </div>

      <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-4">{{ errorMessage }}</v-alert>
      <v-alert v-if="fileError" type="warning" variant="tonal" class="mb-4">{{ fileError }}</v-alert>

      <section class="card">
        <h2 class="card-title">1. เลือกไฟล์</h2>
        <p class="hint">
          หัวคอลัมน์ A–L ตามเทมเพลต: ประเภทการประชุม, วันที่ประชุม, เวลา, สถานที่, ชื่อพนักงาน, สถานะ,
          กะที่ลา, แผนก, ระดับ, รหัสการประชุม, ตรวจสอบ, เหตุผล · ไม่เกิน 5 MB · ไม่เกิน 5,000 แถว ·
          รับเฉพาะ .xlsx
        </p>

        <div class="file-row">
          <label class="file-pick">
            <input
              type="file"
              accept=".xlsx"
              :disabled="stage === 'checking' || stage === 'saving'"
              @change="onFileChange"
            />
            <span>เลือกไฟล์</span>
          </label>
          <span v-if="selectedFile" class="file-name">{{ selectedFile.name }}</span>
        </div>

        <p v-if="stage === 'checking'" class="hint">
          กำลังตรวจไฟล์… {{ batchCount > 1 ? `(ส่งตรวจ ${batchCount} ชุด ชุดละไม่เกิน 500 แถว)` : '' }}
        </p>
      </section>

      <section v-if="preview && summary" class="card">
        <h2 class="card-title">2. ตัวอย่างผลตรวจ</h2>

        <div class="stats">
          <div class="stat"><span class="stat-value">{{ summary.dataRows }}</span><span class="stat-label">แถวในไฟล์</span></div>
          <div class="stat"><span class="stat-value">{{ summary.rounds }}</span><span class="stat-label">รอบ</span></div>
          <div class="stat"><span class="stat-value">{{ summary.newRounds }}</span><span class="stat-label">รอบใหม่</span></div>
          <div class="stat"><span class="stat-value">{{ summary.existingRounds }}</span><span class="stat-label">รอบที่มีอยู่แล้ว</span></div>
          <div class="stat"><span class="stat-value">{{ summary.conflictRounds }}</span><span class="stat-label">รอบซ้ำต้องเลือก</span></div>
          <div class="stat"><span class="stat-value">{{ summary.writeRows }}</span><span class="stat-label">แถวที่จะบันทึก</span></div>
          <div class="stat"><span class="stat-value">{{ summary.skipped }}</span><span class="stat-label">แถวที่ข้าม</span></div>
        </div>

        <v-alert v-if="summary.conflictRounds > 0" type="warning" variant="tonal" class="mb-4">
          มี {{ summary.conflictRounds }} รอบที่ประเภทและวันเดียวกับรอบในระบบแต่เวลา/สถานที่ต่างกัน
          เลือกได้ว่าจะเพิ่มคนเข้ารอบเดิมหรือข้ามรอบนี้ (ค่าเริ่มต้นคือข้าม)
        </v-alert>

        <div v-if="conflicts.length" class="block">
          <h3 class="block-title">รอบที่ต้องเลือก</h3>
          <div v-for="round in conflicts" :key="round.key" class="choice-row">
            <div class="choice-info">
              <div class="choice-main">
                {{ round.typeName }} · {{ round.dateIso }} · ไฟล์ระบุ {{ round.time }} ·
                {{ round.location || 'ไม่ระบุสถานที่' }}
              </div>
              <div class="choice-sub">
                ในระบบ: {{ round.existing?.time || 'ไม่ระบุเวลา' }} ·
                {{ round.existing?.location || 'ไม่ระบุสถานที่' }} · {{ round.fileRows }} แถวในไฟล์
              </div>
            </div>
            <div class="choice-actions">
              <label class="radio">
                <input v-model="decisions[round.key]" type="radio" value="skip" />
                <span>ข้ามรอบนี้</span>
              </label>
              <label class="radio">
                <input v-model="decisions[round.key]" type="radio" value="join" />
                <span>เพิ่มคนเข้ารอบเดิม</span>
              </label>
            </div>
          </div>
        </div>

        <div class="block">
          <h3 class="block-title">รอบทั้งหมด ({{ rounds.length }})</h3>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>วันที่</th><th>ประเภท</th><th>เวลา</th><th>สถานที่</th>
                  <th>เข้าร่วม</th><th>ลา (A/B)</th><th>ไม่เข้าร่วม</th><th>ติดงานด่วน</th><th>สถานะรอบ</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="round in rounds" :key="round.key">
                  <td>{{ round.dateIso }}</td>
                  <td>{{ round.typeName }}</td>
                  <td>{{ round.time }}</td>
                  <td>{{ round.location || '—' }}</td>
                  <td>{{ round.statusCounts.attended }}</td>
                  <td>{{ round.statusCounts.leave }} ({{ round.shiftCounts['กะ A'] }}/{{ round.shiftCounts['กะ B'] }})</td>
                  <td>{{ round.statusCounts.not_attended }}</td>
                  <td>{{ round.statusCounts.urgent_busy }}</td>
                  <td><span class="badge" :class="`badge-${round.mode}`">{{ modeLabel(round.mode) }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-if="preview.skipped?.length" class="block">
          <h3 class="block-title">แถวที่ถูกข้าม ({{ summary.skipped }})</h3>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr><th>แถว</th><th>ประเภท</th><th>วันที่</th><th>ชื่อ</th><th>เหตุผล</th></tr>
              </thead>
              <tbody>
                <tr v-for="item in preview.skipped" :key="`${item.row}-${item.reason}`">
                  <td>{{ item.row }}</td>
                  <td>{{ item.typeName || '—' }}</td>
                  <td>{{ item.dateIso || '—' }}</td>
                  <td>{{ item.name || '—' }}</td>
                  <td>{{ item.reason }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="actions">
          <v-btn color="primary" :disabled="stage === 'saving'" :loading="stage === 'saving'" @click="confirmImport">
            ยืนยันการบันทึก
          </v-btn>
          <v-btn variant="text" :disabled="stage === 'saving'" @click="reset">เลือกไฟล์ใหม่</v-btn>
        </div>
      </section>

      <section v-if="result && result.summary" class="card">
        <h2 class="card-title">3. บันทึกเรียบร้อย</h2>
        <ul class="plain-list">
          <li>สร้างรอบใหม่ {{ result.summary.sessionsCreated }} รอบ</li>
          <li>ใช้รอบเดิม {{ result.summary.sessionsReused }} รอบ</li>
          <li>บันทึกสถานะ {{ result.summary.attendanceWritten }} แถว</li>
          <li>ข้ามรอบซ้ำ {{ result.summary.conflictsSkipped }} รอบ</li>
          <li>ข้ามแถว {{ result.summary.skipped }} แถว</li>
        </ul>

        <div v-if="result.summary.skippedRows?.length" class="block">
          <h3 class="block-title">แถวที่ไม่ได้บันทึก</h3>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr><th>แถว</th><th>ประเภท</th><th>วันที่</th><th>ชื่อ</th><th>เหตุผล</th></tr>
              </thead>
              <tbody>
                <tr v-for="item in result.summary.skippedRows" :key="`${item.row}-${item.reason}`">
                  <td>{{ item.row }}</td>
                  <td>{{ item.typeName || '—' }}</td>
                  <td>{{ item.dateIso || '—' }}</td>
                  <td>{{ item.name || '—' }}</td>
                  <td>{{ item.reason }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="actions">
          <v-btn variant="outlined" @click="reset">นำเข้าไฟล์อื่น</v-btn>
          <RouterLink to="/meeting/controller/backfill">
            <v-btn variant="text">ดูข้อมูลย้อนหลัง</v-btn>
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
  display: flex;
  gap: 18px;
  padding: 20px;
  align-items: flex-start;
}

.content {
  flex: 1;
  min-width: 0;
  max-width: 1120px;
  padding-bottom: 48px;
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
  font-size: 24px;
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
  white-space: nowrap;
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.badge-new {
  background: #e6f4ec;
  color: #17694a;
}

.badge-existing {
  background: #eaf0f7;
  color: #2c4f7c;
}

.badge-joined {
  background: #fff4e0;
  color: #8a5a12;
}

.badge-conflict {
  background: #fdecec;
  color: #9b2c2c;
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

@media (max-width: 900px) {
  .page {
    flex-direction: column;
    padding: 12px;
  }
}
</style>
