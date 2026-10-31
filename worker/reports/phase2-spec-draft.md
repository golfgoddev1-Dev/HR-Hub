# ร่างข้อกำหนด Phase 2 — งานประชุมและลงทะเบียน (ฉบับรออนุมัติ)

วันที่จัดทำ: 2026-10-30  
สถานะ: **ร่างเพื่อขออนุมัติ** ยังไม่เริ่มเขียนโค้ด Workers สำหรับ Phase 2  
ขอบเขตการทำงานรอบนี้: อ่านโค้ด Express และ Vue ที่เกี่ยวข้องเท่านั้น ไม่แก้โค้ดเดิม ไม่เขียนฐานข้อมูล ไม่เรียก Supabase และไม่อ่านค่าใน `.env.local`, `.dev.vars` หรือ `.test-account.env`

---

## 1. ขอบเขตและแหล่งอ้างอิง

### 1.1 ไฟล์ที่อ่าน

**Server / routes**
- `server/index.js`
- `server/routes/register.js`
- `server/routes/meeting-monthly.js`
- `server/routes/meeting-roster.js`
- `server/routes/meeting-overview.js`
- `server/routes/meeting-dashboard.js` (inventory เท่านั้น; Dashboard เป็น Phase 3)
- `server/routes/meeting.js`
- `server/middleware/require-role.js`
- `server/session-check.js`
- `server/session.js`
- `server/access.js`
- `server/config.js`

**Helper / rule modules**
- `server/meeting-window.js`
- `server/meeting-roster.js`
- `server/meeting-overview.js`
- `server/meeting-dashboard.js` (inventory เท่านั้น)
- `server/register-window.js`
- `server/attendance-status.js`
- `server/rate-limit.js`
- `server/unique-violation.js`
- `server/time.js`
- `server/auto-absent.js` (inventory เท่านั้น; Phase 4)
- `server/auto-absent-job.js` (inventory เท่านั้น; Phase 4)

**Vue pages**
- `src/pages/RegisterPage.vue`
- `src/pages/ControllerQrPage.vue`
- `src/pages/ControllerRosterPage.vue`
- `src/pages/ControllerOverviewPage.vue`

**เอกสาร/สคริปต์ประกอบ**
- `DEPLOY.md` (เฉพาะส่วนรายชื่อ env และ QR rotation)
- `scripts/check-meeting-types.js`
- `tests/meeting-window.test.js`
- `tests/register-window.test.js`
- `tests/meeting-overview.test.js`
- `tests/meeting-roster.test.js`
- `tests/rate-limit.test.js`
- `tests/unique-violation.test.js`

### 1.2 หลักการของ Phase 2

1. คงสัญญา HTTP เดิมของ Express ให้มากที่สุด: method, path, status, ชื่อ field, รูปร่าง response และข้อความ Thai ต้องตรงกัน
2. Phase 2 ไม่มี PIN และไม่มี bcrypt ใน endpoint ที่ทำ
3. ทุก endpoint ของ controller ต้องผ่าน `requireRole('meeting_controller')` และตอบ `Cache-Control: no-store`
4. การอ่าน/เขียนฐานข้อมูลต้องระบุตารางและคอลัมน์ให้ชัดก่อนเขียนโค้ด
5. ทุกจุดที่อาศัยเวลาไทยต้องใช้ `Asia/Bangkok` ไม่ใช้ timezone ของเครื่องหรือของ Worker
6. ห้ามคัดลอกข้อมูลจริงจากฐานข้อมูลลงในเอกสารหรือ test; test ใช้ fake fetch และข้อมูลสมมติ

---

## 2. สัญญา endpoint

### 2.0 ข้อตกลงร่วม

- Response เป็น JSON
- สำเร็จ: HTTP 200 และ `{ "ok": true, ... }`
- ผิดพลาด: `{ "ok": false, "message": "<ข้อความ>" }`
- Controller route ทุกตัว:
  - ไม่มี cookie `hr_session` ที่ใช้ได้ → **401** `ไม่ได้เข้าสู่ระบบ`
  - session ใช้ได้แต่ role ไม่ใช่ `meeting_controller` → **403** `ไม่มีสิทธิ์เข้าถึงส่วนนี้`
  - ตั้ง `Cache-Control: no-store`
- `requireRole` ตรวจ session ผ่าน `readSession` (รายละเอียดในข้อ 3.3)
- ตารางด้านล่างใช้ `R` = read, `W` = write/insert/update/upsert

### 2.1 Public registration

