ร่างข้อกำหนด Phase 4 (อ่านอย่างเดียว) - Auto-absent ด้วย Cron Trigger และ DB keep-alive
=====================================================================

วันที่จัดทำ: 2026-10-31
สถานะ: ร่างเพื่อขออนุมัติ ยังไม่เริ่มเขียนโค้ด
รอบนี้: อ่านโค้ดอย่างเดียว เขียนได้เฉพาะไฟล์นี้ไฟล์เดียว
ข้อห้ามที่ถือปฏิบัติในรอบนี้: ไม่เขียนฐานข้อมูล, ไม่รัน wrangler deploy/login/secret/delete,
ไม่เรียกเครือข่ายไปยัง Supabase, ไม่อ่าน .env.local / .dev.vars / .test-account.env,
ไม่พิมพ์หรือบันทึก secret / PIN / token / hash / เลขบัตรประชาชน หรือ body ใด ๆ
ค่าใช้จ่าย: ทุกข้อเสนอในร่างนี้ใช้บริการฟรีเท่านั้น ไม่มีบริการเสียเงิน

แหล่งอ้างอิงที่อ่านในรอบนี้
- server/auto-absent.js - ตัวช่วยล้วน: isDueSession, missingEmployees, isSkipDate,
  shouldEnsureSupSession, dayKeyBefore
- server/auto-absent-job.js - runAutoAbsentOnce, shouldStartRun,
  triggerAutoAbsentIfDue, startAutoAbsentJob
- worker/src/db.js - select, insert, update, upsert (ปัจจุบัน upsert ใช้ merge-duplicates)
- worker/src/index.js - export เฉพาะ fetch ยังไม่มี scheduled handler
- worker/src/register-window.js - bangkokToday, normalizeTime
- worker/src/routes/meeting-dashboard.js - loadContext และ chunk 100
- https://supabase.com/docs/guides/platform/free-project-pausing (ตรวจ 2026-10-31)
- https://developers.cloudflare.com/workers/platform/limits/ (ตรวจ 2026-10-31)

 =====================================================================
 1. อัลกอริทึม auto-absent ตามที่ Express รันจริง
 =====================================================================

ค่าคงที่ใน server/auto-absent-job.js
- RUN_INTERVAL_MS = 10 นาที, FIRST_RUN_DELAY_MS = 60 วินาที, WINDOW_DAYS = 2
- MEETING_CODES = ['sup', 'monthly'], ABSENT_STATUS_CODE = 'not_attended'
- AUDIT_ACTION = 'auto_absent_done', AUDIT_ENTITY = 'meeting_session'
ค่าคงที่ใน server/auto-absent.js
- BANGKOK_OFFSET_MS = 7 ชั่วโมง, WINDOW_MS = 48 ชั่วโมง

