# รายการข้อความบนหน้าจอที่คู่มืออ้างถึง

ไฟล์นี้ใช้ตรวจคู่มือกับระบบจริงทีละบรรทัด ข้อความในคอลัมน์แรกคือข้อความที่ผู้ใช้เห็นบนหน้าจอ ต้องตรงกับคู่มือทุกตัวอักษร

วิธีอ่าน

- หน้า คือที่อยู่ของหน้าที่ข้อความนั้นอยู่
- บทบาท คือผู้ใช้ที่เห็นข้อความนั้น
- อุปกรณ์ คือเครื่องที่เห็นข้อความนั้น (มือถือ / คอมพิวเตอร์ / ทั้งสอง)
- ไฟล์ คือไฟล์ต้นทางที่ข้อความนั้นอยู่
- ถ้าข้อความใดหาไม่พบในโค้ด ให้ทำเครื่องหมายว่า `ไม่พบในโค้ด` และต้องเอาออกจากคู่มือก่อนเผยแพร่

## เมนูและทุกหน้า

- **งานของฉัน** — ทุกหน้า — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/lib/nav-config.js
- **งาน HR** — ทุกหน้า — ผู้ดูแล HR — ทั้งสอง — src/lib/nav-config.js
- **งานหัวหน้า** — ทุกหน้า — ผู้อนุมัติ — ทั้งสอง — src/lib/nav-config.js
- **งานประชุม** — ทุกหน้า — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/lib/nav-config.js
- **ผู้ดูแลระบบ** — ทุกหน้า — ผู้ดูแลระบบ — ทั้งสอง — src/lib/nav-config.js
- **เมนูผู้ควบคุมการประชุม** — /meeting/controller — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/components/ControllerNav.vue
- **ออกจากระบบ** — ทุกหน้า — ทุกบทบาท — ทั้งสอง — src/components/AppDock.vue
- **ออกจากระบบ** — ทุกหน้า — ผู้ดูแลระบบ — คอมพิวเตอร์ — src/components/AdminNav.vue
- **ออกจากระบบ** — /meeting/controller — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/components/ControllerNav.vue
- **เมนู** — ทุกหน้า — พนักงานทั่วไป, ผู้ดูแล HR — มือถือ — src/components/AppDock.vue
- **เมนูทั้งหมด** — ทุกหน้า — พนักงานทั่วไป, ผู้ดูแล HR — มือถือ — src/components/AppDock.vue
- **ปิดเมนู** — ทุกหน้า — พนักงานทั่วไป, ผู้ดูแล HR — มือถือ — src/components/AppDock.vue
- **ใบลาของฉัน** (เมนู) — /leave — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/lib/nav-config.js
- **ยื่นใบลา** (เมนู) — /leave/new — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/lib/nav-config.js
- **ปฏิทินการลา** (เมนู) — /leave/calendar — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/lib/nav-config.js
- **ข้อมูลส่วนตัว** (เมนู) — /profile — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/lib/nav-config.js
- **เปลี่ยน PIN** (เมนู) — /change-pin — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/lib/nav-config.js
- **อนุมัติใบลา** (เมนู) — /leave/approvals — ผู้อนุมัติ — ทั้งสอง — src/lib/leave-nav-items.js
- **ประวัติการอนุมัติ** (เมนู) — /leave/approvals/history — ผู้อนุมัติ, ผู้ดูแล HR — ทั้งสอง — src/lib/leave-nav-items.js
- **หน้าหลัก** (เมนู HR) — /hr — ผู้ดูแล HR — ทั้งสอง — src/lib/nav-config.js
- **รายชื่อพนักงาน** (เมนู HR) — /hr/employees — ผู้ดูแล HR — ทั้งสอง — src/lib/nav-config.js
- **นำเข้าพนักงาน** (เมนู HR) — /hr/employees/import — ผู้ดูแล HR — ทั้งสอง — src/lib/nav-config.js
- **จัดการข้อมูลพนักงาน** (เมนู HR) — /hr/employees/manage — ผู้ดูแล HR — ทั้งสอง — src/lib/nav-config.js
- **จัดการรหัสผ่านพนักงาน** (เมนู HR) — /hr/employees/password — ผู้ดูแล HR — ทั้งสอง — src/lib/nav-config.js
- **ใบลาทั้งหมด** (เมนู HR) — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/lib/nav-config.js
- **คีย์ใบลาย้อนหลัง** (เมนู HR) — /hr/leave/backdated — ผู้ดูแล HR — ทั้งสอง — src/lib/nav-config.js
- **วันหยุด** (เมนู HR) — /hr/leave/holidays — ผู้ดูแล HR — ทั้งสอง — src/lib/nav-config.js
- **ใบรับรองแพทย์** (เมนู HR) — /hr/leave/certificates — ผู้ดูแล HR — ทั้งสอง — src/lib/nav-config.js
- **ผู้อนุมัติ** (เมนู HR) — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/lib/nav-config.js
- **ตั้งค่าใบลา** (เมนู HR) — /hr/leave/settings — ผู้ดูแล HR — ทั้งสอง — src/lib/nav-config.js
- **หน้าหลัก** (เมนูประชุม) — /meeting/controller — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/lib/nav-config.js
- **QR และรอบประชุม** — /meeting/controller/qr — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/lib/nav-config.js
- **รายชื่อประชุม** — /meeting/controller/roster — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/lib/nav-config.js
- **จัดการข้อมูลพนักงาน** (เมนูประชุม) — /meeting/controller/employees — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/lib/nav-config.js
- **ผู้เข้าร่วม** — /meeting/controller/registrants — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/lib/nav-config.js
- **ข้อมูลย้อนหลัง** — /meeting/controller/backfill — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/lib/nav-config.js
- **นำเข้าข้อมูลย้อนหลัง** — /meeting/controller/backfill/import — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/lib/nav-config.js
- **แดชบอร์ด** — /meeting/controller/dashboard — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/lib/nav-config.js
- **ภาพรวมผู้ดูแล** — /admin — ผู้ดูแลระบบ — ทั้งสอง — src/lib/nav-config.js
- **สิทธิ์ผู้ใช้** — /admin/permissions — ผู้ดูแลระบบ — ทั้งสอง — src/lib/nav-config.js
- **จัดการผู้ใช้** — /admin — ผู้ดูแลระบบ — ทั้งสอง — src/lib/nav-config.js
- **ตั้งค่าระบบ** — /admin — ผู้ดูแลระบบ — ทั้งสอง — src/lib/nav-config.js
- **เร็วๆ นี้** — /admin — ผู้ดูแลระบบ — ทั้งสอง — src/lib/nav-config.js, src/components/AdminNav.vue

## เข้าสู่ระบบ (/login)

