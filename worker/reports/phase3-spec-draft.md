ร่างข้อกำหนด Phase 3 (อ่านอย่างเดียว) — Dashboard ผู้ควบคุมการประชุม
=====================================================================
วันที่จัดทำ: 2026-10-31
สถานะ: อนุมัติแล้วตามคำแนะนำ — พร้อมเริ่ม 3a (2026-10-31)
ไฟล์นี้เป็นไฟล์เดียวที่สร้างใหม่ในรอบนี้ ไม่มีการแก้ไขไฟล์อื่น, ไม่มีการเขียนฐานข้อมูล,
ไม่มีเรียก Supabase, ไม่อ่านค่าใน .env.local / .dev.vars / .test-account.env

แหล่งอ้างอิง (อ่านครบแล้วในรอบนี้)
- server/routes/meeting-dashboard.js
- server/meeting-dashboard.js
- server/meeting-window.js (ยืนยันแล้วว่าทั้งกลุ่ม dashboard ไม่ได้ใช้ตัวช่วยจากไฟล์นี้
  ยกเว้นเข้าใจเกณฑ์ HH:mm ที่ใช้ตรงกันทั้งระบบ)
- tests/meeting-dashboard.test.js (vitest ฝั่ง Express — เทียบพฤติกรรมตัวช่วยทั้งหมด)
- src/pages/ControllerDashboardPage.vue
- server/pin-verify.js (เส้นทางตรวจ PIN ของ POST /reason)
- server/session-check.js และ server/middleware/require-role.js (ยืนยันซ้ำตามที่สั่ง)
- server/auto-absent-job.js และ server/attendance-status.js (ปฏิสัมพันธ์ auto-absent
  และรายการรหัสสถานะ)
- ฝั่ง Workers ที่มีอยู่แล้ว: worker/src/crypto.js, worker/src/pin.js, worker/src/pin-rules.js,
  worker/src/routes/auth.js (ระบบ Phase 1 ใช้ HMAC แล้ว), worker/src/db.js

ส่วนที่ผู้ใช้สั่งให้ยืนยัน
- requireRole middleware: อ่าน session ผ่าน readSession → ไม่มี session จึงใช้ไม่ได้ →
  401 'ไม่ได้เข้าสู่ระบบ'; session ใช้ได้แต่ role ไม่ตรง → 403 'ไม่มีสิทธิ์เข้าถึงส่วนนี้'
  ฝั่ง Workers ทำเท่ากันแล้วใน worker/src/session.js + worker/src/require-role.js
  (Phase 1) — ไม่ต้องแก้อะไร
- readSession ฝั่ง Express เขียนฐานข้อมูลเอง (ทำลาย session เมื่อ idle เกิน 15 นาที,
  พนักงานถูกปิดใช้งาน, role ไม่ตรงกับที่ login มา; และอัปเดต last_active_at ทุกครั้ง)
  worker/src/session.js ทำเท่ากันแล้ว ดังนั้น routes dashboard จัดว่าได้ session ที่ถูกต้อง
  จาก requireRole โดยไม่เขียนอะไรเกี่ยวกับ session เพิ่มในตัวเอง

 =================================================================
 1. ภาพรวมกลุ่ม dashboard
 =================================================================

ทุก endpoint อยู่ใต้ /api/meeting/dashboard:
router.use ตั้ง Cache-Control: no-store ก่อน แล้ว router.use(requireRole('meeting_controller'))
ก่อนเข้าทุก route — เหมือนกลุ่ม meeting อื่น

รายการ: 5 GET + 1 POST
- GET  /api/meeting/dashboard
- GET  /api/meeting/dashboard/cycles?code=...
- GET  /api/meeting/dashboard/dept?code=...&cycle=...&dept=...
- GET  /api/meeting/dashboard/registrants?code=...&cycle=...
- GET  /api/meeting/dashboard/monthly-summary?month=...
- POST /api/meeting/dashboard/reason

ข้อความไทยที่ใช้ทั้งกลุ่ม (คัดจากโค้ดคำต่อคำ)
- 400 'ข้อมูลไม่ถูกต้อง'                                                    (validation fail)
- 400 'ประเภทการประชุมไม่ถูกต้อง'                                              (ไม่พบ meeting_types ตาม code)
- 500 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง'                                  (throw ภายใน try)
- 'ยังไม่มีข้อมูลในระบบ'                    (EMPTY_MESSAGE — เป็นค่าใน response ไม่ใช่ error)
- 'ยังไม่ลงทะเบียน'                        (NOT_YET_LABEL — ค่าใน response)
- 401 'ไม่ได้เข้าสู่ระบบ' / 403 'ไม่มีสิทธิ์เข้าถึงส่วนนี้'  (middleware ตาม 2.0 เดิม)

เรื่องการตรวจ body/query ที่งอกต่างจากกลุ่ม meeting อื่น: schemas ของ GET ทั้งหมดเป็น zod
object ธรรมดา (ไม่ใช่ .strict()) เพราะ query มาจาก URL — field เกินถูกตัดทิ้ง (strip)
และตอบปกติ ไม่ตอบ 400; POST /reason เท่านั้นที่ใช้ .strict() — field เกินใน body ตอบ
400 'ข้อมูลไม่ถูกต้อง' ทันที ฝั่ง Workers ต้องจำลองพฤติกรรมนี้ให้ตรง (เขียนเช็คเองแบบ
ที่ทำมาแล้วทั้ง Phase 2 แต่ห้ามใช้ตัว strict แบบเดียวกันทั้งหมด)

 =================================================================
 2. สัญญาของแต่ละ endpoint
 =================================================================

 <- 2.1 GET /api/meeting/dashboard ------------------------------------------------