ลำดับขั้นของ runAutoAbsentOnce เขียนขั้นละหนึ่งบรรทัด
1. ตั้ง now = new Date(), todayKey = bangkokToday(now), fromKey = dayKeyBefore(todayKey, 2) และถ้า fromKey ว่างให้คืน { processed: 0 } ทันที
2. อ่าน meeting_types คอลัมน์ id, code, weekday, default_open_time, default_cutoff_time โดยกรอง code in ('sup', 'monthly')
3. เลือกประเภท sup เป็น supType ถ้าไม่พบให้ supType = null แล้วไปต่อขั้นถัดไปโดยไม่สร้าง session
4. อ่าน meeting_skip_dates คอลัมน์ skip_date ด้วยเงื่อนไข gte fromKey และ lte todayKey แล้วแปลงเป็น Set
5. ถ้าการอ่านวัน skip ล้มเหลว ให้บันทึกเฉพาะ error.code หรือ error.name แล้วคืน { processed: 0 } โดยไม่สร้าง session และไม่เขียน not_attended เลย (fail-closed)
6. ถ้า supType ไม่เป็น null และ shouldEnsureSupSession เป็นจริง ให้ upsert meeting_sessions หนึ่งแถวแบบ ignoreDuplicates
7. อ่าน meeting_sessions คอลัมน์ id, meeting_type_id, session_date, cutoff_time ด้วยเงื่อนไข gte fromKey และ lte todayKey
8. สร้าง Map จาก meeting_type_id ไปยังประเภท แล้วตัด session ที่หา type ไม่พบออก
9. หา cutoffTime ของแต่ละ session จาก toHm(session.cutoff_time) ถ้าไม่ได้ใช้ toHm(type.default_cutoff_time) และถ้าไม่ได้ทั้งสองทางให้ตัด session นั้นออก
10. เก็บ session ที่ isDueSession เป็นจริงไว้ใน dueSessions และถ้า dueSessions ว่างให้คืน { processed: 0 }
11. อ่าน audit_logs คอลัมน์ entity_id ที่ action = 'auto_absent_done' และ entity = 'meeting_session' และ entity_id in (due session ids) แล้วแปลงเป็น Set ของ marker
12. ตั้ง pending = dueSessions ที่ไม่มี marker และถ้า pending ว่างให้คืน { processed: 0 }
13. อ่าน meeting_roster คอลัมน์ meeting_type_id, employee_id พร้อม embed employees!meeting_roster_employee_id_fkey!inner(department_id, position_id) โดยกรอง meeting_type_id ของ pending และ is_active = true
14. อ่าน meeting_attendance คอลัมน์ session_id, employee_id ในชุด pending session ids แล้วจัดกลุ่มตาม session_id
15. ตั้ง stamp = new Date().toISOString() หนึ่งครั้งต่อรอบ และใช้ค่าเดียวกันทุกแถว
16. ต่อหนึ่ง pending session ให้ missing = missingEmployees(roster ของประเภทนั้น, attended ของ session นั้น) โดยคงลำดับ roster เดิม
17. เขียนแถว not_attended ของ missing ด้วย upsert แบบ array body และ ignoreDuplicates
18. insert audit marker หนึ่งแถวต่อหนึ่ง session เสมอแม้ missing ว่าง เพื่อปิดเคสไม่ให้รอบถัดไปหยิบ session นี้ซ้ำ
19. นับ processed เพิ่มหนึ่งเมื่อ session นั้นเขียนครบทั้งสองส่วน แล้วคืน { processed } เมื่อจบ pending ทั้งหมด

เงื่อนไข isDueSession (หน้าต่าง 48 ชั่วโมง)
- session_date ต้องไม่เกินวันไทยของ todayKey และแปลงรูป YYYY-MM-DD ได้
- cutoff = เที่ยงคืนของวัน session บวกเวลา cutoff ลบเขตเวลาไทย 7 ชั่วโมง
- ถ้า now ยังไม่ถึง cutoff ถือว่ายังไม่ due, ถ้าเลย cutoff มาไม่เกิน 48 ชั่วโมงถือว่า due, ถ้าเกิน 48 ชั่วโมงถือว่าไม่ due เสมอ
- ถ้า cutoff ไม่เข้ารูป HH:mm ถือว่าไม่ due

เงื่อนไข shouldEnsureSupSession
- weekday ต้องมีค่า และวันไทยของ todayKey ต้องตรงกับ weekday นั้น
- todayKey ต้องไม่อยู่ใน Set วัน skip และ now ต้องถึงหรือเลย cutoff ของวันนี้แล้ว

 =====================================================================
 2. การแบ่งงานให้อยู่ใต้เพดาน 50 subrequest
 =====================================================================

หลักคิด: หนึ่งรอบ cron ทำงานไม่เกิน 50 subrequest และไม่เกิน CPU 10 ms จึงต้องกำหนด
จำนวน pending session ต่อรอบไว้ตายตัว แล้วปล่อยส่วนที่เหลือไปรอบถัดไป