- **เข้าสู่ระบบ** (ชื่อหน้า) — /login — ทุกบทบาท — ทั้งสอง — src/pages/LoginPage.vue
- **1. ประเภทการเข้าใช้งาน** — /login — ทุกบทบาท — ทั้งสอง — src/pages/LoginPage.vue
- **พนักงานทั่วไป** — /login — ทุกบทบาท — ทั้งสอง — src/pages/LoginPage.vue
- **ผู้ดูแล HR** — /login — ทุกบทบาท — ทั้งสอง — src/pages/LoginPage.vue
- **หัวหน้าคุมประชุม** — /login — ทุกบทบาท — ทั้งสอง — src/pages/LoginPage.vue
- **ผู้ดูแลระบบภาพรวม** — /login — ทุกบทบาท — ทั้งสอง — src/pages/LoginPage.vue
- **2. เลขบัตรประชาชน 13 หลัก** — /login — ทุกบทบาท — ทั้งสอง — src/pages/LoginPage.vue
- **PIN 6 หลัก** — /login — ทุกบทบาท — ทั้งสอง — src/pages/LoginPage.vue
- **แสดง / ซ่อน** — /login — ทุกบทบาท — ทั้งสอง — src/pages/LoginPage.vue
- **เข้าสู่ระบบ** (ปุ่ม) — /login — ทุกบทบาท — ทั้งสอง — src/pages/LoginPage.vue
- **ตั้งหรือรีเซ็ต PIN ด้วยรหัสจาก HR** — /login — ทุกบทบาท — ทั้งสอง — src/pages/LoginPage.vue
- **ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่** — /login — ทุกบทบาท — ทั้งสอง — src/pages/LoginPage.vue
- **บัญชีถูกล็อกชั่วคราว** — /login — ทุกบทบาท — ทั้งสอง — src/components/LockoutDialog.vue
- **ตกลง** — /login — ทุกบทบาท — ทั้งสอง — src/components/LockoutDialog.vue
- **ตั้ง PIN สำเร็จ กรุณาเข้าสู่ระบบด้วย PIN ใหม่** — /login — ทุกบทบาท — ทั้งสอง — src/pages/LoginPage.vue

## ตั้งหรือรีเซ็ต PIN (/set-pin)

- **ตั้งหรือรีเซ็ต PIN** — /set-pin — ทุกบทบาท — ทั้งสอง — src/pages/SetPinPage.vue
- **เลขบัตรประชาชน 13 หลัก** — /set-pin — ทุกบทบาท — ทั้งสอง — src/pages/SetPinPage.vue
- **รหัสจาก HR 8 หลัก** — /set-pin — ทุกบทบาท — ทั้งสอง — src/pages/SetPinPage.vue
- **PIN ใหม่ 6 หลัก** — /set-pin — ทุกบทบาท — ทั้งสอง — src/pages/SetPinPage.vue
- **ยืนยัน PIN ใหม่** — /set-pin — ทุกบทบาท — ทั้งสอง — src/pages/SetPinPage.vue
- **ตั้ง PIN** — /set-pin — ทุกบทบาท — ทั้งสอง — src/pages/SetPinPage.vue
- **กลับไปหน้าเข้าสู่ระบบ** — /set-pin — ทุกบทบาท — ทั้งสอง — src/pages/SetPinPage.vue
- **ไม่สามารถตั้ง PIN ได้ กรุณาลองใหม่** — /set-pin — ทุกบทบาท — ทั้งสอง — src/pages/SetPinPage.vue
- **“เพิ่มไปที่หน้าจอโฮม”** — /profile — พนักงานทั่วไป, ผู้ดูแล HR — มือถือ — src/components/PushToggle.vue
- **เปิดใน Safari** — /profile — พนักงานทั่วไป, ผู้ดูแล HR — มือถือ — src/components/PushToggle.vue

## เปลี่ยน PIN ก่อนใช้งาน (/change-pin)

- **เปลี่ยน PIN ก่อนใช้งาน** — /change-pin — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/ChangePinPage.vue
- **PIN ใหม่ (6 หลัก)** — /change-pin — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/ChangePinPage.vue
- **ยืนยัน PIN ใหม่** — /change-pin — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/ChangePinPage.vue
- **บันทึก PIN ใหม่** — /change-pin — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/ChangePinPage.vue
- **PIN ทั้งสองช่องไม่ตรงกัน** — /change-pin — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/ChangePinPage.vue
- **เปลี่ยน PIN ไม่สำเร็จ กรุณาลองใหม่** — /change-pin — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/ChangePinPage.vue

## ใบลาของฉัน (/leave)

- **ใบลาของฉัน** (ชื่อหน้า) — /leave — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveHomePage.vue
- **ยื่นใบลาใหม่ →** — /leave — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveHomePage.vue
- **ใบลาของฉันที่รอดำเนินการ** — /leave — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveHomePage.vue
- **ใบลารอฉันอนุมัติ** — /leave — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveHomePage.vue
- **รออนุมัติ** (สถานะ) — /leave — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveHomePage.vue
- **อนุมัติแล้ว** (สถานะ) — /leave — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveHomePage.vue
- **ไม่อนุมัติ** (สถานะ) — /leave — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveHomePage.vue
- **ช่วงวันที่** — /leave — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveHomePage.vue
- **จำนวนวัน** — /leave — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveHomePage.vue
- **กลับมาทำงาน** — /leave — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveHomePage.vue
- **ยื่นเมื่อ** — /leave — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveHomePage.vue
- **เหตุผลจากผู้อนุมัติ:** — /leave — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveHomePage.vue
- **ยังไม่มีรายการใบลา** — /leave — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveHomePage.vue
- **เปิดไฟล์แนบ (ต้องล็อกอิน)** — /leave — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/leave-certificate.js

## อีเมลแจ้งผลใบลา

- **HR Hub: แจ้งทราบการลาที่ได้รับการอนุมัติ** — อีเมล — หัวหน้ากะ — ทั้งสอง — worker/src/email/decision-email.js
- **HR Hub: แจ้งทราบการลาที่ไม่ได้รับการอนุมัติ** — อีเมล — หัวหน้ากะ — ทั้งสอง — worker/src/email/decision-email.js
- **HR Hub: ใบลาของคุณได้รับการอนุมัติแล้ว** — อีเมล — พนักงานทั่วไป — ทั้งสอง — worker/src/email/decision-email.js
- **HR Hub: ใบลาของคุณไม่ได้รับการอนุมัติ** — อีเมล — พนักงานทั่วไป — ทั้งสอง — worker/src/email/decision-email.js
- **เหตุผลที่ไม่อนุมัติ** — อีเมล — พนักงานทั่วไป, หัวหน้ากะ — ทั้งสอง — worker/src/email/decision-email.js

## ยื่นใบลา (/leave/new)