Auth: meeting_controller (401/403 ตาม 2.0)
Request (query, non-strict):
- code: enum ['sup','monthly'] บังคับ
- mode: enum ['day','month','year'] ไม่ใส่ได้ (ถ้าไม่มีค่า ใช้ 'day')
- value: string ยาวไม่เกิน 10 optional; ถ้าเป็น string จะ trim
- query เกินกว่า schema ไม่สน (ไม่ตอบ 400)

ก่อนอ่านข้อมูล: เรียก triggerAutoAbsentIfDue แบบ fire-and-forget (ดูหัวข้อ 5)

การอ่านฐานข้อมูล (ตาราง/คอลัมน์):
- meeting_types: id, code, name; filter code=…
- meeting_sessions: id, session_date; filter meeting_type_id, order session_date มากไปน้อย,
  limit 400
- meeting_attendance: id, session_id, employee_id, status_code, reason, shift,
  registered_at; filter session_id in (...) แบ่งชุดละ 100 session id
- meeting_roster: employee_id + embed employees (full_name, departments(name),
  positions(name)); filter meeting_type_id + is_active=true
- ไม่มีการเขียนฐานข้อมูล ไม่มี audit_logs

กติกาภายใน:
- จัดกลุ่มแถว attendance โดย cycle key: sup → session_date เต็ม YYYY-MM-DD; monthly →
  ตัดเหลือ YYYY-MM; availableKeys = กุญแจที่มีข้อมูล เรียงน้อยไปมาก
- currentKey = กุญแจมีข้อมูลล่าสุด (ว่างได้)
- วิธีการนับ (ต่างจาก overview — ดูหัวข้อ 5): ผ่าน latestPerEmployee ก่อน (เอาแถวล่าสุด
  ต่อพนักงานในรอบนั้น) แล้วจึง countByStatus
- today.registered = counts.total ของ latest rows ทั้งหมด (โค้ด Express คำนวณตัวนี้โดยไม่กรองด้วย
  roster) แต่ notYet = max(roster.length - จำนวน latest rows ที่ employee_id
  อยู่ใน roster, 0) — เก็บเป็นประเด็นให้เจ้าของตัดสิน (หัวข้อ เจ้าของข้อ 2)
- historyKeys: ตามหัวข้อ 3 (หน้าต่าง 12 รายการ)
- rateOf: total ≤ 0 → 0; clamp ให้อยู่ 0..1

Response 200:
{
  ok: true,
  meeting: { code, name, periodLabel },
  updated: <ISO string เวลาปัจจุบัน>,
  todayKey: <YYYY-MM-DD วันไทยวันนี้>,
  current: { key, label },    // key ว่าง → label = 'ยังไม่มีข้อมูลในระบบ'
  statuses: ['เข้าร่วมประชุม','ไม่เข้าร่วม','ติดงานด่วน','ลาประชุม'],
  rosterCount,
  today: { registered, byStatus: { <label>: n, ... }, notYet },
  depts: [{ name, total, registered, notYet, attended, rate }],
  history: { mode, key, options, cycles, empty, emptyMessage }
}
- meeting.periodLabel แปะคำ: sup → 'รายสัปดาห์ · ทุกวันอังคาร', monthly → 'รายเดือน'
  (ไม่อ่าน weekday จริงจาก meeting_types — บันทึกไว้ให้เจ้าของยืนยัน)
- today.byStatus: ค่าจาก currentCounts โดยแปลงคีย์ code เป็นป้ายไทยตาม STATUS_LABEL_BY_CODE
- depts: กลุ่มตามชื่อแผนกของ roster (แผนกว่างใช้ '-'), เรียง notYet มาก→น้อย แล้ว tie-break
  ชื่อไทย; rate = attended / total ของแผนกนั้น
- history.cycles: [{ key, label, fullLabel, counts, total, rate }]; ตัวกราฟแรกมาจาก
  requested value หรือ currentKey (key = value || currentKey)
- options = availableKeys ทั้งหมดพร้อม fullLabel

Error: 400 'ข้อมูลไม่ถูกต้อง' / 400 'ประเภทการประชุมไม่ถูกต้อง' / 500 ตามข้อความกลุ่ม

 <- 2.2 GET /api/meeting/dashboard/cycles?code=sup|monthly ---------------------------
Auth: ตาม 2.0. Request (query, non-strict): code enum บังคับ
การอ่าน: เหมือน loadContext ของ 2.1 (types + sessions limit 400 + attendance chunks)
ไม่มีเขียน/audit
Response 200: { ok: true, options: [{ key, label }] } — เฉพาะกุญแจที่มีข้อมูล
เรียงน้อยไปมาก; label เป็น fullLabel
Error: 400 'ข้อมูลไม่ถูกต้อง' / 400 'ประเภทการประชุมไม่ถูกต้อง' / 500

 <- 2.3 GET /api/meeting/dashboard/dept?code=...&cycle=...&dept=... -------------------
Auth: ตาม 2.0. Request (query, non-strict):
- code enum บังคับ
- cycle: string ตรงรูป ^\d{4}-\d{2}(-\d{2})?$ บังคับ
- dept: string 1–200 ตัวอักษร บังคับ
การอ่าน:
- meeting_types (id, code, name); ไม่พบ → 400 'ประเภทการประชุมไม่ถูกต้อง'
- meeting_roster + embeds (เหมือน 2.1) แล้วกรอง member.departmentName === dept ตรงตัว
- meeting_sessions ในรอบ: sup → session_date = cycle เป๊ะ ๆ; monthly → session_date ≥
  วันที่ 1 ของ cycle (cycle-01) และ < วันที่ 1 ของเดือนถัดไป (nextMonthKey คำนวณด้วย
  Date.UTC ห้ามบวก string)