การเรียกทั้งหมดในหนึ่งรอบ (N = จำนวน pending session ที่รอบนั้นหยิบมาทำ)
1. GET meeting_types - 1 subrequest
2. GET meeting_skip_dates - 1 subrequest
3. POST meeting_sessions (upsert ignore) - 0 หรือ 1 subrequest ขึ้นกับเงื่อนไขขั้นที่ 6
4. GET meeting_sessions - 1 subrequest
5. GET audit_logs เพื่ออ่าน marker - ceil(N / 100) subrequest เพราะ in(...) รับได้ทีละ 100 id
6. GET meeting_roster - 1 subrequest เพราะมีเพียงสองประเภท (sup, monthly)
7. GET meeting_attendance เพื่ออ่านผู้ที่ลงทะเบียนแล้ว - ceil(N / 100) subrequest
8. POST meeting_attendance แบบ array body รวมทุกแถวของรอบนั้นในครั้งเดียว - 1 subrequest
9. POST audit_logs แบบ array body รวมทุก session ของรอบนั้นในครั้งเดียว - 1 subrequest

รวมต่อรอบ = 6 + 2 * ceil(N / 100) subrequest และบวกอีก 1 เมื่อรอบนั้นสร้าง session ของวัน sup

ตัวเลขที่ต้องการ
- เมื่อ N = 10 ใช้ 8 subrequest (หรือ 9 เมื่อมีการสร้าง session ของวัน sup)
- เพดานทางทฤษฎีจาก subrequest คือ 6 + 2 * ceil(N / 100) <= 50 ซึ่งให้ ceil(N / 100) <= 22 นั่นคือ N <= 2,200 session ต่อรอบ
- แต่ตัวจำกัดจริงไม่ใช่ subrequest: CPU 10 ms และขนาด body ของ upsert จึงตั้งเพดานใช้งานที่ 10 session ต่อรอบ
- ที่ 10 session และ roster 400 คนต่อประเภท ขนาด body ของ upsert อยู่ราว 4,000 แถว ซึ่งยังเล็กเมื่อเทียบกับเพดาน request body 100 MB

วิธีแบ่งงานข้ามรอบ cron
- เรียง pending ตาม session_date จากเก่าไปใหม่ แล้วตาม id เพื่อให้ลำดับคงที่ทุกรอบ
- หยิบเฉพาะ B = 10 session แรกมาทำในรอบนี้ ส่วนที่เหลือไม่ต้องจำอะไรไว้ เพราะรอบถัดไปอ่านฐานข้อมูลใหม่แล้วคำนวณ pending เองทั้งหมด
- marker auto_absent_done ถูกเขียนหลังการเขียน attendance ของ session นั้นสำเร็จแล้วเท่านั้น ถ้ารอบนั้นหยุดกลางทาง session ที่ยังไม่มี marker จะยังคงเป็น pending ในรอบถัดไป
- ignoreDuplicates ที่ unique(session_id, employee_id) ทำให้การเขียนซ้ำในรอบถัดไปไม่สร้างแถวซ้ำ และไม่ทับแถวที่พนักงานลงทะเบียนเอง
- ไม่มีข้อมูลหาย เพราะไม่มี state ระหว่างรอบให้เสีย และทุกการเขียนเป็นการเขียนซ้ำได้อย่างปลอดภัย

ความจุเทียบกับภาระจริง
- cron ทุก 10 นาที = 144 รอบต่อวัน คูณเพดาน 10 session = 1,440 session ต่อวัน
- ภาระจริงมีไม่เกิน 3 session ที่ due พร้อมกัน (sup สัปดาห์ละครั้ง และ monthly เดือนละครั้ง) จึงไม่มีการค้างคิว
- ต้องระบายคิวภายในหน้าต่าง 48 ชั่วโมง เพราะ session ที่เลย 48 ชั่วโมงจะไม่ถูกหยิบอีก ด้วยความจุข้างต้นจึงเหลือระยะปลอดภัยมาก

 =====================================================================
 3. การแมปกับ Cron Trigger และ idempotency
 =====================================================================

cron ที่เสนอ (2 trigger อยู่ใต้เพดาน 5 ข้อของบัญชีฟรี)
1. `*/10 * * * *` -> auto-absent ตามความถี่เดิมของ Express
2. `0 1,9,17 * * *` -> keep-alive อ่านอย่างเดียว 3 ครั้งต่อวัน (เวลา 08:00, 16:00 และ 00:00 ตามเขตเวลาไทย)