- **ยื่นใบลา** (ชื่อหน้า) — /leave/new — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveRequestPage.vue
- **ระบบคำนวณวันทำการ (จันทร์–เสาร์ ไม่นับวันอาทิตย์และวันหยุด) และวันกลับมาทำงานให้อัตโนมัติ** — /leave/new — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveRequestPage.vue
- **← ใบลาของฉัน** — /leave/new — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveRequestPage.vue
- **ประเภทการลา** — /leave/new — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveRequestPage.vue
- **ระบุประเภทการลาอื่น ๆ** — /leave/new — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveRequestPage.vue
- **กะการทำงาน** — /leave/new — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveRequestPage.vue
- **วันที่เริ่มลา** — /leave/new — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveRequestPage.vue
- **วันที่สิ้นสุด** — /leave/new — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveRequestPage.vue
- **ใช้ OT หรือไม่** — /leave/new — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveRequestPage.vue
- **เหตุผล (ไม่บังคับ)** — /leave/new — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveRequestPage.vue
- **ใบรับรองแพทย์ (JPG, PNG หรือ PDF ไม่เกิน 10 MB)** — /leave/new — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveRequestPage.vue
- **เลือกไฟล์** — /leave/new — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveRequestPage.vue
- **การลาครั้งนี้ต้องแนบใบรับรองแพทย์** — /leave/new — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveRequestPage.vue
- **ยืนยันการยื่นใบลา** — /leave/new — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveRequestPage.vue
- **ยื่นใบลาเรียบร้อย** — /leave/new — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveRequestPage.vue
- **รหัสใบลา** — /leave/new — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveRequestPage.vue
- **รอผู้อนุมัติตรวจสอบ สถานะจะแสดงในหน้า “ใบลาของฉัน”** — /leave/new — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveRequestPage.vue
- **ดูรายการใบลา** — /leave/new — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveRequestPage.vue
- **ยื่นอีกใบ** — /leave/new — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/LeaveRequestPage.vue

## ปฏิทินการลา (/leave/calendar)

- **ปฏิทินการลา** (ชื่อหน้า) — /leave/calendar — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/components/LeaveCalendarView.vue
- **ปฏิทิน** (ปุ่มสลับมุมมอง) — /leave/calendar — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/components/LeaveCalendarView.vue
- **รายการ** (ปุ่มสลับมุมมอง) — /leave/calendar — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/components/LeaveCalendarView.vue
- **ก่อนหน้า** — /leave/calendar — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/components/LeaveCalendarView.vue
- **ถัดไป** — /leave/calendar — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/components/LeaveCalendarView.vue
- **วันนี้** — /leave/calendar — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/components/LeaveCalendarView.vue
- **อนุมัติแล้ว** (คำอธิบายสี) — /leave/calendar — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/components/LeaveCalendarView.vue
- **รออนุมัติ** (คำอธิบายสี) — /leave/calendar — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/components/LeaveCalendarView.vue
- **วันหยุด** (คำอธิบายสี และแถววันหยุด) — /leave/calendar — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/components/LeaveCalendarView.vue
- **ไม่มีรายการการลาในช่วงนี้** — /leave/calendar — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/components/LeaveCalendarView.vue
- **แผนก** — /leave/calendar — ผู้ดูแล HR — ทั้งสอง — src/components/LeaveCalendarView.vue
- **ทุกแผนก** — /leave/calendar — ผู้ดูแล HR — ทั้งสอง — src/components/LeaveCalendarView.vue
- **ปิด** (หน้าต่างรายละเอียด) — /leave/calendar — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/components/LeaveCalendarView.vue
- **ประเภทการลา** — /leave/calendar — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/components/LeaveCalendarView.vue
- **วันที่** — /leave/calendar — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/components/LeaveCalendarView.vue
- **สถานะ** — /leave/calendar — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/components/LeaveCalendarView.vue
- **ใบลาที่อนุมัติแล้วและรออนุมัติที่คุณมีสิทธิ์เห็น** — /leave/calendar — พนักงานทั่วไป, ผู้อนุมัติ — ทั้งสอง — src/components/LeaveCalendarView.vue
- **ลาวันนี้** — /leave/calendar — พนักงานทั่วไป, ผู้อนุมัติ — มือถือ — src/lib/leave-day.js
- **ดูรายละเอียด** — /leave/calendar — พนักงานทั่วไป, ผู้อนุมัติ — มือถือ — src/components/LeaveCalendarView.vue
- **รายละเอียดถูกจำกัดตามสิทธิ์** — /leave/calendar — พนักงานทั่วไป, ผู้อนุมัติ — มือถือ — src/components/LeaveCalendarView.vue
- **ไม่มีสิทธิ์ดูรายละเอียดใบลานี้** — /leave/calendar — พนักงานทั่วไป, ผู้อนุมัติ — มือถือ — src/components/LeaveCalendarView.vue
- **ไม่มีผู้ลาในวันนี้** — /leave/calendar — พนักงานทั่วไป, ผู้อนุมัติ — มือถือ — src/lib/leave-day.js
- **ใบลาที่อนุมัติแล้วและรออนุมัติของทุกแผนก** — /leave/calendar — ผู้ดูแล HR — ทั้งสอง — src/components/LeaveCalendarView.vue

## ข้อมูลส่วนตัว (/profile)

- **ข้อมูลส่วนตัว** (ชื่อหน้า) — /profile — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/ProfilePage.vue
- **แก้ไขข้อมูล** — /profile — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/ProfilePage.vue
- **คำนำหน้า** — /profile — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/ProfilePage.vue
- **ชื่อ-นามสกุล** — /profile — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/ProfilePage.vue
- **อีเมล** — /profile — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/ProfilePage.vue
- **เบอร์มือถือ** — /profile — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/ProfilePage.vue
- **แผนก** — /profile — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/ProfilePage.vue
- **รหัสพนักงาน** — /profile — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/ProfilePage.vue
- **ตำแหน่ง** — /profile — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/ProfilePage.vue
- **บันทึก** — /profile — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/ProfilePage.vue
- **ยกเลิก** — /profile — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/ProfilePage.vue
- **ยังไม่ได้ระบุอีเมล** — /profile — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/ProfilePage.vue
- **แผนกปัจจุบันปิดใช้งาน กรุณาเลือกแผนกที่ใช้งานอยู่เพื่อบันทึกการเปลี่ยนแปลง** — /profile — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/ProfilePage.vue
- **(ปิดใช้งาน)** (ต่อท้ายชื่อแผนกที่ปิดแล้ว) — /profile — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/pages/ProfilePage.vue

## การแจ้งเตือนใบลา (/profile และ /leave)