- meeting_attendance ของ sessions ชุดนั้น (chunks 100) แล้ว latestPerEmployee
ไม่มีเขียน/audit
กติกา:
- ทุกคนใน roster ของแผนกนี้จะได้รายการเสมอ ถ้าไม่มีแถว → status 'ยังไม่ลงทะเบียน',
  shift: null, time: null; ถ้ามีแถว → status จากรหัสล่าสุด (ถ้าไม่รู้รหัส ใช้ '-') shift
  จากแถว และ time = เลข HH:mm เวลาไทยจาก registered_at (แปลงด้วย Date + Intl en-GB h23)
- counts นับเฉพาะ 4 สถานะที่รู้จัก; เรียง people ตามลำดับสถานะ STATUS_LABELS
  ('เข้าร่วมประชุม','ไม่เข้าร่วม','ติดงานด่วน','ลาประชุม'; สถานะอื่นและ 'ยังไม่ลงทะเบียน'
  ลงท้าย) แล้ว tie-break ชื่อไทย
- notYet = จำนวน people ที่ status ยังไม่ลงทะเบียน
Response 200: { ok: true, dept, cycle: { key, label }, total, counts, people, notYet };
  people เป็น [{ employeeId, name, level, status, shift, time }] (level = positionName)
Error: 400 'ข้อมูลไม่ถูกต้อง' / 400 'ประเภทการประชุมไม่ถูกต้อง' / 500

 <- 2.4 GET /api/meeting/dashboard/registrants?code=...&cycle=... ---------------------
Auth: ตาม 2.0. Request (query, non-strict): code enum + cycle ตรงรูป ^\d{4}-\d{2}(-\d{2})?$
การอ่าน: types; sessions ของ cycle (เหมือน 2.3); attendance (chunks 100) → latestPerEmployee
→ เรียงตาม registered_at น้อยไปมาก (sortByRegisteredAt — ค่าที่แปลงเวลาไม่ได้ใช้น้ำหนัก 0)
→ อ่าน employees (id, full_name + departments(name), positions(name)) แบบชุด 100 ไอดี
แล้วสร้างแผนที่จับคู่แถมคืนค่า
ไม่มีเขียน/audit
Response 200: { ok: true, cycle: { key, label }, total, items } — items แต่ละแถว
{ name, departmentName, positionName, status, shift, time } (คนไม่เจอใน employees ใช้
'-' และ status ตามรหัสที่รู้จักเท่านั้น ไม่เช่นนั้น '-'; total = จำนวน items)
Error: 400 'ข้อมูลไม่ถูกต้อง' / 400 'ประเภทการประชุมไม่ถูกต้อง' / 500

 <- 2.5 GET /api/meeting/dashboard/monthly-summary?month=YYYY-MM ---------------------
Auth: ตาม 2.0. Request (query, non-strict): month ตรงรูป ^\d{4}-\d{2}$ บังคับ
การอ่าน: loadContext ของ monthly (types + sessions limit 400 + attendance chunks) +
meeting_roster + employees chunks
กติกา (ต่างจาก dashboard หลัก):
- นับ "ทุกแถว" ในเดือนนั้น (ไม่ผ่าน latestPerEmployee) — ทั้ง counts ของแผนกและการนับ
  ต่อคนต่อสถานะเหมือนกัน
- dateKeys = เซทของ session_date ในเดือนนั้น (จาก sessions รวมรอบที่ไม่มีใครลงทะเบียนด้วย)
  → totalMeetings = จำนวนวันที่ไม่ซ้ำ
- rates[label] = จำนวนแถวสถานะนั้น / จำนวนแถวทั้งหมดของแผนก (อิงแถว ไม่ใช่จำนวนคน)
- รายชื่อแผนกเอาจาก roster เรียงไทย แผนกที่ไม่มีข้อมูลได้ counts ล้วน 0
- personCounts รวมจากแถวทั้งหมดด้วยคีย์ dept/ชื่อ/สถานะ นับแถว; เป็นตามรูปโค้ดเดิม
  ชื่อที่ไม่พบ employee ถูกข้ามไป
ไม่มีเขียน/audit
Response 200:
{
  ok: true, month: { key, label }, totalMeetings,
  depts: [{ name, counts, rows, rates }],
  top: [{ dept, status, name, count, pct }]
}
- depts เรียงตามชื่อแผนกไทย; rows = จำนวนแถวของแผนก; rates ค่า 0..1
- top: topAbsentPerDept — เฉพาะสถานะ not_attended, urgent_busy, leave; เลือกคนจำนวน
  มากสุดต่อหนึ่งแผนก-สถานะ tie-break ชื่อไทย; แผนกเรียงไทย; แถวนับ 0 คืนชื่อว่าง '';
  pct = count / totalMeetings (totalMeetings เป็น 0 → pct 0)
  (หมายเหตุ: คง behavior runtime ของ Express — decision: คงตาม Express, top ว่างเสมอ:
  Express คีย์ personCounts ด้วยป้ายไทย เมื่อ topAbsentPerDept กรองด้วย รหัสอังกฤษไม่ตรงจึงตอบ [])
Error: 400 'ข้อมูลไม่ถูกต้อง' / 400 'ประเภทการประชุมไม่ถูกต้อง' / 500

 <- 2.6 POST /api/meeting/dashboard/reason ------------------------------------------
Auth: meeting_controller (middleware ให้ req.session.employeeId ใน Express)
Request (body, .strict()):
- pin: string ตรงรูป ^\d{6}$
- code: enum ['sup','monthly']
- cycle: string ตรงรูป ^\d{4}-\d{2}(-\d{2})?$
- employeeId: ตามรูป UUID ของ z.uuid() (รวม nil/max เวอร์ชัน; hex ไม่สน case — ใช้
  กติกาเดียวกับ Phase 2c)