การทำงานใน scheduled()
- Worker มี scheduled handler เดียว ทุก expression เข้ามาที่ handler เดียวกันและแยกด้วยค่า cron ของ event
- ถ้า cron ตรง `*/10 * * * *` ให้ await runAutoAbsentOnce(db) ตรง ๆ โดยไม่ต้องใช้ waitUntil เพราะไม่มีงานต่อเนื่องหลังตอบกลับ
- ถ้า cron ตรง `0 1,9,17 * * *` ให้เรียก branch keep-alive ตามข้อ 5
- ถ้าไม่ตรง expression ใดให้จบรอบอย่างเงียบ ๆ ไม่บันทึกอะไร

สิ่งที่ตัดออกจาก Express และเหตุผล
- setInterval และ setTimeout ใช้ไม่ได้ เพราะ Workers ไม่มี timer ในหน่วยความจำที่อยู่ข้ามการเรียก จึงใช้ cron แทน
- flag runInProgress ตัดออก เพราะหนึ่งรอบ cron คือหนึ่ง run และไม่มีทางทับกันเองในรอบเดียว
- lastStartedAt ตัดออก เพราะ cron บังคับระยะห่างขั้นต่ำ 10 นาทีอยู่แล้ว
- AUTO_ABSENT_ENABLED แทนด้วยการมีหรือไม่มี triggers ใน deploy manifest

idempotency สองชั้น
- ชั้นที่หนึ่ง marker auto_absent_done อ่านก่อนทำ ถ้ามี marker แล้ว session นั้นจะไม่ถูกหยิบมาทำซ้ำ
- ชั้นที่สอง ignoreDuplicates ทั้งที่ meeting_sessions ซึ่งกันแถวรอบวันซ้ำ และที่ meeting_attendance ซึ่งกันแถว (session_id, employee_id) ซ้ำ
- audit_logs ไม่มี unique constraint จึงอาศัยกติกาเพิ่มหนึ่งข้อ: หนึ่งรอบเขียน marker ต่อ session เพียงครั้งเดียว และไม่มีการ retry ภายในรอบเดียวกัน ถ้าต้องการกันซ้ำระดับฐานข้อมูลต้องเพิ่ม unique index ซึ่งเป็นข้อให้เจ้าของตัดสินในข้อ 8

 =====================================================================
 4. การเขียนฐานข้อมูล พร้อมคอลัมน์เป๊ะ ๆ
 =====================================================================

การเขียนมีสามจุดเท่านั้น ไม่มีการเขียนอื่น

1. meeting_sessions.upsert ทำเฉพาะเมื่อเงื่อนไขขั้นที่ 6 เป็นจริง
   คอลัมน์: meeting_type_id, session_date = todayKey (YYYY-MM-DD ของวันไทย),
   cycle_key = `sup-${todayKey}`, open_time = toHm(default_open_time),
   cutoff_time = toHm(default_cutoff_time)
   onConflict: 'meeting_type_id,session_date' และ ignoreDuplicates = true
   เหตุผล: รอบที่สร้างด้วยมือหรือมีเวลาเฉพาะตัวต้องไม่ถูกทับด้วยค่า default
   ต้องแก้ worker/src/db.js ให้ upsert รับ option ignoreDuplicates ได้ ปัจจุบันตั้งค่า
   resolution=merge-duplicates ไว้ตายตัว และต้องให้ body รับ array ได้ด้วย

2. meeting_attendance.upsert หนึ่งครั้งต่อรอบ ด้วย array body รวมทุกแถวที่ต้องเขียน
   คอลัมน์: session_id, employee_id, status_code = 'not_attended', reason = null,
   shift = null, department_id และ position_id จาก embed employees ของแถว roster,
   registered_at = stamp (ISO เดียวกันทุกแถวในรอบ)
   onConflict: 'session_id,employee_id' และ ignoreDuplicates = true
   เหตุผล: แถวที่พนักงานลงทะเบียนเองแล้วไม่ถูกแตะ และแถว not_attended เดิมไม่ถูกเขียนซ้ำ