- **การแจ้งเตือนใบลา** — /profile, /leave — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/components/PushToggle.vue
- **เปิดอยู่** — /profile, /leave — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/components/NotificationSwitch.vue
- **ปิดอยู่** — /profile, /leave — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/components/NotificationSwitch.vue
- **เปิดเพื่อรับแจ้งเตือนเมื่อมีใบลารออนุมัติ หรือเมื่อใบลาของคุณได้รับการพิจารณา ไม่ส่งรายละเอียดการลาหรือเหตุผล** — /profile, /leave — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/components/PushToggle.vue
- **หากคุณเป็นผู้อนุมัติ ระบบจะส่งเฉพาะจำนวนรายการรออนุมัติแม้ออกจากระบบแล้ว โดยไม่มีชื่อหรือรายละเอียด** — /profile, /leave — ผู้อนุมัติ — ทั้งสอง — src/components/PushToggle.vue
- **ระบบใบลา** (ชื่อข้อความแจ้งเตือน) — ทุกหน้า — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — worker/src/push/payload.js
- **มีรายการรออนุมัติใหม่ 1 รายการ** — ทุกหน้า — ผู้อนุมัติ — ทั้งสอง — worker/src/push/payload.js
- **มีการอัปเดตใบลาของคุณ** — ทุกหน้า — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — worker/src/push/payload.js
- **คุณมีรายการรออนุมัติ** ต่อท้ายด้วยจำนวนรายการ — ทุกหน้า — ผู้อนุมัติ — ทั้งสอง — worker/src/push/payload.js
- **เบราว์เซอร์บล็อกการแจ้งเตือนไว้ โปรดเปิดในการตั้งค่าเบราว์เซอร์** — /profile — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/lib/notification-toggle.js
- **บันทึกไม่สำเร็จ ลองอีกครั้ง** — /profile — ทุกบทบาทที่มีประวัติพนักงาน — ทั้งสอง — src/lib/notification-toggle.js
- **บัญชีนี้เปิดการแจ้งเตือนใบลาไว้ เปิดบนเครื่องนี้ด้วยหรือไม่** — /leave, /hr, /meeting/controller — ทุกบทบาท — ทั้งสอง — src/components/NotificationBanner.vue
- **เปิดการแจ้งเตือน** — /leave, /hr, /meeting/controller — ทุกบทบาท — ทั้งสอง — src/components/NotificationBanner.vue
- **ไว้ภายหลัง** — /leave, /hr, /meeting/controller — ทุกบทบาท — ทั้งสอง — src/components/NotificationBanner.vue
- **เบราว์เซอร์นี้ปิดการแจ้งเตือนไว้** — /leave, /hr, /meeting/controller — ทุกบทบาท — ทั้งสอง — src/components/NotificationBanner.vue
- **ปุ่มแชร์** — /profile — พนักงานทั่วไป, ผู้ดูแล HR — มือถือ — src/components/PushToggle.vue

## รออนุมัติ (/leave/approvals)

- **รออนุมัติ** (ชื่อหน้า) — /leave/approvals — ผู้อนุมัติ — ทั้งสอง — src/pages/LeaveApprovalsPage.vue
- **เฉพาะใบลาที่คุณเป็นผู้อนุมัติ · อนุมัติหรือไม่อนุมัติได้ครั้งเดียวต่อใบลา** — /leave/approvals — ผู้อนุมัติ — ทั้งสอง — src/pages/LeaveApprovalsPage.vue
- **รายการ** (จำนวน เช่น 3 รายการ) — /leave/approvals — ผู้อนุมัติ — ทั้งสอง — src/pages/LeaveApprovalsPage.vue
- **ไม่มีใบลาที่รอคุณอนุมัติ** — /leave/approvals — ผู้อนุมัติ — ทั้งสอง — src/pages/LeaveApprovalsPage.vue
- **รออนุมัติ** (ป้ายบนใบลา) — /leave/approvals — ผู้อนุมัติ — ทั้งสอง — src/pages/LeaveApprovalsPage.vue
- **ช่วงวันที่** — /leave/approvals — ผู้อนุมัติ — ทั้งสอง — src/pages/LeaveApprovalsPage.vue
- **จำนวนวัน** — /leave/approvals — ผู้อนุมัติ — ทั้งสอง — src/pages/LeaveApprovalsPage.vue
- **กลับมาทำงาน** — /leave/approvals — ผู้อนุมัติ — ทั้งสอง — src/pages/LeaveApprovalsPage.vue
- **กะ / OT** — /leave/approvals — ผู้อนุมัติ — ทั้งสอง — src/pages/LeaveApprovalsPage.vue
- **เหตุผล:** — /leave/approvals — ผู้อนุมัติ — ทั้งสอง — src/pages/LeaveApprovalsPage.vue
- **เหตุผล (จำเป็นเมื่อไม่อนุมัติ)** — /leave/approvals — ผู้อนุมัติ — ทั้งสอง — src/pages/LeaveApprovalsPage.vue
- **อนุมัติ** — /leave/approvals — ผู้อนุมัติ — ทั้งสอง — src/pages/LeaveApprovalsPage.vue
- **ไม่อนุมัติ** — /leave/approvals — ผู้อนุมัติ — ทั้งสอง — src/pages/LeaveApprovalsPage.vue
- **กรุณาระบุเหตุผลที่ไม่อนุมัติ** — /leave/approvals — ผู้อนุมัติ — ทั้งสอง — src/pages/LeaveApprovalsPage.vue
- **ดำเนินการไม่สำเร็จ กรุณาลองใหม่** — /leave/approvals — ผู้อนุมัติ — ทั้งสอง — src/pages/LeaveApprovalsPage.vue

## อนุมัติจากลิงก์ในอีเมล (/approve/:token)

- **อนุมัติใบลา** (ชื่อหน้า) — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/components/ApprovalLinkView.vue
- **พนักงาน** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/components/ApprovalLinkView.vue
- **แผนก** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/components/ApprovalLinkView.vue
- **ประเภทการลา** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/components/ApprovalLinkView.vue
- **ช่วงวันที่** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/components/ApprovalLinkView.vue
- **จำนวนวัน** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/components/ApprovalLinkView.vue
- **กลับมาทำงาน** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/components/ApprovalLinkView.vue
- **กะ / OT** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/components/ApprovalLinkView.vue
- **ใบรับรองแพทย์** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/components/ApprovalLinkView.vue
- **เหตุผล:** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/components/ApprovalLinkView.vue
- **อนุมัติ** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/components/ApprovalLinkView.vue
- **ไม่อนุมัติ** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/components/ApprovalLinkView.vue
- **เหตุผลที่ไม่อนุมัติ (จำเป็น)** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/components/ApprovalLinkView.vue
- **ยืนยันไม่อนุมัติ** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/components/ApprovalLinkView.vue
- **ยกเลิก** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/components/ApprovalLinkView.vue
- **อนุมัติแล้ว** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/components/ApprovalLinkView.vue
- **ไม่อนุมัติแล้ว** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/components/ApprovalLinkView.vue
- **ลิงก์นี้ใช้ไม่ได้แล้ว** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/lib/approval-link.js
- **ลิงก์หมดอายุแล้ว** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/lib/approval-link.js
- **ลิงก์นี้ถูกใช้ไปแล้ว** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/lib/approval-link.js
- **ลิงก์ไม่ถูกต้องหรือถูกแทนที่แล้ว** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/lib/approval-link.js
- **กรุณาระบุเหตุผลที่ไม่อนุมัติ** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/lib/approval-link.js
- **เหตุผลต้องไม่เกิน 500 ตัวอักษร** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/lib/approval-link.js
- **โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/lib/approval-link.js
- **ลองใหม่** — /approve/:token — ผู้อนุมัติ — ทั้งสอง — src/components/ApprovalLinkView.vue