field เกินใน body → 400 'ข้อมูลไม่ถูกต้อง' ทันที

ขั้นที่ 1 — ตรวจ PIN (server/pin-verify.js, verifyLoginPin):
- โหลด employee_credentials ด้วย employee_id = ผู้ควบคุมที่ login อยู่
  (คอลัมน์: employee_id, pin_hash, failed_attempts, locked_until + embed employees
  id, full_name, employee_code, is_active)
- ไม่พบข้อมูล / พนักงาน is_active = false / pin_hash เป็น null → 401
  'เลขบัตรประชาชนหรือ PIN ไม่ถูกต้อง'
- ถ้า locked_until > ตอนนี้ → 423 'บัญชีถูกล็อกชั่วคราว' พร้อม body.lockedUntil
- ตรวจ PIN ด้วย bcrypt.compare(pin, pin_hash) และอนุญาตเฉพาะผู้มีบทบาท meeting_controller
  ผ่าน allowedLoginTypesFor ด้วย; ถ้าไม่ผ่าน:
  → failed_attempts + 1; ถ้า ≥ 5 → อัปเดต { failed_attempts: 0,
     locked_until: now + 15 นาที } แล้วตอบ 423 'บัญชีถูกล็อกชั่วคราว' + lockedUntil
  → ยังไม่ถึง 5 → อัปเดต { failed_attempts: n, updated_at } แล้วตอบ 401 PIN message
- ถ้า PIN ผ่าน → อัปเดต { failed_attempts: 0, locked_until: null, updated_at } แล้วไปขั้น 2
- เขียนกลุ่มนี้อยู่ที่ตาราง employee_credentials เท่านั้น (ไม่มี audit ขั้นตรวจ PIN)

ขั้นที่ 2 — หาแถวและเหตุผล:
- loadContext(code); ไม่พบ type → 400 'ประเภทการประชุมไม่ถูกต้อง'
- แถวของรอบที่ employee_id = คนใน body (กรองให้เฉพาะคนนี้) แล้วใช้ latestPerEmployee
  ท่อนเดียว; ถ้าว่าง → HTTP 200 { ok: false, message: 'ไม่พบข้อมูลของคนนี้ในรอบนี้' }
  (สถานะ HTTP ยังเป็น 200!)
- status_code ต้องอยู่ใน ['urgent_busy','leave'] ไม่เช่นนั้น → HTTP 200 { ok: false,
  message: 'สถานะนี้ไม่มีเหตุผล' } — ทั้งสองกรณีนี้ Express ไม่เขียน audit เลย

ขั้นที่ 3 — audit + ตอบ:
- insert audit_logs หนึ่งแถว:
  { actor_id: <employee id ของ controller ที่ login อยู่>,
    action: 'dashboard_reason_viewed',
    entity: 'meeting_attendance',
    entity_id: <id ของแถว meeting_attendance>,
    detail: null }
  ยืนยันแล้ว: แถวนี้ไม่มีชื่อพนักงาน ไม่มีข้อความเหตุผล ไม่มี PIN ไม่มี token/hash ใด ๆ
- Response 200 { ok: true, status: <ป้ายไทยตามรหัสสถานะ>, reason: <ข้อความเหตุผล ?? สตริงว่าง> }
- ขั้นใด throw → 500 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง'
การรักษาข้อมูลนี้ (REASON เป็นข้อมูลส่วนตัวของพนักงาน): ห้ามปริ๊นท์/log reason หรือ PIN
โดยเด็ดขาดฝั่ง Workers — logError แค่ name/code เหมือนเดิม; ป้าย reason แสดงใน response
ผ่านระบบควบคุมด้วย session + PIN ตามข้อกำหนดเดิมเท่านั้น

 =================================================================
 3. เขตเวลา ป้ายไทย และหน้าต่างประวัติ
 =================================================================

- ทุกจุดที่มีเวลา ยึด Asia/Bangkok:
  bangkokDayKey (en-GB) → 'YYYY-MM-DD' ของ "วันไทย"; timeOfDay → 'HH:mm' (en-GB h23)
- ป้ายไทย ใช้ Intl th-TH (ได้ปี พ.ศ. อัตโนมัติ):
  thaiDateLabel('2026-11-03') = 'วันอังคาร 3 พ.ย. 2569'
  thaiShortDateLabel = '3 พ.ย.'
  thaiMonthLabel('2026-11') = 'พ.ย. 2569'
- การ parse วัน/เดือนจากกุญแจทำแบบ UTC + นาฬิกาตรง 12:00 เพื่อหลีกเลี่ยงขอบวัน และการ
  ตรวจวันอังคารใช้ getUTCDay = 2 — ห้ามใช้เวลาท้องถิ่นของเครื่อง; Workers ต้องทำแบบเดียว
  (workerd ไม่มี เขตเวลาเครื่อง จึงหลีกเลี่ยงปัญหาได้ถ้ายึด Intl + UTC)

หน้าต่างประวัติ (historyKeys) — หน้าต่าง 12 รายการ:
- sup + day: anchor = value (ถ้ามี) ไม่เช่นนั้นใช้กุญแจมีข้อมูลล่าสุด; หาวันอังคาร
  (getUTCDay = 2) วันที่ ≤ anchor; สร้าง 12 วันอังคารย้อนคนละ 7 วัน เรียงขึ้น — สร้าง
  กุญแจทุกช่องแม้ไม่มีข้อมูล (counts ทำให้เป็น 0 บนกราฟ)
