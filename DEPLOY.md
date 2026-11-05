# การ deploy (Cloudflare Workers + Cloudflare Pages + Supabase)

ข้อมูลนี้เป็นขั้นตอนการตั้งค่าเท่านั้น ไม่มีค่าจริงของตัวแปรใด ๆ ในไฟล์นี้
ห้าม commit ไฟล์ `.env.local` หรือค่าจริงลง repository

## Decisions (owner-confirmed)

การตัดสินใจที่ owner ยืนยันแล้วสำหรับ cutover นี้ บันทึกไว้ที่นี่เพื่อไม่ต้องตีความซ้ำ

- **Rollback: fix-forward** — ไม่ rollback กลับไปใช้ Express หลัง cutover ถ้ามีปัญหาให้แก้ที่ Worker
  ต่อไป และ Express ไม่ได้เปิดเป็น public service แล้ว `reports/rollback-plan.md` เก็บไว้เป็น
  ข้อมูลอ้างอิงทางเทคนิคเท่านั้น ไม่ใช่แผนที่จะลงมือ
- **Backup: ไม่มี pre-cutover export** — owner ตัดสินใจว่าฐานข้อมูลปัจจุบันยังไม่มีข้อมูลสำคัญ
  จึงข้ามขั้นสำรองข้อมูลก่อน cutover (ข้อ 4) ข้อมูลจริงจะถูก import ภายหลัง และเมื่อ import แล้ว
  ค่า `pin_hash` กับ `national_id_hash` ต้องคำนวณด้วย pepper ของ Worker (`PIN_PEPPER`,
  `NATIONAL_ID_PEPPER`) ไม่ใช่รูปแบบ bcrypt ของ Express
- **Index:** owner จะลบ index ซ้ำชื่อ `meeting_attendance_once` ด้วยตัวเองก่อน deploy และเก็บ
  `meeting_attendance_session_employee_unique` ไว้ (รายละเอียดใน `reports/supabase-indexes.md`)
  TODO: confirm with owner — วันที่ลงมือลบ index
- **Pages:** ใช้ Git connection โดย production branch คือ **`release`** — push ขึ้น `release`
  แล้ว Pages จะ deploy เอง
- **Turnstile: ปิดเป็นค่าเริ่มต้น** (off by default) — ยังไม่ต้องตั้ง `TURNSTILE_SECRET_KEY`
  จนกว่าจะเปิดใช้
- **Cutover gate:** การทดสอบล็อกอินด้วยบัญชี `EM001` บน `https://hr-hub-3yr.pages.dev` ต้องผ่าน
  ก่อน cutover

## 0. ภาพรวม

- Frontend (Vue + Vite) → Cloudflare Pages ที่โดเมนเดียว
- `/api/*` บน Pages ถูกส่งต่อไปยัง Worker ผ่าน service binding ชื่อ `WORKER`
  (ไฟล์ `functions/api/[[path]].js`) เพื่อให้ frontend และ API อยู่ origin เดียวกัน
  และคุกกี้ session (`SameSite=Strict`) ใช้งานได้
- API → Cloudflare Worker ในโฟลเดอร์ `worker/`
- ฐานข้อมูล → Supabase (PostgREST) ซึ่ง Worker เรียกผ่าน `SUPABASE_URL`
- ทุกส่วนใช้แผนฟรี (Workers Free, Pages Free, Supabase Free) ไม่มีบริการที่ต้องจ่ายเงิน

## 1. Supabase (ฐานข้อมูล)

- โปรเจกต์ Supabase ที่ใช้: **KCS_DATA**
- URL และคีย์ของโปรเจกต์เก็บเป็น secret ของ Worker เท่านั้น (ดูข้อ 2) ไม่เก็บในไฟล์หรือ repository
- TODO: confirm with owner — ภูมิภาค (region) ของโปรเจกต์ และที่มาของ schema (ไฟล์ migration หรือผู้ดูแล)

## 2. Cloudflare Worker (API)

โฟลเดอร์ `worker/` มี `wrangler.toml` เป็น config และ `src/index.js` เป็น entry

- ชื่อ Worker: **`hr-hub-api`** (ตั้งไว้ใน `wrangler.toml` แล้ว) — ชื่อนี้คือชื่อที่ secret
  และ service binding ฝั่ง Pages ผูกอยู่ด้วย
