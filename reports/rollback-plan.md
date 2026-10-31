# แผน rollback กลับไป Express (ก่อน/หลัง cutover)

สถานะเอกสาร: 31 ต.ค. 2026 — เขียนจากโค้ดที่มีอยู่ในรีโปเท่านั้น (`server/`, `worker/src/`)
ยังไม่มีการ deploy, ไม่มีการเชื่อม Supabase และไม่มีการแก้โค้ด Express ในงานนี้

## 1. ใครตัดสินใจ และเมื่อไร

- **ผู้ตัดสินใจและผู้ลงมือ: owner** (ยืนยันแล้ว) — ไม่มีผู้อื่นอนุมัติแทน
- เงื่อนไขที่ถือว่า trigger ให้ rollback:
  - ล็อกอินใช้งานไม่ได้เป็นวงกว้าง (401/423 ผิดปกติ, ผู้ใช้เข้าไม่ได้หลายคน)
  - ข้อมูลผิดหรือหาย (attendance/session/audit ผิดจากที่ควรเป็น)
  - rate limit บล็อกผู้ใช้จริงจนใช้งานไม่ได้
  - API ตอบ 5xx ต่อเนื่อง หรือช้าจนใช้งานไม่ได้
  - พบช่องโหว่ด้านความปลอดภัยใน Worker
- ถ้าเข้าเงื่อนไข "ข้อมูลหาย" หรือ "ล็อกอินล่มทั้งระบบ" ให้ rollback ทันที ไม่ต้องรอตรวจครบ
- owner ควรกำหนดกรอบเวลาไว้ก่อน cutover (เช่น ถ้าภายใน N ชั่วโมงยังไม่นิ่ง ให้ rollback) และจดเวลาที่ตัดสินใจ

## 2. ก่อนสลับทราฟฟิกกลับ

ต้องหยุดการเขียนข้อมูลซ้ำซ้อนก่อน เพราะทั้งสองระบบเขียนตารางเดียวกัน:

1. **ปิด auto-absent ฝั่ง Worker** ถ้าเคยเปิด cron รายนาทีไปแล้ว:
   - เอา `"* * * * *"` ออกจาก `crons` ใน `worker/wrangler.toml` (เหลือ `"0 1,9,17 * * *"` ที่เป็น keep-alive ไมเขียนข้อมูล)
   - แล้ว deploy Worker ใหม่ (การแก้ config ไม่ต้องแก้โค้ด) — ต้องทำก่อนเปิด Express
   - ถ้ายังไม่เคยเพิ่ม trigger นี้ (สถานะปัจจุบัน) ไม่ต้องทำอะไร
2. **เปิด auto-absent ฝั่ง Express**: `AUTO_ABSENT_ENABLED` ต้องไม่ใช่ `"false"` (ถ้าไม่ตั้ง = เปิด ตาม `server/index.js`)
3. ตรวจว่าไม่มีคนกำลังกรอกแบบฟอร์มลงทะเบียนในช่วงสลับ (announce ช่วงปิดปรับปรุงสั้น ๆ)

## 3. ขั้นตอนสลับทราฟฟิกกลับไป Express

มีสองทาง เลือกตามว่าจะคง URL `hr-hub.pages.dev` ไว้หรือไม่

### ทาง A — เร็วที่สุด ไม่ต้องแก้โค้ด (แนะนำถ้าเน้นกู้ระบบ)

Express เสิร์ฟ frontend เองได้เมื่อ `NODE_ENV=production` (`server/index.js` เสิร์ฟ `dist` + SPA fallback + `/api`):