- monthly + day: 12 เดือนย้อนจากเดือนของ anchor (ทุกกุญแจ แม้ไม่มีข้อมูล)
- monthly + month: เอาเฉพาะเดือนที่มีข้อมูล (มาจาก availableKeys) เรียงขึ้น กรองให้
  ไม่เกิน value ก่อน แล้วเก็บ 12 รายการหลัง
- year: value 4 หลักแรก (หรือมาจากกุญแจล่าสุด) → คืนเฉพาะเดือนที่มีข้อมูลในปีนั้น เรียงขึ้น
- ไม่มีข้อมูลและไม่มี value → [] (UI แสดง 'ยังไม่มีข้อมูลในระบบ')
- เดือนถัดไป (nextMonthKey) และ shiftMonth อิง Date.UTC เท่านั้น ห้ามบวกลบสตริง

 =================================================================
 4. สิ่งที่พึ่ง Node runtime (ต้องสรรหาทางเทียบใน Workers)
 =================================================================

- bcrypt: ใช้เฉพาะใน pin-verify.js (POST /reason); มันพึ่ง salt+cost ที่ฝังใน hash จึง
  ตรวจกับ Web Crypto แท้ ๆ ไม่ได้; วิธีแก้อยู่ในหัวข้อ 5
- Intl.DateTimeFormat ทั้ง en-GB และ th-TH (พ.ศ. 2569 จากปฏิทินไทย); workerd มี Intl
  แต่ต้องทดสอบว่าป้ายตรงเหมือน Express (Phase 2 ผ่านการทดสอบรูปเดียวกันแล้ว)
- เวลา: Date + ISO parsing + Date.UTC semantics แบบเดียวกับ Node; ห้ามอิงเวลาเครื่อง
- zod schemas: ตัดเขียนเองแบบตัวอื่นในโปรเจ็กต์ โดยแยก strict/non-strict ตามหัวข้อ 1
- setTimeout/setInterval + unref: Express ใช้กับงาน auto-absent; Workers GET ห้ามใช้
  (Phase 4 จะใช้ Cron Trigger แทน)
- dependency เกินจากนี้ไม่มี — ทั้งกลุ่มใช้ fetch + Intl + Date เท่านั้น

 =================================================================
 5. POST /reason — เสนอทางแทน bcrypt ด้วย HMAC (เทียบเท่าใน Workers)
 =================================================================

สภาวะเดิม Express: bcrypt.compare(pin, pin_hash) — ตรวจ hash ที่ฝัง salt+rounds เดียวกัน;
มีกลไกล็อก 5 ครั้ง / 15 นาที; รีเซ็ต failed_attempts เมื่อสำเร็จ

ข้อแนะนำ: ยึดโครงสร้าง Phase 1 ที่ Workers ใช้แล้วใน /api/auth/login (worker/src/routes/auth.js)
- คำนวณ HMAC-SHA256 ด้วย PEPPER (PIN_PEPPER) บนค่า `${employee.id}:${pin}` →
  เทียบกับ credential.pin_hash ผ่านเทียบแบบ timing-safe (ตัวช่วยมีแล้ว:
  worker/src/crypto.js hmacSha256Hex + timingSafeEqualHex; รูปแบบเดียวกับ pinHash
  ใน worker/src/pin-rules.js ที่ใช้กับ set-pin; ไม่ต้องเพิ่ม dependency ใด)
- ล็อกและนับครั้งผิดที่อยู่ใน employee_credentials ทำเหมือน Express เพราะ login
  Phase 1 ทำแล้ว — ใช้ตรรกะกลางเดียวกัน ห้ามเปลี่ยนเงื่อนเวลาหรือตัวเลข

การเปลี่ยนพฤติกรรมที่ต้องธงให้เจ้าของตัดสิน:
1) ถ้า pin_hash เป็น bcrypt จริง (row ที่ยังไม่ได้ย้ายมา HMAC) แถวนั้นจะตอบ 401 เสมอเมื่อ
   ใช้ HMAC ตามรูปแบบ hash ที่ไม่เท่ากัน — ทางออกที่ไม่เพิ่มต้นทุนและไม่ต้องพึ่ง dependency
   ใหม่: ให้ไปตั้ง PIN ใหม่ผ่าน /api/auth/set-pin ซึ่งจะเขียน pin_hash เป็น HMAC (Phase 1
   ทำไว้แล้ว); เมื่อตั้งใหม่แล้ว PIN เดิมแบบ bcrypt จะใช้ไม่ได้อีก (ชำระในหัวข้อ
   'ทางที่ต้องตัดสิน' ข้อ 3)
2) ความเร็วและข้อแลกเปลี่ยนด้านความปลอดภัย (เจ้าของยอมรับแล้ว ดูหัวข้อ 10 ข้อ 3):
   ข้อแลกเปลี่ยนชี้ตรง: HMAC บน PIN 6 หลักเร็วมาก ถ้าผู้โจมตีได้ทั้งฐานข้อมูลและ PIN_PEPPER
   จะ brute force ได้เร็ว (bcrypt ช้าโดยตั้งใจ เพื่อกั้น brute force ซึ่ง HMAC ไม่มีคุณสมบัตินี้);
   PIN_PEPPER เก็บเป็น Worker secret แยกจากฐานข้อมูล การรั่วของฐานข้อมูลเพียงอย่างเดียว
   ไม่เปิดเผย PIN;
   ล็อก 5 ครั้งผิด / 15 นาที จำกัดเฉพาะการเดาออนไลน์เท่านั้น ไม่ป้องกันกรณีที่ข้อมูลรั่ว;
   Express ไม่มี rate-limit ใน route นี้และกติกาตั้งใจคงเหมือนเดิม
