-- ข้อมูลย้อนหลัง: คอลัมน์เวลาและสถานที่ของรอบประชุม
-- ไฟล์นี้ "ไม่เขียนข้อมูล" และ "ไม่แก้ข้อมูลเดิม" — เพิ่มคอลัมน์ว่างสองคอลัมน์เท่านั้น
-- ผู้ดูแลระบบต้องรันเองใน Supabase SQL editor (ห้ามรันอัตโนมัติจากแอป)

begin;

alter table public.meeting_sessions
  add column if not exists session_time text,
  add column if not exists location text;

comment on column public.meeting_sessions.session_time is
  'เวลาประชุมรูปแบบ HH:mm ของรอบที่นำเข้าข้อมูลย้อนหลัง (ว่างได้)';
comment on column public.meeting_sessions.location is
  'สถานที่ประชุมของรอบที่นำเข้าข้อมูลย้อนหลัง (ว่างได้)';

commit;

-- ตรวจผลหลังรัน: ต้องได้ 2 แถว และ is_nullable = YES ทั้งคู่
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'meeting_sessions'
  and column_name in ('session_time', 'location')
order by column_name;