1. ที่เครื่อง/โฮสต์ของ Express: ติดตั้ง dependencies ตามปกติ (`npm install` หรือ `npm ci`)
2. `npm run build` เพื่อสร้าง `dist` จากโค้ด frontend เวอร์ชันที่ต้องการ
3. `npm start` (คือ `NODE_ENV=production node server/index.js`) → API และหน้าเว็บที่พอร์ต 3001 (หรือ `PORT`)
4. ตั้ง `APP_ORIGIN` ของ Express เป็น origin ที่ผู้ใช้จะเห็นจริง (ใช้สร้างลิงก์ QR ใน `server/routes/meeting.js`) ไม่งั้น QR ที่ controller สร้างจะชี้ผิดโดเมน
5. ถ้า Express อยู่หลัง reverse proxy ให้ตั้ง `TRUST_PROXY_HOPS` ให้ตรงจำนวน hop เพื่อให้ rate limit เห็น IP ผู้ใช้จริง
6. แจ้งผู้ใช้ให้เข้า URL ของ Express แทน `hr-hub.pages.dev`
7. ปิด Pages (unpublish หรือหยุด production deployment) เพื่อไม่ให้มีสอง frontend ใช้งานพร้อมกัน

ข้อควรรู้ของทาง A: คุกกี้ `hr_session` เป็น host-only ของ `hr-hub.pages.dev` ดังนั้นผู้ใช้ **ต้องล็อกอินใหม่** ที่ origin ของ Express (แถวใน `auth_sessions` ยังใช้ได้ เพราะทั้งสองระบบเก็บ `sha256(token)` และใช้ `login_role` ค่าเดียวกัน แต่เบราว์เซอร์จะไม่ส่งคุกกี้ข้าม host)

### ทาง B — คง URL `hr-hub.pages.dev`

ต้องแก้ `functions/api/[[path]].js` ให้ส่งต่อไปยัง origin ของ Express แทน service binding `WORKER` (เป็นการแก้โค้ด ต้องให้ owner อนุมัติ และต้อง deploy Pages ใหม่):

1. แก้ proxy ให้ชี้ Express origin (และส่ง header เดิมต่อไปเหมือนปัจจุบัน)
2. ตั้ง `APP_ORIGIN` ของ Express = `https://hr-hub.pages.dev`
3. ตั้ง `TRUST_PROXY_HOPS=1` ที่ Express เพราะมี Pages เป็น proxy หนึ่งชั้น
4. deploy Pages ใหม่
5. ข้อดี: คุกกี้เดิมยังใช้ได้ (origin เดิม) ผู้ใช้ไม่ต้องล็อกอินใหม่
6. ข้อเสีย: Pages ยังเสิร์ฟ frontend จาก commit ที่ deploy อยู่ ถ้า frontend นั้นไม่ตรงกับ API เก่า ต้อง rollback frontend ด้วย (deploy commit เก่าหรือ unpublish)

ทั้งสองทาง: หลังสลับแล้วให้ตรวจ `GET /api/health` ของ Express (มี route นี้ที่ `server/index.js`) และล็อกอินด้วยบัญชีทดสอบของแต่ละ role

## 4. ปัญหา PIN — ต้องจัดการก่อน rollback (สำคัญที่สุด)

### สาเหตุ

- Worker เก็บ PIN เป็น **HMAC-SHA256 hex**: `pinHash(PIN_PEPPER, employeeId, pin)` ใน `worker/src/pin-rules.js` แล้วเทียบด้วย `timingSafeEqualHex` (`worker/src/pin-verify.js`) → ค่าที่เก็บใน `employee_credentials.pin_hash` เป็น hex ยาว 64 ตัว
- Express เก็บและตรวจด้วย **bcrypt**: `bcrypt.hash(pin, 10)` ตอน set-pin และ `bcrypt.compare(pin, pin_hash)` ตอน login (`server/routes/auth.js`, `server/pin-verify.js`)

### ผลที่เกิดขึ้นถ้า rollback เฉย ๆ

- `bcrypt.compare` ของ bcryptjs จะคืน `false` ทันทีเมื่อความยาว hash ไม่ใช่ 60 ตัวอักษร (ตรวจจาก `node_modules/bcryptjs` — `hashValue.length !== 60` → `false`) ดังนั้น PIN ที่ตั้งผ่าน Worker จะ **ไม่มีทางถูกต้องบน Express**
- Express จะไม่เข้าสาขา "ยังไม่ตั้ง PIN" เพราะ `pin_hash` ไม่ใช่ `null` → ผู้ใช้เห็นข้อความ PIN ผิด แล้ว `failed_attempts` เพิ่มขึ้น ครบ 5 ครั้งล็อก 15 นาที (ตอบ 423) ทำซ้ำได้เรื่อย ๆ = ผู้ใช้ใช้งานไม่ได้จนกว่าจะมีคนแก้ข้อมูล
- Express ที่ไม่แก้โค้ดตรวจ HMAC ไม่ได้ เพราะไม่ได้ถือ `PIN_PEPPER` และไม่ได้ใช้ HMAC ในการเทียบ