## ประวัติการอนุมัติ (/leave/approvals/history)

- **ประวัติการอนุมัติ** (ชื่อหน้า) — /leave/approvals/history — ผู้อนุมัติ, ผู้ดูแล HR — ทั้งสอง — src/pages/LeaveApprovalHistoryPage.vue
- **ตั้งแต่วันที่** — /leave/approvals/history — ผู้อนุมัติ, ผู้ดูแล HR — ทั้งสอง — src/pages/LeaveApprovalHistoryPage.vue
- **ถึงวันที่** — /leave/approvals/history — ผู้อนุมัติ, ผู้ดูแล HR — ทั้งสอง — src/pages/LeaveApprovalHistoryPage.vue
- **การตัดสินใจ** — /leave/approvals/history — ผู้อนุมัติ, ผู้ดูแล HR — ทั้งสอง — src/pages/LeaveApprovalHistoryPage.vue
- **ทั้งหมด** — /leave/approvals/history — ผู้อนุมัติ, ผู้ดูแล HR — ทั้งสอง — src/pages/LeaveApprovalHistoryPage.vue
- **ค้นหาชื่อ** — /leave/approvals/history — ผู้อนุมัติ, ผู้ดูแล HR — ทั้งสอง — src/pages/LeaveApprovalHistoryPage.vue
- **ค้นหา** — /leave/approvals/history — ผู้อนุมัติ, ผู้ดูแล HR — ทั้งสอง — src/pages/LeaveApprovalHistoryPage.vue
- **โหลดเพิ่ม** — /leave/approvals/history — ผู้อนุมัติ, ผู้ดูแล HR — ทั้งสอง — src/pages/LeaveApprovalHistoryPage.vue
- **รายละเอียดใบลา** — /leave/approvals/history — ผู้อนุมัติ, ผู้ดูแล HR — ทั้งสอง — src/pages/LeaveApprovalHistoryPage.vue
- **ปิด** — /leave/approvals/history — ผู้อนุมัติ, ผู้ดูแล HR — ทั้งสอง — src/pages/LeaveApprovalHistoryPage.vue
- **ไม่พบประวัติการอนุมัติในช่วงนี้** — /leave/approvals/history — ผู้อนุมัติ, ผู้ดูแล HR — ทั้งสอง — src/pages/LeaveApprovalHistoryPage.vue
- **โหลดประวัติการอนุมัติไม่สำเร็จ กรุณาลองใหม่** — /leave/approvals/history — ผู้อนุมัติ, ผู้ดูแล HR — ทั้งสอง — src/pages/LeaveApprovalHistoryPage.vue

## หน้าหลักของ HR (/hr)

- **หน้าหลัก** (ชื่อหน้า) — /hr — ผู้ดูแล HR — ทั้งสอง — src/pages/HrHomePage.vue
- **รายชื่อพนักงาน** (การ์ด) — /hr — ผู้ดูแล HR — ทั้งสอง — src/pages/HrHomePage.vue
- **นำเข้าพนักงาน** (การ์ด) — /hr — ผู้ดูแล HR — ทั้งสอง — src/pages/HrHomePage.vue
- **จัดการข้อมูลพนักงาน** (การ์ด) — /hr — ผู้ดูแล HR — ทั้งสอง — src/pages/HrHomePage.vue
- **เปิดหน้านี้ →** — /hr — ผู้ดูแล HR — ทั้งสอง — src/pages/HrHomePage.vue

## รายชื่อพนักงาน (/hr/employees)

- **รายชื่อพนักงาน** (ชื่อหน้า) — /hr/employees — ผู้ดูแล HR — ทั้งสอง — src/pages/HrEmployeesPage.vue
- **พิมพ์ชื่อ หรือรหัสพนักงาน** — /hr/employees — ผู้ดูแล HR — ทั้งสอง — src/pages/HrEmployeesPage.vue
- **ค้นหาพนักงาน** — /hr/employees — ผู้ดูแล HR — ทั้งสอง — src/pages/HrEmployeesPage.vue
- **รหัสพนักงาน** — /hr/employees — ผู้ดูแล HR — ทั้งสอง — src/pages/HrEmployeesPage.vue
- **ชื่อ-สกุล** — /hr/employees — ผู้ดูแล HR — ทั้งสอง — src/pages/HrEmployeesPage.vue
- **แผนก** — /hr/employees — ผู้ดูแล HR — ทั้งสอง — src/pages/HrEmployeesPage.vue
- **สถานะ** — /hr/employees — ผู้ดูแล HR — ทั้งสอง — src/pages/HrEmployeesPage.vue
- **ใช้งานอยู่** — /hr/employees — ผู้ดูแล HR — ทั้งสอง — src/pages/HrEmployeesPage.vue
- **ปิดการใช้งาน** — /hr/employees — ผู้ดูแล HR — ทั้งสอง — src/pages/HrEmployeesPage.vue
- **นำเข้าข้อมูลพนักงาน →** — /hr/employees — ผู้ดูแล HR — ทั้งสอง — src/pages/HrEmployeesPage.vue

## รายละเอียดพนักงาน (/hr/employees/:id)

- **รายละเอียดพนักงาน** — /hr/employees/:id — ผู้ดูแล HR — ทั้งสอง — src/pages/HrEmployeeDetailPage.vue
- **ดูเลขเต็ม** — /hr/employees/:id — ผู้ดูแล HR — ทั้งสอง — src/pages/HrEmployeeDetailPage.vue
- **ไม่พร้อมแสดง** — /hr/employees/:id — ผู้ดูแล HR — ทั้งสอง — src/pages/HrEmployeeDetailPage.vue

## จัดการข้อมูลพนักงาน (/hr/employees/manage)

