# ดัชนีของตาราง meeting_attendance (ผลจาก pg_indexes)

บันทึกวันที่: 31 ต.ค. 2026
โปรเจกต์: Supabase `KCS_DATA`

ที่มาของข้อมูล: ผล query `pg_indexes` ที่ **owner เป็นผู้รัน** บนโปรเจกต์จริง
งานนี้ไม่ได้เชื่อมต่อ Supabase, ไม่ได้ query ซ้ำ และไม่ได้แก้ไข schema ใด ๆ

## ผลที่บันทึกไว้

ตาราง `meeting_attendance` มี **unique index สองตัวบนคอลัมน์ชุดเดียวกัน** `(session_id, employee_id)`:

| indexname | table | columns | unique |
| --- | --- | --- | --- |
| `meeting_attendance_once` | `meeting_attendance` | `(session_id, employee_id)` | yes |
| `meeting_attendance_session_employee_unique` | `meeting_attendance` | `(session_id, employee_id)` | yes |

หมายเหตุ: `indexdef` แบบเต็มไม่ได้ถูกคัดลอกมาเก็บในรีโป — ชื่อ index และคอลัมน์ข้างต้นคือข้อมูลจากผล
query ของ owner หากต้องการยืนยัน ให้รันคำสั่ง read-only ท้ายเอกสารนี้ซ้ำ

## ทำไมจึงมีสองตัว

ทั้งสองตัวบังคับ uniqueness ชุดเดียวกัน ซึ่งปกติเกิดจากการสร้างตาราง/เพิ่ม constraint ซ้ำในอดีต
หรือการเปลี่ยนชื่อ constraint แล้วสร้างใหม่โดยไม่ได้ลบตัวเก่า ไม่มีโค้ดส่วนใดในรีโปสร้าง index เหล่านี้
(ทั้ง Express และ Worker ใช้ `onConflict` แบบระบุคอลัมน์ ไม่ได้อ้างชื่อ index)

## ผลกระทบ

1. **เขียนช้าลงและเปลืองพื้นที่** — ทุก insert/upsert ต้องอัปเดต index สองชุดแทนที่จะเป็นชุดเดียว
2. **arbiter ของ upsert ไม่ชัดเจน** — Worker ใช้ PostgREST `onConflict=session_id,employee_id`
   (ใน `worker/src/auto-absent.js` และเส้นทางลงทะเบียน) เมื่อมี index ที่ตรงเงื่อนไขสองตัว
   Postgres เลือกใช้ตัวใดตัวหนึ่งโดยไม่ได้ระบุไว้ในเอกสาร จึงไม่ควรพึ่งพฤติกรรมนี้ในระยะยาว
3. **debug สับสน** — error `23505` (unique violation) อาจรายงานชื่อ constraint ต่างกันในแต่ละครั้ง
   ทำให้ตามหาต้นเหตุยากขึ้น (โค้ดแปลง `23505` เป็น 409 "ลงทะเบียนแล้ว" อยู่แล้ว)
4. **ข้อมูลไม่ผิด** — uniqueness ยังถูกบังคับเหมือนเดิม และการอ่าน/dashboard ไม่ได้รับผลกระทบ

## คำแนะนำ

- **เก็บ** `meeting_attendance_session_employee_unique` (ชื่อตรงกับคอลัมน์และอ่านง่าย)
  และ **ลบ** `meeting_attendance_once` — owner อนุมัติและเป็นผู้รันเอง
- ก่อนลบ:
  1. สำรองข้อมูลตาม `DEPLOY.md` ข้อ 4
  2. ตรวจว่าไม่มี foreign key / constraint / view อื่นอ้างถึงชื่อ index หรือ constraint นี้
     (คำสั่งตรวจอยู่ท้ายเอกสาร)
  3. ทำในช่วงที่ไม่มีคนลงทะเบียน และทำใน transaction เดียว
- **ไม่ควรลบทั้งสองตัว** เพราะจะทำให้การกันลงทะเบียนซ้ำ (409) และ `resolution=ignore-duplicates`
  ของ auto-absent ทำงานผิด
- หลังลบ ให้ทดสอบ: ลงทะเบียนซ้ำคนเดิมในรอบเดิม (ต้องได้ 409), auto-absent รันซ้ำ (ต้องไม่สร้างแถวซ้ำ),
  และหน้า dashboard อ่านข้อมูลได้ตามปกติ

## คำสั่ง read-only สำหรับยืนยัน (owner รันเอง)

```sql
-- index ทั้งหมดของตาราง
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'meeting_attendance'
order by indexname;

-- constraint ที่ผูกกับตาราง (ดูว่าตัวไหนเป็น unique constraint จริง)
select conname, contype, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.meeting_attendance'::regclass
order by conname;
```

## ขอบเขตของงานนี้

- ไม่มีการรัน `DROP`, `ALTER` หรือ write SQL ใด ๆ
- ไม่ได้เชื่อมต่อฐานข้อมูลจริง
- ไม่ได้เขียนคำสั่งลบ index ไว้ให้รัน (เจตนา) — owner ต้องตัดสินใจและดำเนินการเองหลังสำรองข้อมูล