### สิ่งที่ต้องทำก่อน rollback (owner, เป็นงานข้อมูล ไม่ใช่แก้โค้ด)

1. **หาว่าใครตั้ง PIN ผ่าน Worker**: query แบบอ่านอย่างเดียวตรวจ `employee_credentials` โดยดูแถวที่ `pin_hash` ไม่ขึ้นต้นด้วย `$2` (bcrypt ขึ้นต้น `$2a$`/`$2b$`) — เช่น
   `select employee_id, left(pin_hash, 4) as prefix, pin_set_at from employee_credentials where pin_hash is not null and pin_hash not like '$2%';`
2. **เคลียร์ค่าให้ Express มองว่า "ยังไม่ตั้ง PIN"**: ตั้ง `pin_hash = null` (และ `pin_set_at = null`) เฉพาะแถวเหล่านั้น — เป็น write SQL ที่ owner รันเองใน Supabase (งานนี้ไม่รันและไม่เขียนคำสั่ง DROP/ALTER ให้)
3. **ออก reset code ให้ผู้ใช้แต่ละคน** ด้วยสคริปต์เดิม `npm run issue:reset-code -- <employee_code>` (`scripts/issue-reset-code.js`) — สคริปต์เขียน `pin_reset_codes` ด้วย HMAC `PIN_RESET_SECRET` ซึ่งทั้ง Express และ Worker ใช้กติกาเดียวกัน จึงใช้ได้
4. **ให้ผู้ใช้ตั้ง PIN ใหม่ผ่านหน้า set-pin ของ Express** → ได้ bcrypt hash ตามปกติ
5. **ตรวจซ้ำก่อนเปิดใช้**: จำนวนแถวที่ `pin_hash not like '$2%'` ต้องเป็น 0

ถ้ามีคนตั้ง PIN บน Worker จำนวนมาก ให้ประกาศช่วงปิดปรับปรุง เพราะขั้นตอน 3–4 ต้องให้ผู้ใช้แต่ละคนทำเอง

ทางเลือกที่ต้องแก้โค้ด (นอกขอบเขตงานนี้): ให้ Express รองรับ HMAC ชั่วคราวด้วย `PIN_PEPPER` — ต้องแก้ `server/` ซึ่งงานนี้ห้ามแก้

## 5. ความเข้ากันได้ของข้อมูล (Worker เขียนอะไร และ Express อ่านได้ไหม)

ตารางที่ Worker เขียน (จาก `worker/src/`) และผลเมื่อ Express กลับมาอ่าน — อ้าง schema list ใน `worker/reports/phase2-spec-draft.md` ข้อ 3.8:

