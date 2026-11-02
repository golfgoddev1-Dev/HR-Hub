-- ข้อมูลย้อนหลังหลายรอบต่อวัน
-- รันไฟล์นี้บนฐานข้อมูล "ก่อน" deploy โค้ดที่ใช้ unique ใหม่
-- (โค้ดใหม่ upsert ด้วย meeting_type_id, session_date, session_time)
--
-- ผลลัพธ์: หนึ่งวัน/หนึ่งประเภท มีได้หลายรอบตามเวลา และรอบปกติของวันใช้ session_time = ''

begin;

-- 1) แถวเดิมที่ยังไม่มีเวลา -> ค่าว่าง (รอบปกติของวัน)
update public.meeting_sessions
   set session_time = ''
 where session_time is null;

-- 2) ค่าเริ่มต้น '' และ not null
alter table public.meeting_sessions
  alter column session_time set default '',
  alter column session_time set not null;

comment on column public.meeting_sessions.session_time is
  'เวลารอบประชุม HH:mm; ค่าว่าง = รอบปกติของวัน (ไม่มีเวลา)';

-- 3) ลบ unique เดิม (ประเภท + วันที่)
alter table public.meeting_sessions
  drop constraint if exists meeting_sessions_unique;

-- 4) unique ใหม่ (ประเภท + วันที่ + เวลา)
alter table public.meeting_sessions
  add constraint meeting_sessions_type_date_time_unique
  unique (meeting_type_id, session_date, session_time);

commit;

-- ตรวจผล (อ่านอย่างเดียว): ต้องเห็น meeting_sessions_type_date_time_unique
-- 1 แถว และต้องไม่มี meeting_sessions_unique
select con.conname as constraint_name,
       pg_get_constraintdef(con.oid) as definition
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
 where ns.nspname = 'public'
   and rel.relname = 'meeting_sessions'
   and con.contype = 'u'
 order by con.conname;