3) ข้อความไทย สถานะ HTTP และโครง response ทุกกรณี คงเดิมเท่ากัน (รวม 423 + lockedUntil
   ในกรณีล็อก)

รายการ audit_logs ที่เขียน (ยืนยันแล้ว):
- action='dashboard_reason_viewed', entity='meeting_attendance',
  entity_id=<attendance id>, actor_id=<controller employee id>, detail=null
- ยืนยันว่าไม่มีชื่อและไม่มีข้อความเหตุผล
- กรณี 200 {ok:false} (ไม่พบแถว / สถานะไม่มีเหตุผล) Express ไม่เขียน audit —
  Workers ก็ไม่เขียนด้วย

 =================================================================
 6. auto-absent กับ dashboard, และกติกาการนับ/เรียงที่ต่างจาก overview
 =================================================================

Auto-absent ใน Express:
- เฉพาะ GET /api/meeting/dashboard เท่านั้นที่เรียก triggerAutoAbsentIfDue แบบ
  fire-and-forget ก่อนอ่าน พร้อมกั้นหน้า INTERVAL 10 นาทีต่อรัน — /cycles, /dept,
  /registrants, /monthly-summary, /reason ไม่เรียก
- ตามข้อตกลงแล้ว: ฝั่ง Workers ห้ามทำจาก GET ทุกจุด — มอบไปให้ Cron Trigger (Phase 4)

ข้อจำทางหน้า dashboard เมื่อ cron ยังไม่พาผ่าน:
- ถ้ายังไม่มี meeting_sessions ของ "วันไทยวันนี้" ฝั่ง sup และยังไม่มีใครลงทะเบียนในรอบ
  นั้น → currentKey ยังยึดรอบเก่าที่มีข้อมูล; today.byStatus อ่านจาก latest rows ของรอบ
  เก่า ไม่ใช่วันนี้
- ไม่มีแถว not_attended อัตโนมัติจน cron รันครั้งแรก → ตัวเลข notYet จะสูงกว่าค่าจบวัน
  จริง; ต้องรีเฟรชหน้าด้วยมือถึงจะเห็นข้อมูลที่ cron เพิ่งเขียน (หน้าไม่ทำออโต้เฟรช)
- ตาราง meeting_skip_dates ทำหน้าที่ยับยั้งการสร้าง session sup ของวัน skip เท่านั้น
  (ถ้าวันนี้เป็นวัน skip → ไม่สร้าง session วันนี้ แต่ dashboard ยังยึดรอบย้อนหลังเหมือนเดิม
  ไม่มีข้อความ error พิเศษ) — อธิบายชัดไว้เพราะ UI อาจดูเหมือน
  ยังไม่ตั้งรอบวันนี้ในช่วงดังกล่าว

กติกานับที่ต่างกัน dashboard vs overview (สำคัญ):
- overview (Phase 2d): countByStatus นับทุกแถวของรอบนั้น (ไม่ตัดล่าสุดต่อคน)
- dashboard: ผ่าน latestPerEmployee ก่อนเสมอ (ยกเว้น monthly-summary ที่นับทุกแถว)
- pending (overview): คนที่มีแถวอะไรก็ได้ในรอบนั้นถือว่าลงแล้ว (ต่างจากตัวนับล่าสุด)
- /dept และ /registrants ใช้ latestPerEmployee แต่ /monthly-summary นับทุกแถว —
  ผลนับจึงต่างกันระหว่าง endpoint โดยตั้งใจ ทดสอบต้องคุมค่าให้เท่าโค้ดเดิมแต่ละจุด
  แม้กติกา "ย้อนหลังไม่เนียนกัน" ระหว่าง endpoint ทั้งหมด

กติกาการเรียงที่ต้องตรง:
- depts (dashboard): notYet มาก→น้อย แล้ว tie-break ชื่อไทย
- depts (monthly-summary): เรียงชื่อไทย
- people (dept drawer): ลำดับสถานะตาม STATUS_LABELS แล้วชื่อไทย
- registrants: registered_at น้อยไปมาก (ค่าแปลงไม่ได้ = 0) และไม่แก้ array ต้นฉบับ
- cycles / options: กุญแจเรียงขึ้นแบบ localeCompare
- top: แผนกเรียงไทย + สถานะตามลำดับที่ fix ไว้ ['not_attended','urgent_busy','leave']

 =================================================================
 7. ตารางที่อ่าน/เขียน และ dependency รวม
 =================================================================

อ่านทั้งกลุ่ม:
- meeting_types: id, code, name
- meeting_sessions: id, session_date (จำกัด 400 ล่าสุด)
- meeting_attendance: id, session_id, employee_id, status_code, reason, shift,
  registered_at
- meeting_roster + employees + departments(name) + positions(name) (active เท่านั้น)
- employees แยก (registrants/monthly-summary): id, full_name + embeds
เขียน (เท่าที่กลุ่มนี้มี)
- POST /reason: employee_credentials (failed_attempts / locked_until / updated_at)
  และ audit_logs หนึ่งแถว (dashboard_reason_viewed) เท่านั้น
- GET ทุกตัวไม่มีการเขียนเด็ดขาด (ไม่รวมการเขียนของ readSession ใน require-role ซึ่ง
  เป็นของกลางและต่างกันแล้วใน Phase 1)
meeting_skip_dates: dashboard เองไม่อ่าน; เฉพาะงาน auto-absent (Phase 4) ใช้ตัดวัน skip
อื่น ๆ ที่เกี่ยว: audit_logs (อ่านใน auto-absent เพื่อ mark งานที่ทำแล้ว; /reason เขียน);
employees.is_active (ใน session path และตรวจเวลาตรวจ PIN)

 =================================================================
 8. ความเสี่ยงและงานเฉพาะของ Workers
 =================================================================