3. audit_logs.insert หนึ่งครั้งต่อรอบ ด้วย array body หนึ่งแถวต่อหนึ่ง session
   คอลัมน์: actor_id = null, action = 'auto_absent_done', entity = 'meeting_session',
   entity_id = session id, detail = JSON.stringify({ count: จำนวนแถว not_attended ของ session นั้น })
   เขียนเสมอแม้ count = 0 เพื่อปิดเคส

ไม่มีการเขียนอื่นเลย: ไม่มี update, ไม่มี delete, ไม่แตะ employees, ไม่แตะ meeting_types

 =====================================================================
 5. Supabase keep-alive
 =====================================================================

นโยบายจากหน้าของ Supabase (ตรวจ 2026-10-31)
- ที่มาที่อ่าน: https://supabase.com/docs/guides/platform/free-project-pausing
- ประโยคที่ระบุว่าอะไรนับเป็น activity คัดมาตรงตัวว่า
  "Typically a few user requests to the database each day over the previous week is
  enough to keep the project from being paused."
- หน้าเดียวกันยังระบุวิธีกันการพักไว้สองข้อ คือเปิดโปรเจกต์ผ่าน Dashboard เพื่อสร้าง activity
  และสร้าง activity ด้วยการเรียก API เข้ามาที่โปรเจกต์หรือผ่านแอปที่เชื่อมอยู่

สถานะที่ตรวจได้และตรวจไม่ได้
- หน้านี้ไม่ได้ระบุว่าการอ่านหนึ่งครั้งต่อวันนับเป็น activity ที่เพียงพอ จึงถือว่า **ยังไม่ยืนยัน**
  (unconfirmed) คำว่า a few ในประโยคข้างต้นหมายถึงหลายครั้ง ไม่ใช่ครั้งเดียว
- ทางเลือกที่ตรวจสอบได้แทนการเดา
  1. ให้เจ้าของเปิดโปรเจกต์ผ่าน Dashboard ตามที่หน้าระบุตรง ๆ ซึ่งเป็นวิธีที่หน้าเดียวกันรับรอง
  2. ถ้าต้องการอัตโนมัติ ให้ยิงอ่าน 3 ครั้งต่อวันกระจายเวลา แทน 1 ครั้ง เพื่อให้เข้าเงื่อนไข a few
     แล้วให้เจ้าของยืนยันตัวเลขใน Dashboard -> Reports ว่า request ถูกนับจริง
     ผมยืนยันแทนไม่ได้ในรอบนี้ เพราะรอบนี้ห้ามเรียกเครือข่ายไปยัง Supabase

ข้อเสนอทางเทคนิค
- ใช้ worker/src/db.js เดิม: db.select('meeting_types', { columns: 'id', limit: 1 })
- ไม่อ่านตารางที่มีข้อมูลส่วนบุคคล และไม่เขียนอะไรทั้งสิ้น
- จำนวน 3 ครั้งต่อวัน ใช้ cron เดียวที่ทำงานทุก 8 ชั่วโมง คือ `0 1,9,17 * * *`
  (เวลา 08:00, 16:00, 00:00 ตามเขตเวลาไทย)
- เมื่อ error ให้บันทึกเฉพาะชื่อ error และ code แล้วจบรอบนั้น ไม่ retry และไม่เพิ่มบริการแจ้งเตือน
- ห้ามบันทึก url, key, ผลลัพธ์เต็ม หรือค่าใด ๆ จาก environment ลง log

 =====================================================================
 6. เพดานของ Cron บนแผนฟรี
 =====================================================================