- **จัดการข้อมูลพนักงาน** (ชื่อหน้า) — /hr/employees/manage — ผู้ดูแล HR — ทั้งสอง — src/pages/HrEmployeeDataPage.vue
- **แก้ไข** — /hr/employees/manage — ผู้ดูแล HR — ทั้งสอง — src/components/EmployeeDirectoryManager.vue
- **แก้ไขข้อมูลพนักงาน** — /hr/employees/manage — ผู้ดูแล HR — ทั้งสอง — src/components/EmployeeDirectoryManager.vue
- **เลือกแผนก** — /hr/employees/manage — ผู้ดูแล HR — ทั้งสอง — src/components/EmployeeDirectoryManager.vue
- **(ไม่บังคับ)** — /hr/employees/manage — ผู้ดูแล HR — ทั้งสอง — src/components/EmployeeDirectoryManager.vue
- **— ไม่ระบุตำแหน่ง —** — /hr/employees/manage — ผู้ดูแล HR — ทั้งสอง — src/components/EmployeeDirectoryManager.vue
- **บันทึก** — /hr/employees/manage — ผู้ดูแล HR — ทั้งสอง — src/components/EmployeeDirectoryManager.vue
- **ยกเลิก** — /hr/employees/manage — ผู้ดูแล HR — ทั้งสอง — src/components/EmployeeDirectoryManager.vue
- **รายการแผนกและตำแหน่ง** — /hr/employees/manage — ผู้ดูแล HR — ทั้งสอง — src/components/EmployeeDirectoryManager.vue
- **ชื่อแผนกใหม่** — /hr/employees/manage — ผู้ดูแล HR — ทั้งสอง — src/components/EmployeeDirectoryManager.vue
- **ชื่อตำแหน่งใหม่** — /hr/employees/manage — ผู้ดูแล HR — ทั้งสอง — src/components/EmployeeDirectoryManager.vue
- **เปลี่ยนชื่อ** — /hr/employees/manage — ผู้ดูแล HR — ทั้งสอง — src/components/EmployeeDirectoryManager.vue
- **ปิด** — /hr/employees/manage — ผู้ดูแล HR — ทั้งสอง — src/components/EmployeeDirectoryManager.vue

## นำเข้าพนักงาน (/hr/employees/import)

- **นำเข้าข้อมูลพนักงาน** — /hr/employees/import — ผู้ดูแล HR — คอมพิวเตอร์ — src/pages/HrEmployeeImportPage.vue
- **ดาวน์โหลดเทมเพลต .xlsx** — /hr/employees/import — ผู้ดูแล HR — คอมพิวเตอร์ — src/pages/HrEmployeeImportPage.vue
- **1. เลือกไฟล์** — /hr/employees/import — ผู้ดูแล HR — คอมพิวเตอร์ — src/pages/HrEmployeeImportPage.vue
- **เลือกไฟล์** — /hr/employees/import — ผู้ดูแล HR — คอมพิวเตอร์ — src/pages/HrEmployeeImportPage.vue
- **2. ตัวอย่างผลตรวจ** — /hr/employees/import — ผู้ดูแล HR — คอมพิวเตอร์ — src/pages/HrEmployeeImportPage.vue
- **เพิ่มใหม่** — /hr/employees/import — ผู้ดูแล HR — คอมพิวเตอร์ — src/pages/HrEmployeeImportPage.vue
- **อัปเดต** — /hr/employees/import — ผู้ดูแล HR — คอมพิวเตอร์ — src/pages/HrEmployeeImportPage.vue
- **ต้องให้เลือก** — /hr/employees/import — ผู้ดูแล HR — คอมพิวเตอร์ — src/pages/HrEmployeeImportPage.vue
- **คงค่าเดิม** — /hr/employees/import — ผู้ดูแล HR — คอมพิวเตอร์ — src/pages/HrEmployeeImportPage.vue
- **ใช้ค่าจากไฟล์** — /hr/employees/import — ผู้ดูแล HR — คอมพิวเตอร์ — src/pages/HrEmployeeImportPage.vue
- **ยืนยันการบันทึก** — /hr/employees/import — ผู้ดูแล HR — คอมพิวเตอร์ — src/pages/HrEmployeeImportPage.vue
- **3. บันทึกเรียบร้อย** — /hr/employees/import — ผู้ดูแล HR — คอมพิวเตอร์ — src/pages/HrEmployeeImportPage.vue
- **เลือกไฟล์ใหม่** — /hr/employees/import — ผู้ดูแล HR — คอมพิวเตอร์ — src/pages/HrEmployeeImportPage.vue

## จัดการรหัสผ่านพนักงาน (/hr/employees/password)

- **จัดการรหัสผ่านพนักงาน** — /hr/employees/password — ผู้ดูแล HR — ทั้งสอง — src/pages/HrPasswordPage.vue
- **1) รหัสผ่านเริ่มต้น (PIN 6 หลัก)** — /hr/employees/password — ผู้ดูแล HR — ทั้งสอง — src/pages/HrPasswordPage.vue
- **สร้างรหัสผ่านเริ่มต้น** — /hr/employees/password — ผู้ดูแล HR — ทั้งสอง — src/pages/HrPasswordPage.vue
- **คัดลอก** — /hr/employees/password — ผู้ดูแล HR — ทั้งสอง — src/pages/HrPasswordPage.vue
- **2) รหัสรีเซ็ต PIN (8 หลัก)** — /hr/employees/password — ผู้ดูแล HR — ทั้งสอง — src/pages/HrPasswordPage.vue
- **สร้างรหัสรีเซ็ต** — /hr/employees/password — ผู้ดูแล HR — ทั้งสอง — src/pages/HrPasswordPage.vue
- **← กลับไปรายชื่อพนักงาน** — /hr/employees/password — ผู้ดูแล HR — ทั้งสอง — src/pages/HrPasswordPage.vue

## ใบลาทั้งหมด / จัดการใบลา (/hr/leave)

- **จัดการใบลา** (ชื่อหน้า) — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **หน้านี้ไม่เปลี่ยนสถานะใบลา ใช้ได้เฉพาะการดูและคีย์ย้อนหลัง** — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **แผนก** — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **ทุกแผนก** — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **สถานะ** — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **ทุกสถานะ** — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **ประเภทการลา** — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **ตั้งแต่วันที่** — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **ถึงวันที่** — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **ค้นหา** — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **ล้างตัวกรอง** — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **คีย์ใบลาย้อนหลัง** — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **คีย์ย้อนหลัง** — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **รายละเอียดใบลา** — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **ส่งลิงก์อนุมัติใหม่** — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **ส่งลิงก์อนุมัติใหม่แล้ว (ลิงก์ใหม่มีอายุ 72 ชั่วโมง)** — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **ส่งลิงก์อนุมัติใหม่ไม่สำเร็จ กรุณาลองใหม่** — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **พิมพ์ / บันทึกเป็น PDF** — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **รออนุมัติ** (ตัวกรองสถานะ) — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **อนุมัติแล้ว** (ตัวกรองสถานะ) — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **ไม่อนุมัติ** (ตัวกรองสถานะ) — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue
- **ยกเลิก** (ตัวกรองสถานะ) — /hr/leave — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveRequestsPage.vue