- Deploy: `cd worker && npx wrangler deploy`
- Secrets ผูกกับ "ชื่อ Worker": secret ที่เคยตั้งบน `hr-workers-spike` ไม่ติดมาที่ชื่อใหม่
  ตอน cutover ต้องตั้งใหม่ทั้งห้ารายการนี้บน `hr-hub-api` ด้วย `npx wrangler secret put <NAME>`
  ในโฟลเดอร์ `worker/`:
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NATIONAL_ID_PEPPER`, `PIN_PEPPER`, `PIN_RESET_SECRET`
  (และ `TURNSTILE_SECRET_KEY` ถ้าเปิดใช้ Turnstile — ค่าเริ่มต้นคือปิด ดูหัวข้อ Decisions)
- Secrets สำหรับ Web Push (ระบบลา/แจ้งเตือน) ตั้งบน Worker ชื่อเดียวกัน:
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (ค่าจริงสร้างนอก repo และห้าม commit)
- Cron triggers ตามที่อยู่ใน `wrangler.toml` ปัจจุบัน (3 ตัว จากเพดานฟรี 5 ตัว):
  `crons = ["0 1,9,17 * * *", "0 2 * * *", "* * * * *"]`
  - `0 1,9,17 * * *` — keep-alive ของ Supabase (เดิม ไม่เปลี่ยน)
  - `0 2 * * *` — ลบไฟล์ใบรับรองแพทย์ที่หมดอายุตาม `leave_settings`
  - `* * * * *` — คิว Web Push (fallback ทุกนาที; แจ้งเตือนใหม่ส่งทันทีใน request)
  - auto-absent ใช้ expression เดียวกันแต่ยังปิดอยู่ เปิดด้วย `AUTO_ABSENT_ENABLED="true"` เมื่อพร้อม
- (ประวัติ) Worker เก่าชื่อ `hr-workers-spike` ไม่ได้ใช้งานแล้ว — ชื่อที่ใช้อยู่คือ `hr-hub-api`
- ตัวแปรที่ไม่ใช่ secret:
  - `APP_ORIGIN` = origin จริงของ Pages (ปัจจุบันใน `wrangler.toml` คือ `https://hr-hub-3yr.pages.dev`)
    ใช้สร้างลิงก์ QR/ลงทะเบียน ต้องตรงกับ origin จริงของผู้ใช้
  - `COOKIE_SECURE` = เว้นว่างไว้ใน production (ไม่ตั้ง = คุกกี้มี Secure); ค่า `false` ใช้เฉพาะทดสอบ local
- Rate limit ใช้ Durable Objects ที่ประกาศไว้ใน `wrangler.toml`
  (`RL_CONTEXT_IP`, `RL_SUBMIT_IP`, `RL_SUBMIT_TOKEN`) จึงไม่ต้องใช้บริการภายนอกเพิ่ม

## 3. Cloudflare Pages (frontend)

- Pages project: **`hr-hub`** — โดเมน **`https://hr-hub-3yr.pages.dev`** (โดเมนที่ใช้งานจริง ไม่เปลี่ยนชื่อโปรเจกต์)
- Build command: `npm run build`; Output directory: `dist`
- วิธี deploy: **Git connection** (เชื่อม repository แล้วให้ Pages build เอง)
  - Production branch: **`release`** — push ขึ้น branch นี้จะ deploy ขึ้นจริงทันที
  - การเชื่อม Git เลื่อนไปทำตอน cutover เพราะเมื่อเชื่อมแล้ว การ push ขึ้น `release`
    จะ deploy ขึ้นจริงทันทีอัตโนมัติ (ยังไม่อยากให้ Pages ใช้งานจริงก่อนพร้อม)
- Service binding (Pages → Settings → Bindings → Add → Service binding):
  - Variable name: `WORKER`
  - Service: **`hr-hub-api`** (Worker จากข้อ 2)
  - เมื่อเพิ่ม/แก้ binding ต้อง deploy Pages ใหม่หนึ่งครั้งให้ binding มีผล
- ไฟล์ `functions/api/[[path]].js` ส่งต่อ method, path, query string, body และ header
  ไปยัง Worker แล้วคืน response กลับตามเดิม โดยไม่แตะคุกกี้
- Deep link ของ Vue (เช่น `/login`, `/meeting/register?t=...`) ใช้ค่า default ของ Pages
  ที่ให้ SPA ทำงานได้เมื่อไม่มีไฟล์ `404.html` ที่ root
- หมายเหตุ: ถ้าภายหลังเปลี่ยนไปใช้ custom domain ต้องอัปเดต `APP_ORIGIN` ของ Worker ให้ตรงกับโดเมนนั้น

## 4. สำรองข้อมูลก่อน cutover (owner action)