ตรวจเมื่อ 2026-10-31 จาก https://developers.cloudflare.com/workers/platform/limits/
- จำนวน Cron Trigger ต่อบัญชี: Workers Free 5, Workers Paid 250
- CPU time ต่อ Cron Trigger: Workers Free 10 ms, Workers Paid 30 วินาที (ช่วงน้อยกว่า 1 ชั่วโมง) หรือ 15 นาที (ช่วงตั้งแต่ 1 ชั่วโมงขึ้นไป)
- Wall time ของ Cron Trigger: 15 นาทีต่อการเรียก
- Subrequest ต่อการเรียก: Workers Free 50, Workers Paid 10,000
- จำนวน connection ขาออกพร้อมกัน: 6 ต่อการเรียก
- Request ต่อวัน: Workers Free 100,000 ต่อวัน รีเซ็ตเวลาเที่ยงคืน UTC เกินแล้วได้ error 1027
- หน้าเดียวกันระบุชัดว่าเวลารอ network เช่น fetch ไม่นับเป็น CPU time

เทียบกับที่ร่างนี้ใช้
- ใช้ 2 trigger จากเพดาน 5
- ใช้ subrequest สูงสุด 9 จากการเรียกหนึ่งครั้ง จากเพดาน 50
- ใช้ประมาณ 147 การเรียกต่อวัน (144 จาก auto-absent และ 3 จาก keep-alive) จากเพดาน 100,000
- ไม่มีข้อใดในร่างนี้ต้องใช้แผนเสียเงิน

 =====================================================================
 7. ความเสี่ยงด้าน CPU และแผนวัดก่อน deploy
 =====================================================================

ความเสี่ยง
- เพดาน CPU 10 ms ต่อ Cron Trigger บนแผนฟรีเป็นข้อจำกัดที่แน่นที่สุดในงานนี้ ไม่ใช่ subrequest
- งานที่กิน CPU คือ JSON.parse ของ roster และ attendance, การสร้าง Set และ Map, การเรียงลำดับ และ Intl.DateTimeFormat ใน bangkokToday
- เวลารอ fetch ไม่นับเป็น CPU จึงคาดว่าอยู่ในเกณฑ์ แต่ยังต้องวัดจริงก่อน deploy
- ถ้าเกินเพดาน Cloudflare คืน error 1102 และ invocation นั้นถูกตัดกลางทาง ซึ่งปลอดภัยต่อข้อมูลเพราะ marker ยังไม่ถูกเขียน แต่ต้องไม่ให้เกิด

แผนวัด ก่อน deploy ทุกขั้นใช้ของฟรีและทำในเครื่อง
1. สร้าง fixture ขนาดจริงในเครื่อง: roster 400 คนต่อประเภท, attendance 800 แถว, session 3 แถว ในหน้าต่าง 48 ชั่วโมง
2. รัน wrangler dev พร้อม flag --test-scheduled แล้วยิง scheduled ผ่าน URL ทดสอบในเครื่อง เพื่อวัด wall time และดู log โดยไม่ต้อง deploy
3. วัด CPU ด้วย DevTools profiler ของ workerd ในเครื่อง แล้วเทียบกับเพดาน 10 ms
4. เกณฑ์ผ่าน: CPU ที่วัดได้ต้องไม่เกินครึ่งของเพดาน คือ 5 ms เพื่อเหลือระยะปลอดภัย
5. ถ้าเกินเกณฑ์ ให้ลด B จาก 10 เหลือ 1 session ต่อรอบก่อน แล้ววัดซ้ำ ถ้ายังเกินให้ย้ายการแปลงเวลาไทยออกจากเส้นทางร้อน
6. หลัง deploy ให้ดู Metrics -> Errors -> Invocation Statuses ว่าไม่มี exceededCpu ในสองวันแรก
- ยังไม่ deploy จนกว่าข้อ 4 จะผ่าน

 =====================================================================
 8. เรื่องที่เจ้าของต้องตัดสิน (บรรทัดละข้อ พร้อมข้อแนะนำ)
 =====================================================================