## คีย์ใบลาย้อนหลัง (/hr/leave/backdated)

- **คีย์ใบลาย้อนหลัง** (ชื่อหน้า) — /hr/leave/backdated — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveBackdatedPage.vue
- **← จัดการใบลา** — /hr/leave/backdated — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveBackdatedPage.vue
- **ประเภทการลา** — /hr/leave/backdated — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveBackdatedPage.vue
- **ระบุประเภทการลาอื่น ๆ** — /hr/leave/backdated — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveBackdatedPage.vue
- **กะการทำงาน** — /hr/leave/backdated — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveBackdatedPage.vue
- **วันที่เริ่มลา** — /hr/leave/backdated — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveBackdatedPage.vue
- **วันที่สิ้นสุด** — /hr/leave/backdated — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveBackdatedPage.vue
- **ใช้ OT หรือไม่** — /hr/leave/backdated — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveBackdatedPage.vue
- **เหตุผล (ไม่บังคับ)** — /hr/leave/backdated — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveBackdatedPage.vue
- **มีใบรับรองแพทย์** — /hr/leave/backdated — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveBackdatedPage.vue
- **บันทึกใบลาย้อนหลัง** — /hr/leave/backdated — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveBackdatedPage.vue
- **บันทึกใบลาเรียบร้อย** — /hr/leave/backdated — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveBackdatedPage.vue
- **อนุมัติแล้ว (คีย์ย้อนหลัง)** — /hr/leave/backdated — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveBackdatedPage.vue
- **ดูรายการใบลา** — /hr/leave/backdated — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveBackdatedPage.vue
- **คีย์อีกใบ** — /hr/leave/backdated — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveBackdatedPage.vue

## วันหยุด (/hr/leave/holidays)

- **วันหยุดบริษัท** — /hr/leave/holidays — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveHolidaysPage.vue
- **วันทำการ = จันทร์–เสาร์ ไม่นับวันอาทิตย์และวันในรายการนี้** — /hr/leave/holidays — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveHolidaysPage.vue
- **วันที่** — /hr/leave/holidays — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveHolidaysPage.vue
- **ชื่อวันหยุด (ไม่บังคับ)** — /hr/leave/holidays — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveHolidaysPage.vue
- **เพิ่มวันหยุด** — /hr/leave/holidays — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveHolidaysPage.vue
- **รายการวันหยุด** — /hr/leave/holidays — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveHolidaysPage.vue
- **ลบ** — /hr/leave/holidays — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveHolidaysPage.vue
- **ยังไม่มีวันหยุดในระบบ** — /hr/leave/holidays — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveHolidaysPage.vue

## ผู้อนุมัติ (/hr/leave/approvers)

- **ตั้งค่าผู้อนุมัติ** — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveApproversPage.vue
- **เลือกแผนก** — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveApproversPage.vue
- **ทุกแผนก** — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveApproversPage.vue
- **ระดับแผนก** — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveApproversPage.vue
- **รายบุคคล** — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveApproversPage.vue
- **เพิ่มผู้อนุมัติ** — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveApproversPage.vue
- **ลำดับความสำคัญ (1–999, น้อยก่อน)** — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveApproversPage.vue
- **รายการผู้อนุมัติ** — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveApproversPage.vue
- **ใช้งานอยู่** (ป้ายสถานะในแถวผู้อนุมัติ) — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/lib/leave-approvers-view.js
- **ปิดใช้งาน** (ป้ายสถานะและปุ่มสลับ) — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/lib/leave-approvers-view.js
- **เปิดใช้งาน** (ปุ่มสลับเมื่อถูกปิดไว้) — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/lib/leave-approvers-view.js
- **ผู้อนุมัติต้องไม่ใช่พนักงานคนเดียวกัน** — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveApproversPage.vue
- **หัวหน้ากะที่รับแจ้งทราบ** — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/components/ShiftLeadsSection.vue
- **ชื่อกะ** — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/components/ShiftLeadsSection.vue
- **เพิ่มหัวหน้ากะ** — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/components/ShiftLeadsSection.vue
- **บันทึกหัวหน้ากะ** — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/components/ShiftLeadsSection.vue
- **ลบ** (หัวหน้ากะ) — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/components/ShiftLeadsSection.vue
- **ยังไม่มีหัวหน้ากะสำหรับแผนกนี้** — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/components/ShiftLeadsSection.vue
- **เลือกแผนกเพื่อตั้งหัวหน้ากะที่รับแจ้งทราบ** — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveApproversPage.vue
- **พนักงานคนนี้ไม่มีอีเมล จะไม่ได้รับแจ้งเตือน** — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/lib/shift-leads.js
- **กรุณากรอกชื่อกะ** — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/lib/shift-leads.js
- **ชื่อกะต้องไม่เกิน 30 ตัวอักษร** — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/lib/shift-leads.js
- **ชื่อกะซ้ำกันในแผนกนี้** — /hr/leave/approvers — ผู้ดูแล HR — ทั้งสอง — src/lib/shift-leads.js

## ใบรับรองแพทย์ (/hr/leave/certificates)

- **ใบรับรองแพทย์** (ชื่อหน้า) — /hr/leave/certificates — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveCertificatesPage.vue
- **พนักงาน** — /hr/leave/certificates — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveCertificatesPage.vue
- **พิมพ์ชื่อหรือรหัสพนักงาน** — /hr/leave/certificates — ผู้ดูแล HR — ทั้งสอง — src/components/EmployeePicker.vue
- **รายการที่พบ** — /hr/leave/certificates — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveCertificatesPage.vue
- **เปิดใบรับรองแพทย์** — /hr/leave/certificates — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveCertificatesPage.vue
- **ไม่พบใบรับรองแพทย์ของพนักงานคนนี้** — /hr/leave/certificates — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveCertificatesPage.vue
- **ดูใบรับรองแพทย์** — /leave — พนักงานทั่วไป — ทั้งสอง — src/leave-certificate.js

## ตั้งค่าใบลา (/hr/leave/settings)