| ตาราง | Worker เขียนอะไร | Express อ่านต่อได้ไหม |
| --- | --- | --- |
| `auth_sessions` | insert ตอน login (`token_hash`, `login_role`, `expires_at`, ...), update `last_active_at`, `revoked_at` | ได้ — คอลัมน์และกติกาเดียวกัน (`sha256` ของ token, role ค่าเดียวกัน) แต่คุกกี้ผูก host จึงต้องล็อกอินใหม่เมื่อเปลี่ยน origin |
| `employee_credentials` | update `failed_attempts`, `locked_until`, `pin_hash`/`pin_set_at` ตอน set-pin | **ไม่ได้สำหรับ `pin_hash`** — คอลัมน์อ่านได้ แต่ค่าเป็น HMAC ไม่ใช่ bcrypt (ดูข้อ 4) |
| `pin_reset_codes` | update `attempts`, `used_at` เท่านั้น (Worker ไม่สร้าง code) | ได้ — Express เป็นคนสร้าง code เอง |
| `audit_logs` | insert action: `pin_set`, `logout`, `dashboard_reason_viewed`, `meeting_qr_rotated`, `meeting_window_updated`, `meeting_monthly_session_set`, `auto_absent_done` | ได้ — เป็นชุด action เดียวกับที่ Express เขียน (`server/routes/auth.js`, `meeting.js`, `meeting-monthly.js`, `meeting-dashboard.js`) |
| `meeting_sessions` | insert (สร้าง session ของ sup ตอนลงทะเบียน), upsert (monthly, auto-absent), update (open/close) | ได้ — parity tests ของ Phase 4a/4c เทียบแถวที่ Express และ Worker เขียนแล้วเหมือนกันทุกคอลัมน์ |
| `meeting_attendance` | insert (ลงทะเบียน), upsert (auto-absent) | ได้ — เทียบแล้วเหมือนกันทุกคอลัมน์รวม `registered_at` |
| `meeting_roster` | upsert (เพิ่ม/เปิดใช้), update (`is_active`) | ได้ — คอลัมน์เดียวกัน; ทั้งสองระบบไม่เขียน audit row ในกลุ่มนี้ |
| `meeting_types` | update `qr_token` (rotate) | ได้ — คอลัมน์เดียวกัน |

ตารางที่ Worker **อ่านอย่างเดียว**: `employees`, `departments`, `positions`, `meeting_skip_dates`, `leave_requests`, `hr_admins`, `meeting_admins`, `system_admins` → ไม่มีปัญหาข้อมูล

## 6. สิ่งที่ย้อนกลับไม่ได้ (พูดตรง ๆ)

- **PIN ที่ผู้ใช้ตั้งผ่าน Worker กู้คืนเป็น PIN เดิมไม่ได้** — HMAC เป็นทางเดียว แม้มี `PIN_PEPPER` ก็ย้อนกลับไม่ได้ ต้องให้ผู้ใช้ตั้งใหม่เท่านั้น (และการเคลียร์ `pin_hash` ในข้อ 4 ก็ทำให้ต้องตั้งใหม่)
- **การลบ Worker เก่า `hr-workers-spike`**: ถ้าลบแล้วภายหลังอยากกลับไป Worker ต้อง deploy ใหม่และ **ตั้ง secret ใหม่ทั้งหมด** เพราะ secret ที่ลบแล้วอ่านกลับไม่ได้
- **audit_logs ที่ Worker เขียนช่วงใช้งานจริง**: ถ้า owner ลบทิ้งเพื่อ "ย้อนสภาพ" ประวัติจะหายถาวร; ถ้าเก็บไว้ ประวัติจะปนกันสองระบบ (แนะนำให้เก็บ)
- **ข้อมูลที่ผู้ใช้กรอกระหว่างที่ระบบมีปัญหา**: ถ้า request ไม่ถึงฐานข้อมูล ข้อมูลนั้นหายและกู้ไม่ได้
- **ถ้าไม่ได้สำรองข้อมูลก่อน cutover (ข้อ 4 ของ `DEPLOY.md`)**: การ rollback จะเหลือเพียงข้อมูลในฐานข้อมูลจริง ไม่มีสำเนาให้ย้อนทั้งระบบ
- **เวลาให้บริการที่เสียไประหว่าง rollback** และการที่ผู้ใช้ต้องตั้ง PIN ใหม่/ล็อกอินใหม่ ย้อนกลับไม่ได้

## 7. หลัง rollback

- ตรวจ `GET /api/health` (Express), ล็อกอินแต่ละ role, เปิดหน้า dashboard/roster/QR หนึ่งรอบ
- ตรวจว่า auto-absent ของ Express ทำงาน (ดู `audit_logs` action `auto_absent_done` รอบถัดไป)
- อย่าลบ Worker ทันที — เก็บไว้จนกว่า owner จะสรุปว่าไม่กลับไปใช้อีก
- จดบันทึก: วันที่/เวลาที่ rollback, เหตุผล, จำนวนบัญชีที่ต้องตั้ง PIN ใหม่, และสิ่งที่ยังค้าง