| # | Method / Path | Auth | Request และ validation | สำเร็จ 200 | Error status + ข้อความ Thai | Tables / Audit | Time zone / Rate limit |
|---|---|---|---|---|---|---|---|
| 1 | `GET /api/register/context?t=<token>` | ไม่มี (public; ต้องมี QR token) | query `t` เป็น string; ถ้าไม่มีหรือหาไม่พบ ถือว่า token ไม่ถูกต้อง | `{ok:true, meetingName, state, statuses, shifts, reasonStatuses, leaveStatus}`; ถ้ามี message จะเพิ่ม `message`; state `before` เพิ่ม `openTime`, `cutoffTime`; state `open` เพิ่ม `openTime`, `cutoffTime`, `employees[]` โดยแต่ละคนมี `employeeId`, `fullName`, `departmentName`, `positionName` | **404** `ลิงก์ไม่ถูกต้อง กรุณาสแกน QR ใหม่อีกครั้ง`; **429** `ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่`; **500** `ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง` | `meeting_types` R (lookup `qr_token`, `id`, `code`, `name`, `weekday`, `default_open_time`, `default_cutoff_time`); `meeting_sessions` R เฉพาะ monthly วันนี้ (`id`, `session_date`, `open_time`, `cutoff_time`); เมื่อ state `open`: `meeting_roster` R + `employees` R + `departments(name)` + `positions(name)`; audit: ไม่มี | ใช้ `bangkokToday` / เวลา Bangkok; state ตามข้อ 3.2; rate limit binding 100 ครั้ง / 60 วินาที ต่อ `context + IP` |
| 2 | `POST /api/register/submit` | ไม่มี (public; ต้องมี QR token) | body ต้อง strict และมีเฉพาะ `t` (string non-empty), `employeeId` (UUID), `statusCode` (string), `shift` (string/null/ไม่ส่ง), `reason` (string/null/ไม่ส่ง); `statusCode` ต้องแปลงเป็นรหัสได้; ถ้า status เป็น `ลาประชุม` ต้องมี `shift` เป็น `กะ A` หรือ `กะ B`; status อื่นต้องไม่มี shift; status `ติดงานด่วน` หรือ `ลาประชุม` ต้องมี reason ที่ trim แล้วยาว 1–200; status อื่นต้องไม่มี reason | `{ok:true, summary:{name, dept, level, status, shift, meetingName, savedAt}}`; `savedAt` เป็นข้อความวันที่/เวลาไทย | **400** `ข้อมูลไม่ถูกต้อง` (body/status/shift/reason ผิด); **404** `ลิงก์ไม่ถูกต้อง กรุณาสแกน QR ใหม่อีกครั้ง`; **403** ข้อความ state จากข้อ 3.2 (`ยังไม่ถึงเวลาลงทะเบียนเข้าประชุม`, `หมดเวลาการลงทะเบียนเข้าประชุมแล้ว`, `ยังไม่ได้กำหนดรอบประชุม กรุณาแจ้งผู้ดูแล`); **400** `ไม่พบรายชื่อนี้ในรายชื่อการประชุม`; **409** `ท่านได้ลงทะเบียนสำหรับประชุมนี้แล้ว`; **429** `ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่`; **500** `ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง` | `meeting_types` R; `meeting_sessions` R และอาจ W (sup: insert ถ้ายังไม่มี session วันนี้); `meeting_roster` R; `employees` R (`id`, `full_name`, `department_id`, `position_id`, `departments(name)`, `positions(name)`); `meeting_attendance` R (duplicate) + W (`session_id`, `employee_id`, `status_code`, `reason`, `shift`, `department_id`, `position_id`, `registered_at`); audit: ไม่มี | ใช้ state/Window ตามข้อ 3.2; `registered_at` เป็น ISO เวลาปัจจุบัน; `savedAt` แสดง Bangkok; rate limit binding 30 ครั้ง / 60 วินาที ต่อ `submit + IP` และ 60 ครั้ง / 60 วินาที ต่อ `submit + token`; unique violation `23505` → 409 |

หมายเหตุ public:
- `statuses` = `['เข้าร่วมประชุม','ไม่เข้าร่วม','ติดงานด่วน','ลาประชุม']`
- `shifts` = `['กะ A','กะ B']`
- `reasonStatuses` = `['ติดงานด่วน','ลาประชุม']`
- `leaveStatus` = `ลาประชุม`
- `state` เป็นหนึ่งใน `before`, `open`, `after`, `no_session`
- `GET /context` ไม่ต้องมี session; การเห็นรายชื่อพนักงานขึ้นกับ token เท่านั้น
- mapping ของ `statusCode`: `เข้าร่วมประชุม` → `attended`, `ไม่เข้าร่วม` → `not_attended`, `ติดงานด่วน` → `urgent_busy`, `ลาประชุม` → `leave`
- `shift` ถูกบันทึกเฉพาะสถานะ `ลาประชุม`; `reason` ถูกบันทึกเฉพาะ `ติดงานด่วน` และ `ลาประชุม`; สถานะอื่นบันทึกเป็น null

### 2.2 QR และ session settings (controller)

| # | Method / Path | Auth | Request และ validation | สำเร็จ 200 | Error status + ข้อความ Thai | Tables / Audit | Time zone / Rate limit |
|---|---|---|---|---|---|---|---|
| 3 | `GET /api/meeting/types` | `meeting_controller` | ไม่มี body/query | `{ok:true, types:[{code,name,registerUrl,weekday,openTime,cutoffTime}]}` เรียงตาม `code` จากน้อยไปมาก; `weekday` เป็น number หรือ null; `openTime`/`cutoffTime` ตัดเป็น `HH:mm` หรือ null; `registerUrl` มาจาก `APP_ORIGIN` + `/meeting/register?t=<qr_token>` | **500** `ไม่สามารถบันทึกได้ กรุณาลองใหม่`; 401/403 ตามข้อ 2.0 | `meeting_types` R (`code`, `name`, `qr_token`, `weekday`, `default_open_time`, `default_cutoff_time`); audit: ไม่มี | ไม่มี timezone logic; ไม่มี rate limit |
| 4 | `POST /api/meeting/qr/rotate` | `meeting_controller` | body strict `{code: 'sup' หรือ 'monthly'}` | `{ok:true, registerUrl}`; token ใหม่เป็น 64 hex characters จาก 32 random bytes | **400** `ข้อมูลไม่ถูกต้อง`; **400** `ไม่พบประเภทการประชุม`; **500** `ไม่สามารถบันทึกได้ กรุณาลองใหม่`; 401/403 ตามข้อ 2.0 | `meeting_types` W (`qr_token` ตาม `code`) + R (`id`); audit: `meeting_qr_rotated` entity `meeting_type`, entity_id = type id, detail null | ไม่มี timezone; ไม่มี rate limit |
| 5 | `PUT /api/meeting/window` | `meeting_controller` | body strict `{openTime:string, cutoffTime:string, code?:string}`; ถ้า `code` มีค่าและไม่ใช่ `sup` → 400; เวลาต้องตรง `^([01]\d\|2[0-3]):[0-5]\d$`; `openTime < cutoffTime` แบบ string | `{ok:true}` | **400** `ข้อมูลไม่ถูกต้อง`; **400** `แก้ไขได้เฉพาะการประชุมหัวหน้างาน`; **400** `รูปแบบเวลาไม่ถูกต้อง`; **400** `เวลาเปิดรับต้องก่อนเวลาปิดรับ`; **400** `ไม่พบประเภทการประชุม`; **500** `ไม่สามารถบันทึกได้ กรุณาลองใหม่`; 401/403 ตามข้อ 2.0 | `meeting_types` R (`id`, `default_open_time`, `default_cutoff_time` where `code='sup'`) + W (`default_open_time`, `default_cutoff_time`); audit: `meeting_window_updated` entity `meeting_type`, detail JSON `{old:{openTime,cutoffTime}, new:{openTime,cutoffTime}}` | เวลาเป็นเวลาไทยแบบ `HH:mm`; ไม่มี rate limit |
| 6 | `GET /api/meeting/monthly-session` | `meeting_controller` | ไม่มี body/query | `{ok:true, sessions:[{id,sessionDate,openTime,cutoffTime}]}`; เฉพาะ monthly; `session_date >= bangkokToday()`; เรียงวันที่จากน้อยไปมาก; จำกัด 12 รายการ | **400** `ประเภทการประชุมไม่ถูกต้อง`; **500** `ไม่สามารถบันทึกได้ กรุณาลองใหม่`; 401/403 ตามข้อ 2.0 | `meeting_types` R (`id` where `code='monthly'`); `meeting_sessions` R (`id`, `session_date`, `open_time`, `cutoff_time`); audit: ไม่มี | ใช้ `bangkokToday()`; ไม่มี rate limit |
| 7 | `PUT /api/meeting/monthly-session` | `meeting_controller` | body strict `{sessionDate, openTime, cutoffTime}`; `sessionDate` ตรง `^\d{4}-\d{2}-\d{2}$` และต้องเป็นวันที่จริง (UTC round-trip); เวลาผ่าน `validateWindow`; `sessionDate >= bangkokToday()` | `{ok:true}` | **400** `ข้อมูลไม่ถูกต้อง`; **400** `รูปแบบเวลาไม่ถูกต้อง`; **400** `เวลาเปิดรับต้องก่อนเวลาปิดรับ`; **400** `เลือกวันที่ตั้งแต่วันนี้เป็นต้นไป`; **400** `ประเภทการประชุมไม่ถูกต้อง`; **500** `ไม่สามารถบันทึกได้ กรุณาลองใหม่`; 401/403 ตามข้อ 2.0 | `meeting_types` R (`id` where `code='monthly'`); `meeting_sessions` W แบบ upsert on conflict `(meeting_type_id, session_date)` พร้อม `cycle_key = monthly-<sessionDate>`, `open_time`, `cutoff_time`; audit: `meeting_monthly_session_set` entity `meeting_session`, detail JSON `{sessionDate,openTime,cutoffTime}` | เปรียบเทียบวันที่กับ `bangkokToday()`; ไม่มี rate limit |