**สถานะ: ต้องสำรองข้อมูลก่อนรัน SQL ใหม่ทุกครั้ง** — ฐานข้อมูล production มีข้อมูลจริงแล้ว
(ตาราง `employees` ประมาณ 176 แถว) ข้อความ "ข้ามขั้นนี้" ด้านล่างเป็นประวัติของการ cutover ครั้งแรก
ไม่ใช้กับรอบนี้:

- export ข้อมูลทุกตารางที่ระบบใช้: `meeting_types`, `meeting_sessions`, `meeting_roster`,
  `meeting_attendance`, `employees`, `departments`, `positions`, `employee_credentials`,
  `pin_reset_codes`, `auth_sessions`, `audit_logs`, `leave_requests`, `meeting_skip_dates`,
  `hr_admins`, `meeting_admins`, `system_admins`
- เก็บไฟล์ export ไว้นอกรีโป (เครื่องของ owner หรือ storage ส่วนตัว) ห้าม commit เข้า repository
- ตั้งชื่อไฟล์ให้มีวันที่ export เช่น `kcs_data_2026-10-31.sql` และจดวันที่ไว้ในบันทึกของ owner
- ไฟล์ export มีข้อมูลอ่อนไหว (`pin_hash`, `token_hash`, ข้อมูลพนักงาน) ต้องเก็บให้ปลอดภัย
  และไม่ส่งต่อในแชตหรืออีเมล
- เอกสารนี้ไม่มี credential ใด ๆ และไม่ต้องใส่ค่าจริงลงไป

## 5. ลำดับการ deploy

