# รายการอนุญาตไอคอนและ Vuetify Utility

ไฟล์นี้สรุปสิ่งที่ต้องทำเมื่อเพิ่มไอคอนหรือคลาส Vuetify Utility ใหม่ เพราะแอปใช้ไฟล์ฟอนต์และ CSS ที่ตัดมาเฉพาะรายการที่ใช้จริง

## ไอคอน Material Symbols

รายการไอคอนที่อนุญาตอยู่ใน `index.html` ในพารามิเตอร์ `icon_names` ของลิงก์ Google Fonts

ถ้าต้องใช้ไอคอนใหม่:

1. เปิด `index.html`
2. เพิ่มชื่อไอคอนแบบตรงทุกตัวอักษรลงใน `icon_names` เช่น `qr_code`
3. เรียงรายการตามรูปแบบเดิม
4. รัน `npx vitest run tests/asset-allowlists.test.js`

ถ้าไม่เพิ่มชื่อ ไอคอนจะแสดงเป็นข้อความธรรมดา เช่น `qr_code` แทนรูปไอคอน และจะไม่มี error ตอน build

## Vuetify Utility

รายการคลาส Vuetify Utility ที่อนุญาตอยู่ใน `src/vuetify-utilities.css`

ถ้าต้องใช้คลาสใหม่:

1. เปิด `src/vuetify-utilities.css`
2. เพิ่มคลาสและกฎ CSS ของคลาสนั้นในเลเยอร์ `vuetify-utilities.helpers`
3. รัน `npx vitest run tests/asset-allowlists.test.js`

ถ้าไม่เพิ่มคลาสในไฟล์นี้ คลาสจะไม่ถูกโหลด และหน้าจะสูญเสียสไตล์โดยไม่มี error ตอน build

## ห้ามลบ layer order

ห้ามลบหรือแก้ลำดับ `@layer` ใน `index.html` เพราะเป็นตัวกำหนดลำดับชั้น CSS ของ Vuetify และต้องอยู่ก่อน CSS ของคอมโพเนนต์ทั้งหมด

## คำสั่งตรวจสอบ

```text
npx vitest run tests/asset-allowlists.test.js
npx vitest run
```

ถ้า test ฟ้องชื่อไอคอนหรือคลาสที่หาย ให้เพิ่มรายการในไฟล์ allowlist ที่ถูกต้องแล้วรัน test ซ้ำ