- db.js (worker/src/db.js): ตอนนี้รองรับ eq / is / gte / lt / order / limit / single /
  extra raw params แต่ 'in (...)' ยังไม่มี — dashboard ต้องใช้ session_id in (ชุด 100)
  และ employees in (ชุด 100) ต้องเพิ่ม operator แบบส่วนเสริมเท่านั้น (ต้องทำตอน chunk 3a
  และระบุในรายงานทันทีถ้าแก้ db.js)
- ค่าใน 'in' ต้องเข้ารูปแบบ in.(a,b,c) ของ PostgREST — uuid ในตารางไม่มี comma จริง
  แต่ควรมีเคสทดสอบคุม encoding ให้ไม่มีข้อผิด (ทดสอบด้วย fake fetch)
- ป้าย Intl th-TH (พ.ศ.) และ en-GB HH:mm บน workerd — ทดสอบด้วยค่าตาย ('วันอังคาร
  3 พ.ย. 2569' / 'พ.ย. 2569') ค่าทดสอบคงไว้ตามเดิม; ถ้ารูปปี พ.ศ. หรือเวลาบน workerd
  ต่างจาก Node ให้เขียนตัวแปลงป้ายของตัวเอง (local formatter) พร้อมทดสอบครอบคลุมป้ายเหล่านั้น
- เวลา registered_at ที่ DB เก็บเป็น ISO — แปลงด้วย Date เท่านั้นห้ามเปลี่ยน
- body ของ /reason: ยึดขนาดสูงสุด 4KB (ทำไปแล้วใน Phase 2 แบบตัวอื่น) + JSON content type เท่านั้น
- /reason ใน Express ไม่มี CSRF/origin check เพิ่ม — Workers จะไม่เพิ่มเช่นเดิม (ถ้าเจ้าของ
  ต้องการ เป็นการเพิ่มพฤติกรรม ต้องตัดสินใจก่อน)
- ห้ามปริ๊นท์ PIN / pin_hash / reason ใน log โดยเด็ดขาด

 =================================================================
 9. แบ่งงานเป็น chunk (ข้อเสนอ)
 =================================================================

ข้อ 3a — dashboard อ่าน (GET 5 ตัว)
- worker/src/meeting-dashboard.js: ตัวช่วยล้วน — bangkokDayKey, thaiDateLabel,
  thaiShortDateLabel, thaiMonthLabel, timeOfDay, latestPerEmployee, sortByRegisteredAt,
  countByStatus, rateOf, historyKeys, deptSummary, topAbsentPerDept และรายการ STATUS_LABEL
  (นิยามเดียวกับ meeting-overview/attendance-status)
- worker/src/routes/meeting-dashboard.js: 5 GET ตามหัวข้อ 2; mount /api/meeting/dashboard;
  requireRole('meeting_controller') + Cache-Control: no-store; ทุก GET เป็นอ่านล้วน
  ไม่มี auto-absent — มีเทส "GET ไม่มี side effect" เหมือนแบบ 2d
- db.js: เพิ่ม operator in(...) แบบเสริม (อ้างรายงาน); ทำเท่านั้นที่ชุดทดสอบแก้พร้อมกัน
- tests: tests/meeting-dashboard.test.js (ตัวช่วย — แปลงเคสจาก vitest ของ Express
  เป็น node:test) + tests/meeting-dashboard-routes.test.js (fake fetch + Hono
  app.request + นาฬิกาแช่แบบ 2d)

ข้อ 3b — POST /reason (แยกไฟล์ใหม่กันไว้ก่อน)
- worker/src/routes/dashboard-reason.js (หรือรวมในไฟล์เดียวกันถ้าเจ้าของพอใจ)
  มีขั้นตรวจ PIN ด้วย HMAC + ล็อก + audit + ตรวจ body strict
- ทดสอบ: 400 validation / 401 PIN / 423 + lockedUntil / 200 ok:false ทั้งสองกรณี
  / success + audit row (detail null, ไม่มีชื่อ/ไม่มี reason ใน audit row ในทดสอบด้วย)
  และ pin_hash แบบ bcrypt (ค่าปลอมในทดสอบ) → 401 เสมอ
  ตามพฤติกรรมที่ธงไว้ในหัวข้อ 5
- อย่าเปิดเส้นใหม่จนกระทั่ง 3b ทดสอบผ่าน

ท้ายรอบ (ทุก chunk): npm run typecheck, npm test, wrangler dev smoke บน 8787 (401/403
กับ /api/meeting/dashboard*; 404 สำหรับเส้นที่ยังไม่ mount) แล้วหยุดและยืนยันว่า port ถูกปล่อย

อย่าทำใน Phase 3 (ห้าม ข้ามเส้น):
- งาน auto-absent ทั้งหมด (Phase 4, ใช้ Cron)
- หน้า Vue dashboard (root src/ — ห้ามแตะ)
- เขียนฐานข้อมูลจริงใด ๆ, deploy, login, secret

 =================================================================
 10. ทางที่ต้องตัดสินใจจากเจ้าของ
 =================================================================

ทุกข้อตัดสินและอนุมัติแล้วโดยเจ้าของ (2026-10-31):

1) การนับ — อนุมัติแล้ว: คงการนับตาม Express เดิม dashboard นับล่าสุดต่อคน (latest-per-employee)
   overview และ monthly-summary นับทุกแถว
2) dashboard 'today.registered' — อนุมัติแล้ว: คง today.registered และ notYet ตาม Express
   ที่เขียนไว้ และเพิ่มเทสที่ชี้ความแตกต่างของสองค่านี้ชัด
