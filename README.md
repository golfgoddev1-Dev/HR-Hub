# HR Hub

ระบบงานบุคคลของหน่วยงาน ทำงานบนเว็บเดียว ประกอบด้วย

- **ระบบประชุม** — ตั้งรอบประชุม, QR สำหรับลงทะเบียน, ตรวจรายชื่อผู้เข้าร่วม, รายงานรายรอบ/รายเดือน
- **ระบบลา** — ยื่นใบลา, แนบใบรับรองแพทย์ (เก็บใน Storage แบบ private), ผู้อนุมัติและลำดับชั้น,
  วันหยุดบริษัท, คีย์ใบลาย้อนหลังโดย HR, หน้าพิมพ์ใบลา (A4) และการแจ้งเตือนผ่าน Web Push

## Stack

- Frontend: Vue 3 + Vite + Vuetify (Cloudflare Pages)
- API: Cloudflare Worker (Hono) ในโฟลเดอร์ `worker/`
- ฐานข้อมูลและไฟล์: Supabase (Postgres ผ่าน PostgREST + Storage)

## รันในเครื่อง

```bash
npm install
npm run dev
```

`npm run dev` รัน Worker ที่ `http://127.0.0.1:8787` คู่กับ Vite ที่ `http://localhost:5173`
และ Vite proxy ส่ง `/api` ไปที่ Worker

- แยกคำสั่ง: `npm run dev:worker` (Worker) และ `npm run dev:web` (Vite)
- เปลี่ยนเป้าหมาย proxy ด้วย `VITE_API_TARGET`
- ค่า environment ของ Worker อยู่ใน `worker/.dev.vars` (ห้าม commit) — ดูรายชื่อตัวแปรใน `.env.example`
- สคริปต์ผู้ดูแล (`npm run check:*`, `npm run issue:reset-code`) อ่านค่าจาก `.env.local`

## ตรวจสอบโค้ด

```bash
npm test                  # เทสต์ฝั่งเว็บ (vitest) ใน tests/
npm run typecheck
cd worker && npm test     # เทสต์ Worker (node --test) ใน worker/tests
cd worker && npm run typecheck
npm run build
```

## Deploy

ขั้นตอน deploy ทั้งหมด (Supabase SQL, bucket, secrets, Worker, Pages, cron และ checklist
หลัง deploy) อยู่ใน [DEPLOY.md](DEPLOY.md)
