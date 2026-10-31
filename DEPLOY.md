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
- **Cutover gate:** การทดสอบล็อกอินด้วยบัญชี `EM001` บน `https://hr-hub.pages.dev` ต้องผ่าน
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
- Worker เก่าชื่อ `hr-workers-spike` ให้ลบ **หลัง owner ยืนยันแล้วเท่านั้น** คือหลัง cutover
  ใช้งานได้จริงและตัดสินใจว่าไม่ rollback แล้ว
- ตัวแปรที่ไม่ใช่ secret:
  - `APP_ORIGIN` = `https://hr-hub.pages.dev` (ใช้สร้างลิงก์ QR/ลงทะเบียน ต้องตรงกับ origin จริงของผู้ใช้)
  - `COOKIE_SECURE` = เว้นว่างไว้ใน production (ไม่ตั้ง = คุกกี้มี Secure); ค่า `false` ใช้เฉพาะทดสอบ local
- Cron triggers ตามที่อยู่ใน `wrangler.toml` ปัจจุบัน:
  `crons = ["0 1,9,17 * * *"]` (งาน keep-alive)
  - งาน auto-absent รายนาที (`* * * * *`) ยังไม่ถูกเปิดใน config นี้: จะเพิ่มเมื่อ Express ปิดงานนี้แล้วเท่านั้น
    (รายละเอียด cutover อยู่ใน `worker/reports/phase4c-report.txt`)
- Rate limit ใช้ Durable Objects ที่ประกาศไว้ใน `wrangler.toml`
  (`RL_CONTEXT_IP`, `RL_SUBMIT_IP`, `RL_SUBMIT_TOKEN`) จึงไม่ต้องใช้บริการภายนอกเพิ่ม

## 3. Cloudflare Pages (frontend)

- Pages project: **`hr-hub`** — โดเมน **`https://hr-hub.pages.dev`**
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

**สถานะ: ข้ามขั้นนี้ตามการตัดสินใจของ owner** (ดูหัวข้อ Decisions) — owner ยืนยันว่าฐานข้อมูล
ปัจจุบันยังไม่มีข้อมูลสำคัญ จึงไม่ต้อง export ก่อน cutover ขั้นตอนด้านล่างเก็บไว้ใช้เมื่อต้อง
สำรองข้อมูลจริงในอนาคต (เช่นก่อน import ข้อมูลจริง):

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
2. ตั้ง secrets ทั้งห้ารายการบน `hr-hub-api` (ข้อ 2) รวม `TURNSTILE_SECRET_KEY` ถ้าเปิดใช้ Turnstile
3. ตั้ง `APP_ORIGIN` เป็น `https://hr-hub.pages.dev`
4. `cd worker && npx wrangler deploy`
5. ตอน cutover: เชื่อม Git ของโปรเจกต์ `hr-hub` (build `npm run build`, output `dist`)
   แล้ว push ขึ้น production branch `release` เพื่อให้ Pages deploy
6. ตั้ง service binding `WORKER` → `hr-hub-api` ในโปรเจกต์ Pages (ถ้ายังไม่ได้ตั้ง)
   แล้ว deploy Pages อีกครั้งให้ binding มีผล
7. ตรวจว่า `GET /api/auth/me` บน `https://hr-hub.pages.dev` ตอบ 401 (ยังไม่ได้เข้าสู่ระบบ) ไม่ใช่ 503
   ซึ่งแปลว่า binding ต่อถึง Worker แล้ว
8. หลังยืนยันว่าใช้งานได้จริงและไม่ rollback แล้ว จึงลบ Worker เก่า `hr-workers-spike` (owner ยืนยันก่อน)

## 6. การรัน Express ในเครื่อง (จนกว่าจะ cutover)

ส่วนนี้ใช้เฉพาะช่วงที่ API ยังเป็น Express (`server/`) ก่อน cutover ไป Worker — หลัง cutover ให้ลบส่วนนี้

- `npm install`
- `npm run dev` (เปิด API และ Vite พร้อมกัน) หรือแยกเป็น `npm run dev:api` และ `npm run dev:web`
- Vite dev proxy ส่ง `/api` ไปที่ `http://localhost:3001` ตาม `vite.config.js`
- ตัวแปร env ของ Express ใช้ชื่อเดียวกับ `.env.example` และใส่ค่าจริงใน `.env.local` เท่านั้น (ห้าม commit)

## 7. Checklist ก่อนเปิดใช้จริง

- อ่าน `reports/rollback-plan.md` ก่อน cutover (โดยเฉพาะปัญหา PIN ที่ตั้งผ่าน Worker)
- เปลี่ยน PIN ของ `ADM001` (จากค่าเริ่มต้น) ก่อนเปิดให้ใช้งาน
- ทดสอบ rate limit จากอุปกรณ์ 2 เครื่องที่แยกกัน (เช่น มือถือบนเน็ตมือถือ + เครื่องในออฟฟิศ) ว่าไม่บล็อกกันเองผิดปกติ
- ยืนยันว่า auto-absent job ทำงาน: หลังรอบประชุมที่ครบกำหนด ให้ตรวจตาราง `audit_logs` ว่ามีแถว `auto_absent_done` ของ session นั้น
- ตรวจว่า frontend กับ API อยู่ origin เดียวกันจริง: ล็อกอินบนโดเมน Pages แล้ว `GET /api/auth/me` ต้องตอบ 200 โดยคุกกี้ `hr_session` ถูกส่งไปด้วย
- Rollback: ใช้แนวทาง **fix-forward** ตามหัวข้อ Decisions — ไม่ rollback กลับ Express;
  `reports/rollback-plan.md` ใช้เป็นข้อมูลอ้างอิงทางเทคนิคเท่านั้น