3) bcrypt → HMAC — อนุมัติแล้ว: ใช้ HMAC สำหรับ POST /reason ตาม Phase 1;
   PIN ที่ยังเป็น bcrypt ต้องตั้งใหม่ผ่าน /api/auth/set-pin ตอน cutover;
   เจ้าของยอมรับข้อแลกเปลี่ยนด้านความปลอดภัยในหัวข้อ 5 ข้อ 2 แล้ว
4) periodLabel — อนุมัติแล้ว: คงป้ายคงที่ 'รายสัปดาห์ · ทุกวันอังคาร' ตาม Express
5) เขียน employee_credentials — ยอมรับแล้ว: ยอมรับการเขียน counter ที่ employee_credentials
   เมื่อ PIN ผิด
6) origin/CSRF — อนุมัติแล้ว: ไม่เพิ่ม CSRF หรือ origin check; hr_session cookie เป็น SameSite=Strict
7) ประวัติ auto-absent — อนุมัติตามร่างเดิม: ยืนยันแล้วว่า Phase 4 จะใช้ Cron + เขียน audit_logs เดิม;
   dashboard ใน Workers ตอบจากข้อมูลที่มีเท่านั้น (ไม่ trigger จาก GET และหน้าอาจแสดงค่าเก่า
   ถ้า cron ยังไม่ได้รัน — ดูหัวข้อ 6)

 =================================================================
 11. ต้นทุน (กลุ่มกฎ "ไม่มีบริการเสียเงิน")
 =================================================================

- ทั้งกลุ่มผูกกับ Supabase PostgREST เดิม + Web Crypto + built-in Intl ของ workerd
- ไม่มี dependency ใหม่; ไม่มีบริการเสริมเสียเงิน; bcrypt ถูกแทนด้วย HMAC ได้ในตัว
- ตารางและ index ปัจจุบันไม่ต้องอัปเกรด; ตรวจ quota ที่เคยรับไว้เท่าเดิม

 =================================================================
 12. บันทึกการตรวจระบบของรอบทำงานนี้
 =================================================================

- จาก worker/: npm test ถูกรันหลังอ่านข้อมูลเพื่อยืนยันว่าไม่ได้แตะไฟล์โค้ดใด;
  exit code บันทึกที่ท้ายไฟล์นี้ด้านล่าง
- ไม่เรียกเครือข่ายจริง; ไม่ deploy; ไม่เขียนฐานข้อมูล; มีสิทธิเขียนเฉพาะไฟล์เดียว (รายงานนี้)
- ไม่พิมพ์/log ค่า secret/PIN/token/hash/เลขบัตรประชาชน หรือ body จริงในทุกไฟล์และรายงาน

ผลทดสอบตอนจบรอบแก้ไขนี้: npm test (จาก worker/) → exit code 0
(tests 249 / pass 249 / fail 0 / skipped 0 — เท่าตัวของรอบก่อนแก้; ไม่แตะโค้ดใด ๆ)

 =================================================================
 13. การแก้ไขรอบนี้ (2026-10-31)
 =================================================================

- เปลี่ยนคำอ้างระยะการทำงานทุกจุดให้เป็น "Phase N" ตามเลขระยะ (1, 2, 2d, 3, 4) ทั้งไฟล์
  คงปี พ.ศ. เช่น 2569 ไว้ตามเดิม เพราะเป็นปีปฏิทินจริง
- หัวข้อ 5 ข้อ 2 เขียนใหม่ ชี้ชัด: HMAC บน PIN 6 หลัก ยิง brute force ได้เร็วถ้าผู้โจมตี
  ได้ทั้งฐานข้อมูลและ PIN_PEPPER; pepper เก็บเป็น Worker secret แยกจากฐานข้อมูล การรั่วของ
  ฐานข้อมูลเพียงอย่างเดียวไม่เปิดเผย PIN; ล็อก 5 ครั้ง / 15 นาที จำกัดเฉพาะการเดาออนไลน์เท่านั้น
  และบันทึกว่าเจ้าของยอมรับแล้ว (อ้างหัวข้อ 10 ข้อ 3)
- หัวข้อ 8 เรียบเรียงเรื่องป้าย Intl ให้ชัด: ถ้า workerd แปลงปี พ.ศ. หรือรูปเวลาต่างจาก Node
  ให้เขียนตัวแปลงป้ายของตัวเองพร้อมทดสอบ ค่าทดสอบคงไว้เท่าเดิม
- หัวข้อ 10 ทำเครื่องหมายอนุมัติทุกข้อตามคำตัดสินของเจ้าของ (การนับตาม Express;
  คง today.registered/notYet พร้อมเทสชี้ความแตกต่าง; HMAC ตาม Phase 1 + ตั้ง PIN ใหม่
  ตอน cutover + รับ trade-off หัวข้อ 5 ข้อ 2; คงป้ายคงที่ตาม Express; ยอมรับเขียน counter ที่ employee_credentials เมื่อ PIN ผิด; ไม่เพิ่ม CSRF/origin check และระบุ hr_session cookie
  เป็น SameSite=Strict; ข้อ 7 อนุมัติตามร่างเดิม)
- สถานะบนหัวเอกสารเปลี่ยนเป็น "อนุมัติแล้วตามคำแนะนำ — พร้อมเริ่ม 3a" และเพิ่มวันที่ 2026-10-31
- รัน npm test จาก worker/ และบันทึก exit code กับค่านับผลท้ายไฟล์ (exit 0; tests 249 /
  pass 249 / fail 0)
- ไม่แก้ไฟล์อื่น ไม่มีเขียนฐานข้อมูล ไม่มีเรียกเครือข่าย ไม่มี deploy; ไม่มีค่า secret/PIN/
  token/hash/เลขบัตรประชาชน หรือ body จริงในไฟล์นี้