1. สำรองข้อมูลตามข้อ 4 — owner ตัดสินใจข้ามขั้นนี้ในรอบนี้ (ดูหัวข้อ Decisions)
2. ตรวจว่า SQL ที่รันแล้วตรงกับหัวข้อ 8.1 (ไม่ต้องรันซ้ำ; ถ้าเป็นฐานข้อมูลใหม่ให้สำรองก่อน)
3. สร้าง bucket `leave-certificates` เป็น **private** และตรวจว่าไฟล์เข้า/ออกผ่าน service role เท่านั้น
4. ตั้ง secrets ทั้งห้ารายการบน `hr-hub-api` (ข้อ 2) รวม `TURNSTILE_SECRET_KEY` ถ้าเปิดใช้ Turnstile
   และ secrets ของ Web Push (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`)
5. ตั้ง `APP_ORIGIN` เป็น origin จริงของ Pages (ปัจจุบัน `wrangler.toml` ระบุ `https://hr-hub-3yr.pages.dev`)
6. `cd worker && npx wrangler deploy` (Worker + cron 3 ตัวตาม `wrangler.toml`)
7. push ขึ้น production branch `release` เพื่อให้ Pages build `npm run build` และ deploy `dist`
   (ขั้นตอนนี้ต้องได้รับอนุมัติจาก owner ก่อนทุกครั้ง)
8. ตั้ง service binding `WORKER` → `hr-hub-api` ในโปรเจกต์ Pages (ถ้ายังไม่ได้ตั้ง)
   แล้ว deploy Pages อีกครั้งให้ binding มีผล
9. ตรวจว่า `GET /api/auth/me` ที่ origin ของ Pages ตอบ 401 (ยังไม่ได้เข้าสู่ระบบ) ไม่ใช่ 503
   ซึ่งแปลว่า binding ต่อถึง Worker แล้ว
10. ทดสอบบน production ตามหัวข้อ 8.6 (ระบบลา + Web Push)
11. (ประวัติ) การลบ Worker เก่า `hr-workers-spike` ไม่เกี่ยวกับรอบนี้ — ถ้าจะลบ ต้องให้ owner ยืนยันก่อน

## 6. การรันในเครื่อง (จนกว่าจะ cutover)

`npm run dev` รัน Worker ในเครื่อง (`wrangler dev` ที่ `http://127.0.0.1:8787`) คู่กับ Vite และ Vite proxy ส่ง `/api` ไปที่ Worker ตาม `vite.config.js` — Express ถูกถอดออกแล้ว Worker เป็น API เดียว

- `npm install`
- `npm run dev` (Worker + Vite พร้อมกัน) — ค่าเริ่มต้น
- แยกคำสั่ง: `npm run dev:worker` (Worker), `npm run dev:web` (Vite); เปลี่ยนเป้าหมาย proxy ด้วย `VITE_API_TARGET`
- Worker ใช้ secrets จาก `worker/.dev.vars` (ห้าม commit); สคริปต์ผู้ดูแล (`issue:reset-code`, `check:*`) ยังอ่าน `.env.local` ตาม `.env.example`

## 7. Checklist ก่อนเปิดใช้จริง

- อ่าน `reports/rollback-plan.md` ก่อน cutover (โดยเฉพาะปัญหา PIN ที่ตั้งผ่าน Worker)
- เปลี่ยน PIN ของ `ADM001` (จากค่าเริ่มต้น) ก่อนเปิดให้ใช้งาน
- ทดสอบ rate limit จากอุปกรณ์ 2 เครื่องที่แยกกัน (เช่น มือถือบนเน็ตมือถือ + เครื่องในออฟฟิศ) ว่าไม่บล็อกกันเองผิดปกติ
- ยืนยันว่า auto-absent job ทำงาน: หลังรอบประชุมที่ครบกำหนด ให้ตรวจตาราง `audit_logs` ว่ามีแถว `auto_absent_done` ของ session นั้น
- ตรวจว่า frontend กับ API อยู่ origin เดียวกันจริง: ล็อกอินบนโดเมน Pages แล้ว `GET /api/auth/me` ต้องตอบ 200 โดยคุกกี้ `hr_session` ถูกส่งไปด้วย
- Rollback: ใช้แนวทาง **fix-forward** ตามหัวข้อ Decisions — ไม่ rollback กลับ Express;
  `reports/rollback-plan.md` ใช้เป็นข้อมูลอ้างอิงทางเทคนิคเท่านั้น

## 8. ระบบลาและแจ้งเตือน (Web Push) — ร่างลำดับก่อน deploy

### 8.1 SQL ที่รันแล้ว (ไม่ต้องรันซ้ำ และไม่ commit ไฟล์ draft)

ระบบลาถูกติดตั้งบนฐานข้อมูลแล้ว รายการด้านล่างคือ **บันทึกของสิ่งที่รันแล้ว** ไม่ใช่ขั้นตอนให้รันซ้ำ
และไฟล์ `worker/sql/leave-*-draft.sql` **ไม่ถูกเพิ่มเข้า git** — ใช้เป็นบันทึกในเครื่องเท่านั้น

| ลำดับ | ไฟล์ | วันที่รัน (ตามบันทึก) | สิ่งที่ติดตั้ง | ผลตรวจ |
|---|---|---|---|---|
| 1 | `worker/sql/leave-mvp-draft.sql` | 2026-11-03 | `leave_types`, `leave_requests`, `shift_options`, `employee_approvers`, `department_approvers`, `holidays`, `audit_logs` ที่เกี่ยวข้อง | ตารางและคอลัมน์ครบ |
| 2 | `worker/sql/leave-hr-phase2-draft.sql` | 2026-11-03 | `leave_settings` (แถวเดียว id=1), RLS, คอลัมน์ `id` ของตารางผู้อนุมัติ | query ตรวจ 7 ข้อผ่าน |

ผลตรวจที่ยืนยันแล้ว (owner ตรวจบนฐานข้อมูลจริง):

- `holidays` มี 2 คอลัมน์เท่านั้น คือ `holiday_date` (date, PK, not null) และ `name` (text, not null);
  ไม่มีคอลัมน์ `date` และไม่มี `created_at`
- `leave_requests.has_medical_certificate` เป็น boolean not null default false
- `leave_settings` มีแถว `id = 1` และ `certificate_retention_days` = 90
- ตารางผู้อนุมัติ (`employee_approvers`, `department_approvers`) มีคอลัมน์ `id` และเปิด RLS
- bucket `leave-certificates` เป็น private

หมายเหตุ: วันที่ในตารางเป็นวันที่ตามบันทึกการทำงานระยะที่ 1–2 — owner โปรดยืนยันวันจริงอีกครั้ง
ถ้าจะติดตั้งบนฐานข้อมูลใหม่: **สำรองข้อมูลก่อน** แล้วรันสองไฟล์ตามลำดับ และตรวจผล query ให้ตรงก่อน deploy

### 8.2 Storage bucket

- สร้าง bucket ชื่อ `leave-certificates` แบบ **private** (ไม่มี public policy)
- จำกัดขนาดไฟล์ 10 MB ต่อไฟล์ และรับเฉพาะ MIME `image/jpeg`, `image/png`, `application/pdf` (Worker ตรวจซ้ำอีกชั้น)
- โครงสร้าง path: `leave/<employee_id>/<request_code>/<ชื่อไฟล์>` และเก็บเฉพาะ path นี้ในฐานข้อมูล (ไม่เก็บ public URL)
- Worker ใช้ service role ผ่าน `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` ในการ upload/delete/sign เท่านั้น
- ห้ามใส่ public URL ลง `medical_certificate_url` — เก็บเฉพาะ object path `leave/<employee_id>/<request_code>/<file>`

### 8.3 VAPID secrets

- สร้างคู่คีย์ VAPID นอก repository (เครื่อง owner หรือเครื่องมือที่เชื่อถือได้) แล้วเก็บเฉพาะใน secret store
- ตั้งบน Worker `hr-hub-api` ด้วย `npx wrangler secret put <NAME>` ในโฟลเดอร์ `worker/`:
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (subject เป็น `mailto:` หรือ URL ของหน่วยงาน)
- ค่า public key ถูกส่งให้เบราว์เซอร์ผ่าน API เท่านั้น; private key ห้ามอยู่ในไฟล์, log หรือ repository

### 8.4 Cron ที่ต้องมีหลัง deploy

| Cron | งาน | หมายเหตุ |
|---|---|---|
| `0 1,9,17 * * *` | keep-alive ของ Supabase | **เดิม ไม่เปลี่ยน** |
| `0 2 * * *` | ลบไฟล์ใบรับรองแพทย์ที่หมดอายุ (ตาม `leave_settings`) | ใหม่ |
| `* * * * *` | คิว Web Push (fallback ทุกนาที) | ใหม่ |

- ใช้ 3 จากเพดาน 5 trigger ของ Workers Free; `* * * * *` ถูกใช้โดยคิว Web Push แล้ว
- auto-absent แชร์ expression นี้แต่ถูก gate ด้วย `AUTO_ABSENT_ENABLED` จึงยังไม่ทำงาน
- ตรวจว่า trigger ถูก deploy จริง: `cd worker && npx wrangler deployments list` หรือดูใน Dashboard → Triggers
- ตรวจ log ของ cron ด้วย `npx wrangler tail` แล้วดูว่าไม่มี `[cert-cleanup-error]` หรือ `[notification-cron-error]`

### 8.5 ลำดับ deploy (ลำดับจริงหลังระยะที่ 1–4)

1. **SQL ที่รันแล้ว** — ตรวจตาม 8.1 ไม่ต้องรันซ้ำ (ไฟล์ draft ไม่ถูก commit)
2. **bucket** `leave-certificates` แบบ private (10 MB, jpeg/png/pdf) ตาม 8.2
3. **secrets ของ Worker** — `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` เพิ่มจาก secrets เดิม (8.3)
4. **`cd worker && npx wrangler deploy`** — ต้องมี cron สามตัว: `"0 1,9,17 * * *"`, `"0 2 * * *"`, `"* * * * *"`
5. **push branch `release`** เพื่อให้ Pages build (ต้องได้รับอนุมัติก่อนทุกครั้ง)
6. **ทดสอบตาม checklist หลัง deploy** ใน 8.6 และตรวจ `dist` ว่ามี `manifest.webmanifest`, `sw.js`, `icon.svg`, `fonts/`

### 8.6 ทดสอบบน production (หลัง deploy)

1. ล็อกอินด้วยบัญชี HR → เปิด `/hr/leave` เห็นเมนู "ใบลาทั้งหมด" และหน้าใบลาย้อนหลัง/วันหยุด/ผู้อนุมัติ/ตั้งค่า
2. เปิด `/leave/new` → เลือกวันหยุดและจำนวนวัน → แนบไฟล์ JPG/PNG/PDF → ยื่นสำเร็จและได้รหัส `LV-YYYYMMDD-NNN`
3. เปิดไฟล์แนบจากหน้า "ใบลาของฉัน" และจากหน้า HR → ได้ signed URL อายุ 60 วินาที และเปิดได้
4. ตรวจว่าไม่มี public URL ของ bucket ถูกส่งออกไปใน response ใด ๆ
5. คีย์ใบลาย้อนหลัง → ติ๊ก "มีใบรับรองแพทย์" → บันทึกแล้วขึ้น "มีใบรับรองแพทย์ (บันทึกโดย HR)" ไม่มีปุ่มเปิดไฟล์
6. เปิดหน้าพิมพ์ใบลา → กด "พิมพ์ / บันทึกเป็น PDF" → ได้ A4 หนึ่งหน้า ฟอนต์ไทยครบ ไม่มีช่องลายเซ็น
7. เปิด `/hr/leave/settings` เปลี่ยนจำนวนวันเก็บไฟล์ → กลับไปหน้าใบลาเห็นข้อความ N เปลี่ยนตาม
8. เปิดการแจ้งเตือน (PushToggle) → อนุมัติใบลา → ตรวจว่ามีแถวในคิวและ push ถูกส่งภายในไม่กี่วินาที (fallback cron ทุกนาที)
9. ตรวจว่า `/api/leave/hr/*` ตอบ 403 เมื่อเรียกด้วยบัญชีที่ไม่ใช่ HR