1. ความถี่ auto-absent: `*/10 * * * *` - แนะนำให้คงตาม Express เดิม
2. เวลา keep-alive: `0 1,9,17 * * *` (3 ครั้งต่อวัน) - แนะนำ 3 ครั้ง เพราะหน้าของ Supabase ไม่ยืนยันว่าครั้งเดียวนับ
3. ตารางที่ใช้ keep-alive: meeting_types limit 1 - แนะนำตามนี้ เพราะเป็นตารางเล็กและไม่มีข้อมูลส่วนบุคคล
4. เปิด cron ทันทีเมื่อ deploy หรือกันด้วย flag - แนะนำเปิดทันที ไม่เพิ่ม flag เพราะปิดได้ด้วยการถอด trigger
5. เพดาน B = 10 session ต่อรอบ - แนะนำ 10 เพราะภาระจริงไม่เกิน 3 และยังเหลือ margin ด้าน CPU
6. เพิ่ม unique index บน audit_logs (action, entity, entity_id) - แนะนำยังไม่เพิ่มใน Phase นี้ เพราะต้องทำ migration และ marker ที่มีอยู่ก็กันซ้ำได้แล้ว
7. แก้ worker/src/db.js ให้ upsert รับ ignoreDuplicates และ array body - แนะนำให้แก้ เพราะเป็นทางเดียวที่จะได้พฤติกรรม ignore เหมือน Express
8. การแจ้งเตือนเมื่อ keep-alive ล้มเหลว - แนะนำยังไม่เพิ่มใน Phase นี้ ให้ดูจาก log ก่อน
9. ให้ dashboard แสดงข้อมูลทันทีหลัง cron ทำงานหรือไม่ - แนะนำไม่แก้ dashboard เพราะ Phase 3 คงรูปเดิมและผู้ใช้กด refresh เองได้

 =====================================================================
 9. chunk ที่เสนอ
 =====================================================================

4a - auto-absent พร้อม cron
- port ตัวช่วยเป็น worker/src/auto-absent.js ตาม server/auto-absent.js แบบตรงตัว
- สร้าง worker/src/auto-absent-job.js ที่มี runAutoAbsentOnce แบบ batched ตามข้อ 2 โดยไม่มี throttle state
- แก้ worker/src/db.js เพิ่ม option ignoreDuplicates และรองรับ array body ใน upsert และ insert
- เพิ่ม scheduled handler ใน worker/src/index.js พร้อม dispatch ตามค่า cron
- แปลงเคสจาก tests/auto-absent.test.js และ tests/auto-absent-throttle.test.js เป็น node:test ด้วย fake fetch และนาฬิกาแช่
- เพิ่มเคสใหม่: การแบ่งรอบเมื่อ pending เกิน B, การไม่เขียนซ้ำเมื่อมี marker, การไม่เรียกเกินเพดาน subrequest
- ปิดท้ายด้วย typecheck, npm test และ wrangler dev แบบ --test-scheduled ในเครื่อง

4b - keep-alive
- เพิ่ม branch keep-alive ใน scheduled handler ตามข้อ 5
- เพิ่มเทสต์ยืนยันว่า branch นี้เรียกเฉพาะ GET และไม่มีการเขียนใด ๆ ออกมา
- เพิ่มเทสต์ว่า cron ที่ไม่รู้จักจบเงียบ ๆ
- รวมเข้า 4a ได้ถ้าเจ้าของต้องการลดขั้นตอน แต่แนะนำแยกเพื่อให้ตรวจ 4a ได้ก่อน

 =====================================================================
 10. บันทึกการตรวจของรอบนี้
 =====================================================================

รันจากโฟลเดอร์ worker/ หลังเขียนไฟล์นี้เสร็จ
- คำสั่ง: npm test (สคริปต์คือ node --test)
- exit code: 0
- ผลนับ: tests 298, pass 298, fail 0, cancelled 0, skipped 0, todo 0
- duration_ms: 1387.1057

ขอบเขตของรอบนี้
- ไม่ได้แก้ไฟล์โค้ดใดเลย ไฟล์ที่เขียนมีเพียงไฟล์นี้ไฟล์เดียว
- ไม่ได้เรียก Supabase จริง ไม่ได้เขียนฐานข้อมูล และไม่ได้รันคำสั่ง wrangler ใด ๆ
- ไม่ได้พิมพ์หรือบันทึก secret / PIN / token / hash / เลขบัตรประชาชน หรือ body ใด ๆ