- **ตั้งค่าใบลา** — /hr/leave/settings — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveSettingsPage.vue
- **เก็บใบรับรองแพทย์ (วัน)** — /hr/leave/settings — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveSettingsPage.vue
- **บันทึกการตั้งค่า** — /hr/leave/settings — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveSettingsPage.vue
- **เก็บข้อมูลใบลา** — /hr/leave/settings — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveSettingsPage.vue
- **เปิดการลบข้อมูลใบลาอัตโนมัติ** — /hr/leave/settings — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveSettingsPage.vue
- **เก็บข้อมูลใบลา (วัน)** — /hr/leave/settings — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveSettingsPage.vue
- **บันทึกจำนวนวันเก็บข้อมูล** — /hr/leave/settings — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveSettingsPage.vue
- **จำนวนวันต้องอยู่ระหว่าง 730 ถึง 3650 วัน** — /hr/leave/settings — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveSettingsPage.vue
- **ยืนยันเปิดการลบข้อมูลอัตโนมัติ** — /hr/leave/settings — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveSettingsPage.vue
- **ใบลาที่จะถูกลบตอนนี้** — /hr/leave/settings — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveSettingsPage.vue
- **ไฟล์ใบรับรองแพทย์ที่จะถูกลบตอนนี้** — /hr/leave/settings — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveSettingsPage.vue
- **ยืนยัน** — /hr/leave/settings — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveSettingsPage.vue
- **ยกเลิก** (ปิดหน้าต่างยืนยัน) — /hr/leave/settings — ผู้ดูแล HR — ทั้งสอง — src/pages/HrLeaveSettingsPage.vue

## หัวหน้าคุมการประชุม (/meeting/controller…)

- **ภาพรวมการประชุม** — /meeting/controller — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/ControllerOverviewPage.vue
- **ดู QR** — /meeting/controller — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/ControllerOverviewPage.vue
- **ดูรายชื่อ** — /meeting/controller — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/ControllerOverviewPage.vue
- **จัดการรายชื่อ** — /meeting/controller — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/ControllerOverviewPage.vue
- **QR ลงทะเบียนเข้าประชุม** — /meeting/controller/qr — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/ControllerQrPage.vue
- **ดาวน์โหลด QR (PNG)** — /meeting/controller/qr — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/ControllerQrPage.vue
- **คัดลอกลิงก์** — /meeting/controller/qr — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/ControllerQrPage.vue
- **สร้าง QR ใหม่** — /meeting/controller/qr — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/ControllerQrPage.vue
- **ช่วงเวลาเปิดรับลงทะเบียน** — /meeting/controller/qr — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/ControllerQrPage.vue
- **บันทึกเวลา** — /meeting/controller/qr — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/ControllerQrPage.vue
- **บันทึกรอบ** — /meeting/controller/qr — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/ControllerQrPage.vue
- **รายชื่อผู้เข้าประชุม** — /meeting/controller/roster — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/ControllerRosterPage.vue
- **เพิ่มพนักงาน** — /meeting/controller/roster — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/ControllerRosterPage.vue
- **นำออก** — /meeting/controller/roster — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/ControllerRosterPage.vue
- **ปิดรอบและตัดสถานะไม่เข้าร่วม** — /meeting/controller/registrants — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/RegistrantsPage.vue
- **แก้ไขสถานะการเข้าร่วมประชุม** — /meeting/controller/registrants — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/RegistrantsPage.vue
- **ยืนยันปิดรอบ** — /meeting/controller/registrants — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/RegistrantsPage.vue
- **ส่งออก Excel ตามตัวกรอง** — /meeting/controller/backfill — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/MeetingBackfillHistoryPage.vue
- **แดชบอร์ดการเข้าประชุม** — /meeting/controller/dashboard — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/ControllerDashboardPage.vue
- **อัตราลงทะเบียนรวม** — /meeting/controller/dashboard — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/ControllerDashboardPage.vue
- **ภาพรวมตามแผนก** — /meeting/controller/dashboard — หัวหน้าคุมประชุม — คอมพิวเตอร์ — src/pages/ControllerDashboardPage.vue

## ผู้ดูแลระบบ (/admin และ /admin/permissions)

- **ภาพรวมผู้ดูแล** (ชื่อหน้า) — /admin — ผู้ดูแลระบบ — ทั้งสอง — src/pages/AdminPage.vue
- **พนักงานที่ใช้งาน** — /admin — ผู้ดูแลระบบ — ทั้งสอง — src/lib/admin-overview.js
- **ใบลารออนุมัติ** — /admin — ผู้ดูแลระบบ — ทั้งสอง — src/lib/admin-overview.js
- **ผู้อนุมัติที่ใช้งาน** — /admin — ผู้ดูแลระบบ — ทั้งสอง — src/lib/admin-overview.js
- **วันหยุดปีนี้** — /admin — ผู้ดูแลระบบ — ทั้งสอง — src/lib/admin-overview.js
- **ใบลาทั้งหมด** (ทางลัด) — /admin — ผู้ดูแลระบบ — ทั้งสอง — src/lib/admin-overview.js
- **ต้องใช้สิทธิ์ HR** — /admin — ผู้ดูแลระบบ — ทั้งสอง — src/pages/AdminPage.vue
- **จัดการสิทธิ์ผู้ใช้** — /admin/permissions — ผู้ดูแลระบบ — ทั้งสอง — src/pages/AdminPermissionsPage.vue
- **ชื่อ หรือรหัสพนักงาน** — /admin/permissions — ผู้ดูแลระบบ — ทั้งสอง — src/pages/AdminPermissionsPage.vue
- **ค้นหาพนักงาน** — /admin/permissions — ผู้ดูแลระบบ — ทั้งสอง — src/pages/AdminPermissionsPage.vue
- **ผู้ดูแล HR** (สิทธิ์) — /admin/permissions — ผู้ดูแลระบบ — ทั้งสอง — src/lib/admin-permissions.js
- **ผู้ดูแลการประชุม** (สิทธิ์) — /admin/permissions — ผู้ดูแลระบบ — ทั้งสอง — src/lib/admin-permissions.js
- **ผู้ดูแลระบบ** (สิทธิ์) — /admin/permissions — ผู้ดูแลระบบ — ทั้งสอง — src/lib/admin-permissions.js
- **ผู้อนุมัติการลา** (สิทธิ์) — /admin/permissions — ผู้ดูแลระบบ — ทั้งสอง — src/lib/admin-permissions.js
- **บันทึกสิทธิ์** — /admin/permissions — ผู้ดูแลระบบ — ทั้งสอง — src/pages/AdminPermissionsPage.vue
- **ยกเลิกการแก้ไข** — /admin/permissions — ผู้ดูแลระบบ — ทั้งสอง — src/pages/AdminPermissionsPage.vue
- **ยืนยันถอดสิทธิ์** — /admin/permissions — ผู้ดูแลระบบ — ทั้งสอง — src/pages/AdminPermissionsPage.vue
- **ไม่พบพนักงานที่ตรงกับคำค้น** — /admin/permissions — ผู้ดูแลระบบ — ทั้งสอง — src/pages/AdminPermissionsPage.vue

## หน้าอื่น

- **หน้านี้กำลังพัฒนา** — หน้าที่ไม่มีอยู่ — ทุกบทบาท — ทั้งสอง — src/pages/PendingPage.vue