### 2.3 Roster (controller)

| # | Method / Path | Auth | Request และ validation | สำเร็จ 200 | Error status + ข้อความ Thai | Tables / Audit | Time zone / Rate limit |
|---|---|---|---|---|---|---|---|
| 8 | `GET /api/meeting/roster` | `meeting_controller` | ไม่มี body/query | `{ok:true, count, members:[{employeeId,employeeCode,fullName,departmentName,positionName}]}`; เฉพาะ roster ของ `sup` ที่ `is_active=true`; เรียงชื่อแบบ `th` | **400** `ประเภทการประชุมไม่ถูกต้อง`; **500** `ไม่สามารถบันทึกได้ กรุณาลองใหม่`; 401/403 ตามข้อ 2.0 | `meeting_types` R (`id` where `code='sup'`); `meeting_roster` R (sup, active); `employees` R + `departments(name)` + `positions(name)`; audit: ไม่มี | ไม่มี timezone; ไม่มี rate limit |
| 9 | `GET /api/meeting/roster/search?q=<query>` | `meeting_controller` | query `q` ถูก trim และยุบช่องว่างซ้ำเป็นช่องเดียว; ถ้ายาวน้อยกว่า 2 ตัวอักษร → คืน `{ok:true, results:[]}` ทันที (ไม่ใช่ error) | `{ok:true, results:[{employeeId,employeeCode,fullName,departmentName,positionName}]}`; ค้น `employees.is_active=true` จาก `full_name` หรือ `employee_code` แบบ ilike; สูงสุด 10 ต่อ query; รวมผล ซ้ำตัดออก; ตัดคนที่อยู่ใน roster sup active แล้ว; เรียงชื่อไทย; สูงสุด 10 | **400** `ประเภทการประชุมไม่ถูกต้อง`; **500** `ไม่สามารถบันทึกได้ กรุณาลองใหม่`; 401/403 ตามข้อ 2.0 | `meeting_types` R (sup); `meeting_roster` R (sup active); `employees` R + `departments(name)` + `positions(name)`; audit: ไม่มี | ไม่มี timezone; ไม่มี rate limit; escape `\`, `%`, `_` ก่อนสร้าง pattern |
| 10 | `POST /api/meeting/roster/add` | `meeting_controller` | body strict `{employeeId: UUID}` | `{ok:true}`; upsert เข้า roster ทั้ง `sup` และ `monthly`; `is_active=true`; `created_by` = controller employee id; `created_at` = now ISO | **400** `ข้อมูลไม่ถูกต้อง`; **400** `ไม่พบพนักงานที่ใช้งานอยู่`; **400** `ประเภทการประชุมไม่ถูกต้อง` (ถ้า sup หรือ monthly หาย); **500** `ไม่สามารถบันทึกได้ กรุณาลองใหม่`; 401/403 ตามข้อ 2.0 | `employees` R (`id`, `is_active`); `meeting_types` R (`id`, `code` สำหรับ sup/monthly); `meeting_roster` W upsert on conflict `(meeting_type_id, employee_id)`; audit: ไม่มี | ไม่มี timezone; ไม่มี rate limit |
| 11 | `POST /api/meeting/roster/remove` | `meeting_controller` | body strict `{employeeId: UUID}` | `{ok:true}`; update `is_active=false` สำหรับ employee นี้ในทั้ง `sup` และ `monthly` | **400** `ข้อมูลไม่ถูกต้อง`; **400** `ประเภทการประชุมไม่ถูกต้อง`; **404** `ไม่พบรายชื่อนี้` (ไม่มีแถวถูก update); **500** `ไม่สามารถบันทึกได้ กรุณาลองใหม่`; 401/403 ตามข้อ 2.0 | `meeting_types` R (sup/monthly); `meeting_roster` W (`is_active=false` where employee_id และ type in [sup, monthly]); audit: ไม่มี | ไม่มี timezone; ไม่มี rate limit |

### 2.4 Overview (controller, Phase 2)

| # | Method / Path | Auth | Request และ validation | สำเร็จ 200 | Error status + ข้อความ Thai | Tables / Audit | Time zone / Rate limit |
|---|---|---|---|---|---|---|---|
| 12 | `GET /api/meeting/overview` | `meeting_controller` | ไม่มี body/query | `{ok:true, today:{dateText, sup, monthly}}`; `sup`/`monthly` เป็น `{hasSession:false, rosterCount}` หรือ `{hasSession:true, openTime, cutoffTime, phase, counts, rosterCount}`; `phase` = `not_open` / `open` / `closed` / `none`; `counts` = `attended`, `not_attended`, `urgent_busy`, `leave`, `total` | **500** `ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง`; 401/403 ตามข้อ 2.0 | `meeting_types` R (sup/monthly); `meeting_sessions` R วันนี้; `meeting_attendance` R (`status_code` ตาม session วันนี้); `meeting_roster` R (count active); audit: ไม่มี | `dateText` ภาษาไทย timezone Bangkok; `bangkokToday()` + weekday ของวันที่; `sessionPhase` ใช้เวลา Bangkok; อาจ trigger auto-absent (ดูข้อ 3.9) |
| 13 | `GET /api/meeting/overview/pending?code=sup\|monthly` | `meeting_controller` | query strict `{code: 'sup'\|'monthly'}` | `{ok:true, code, sessionDate, pending:[{fullName,departmentName,positionName}]}`; ถ้าไม่มี session วันนี้ → `sessionDate:null`, `pending:[]`; ถ้ามี session → ตัดคนที่มี attendance row ใด ๆ ของ session นี้ออก; เรียงชื่อไทย | **400** `ประเภทการประชุมไม่ถูกต้อง`; **500** `ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง`; 401/403 ตามข้อ 2.0 | `meeting_types` R; `meeting_sessions` R วันนี้; `meeting_roster` R active; `meeting_attendance` R (`employee_id` by session); audit: ไม่มี | `bangkokToday()`; ไม่มี rate limit |

หมายเหตุ overview: `sup.hasSession = true` เมื่อ weekday วันนี้ตรงกับ `meeting_types.weekday` แม้ยังไม่มี row `meeting_sessions` ของวันนี้ (counts จะเป็น 0); ส่วน `monthly.hasSession = true` เฉพาะเมื่อมี row session ของวันนี้

### 2.5 Inventory เท่านั้น: Dashboard (Phase 3)

endpoint กลุ่มนี้ยัง **ไม่ทำใน Phase 2** แต่บันทึกไว้เพื่อไม่ให้ปนกับ 2a–2d

| # | Method / Path | Auth | Request / validation | Success | Error status + ข้อความ Thai | Tables / Audit | หมายเหตุ |
|---|---|---|---|---|---|---|---|
| 14 | `GET /api/meeting/dashboard` | `meeting_controller` | query `code` (`sup`/`monthly`), `mode` (`day`/`month`/`year`, optional), `value` (string max 10, optional); schema ไม่ strict (field เกินถูก strip) | `{ok:true, meeting, updated, todayKey, current, statuses, rosterCount, today, depts, history}` | **400** `ข้อมูลไม่ถูกต้อง`; **400** `ประเภทการประชุมไม่ถูกต้อง`; **500** `ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง`; 401/403 | `meeting_types`, `meeting_sessions`, `meeting_attendance`, `meeting_roster`, `employees`; audit: ไม่มี | trigger auto-absent; history ใช้ Bangkok day/month keys |
| 15 | `GET /api/meeting/dashboard/cycles?code=...` | `meeting_controller` | query `code` enum | `{ok:true, options:[{key,label}]}` | **400** `ข้อมูลไม่ถูกต้อง`; **400** `ประเภทการประชุมไม่ถูกต้อง`; **500** `ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง` | `meeting_types`, `meeting_sessions`, `meeting_attendance`; audit: ไม่มี | Phase 3 |
| 16 | `GET /api/meeting/dashboard/dept` | `meeting_controller` | query `code` enum, `cycle` regex `YYYY-MM` หรือ `YYYY-MM-DD`, `dept` string 1–200 | `{ok:true, dept, cycle:{key,label}, total, counts, people, notYet}` | **400** `ข้อมูลไม่ถูกต้อง`; **400** `ประเภทการประชุมไม่ถูกต้อง`; **500** `ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง` | `meeting_types`, `meeting_roster`, `meeting_sessions`, `meeting_attendance`, `employees`; audit: ไม่มี | Phase 3 |
| 17 | `GET /api/meeting/dashboard/registrants` | `meeting_controller` | query `code` enum, `cycle` regex | `{ok:true, cycle:{key,label}, total, items:[{name,departmentName,positionName,status,shift,time}]}` | **400** `ข้อมูลไม่ถูกต้อง`; **400** `ประเภทการประชุมไม่ถูกต้อง`; **500** `ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง` | `meeting_types`, `meeting_sessions`, `meeting_attendance`, `employees`; audit: ไม่มี | Phase 3 |
| 18 | `GET /api/meeting/dashboard/monthly-summary` | `meeting_controller` | query `month` regex `YYYY-MM` | `{ok:true, month:{key,label}, totalMeetings, depts, top}` | **400** `ข้อมูลไม่ถูกต้อง`; **400** `ประเภทการประชุมไม่ถูกต้อง`; **500** `ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง` | `meeting_types`, `meeting_sessions`, `meeting_attendance`, `meeting_roster`, `employees`; audit: ไม่มี | Phase 3 |
| 19 | `POST /api/meeting/dashboard/reason` | `meeting_controller` | body strict `{pin: string 6 หลัก, code:'sup'\|'monthly', cycle: regex, employeeId: UUID}` | `{ok:true, status, reason}`; กรณีไม่มีข้อมูลหรือสถานะไม่ต้องมีเหตุผล ยังตอบ **200** แต่ `ok:false` | **400** `ข้อมูลไม่ถูกต้อง`; **401** `เลขบัตรประชาชนหรือ PIN ไม่ถูกต้อง`; **423** `บัญชีถูกล็อกชั่วคราว` + `lockedUntil`; **500** `ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง`; กรณีไม่พบแถว/สถานะไม่ต้องมีเหตุผล → **200** `ok:false` พร้อม `ไม่พบข้อมูลของคนนี้ในรอบนี้` หรือ `สถานะนี้ไม่มีเหตุผล` | `auth_sessions` (ผ่าน session), `employee_credentials` (ตรวจ PIN), `meeting_*`, `employees`; audit: `dashboard_reason_viewed` entity `meeting_attendance`, entity_id = attendance id, detail null | Phase 3; ใช้ PIN/bcrypt ใน Express (ดูข้อ 3.4) |

### 2.6 Inventory เท่านั้น: Auto-absent (Phase 4)

ไม่มี HTTP endpoint ใน Phase 2

- เริ่มจาก `server/index.js` เมื่อ `AUTO_ABSENT_ENABLED !== 'false'`
- ครั้งแรกหลังเริ่ม 60 วินาที แล้วทุก 10 นาที
- ถูก trigger แบบ fire-and-forget จาก `GET /api/register/context`, `GET /api/meeting/overview`, `GET /api/meeting/dashboard`
- หน้าต่างย้อนหลัง 2 วัน; ตัดข้อมูลเมื่อเลย cutoff ไม่เกิน 48 ชั่วโมง
- สร้าง `meeting_sessions` ของ `sup` ให้อัตโนมัติเมื่อถึง cutoff ใน weekday ที่กำหนด และไม่ใช่วัน skip
- เขียน `meeting_attendance` สถานะ `not_attended` ให้คนใน roster ที่ยังไม่มี attendance row
- เขียน `audit_logs` action `auto_absent_done`, entity `meeting_session`, actor_id null, detail JSON `{count}`
- อ่าน `meeting_skip_dates.skip_date`
- ต้องใช้ `ctx.waitUntil` หรือ cron/queue ใน Workers; ยังไม่ใช่ Phase 2

---

## 3. กติกาข้าม endpoint

### 3.1 QR token: generation และ verification

**Generation**
- `newQrToken()` = `randomBytes(32).toString('hex')` → 64 ตัวอักษร hex ตัวพิมพ์เล็ก
- เก็บใน `meeting_types.qr_token`
- `buildRegisterUrl(origin, token)`:
  - ตัด whitespace หัวท้ายของ `origin`
  - ตัด `/` ท้ายสุดออก
  - ได้ `<origin>/meeting/register?t=<encodeURIComponent(token)>`
- `APP_ORIGIN` ต้องมีค่า; ถ้าว่างจะ throw และ route ตอบ 500

**Verification**
- `findTypeByToken` ค้น `meeting_types` ด้วย `.eq('qr_token', token).maybeSingle()` เท่านั้น
- ไม่มี HMAC, ไม่มี signature, ไม่มี expiry ในโค้ดปัจจุบัน
- token ใช้ได้จนกว่าจะ rotate; การ rotate เขียน `qr_token` ใหม่ทันทีและ token เก่าใช้ไม่ได้ทันที
- โค้ดค้นด้วย `maybeSingle()` จึงสมมติว่า `qr_token` ไม่ซ้ำ; ต้องยืนยันว่ามี unique constraint ในฐานข้อมูล
- **ข้อค้นพบสำคัญ:** `MEETING_QR_SECRET` ปรากฏใน `DEPLOY.md` และ checklist การ rotate แต่ **ไม่มีโค้ดใดอ่านค่านี้เลย** ทั้งใน `server/`, `scripts/` และ `src/` Поэтому "การหมุน secret" ในเอกสารไม่มีผลกับ token จริง ต้องตัดสินใจก่อน Phase 2 (ดูข้อ 5)

### 3.2 Scan window และ cutoff

`resolveScanState({now, typeCode, meetingDefaults, sessions})`

- ค่าเริ่มต้น timezone: `Asia/Bangkok`
- `bangkokToday(now)` → `YYYY-MM-DD` ด้วย `Intl.DateTimeFormat('en-CA')`
- `bangkokMoment(now)` → `{date, time: HH:mm, weekday}`; weekday คำนวณจาก UTC date parts ของวันไทย
- `HH:mm` เปรียบเทียบแบบ string; ตัดค่าที่มีวินาทีด้วย `slice(0,5)`

**sup**
- ถ้า `weekday` วันนี้ไม่ตรง `meetingDefaults.weekday` → `no_session`
- ถ้า default open/cutoff ว่าง → `no_session`
- ถ้า `nowTime < openTime` → `before` พร้อม `openTime`, `cutoffTime`
- ถ้า `nowTime >= cutoffTime` → `after`
- อย่างอื่น → `open` พร้อม session `{sessionDate: today, openTime, cutoffTime}`
- **ไม่ต้องมี row `meeting_sessions` ก่อน**; ตอน submit จะสร้างให้ถ้ายังไม่มี

**monthly**
- หา session ที่ `sessionDate === today` จาก `meeting_sessions`
- ไม่มี session หรือเวลา null → `no_session`
- ใช้ `openTime`/`cutoffTime` จาก session
- boundary เหมือน sup: ก่อน open = `before`, ตั้งแต่ cutoff = `after`

**ข้อความ**
- `before`: `ยังไม่ถึงเวลาลงทะเบียนเข้าประชุม`
- `after`: `หมดเวลาการลงทะเบียนเข้าประชุมแล้ว`
- `no_session`: `ยังไม่ได้กำหนดรอบประชุม กรุณาแจ้งผู้ดูแล`

**การสร้าง session ของ sup ตอน submit**
- หา session วันนี้ก่อน
- ถ้าไม่มี insert `{meeting_type_id, session_date: today, cycle_key: 'sup-<today>', open_time: default, cutoff_time: default}`
- ถ้า insert ชน unique (`23505`) ให้อ่านซ้ำ; ถ้ายังไม่พบจึง throw → 500
- monthly ไม่สร้าง session อัตโนมัติใน submit; ถ้าไม่มี session จะได้ `no_session` → 403

### 3.3 Cookie/session ของ controller

- ชื่อ cookie: `hr_session`
- `requireRole('meeting_controller')` เรียก `readSession(req)`
- `readSession` ตรวจตามลำดับ:
  1. ไม่มี token → fail
  2. `auth_sessions` where `token_hash = sha256(token)`, `revoked_at is null`, `expires_at > now`; ไม่พบ → fail
  3. `now - last_active_at > 15 นาที` → set `revoked_at` แล้ว fail
  4. โหลด `employees.id, is_active`; ไม่พบหรือไม่ active → revoke แล้ว fail
  5. `allowedLoginTypesFor(employee_id)` ต้องมี `login_role`; ไม่มี → revoke แล้ว fail
  6. update `last_active_at = now`
  7. ถ้า role เป็น employee ให้ตรวจ `leave_requests` pending เพื่อสร้าง `redirectTo` (ไม่เกี่ยวกับ Phase 2 controller)
- `allowedLoginTypesFor` priority: `hr_admins` → `hr`, `meeting_admins` → `meeting_controller`, `system_admins` → `system_admin`, ไม่อยู่ในตารางใด → `employee`
- `requireRole` ตอบ 401 `ไม่ได้เข้าสู่ระบบ` หรือ 403 `ไม่มีสิทธิ์เข้าถึงส่วนนี้`

### 3.4 bcrypt / PIN

- **Phase 2 endpoint ทั้งหมดในข้อ 2.1–2.4 ไม่มี PIN และไม่มี bcrypt**
- PIN ปรากฏเฉพาะ:
  - Phase 1 auth (`login`, `set-pin`)
  - Phase 3 `POST /api/meeting/dashboard/reason` ซึ่งเรียก `verifyLoginPin` และใน Express ใช้ `bcrypt.compare`
- Workers Phase 1 เปลี่ยนการเก็บ PIN เป็น HMAC-SHA256 แล้ว ดังนั้น dashboard reason ใน Phase 3 ต้องออกแบบให้ตรงกับ HMAC ไม่ใช่ bcrypt
- Auto-absent ไม่ใช้ PIN

### 3.5 Time zone

- ทุก business day ใช้ `Asia/Bangkok`
- `bangkokToday()` ใช้ `en-CA` เพื่อให้ได้ `YYYY-MM-DD`
- `bangkokMoment()` ใช้ `en-GB` แบบ `hourCycle: 'h23'`
- `sessionPhase()` ใช้เวลา Bangkok และคืน `not_open` / `open` / `closed` / `none`
- `formatSavedAt()` วันที่ภาษาไทย + เวลา `en-GB` Bangkok
- `formatDateText()` วันภาษาไทย Bangkok
- `PUT monthly-session` เปรียบเทียบ `sessionDate < bangkokToday()` แบบ string
- Dashboard history (Phase 3) ใช้ Bangkok day keys และหน้าต่าง 12 วัน/12 เดือน
- Auto-absent (Phase 4) ใช้ offset +7 ชั่วโมง, หน้าต่าง 48 ชั่วโมง, ย้อนหลัง 2 วัน
- Workers ต้องตรวจว่า `Intl` และ `timeZone: 'Asia/Bangkok'` ทำงานใน workerd/compatibility date ที่ใช้

### 3.6 Rate limit

- ใช้ SQLite-backed Durable Objects (`[[durable_objects.bindings]]` + `[[migrations]] new_sqlite_classes`) period 60 วินาที; ไม่มี in-memory `Map`
- `RL_CONTEXT_IP` → `ContextRateLimiter`: 100 ครั้ง / 60 วินาที, key `context|<ip>`
- `RL_SUBMIT_IP` → `SubmitIpRateLimiter`: 30 ครั้ง / 60 วินาที, key `submit|<ip>`
- `RL_SUBMIT_TOKEN` → `SubmitTokenRateLimiter`: 60 ครั้ง / 60 วินาที, key `submit|<sha256hex(token)>` (ไม่ใช้ token ดิบเป็น key)
- ip มาจาก `CF-Connecting-IP`; ถ้าไม่มีใช้ `'unknown'`
- เรียก limiter หลัง cheap preflight/body shape และก่อนการเรียกฐานข้อมูล
- เกิน → 429 `ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่`
- binding หาย, object error หรือ response ผิดรูป → 503 `ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง` (fail closed)
- Durable Object ต่อ key ทำให้ตัวนับใช้ร่วมกันทุก Cloudflare location
- ไม่มี rate limit บน controller routes

### 3.7 Audit, logging, cache

**Audit ที่เขียนใน Phase 2**
- `meeting_qr_rotated` (qr rotate)
- `meeting_window_updated` (window)
- `meeting_monthly_session_set` (monthly PUT)

**Audit ที่ไม่เขียน**
- register context/submit
- roster get/search/add/remove
- overview / pending

**Audit ใน Phase 3/4**
- `dashboard_reason_viewed`
- `auto_absent_done`

**Cache**
- ทุก route group ตั้ง `Cache-Control: no-store` ผ่าน `router.use`

**Logging**
- register: log `code`, `name`, `constraint` เท่านั้น
- monthly: log `code` หรือ `name`
- roster: log `code` หรือ `{name,message}` (มี message)
- meeting types: log `{name, code, message, details, hint}` — ควรลดรายละเอียดใน Workers
- dashboard/overview: log `code` หรือ `name`
- ห้าม log body, PIN, token, ข้อมูลพนักงาน

### 3.8 ตาราง/คอลัมน์ที่เกี่ยวข้อง (อนุมานจาก query ในโค้ด)

- `meeting_types`: `id`, `code`, `name`, `qr_token`, `weekday`, `default_open_time`, `default_cutoff_time`
- `meeting_sessions`: `id`, `meeting_type_id`, `session_date`, `cycle_key`, `open_time`, `cutoff_time`; unique `(meeting_type_id, session_date)`
- `meeting_roster`: `meeting_type_id`, `employee_id`, `is_active`, `created_by`, `created_at`; unique `(meeting_type_id, employee_id)`
- `meeting_attendance`: `id`, `session_id`, `employee_id`, `status_code`, `reason`, `shift`, `department_id`, `position_id`, `registered_at`; unique `(session_id, employee_id)`
- `employees`: `id`, `employee_code`, `full_name`, `is_active`, `department_id`, `position_id`
- `departments`: `name`; `positions`: `name`
- `audit_logs`: `actor_id`, `action`, `entity`, `entity_id`, `detail`
- `auth_sessions`: `id`, `employee_id`, `token_hash`, `last_active_at`, `expires_at`, `revoked_at`, `login_role`
- `hr_admins`, `meeting_admins`, `system_admins`: `employee_id`
- `leave_requests`: `approver_id`, `status` (ใช้ใน readSession)
- `meeting_skip_dates`: `skip_date` (Phase 4)
- `employee_credentials`: ใช้ใน Phase 3 dashboard reason (`pin_hash`, `failed_attempts`, `locked_until`)

> หมายเหตุ: รายชื่อคอลัมน์ข้างต้นมาจาก select/insert/upsert ในโค้ด ไม่ได้ตรวจ schema จริงในฐานข้อมูล

---

## 4. การแบ่ง Phase 2 เป็น chunk ที่ตรวจง่าย

### 2a — Public registration

**ขอบเขต**
- `GET /api/register/context`
- `POST /api/register/submit`
- window resolver, attendance status mapping, rate-limit binding helper, Turnstile flag

**ไฟล์ที่สร้างใน `worker/`**
- `src/routes/register.js`
- `src/register-window.js`
- `src/attendance-status.js`
- `src/rate-limit.js` (binding helper)
- `src/turnstile.js` (Siteverify, เปิดด้วย `TURNSTILE_ENABLED`; ค่าเริ่มต้นปิด)
- `tests/register-window.test.js`
- `tests/register-routes.test.js`
- `tests/rate-limit.test.js`
- แก้ `src/app.js` เพื่อ mount `/api/register` (เฉพาะเมื่อถึงขั้นลงมือ)

**เทสที่ต้องมี**
- context: token หาย/ไม่พบ → 404; state before/open/after/no_session; payload ครบ; employees เฉพาะตอน open; monthly session วันนี้; sup weekday ผิด
- submit: strict body; status แปลงไม่ได้; shift ผิด; reason ว่าง/ยาวเกิน/ส่งมาในสถานะที่ไม่ต้องใช้; roster ไม่พบ; employee ไม่พบ; duplicate; unique race → 409; before/after/no_session → 403; sup สร้าง session; monthly ไม่มี session → 403; summary/savedAt
- rate limit: binding 100/30/60 ต่อ 60 วินาที; 429; binding หาย/throw → 503; แยก key ต่อ IP และ token
- Turnstile: ปิด = ไม่เรียก Siteverify และ body เดิม; เปิด = ต้องมี token, ไม่ผ่าน → 403, error → 503
- ไม่มี PIN/token/hash/ข้อมูลจริงใน response หรือ log

**สัญญา Express ที่ต้องตรง**
- status/ข้อความตามตาราง 2.1
- response shape ตามตาราง 2.1
- `Cache-Control: no-store`
- `statusCode` รับเฉพาะ label 4 ตัว; shift/reason ตามกฎ

**ยังไม่ทำ**
- auto-absent trigger (ต้องรอคำตอบข้อ 5)
- dashboard/Phase 3

### 2b — QR และ session settings

**ขอบเขต**
- `GET /api/meeting/types`
- `POST /api/meeting/qr/rotate`
- `PUT /api/meeting/window`
- `GET/PUT /api/meeting/monthly-session`

**ไฟล์ที่สร้างใน `worker/`**
- `src/routes/meeting.js`
- `src/routes/meeting-monthly.js`
- `src/meeting-window.js`
- `tests/meeting-window.test.js`
- `tests/meeting-qr-routes.test.js`
- `tests/meeting-monthly-routes.test.js`
- แก้ `src/app.js` เพื่อ mount

**เทสที่ต้องมี**
- types: APP_ORIGIN; registerUrl; ตัด trailing slash; weekday/null; time format; 500 เมื่อ env หาย
- rotate: body strict; code sup/monthly; token 64 hex ใหม่; token เก่าใช้ไม่ได้; audit; 400 not found
- window: regex; open >= cutoff; code อื่น → 400; update + audit; read failure
- monthly GET: เฉพาะ >= วันนี้; order; limit 12; 400 type
- monthly PUT: date จริง/เท็จ; past; time validation; upsert; audit
- auth 401/403 ทุก route

**สัญญา Express ที่ต้องตรง**
- ตาราง 2.2
- ข้อความ Thai ทุกข้อ
- audit action/entity/detail
- `Cache-Control: no-store`

### 2c — Roster

**ขอบเขต**
- `GET /api/meeting/roster`
- `GET /api/meeting/roster/search`
- `POST /api/meeting/roster/add`
- `POST /api/meeting/roster/remove`

**ไฟล์ที่สร้างใน `worker/`**
- `src/routes/meeting-roster.js`
- `src/meeting-roster.js` (normalize/validate query)
- `tests/meeting-roster.test.js` (helper)
- `tests/meeting-roster-routes.test.js`
- แก้ `src/app.js` เพื่อ mount

**เทสที่ต้องมี**
- query < 2 ตัวอักษร → 200 results []
- trim/ยุบช่องว่าง; ilike escape; merge/dedupe; ตัดคนใน roster; limit 10; เรียงชื่อไทย
- add: UUID; employee inactive/ไม่พบ → 400; type หาย → 400; upsert 2 types; created_by/created_at
- remove: update 2 types; ไม่มีแถว → 404
- auth 401/403; 500; no-store

**สัญญา Express ที่ต้องตรง**
- ตาราง 2.3
- ข้อความ `ไม่พบพนักงานที่ใช้งานอยู่`, `ไม่พบรายชื่อนี้`, `ประเภทการประชุมไม่ถูกต้อง`, `ไม่สามารถบันทึกได้ กรุณาลองใหม่`

### 2d — Overview

**ขอบเขต**
- `GET /api/meeting/overview`
- `GET /api/meeting/overview/pending`

**ไฟล์ที่สร้างใน `worker/`**
- `src/routes/meeting-overview.js`
- `src/meeting-overview.js` (countByStatus, findPending, sessionPhase)
- `tests/meeting-overview.test.js` (helper)
- `tests/meeting-overview-routes.test.js`
- แก้ `src/app.js` เพื่อ mount

**เทสที่ต้องมี**
- weekday sup; hasSession false; phase not_open/open/closed/none; counts; rosterCount
- monthly session วันนี้/ไม่มี; times
- pending: no session → null/[]; exclude any attendance row; sort Thai; no employeeId
- 400 code ผิด; 500; auth; no-store

**สัญญา Express ที่ต้องตรง**
- ตาราง 2.4
- `dateText` ภาษาไทย Bangkok
- `pending` ไม่มี `employeeId` (ตามสัญญาเดิม)

### ลำดับที่แนะนำ

1. **2a** ก่อน เพราะเป็น public surface และมี rate limit/timezone ชัดเจน
2. **2b** ต่อ เพราะ controller ใช้ QR/session settings
3. **2c** ต่อ เพราะ roster ถูกใช้โดย 2a (employees) และ 2d
4. **2d** สุดท้าย เพราะอ่านข้อมูลจากทั้ง roster และ attendance

---

## 5. ความเสี่ยงและคำถามที่ต้องให้ owner ตัดสิน

### 5.1 คำถามที่บล็อกการเริ่ม 2a

1. **`MEETING_QR_SECRET` ไม่ถูกใช้จริง**
   - โค้ดปัจจุบันสร้าง token สุ่มและเก็บใน DB; verify ด้วยการ lookup ตรง ๆ
   - `DEPLOY.md` บอกให้ rotate secret แต่การ rotate secret ไม่เปลี่ยน token
   - ต้องเลือก: (ก) ลบ secret/คำแนะนำออกจากเอกสาร หรือ (ข) เปลี่ยนเป็น signed token/HMAC ซึ่งจะเป็น breaking change กับ QR ที่พิมพ์ไว้
2. **ที่เก็บ rate limit ใน Workers — ตัดสินแล้ว**
   - ใช้ SQLite-backed Durable Objects ตามข้อ 3.6; ไม่ใช้ KV, D1 หรือ in-memory `Map`
   - Workers Free รองรับเฉพาะ Durable Objects ที่ใช้ SQLite storage backend
   - แหล่ง IP คือ `CF-Connecting-IP` และ fallback เป็น `'unknown'`
   - key ของ token ใช้ SHA-256 digest ไม่ใช้ token ดิบ
3. **Auto-absent trigger ใน GET**
   - `GET /api/register/context` และ `GET /api/meeting/overview` เรียก `triggerAutoAbsentIfDue` แบบ fire-and-forget ซึ่งอาจเขียน attendance/audit
   - Workers ต้องใช้ `ctx.waitUntil` หรือ cron/queue; ถ้าไม่ทำ ต้องเอา trigger ออกและยอมรับว่า GET ไม่มี side effect เหมือนเดิม
   - ต้องตัดสินว่าการเรียก GET ควรมี side effect หรือไม่
4. **การเปิดเผยรายชื่อผ่าน public context**
   - ใครมี token จะเห็นชื่อ แผนก ตำแหน่ง ของ roster ทั้งหมด
   - token อยู่ใน URL และอาจถูก log
   - ต้องยืนยันว่ายอมรับได้ หรือต้องลดข้อมูล/เพิ่ม expiry

### 5.2 ความไม่สอดคล้องที่ควรแก้หรือยืนยัน

5. **แหล่งเวลาของ sup ไม่ชัด**
   - register ใช้ `meeting_types.default_open_time/default_cutoff_time`
   - overview ใช้ default ก่อน แล้วค่อย fallback เป็น session
   - auto-absent สร้าง session ด้วย default
   - ถ้าแก้ default ระหว่างวัน พฤติกรรมของ register/overview เปลี่ยนทันที; session ที่มีอยู่ไม่ถูกใช้
   - ต้องเลือกแหล่งเวลาที่เป็น canonical
6. **การนับของ overview กับ dashboard ต่างกัน**
   - overview `countByStatus` นับ attendance ทุกแถวของ session
   - dashboard ใช้ `latestPerEmployee` (แถวล่าสุดต่อคน)
   - pending ตัดคนที่มี attendance row ใด ๆ (ไม่ใช่เฉพาะ attended)
   - ถ้ามีข้อมูลซ้ำจากอดีต ตัวเลขจะไม่ตรงกัน
7. **`overview/pending` ไม่มี `employeeId`**
   - UI ใช้ `fullName + positionName` เป็น key ซึ่งอาจซ้ำ
   - ควรเพิ่ม `employeeId` หรือยืนยันคงสัญญาเดิม
8. **Roster ไม่มี audit**
   - add/remove ไม่เขียน `audit_logs`
   - `add` เป็น upsert ที่เขียน `created_by`/`created_at` ทับของเดิมเมื่อเพิ่มซ้ำ
   - `remove` ปิดทั้ง sup และ monthly แม้ผู้ใช้กำลังดู type เดียว
   - ต้องยืนยันว่าต้องการ audit และ semantics นี้หรือไม่

### 5.3 ความเสี่ยงด้าน runtime / validation

9. **Zod 4 และ `z.uuid()`**
   - Express ใช้ Zod 4; Worker ปัจจุบันมีแค่ Hono
   - ต้องเลือก: เพิ่ม zod ใน worker หรือเขียน validation manual ให้ผลลัพธ์เดียวกัน (strict body, UUID, nullish)
10. **`Intl` / `Asia/Bangkok` ใน workerd**
    - ต้องทดสอบ `en-CA` (YYYY-MM-DD), `en-GB` (HH:mm), `th-TH` (วัน/เดือน) กับ compatibility date จริง
11. **ความต่างของ error ตอนอ่าน**
    - `GET monthly-session`, `GET roster`, `GET types` ใช้ข้อความ `ไม่สามารถบันทึกได้ กรุณาลองใหม่` แม้เป็นการอ่าน
    - overview ใช้ `ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง`
    - ต้องเลือกคงเดิมทุกตัวอักษรหรือ normalize (การเปลี่ยนเป็น breaking change ต่อ frontend test)
12. **UUID และ unique violation**
    - Worker db ต้องส่ง `error.code = '23505'` ออกมาให้ตรวจ unique race ได้
    - ต้องยืนยันว่า PostgREST/Worker wrapper ไม่กลืน code
13. **`APP_ORIGIN`**
    - types/rotate ต้องใช้ origin ที่ตรงกับหน้าเว็บจริง
    - ถ้า Worker อยู่คนละโดเมนกับ Vercel ต้องตั้งค่าให้ถูก; ถ้าใช้ relative URL จะไม่ได้ลิงก์ที่ถูก
14. **PIN/bcrypt ใน Phase 3**
    - dashboard reason ใช้ `verifyLoginPin` (bcrypt ใน Express)
    - Workers Phase 1 ใช้ HMAC แล้ว; Phase 3 ต้องตัดสินว่าจะย้าย Express มาที่ HMAC หรือทำ compatibility layer
    - ไม่กระทบ Phase 2 แต่ต้องไม่ลืมตอนทำ 2d/Phase 3

### 5.4 สิ่งที่ยังไม่ต้องทำใน Phase 2

- Dashboard ทั้งหมด (Phase 3)
- Auto-absent job/cron (Phase 4)
- การแก้ Express เดิม
- การ deploy หรือการเปลี่ยน env
- การลบ spike `src/pin.js`

---

## 6. การตรวจสอบรอบนี้

รันจาก `worker/`:

- `npm test` → exit code **0**; tests 75, pass 75, fail 0

ไม่มีโค้ดหรือไฟล์เดิมถูกแก้ไขในรอบนี้; ไฟล์ที่สร้างใหม่มีเพียงไฟล์ร่างนี้
